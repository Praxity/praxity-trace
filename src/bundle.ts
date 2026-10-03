import { mkdir, writeFile } from "node:fs/promises";
import { blockTexts, formattedText, oneLine, transcripts, visibleText } from "./text.ts";
import { join } from "node:path";

import { indexCourse, locateBlocks } from "./places.ts";

import { type Block, type Course, courseHash, typedLimits, type TypedText, type TypedNarration } from "./inspect.ts";

const STRUCTURAL = new Set(["divider", "blockBreak", "pageBreak", "variable", "logic"]);

/** The course as the reviewer sees it: every block's screen text, narration and transcripts, by ref. */
export function courseText(course: Course): string {
	const index = indexCourse(course);
	const out: string[] = [`# ${course.course.title}`];
	if (course.schema === "praxity-inspect/1") out.push("", typedLimits(course.projectionVersion), course.projectionVersion === 2 ? "Read Answer key, Scoring, Media, and Unresolved narration as authored evidence, not on-screen or confirmed spoken prose. An answer key does not establish scoring. A URI does not establish asset availability. Only a current blockRef links narration to a block." : "Respect these limits: absence from a partial projection is not evidence of absence. \"Feedback:\" is shown after a response. Never infer scoring or a correct answer from missing metadata.", `Unlinked narration entries: ${course.lessons.reduce((sum, lesson) => sum + (lesson.unlinkedNarrationCount ?? 0), 0)}.`);
	let heading = "";
	for (const item of index.blocks) {
		const lesson = course.lessons[item.lessonNumber - 1];
		const page = index.page(item.lessonNumber, item.page);
		const next = `## ${lesson?.title} (${item.lesson}), page ${item.page}: ${page?.title ?? ""}`;
		if (next !== heading) out.push("", next);
		heading = next;
		const texts = blockTexts(item.block);
		if (STRUCTURAL.has(item.block.type) && !(course.schema === "praxity-inspect/1" && (item.block.data.typedNarrations as TypedNarration[]).length)) continue;
		out.push("", `[${item.ref}] ${item.block.type}${item.block.data.scored === true ? " (scored)" : ""}`);
		if (item.block.coverage) out.push(`Text coverage: ${item.block.coverage}.`);
		if (item.block.type === "assessment" && item.block.ref) {
			if (item.block.assessment) {
				const { scoring, ...answer } = item.block.assessment;
				out.push(`Answer key and response semantics (not screen): ${JSON.stringify(answer)}`);
				out.push(`Scoring: ${scoring.scored ? "scored" : "completion-only"}; ${JSON.stringify(scoring)}`);
			} else out.push("Correct answers and scoring: unknown.");
		}
		if (item.block.assessmentGroup) out.push(`Assessment group (aggregation context, not a question): ${JSON.stringify({ ...item.block.assessmentGroup, memberRefs: item.block.assessmentGroup.memberRefs.map(ref => index.sourceBlock(ref)?.ref ?? ref) })}`);
		for (const media of item.block.media ?? []) {
			out.push(`Media: ${media.kind}; source ${JSON.stringify(media.source)}.`);
			if (media.alt !== null) out.push(`Media alternative (not screen prose): ${media.alt}`);
			if (media.description) out.push(`Media description (not screen prose): ${formattedText(media.description)}`);
			if (media.captionTracks.length) out.push(`Caption tracks (contents unavailable): ${JSON.stringify(media.captionTracks)}`);
		}
		for (const feedback of new Set(((item.block.data.typedTexts as TypedText[] | undefined) ?? []).filter(text => text.role === "feedback").map(text => oneLine(visibleText({ typedTexts: [{ ...text, role: "body" }] }).join(" "))))) out.push(`Feedback: ${feedback}`);
		for (const narration of (item.block.data.typedNarrations as TypedNarration[] | undefined) ?? []) out.push(`Narration source: ${JSON.stringify({ ref: narration.ref, origin: narration.origin, disabled: narration.disabled, location: narration.location, blockRef: narration.blockRef, pageRef: narration.pageRef, ...(course.projectionVersion === 2 ? { audio: narration.audio, duration: narration.duration, timings: narration.timings, audioProvenance: narration.audioProvenance } : {}) })}`);
		if (texts.screen) out.push(`Screen: ${texts.screen}`);
		for (const tip of texts.tooltips) out.push(`Tooltip on "${tip.term}": ${tip.text}`);
		for (const narration of texts.narration) out.push(`Narration: ${narration}`);
		for (const transcript of transcripts(item.block)) out.push(`Transcript (${transcript.origin === "authored" ? "authored" : "caption track"}, ${transcript.kind}): ${transcript.text}`);
	}
	if (course.projectionVersion === 2) for (const [l, lesson] of course.lessons.entries()) for (const narration of lesson.unlinkedNarration ?? []) out.push("", `Unresolved narration in L${l + 1} (not linked or confirmed spoken): ${JSON.stringify(narration)}`);
	return `${out.join("\n")}\n`;
}

const bundleVersion = (course: Course, version: string) => course.projectionVersion === 2 ? `${version}-projection-2` : version;

/** How every bundle prompt describes \`course.md\`. */
export const COURSE_TEXT_GUIDE = `Read \`course.md\`. Every block is labelled with a ref such as \`[3.9.2]\`: lesson, page, block. "Screen:" is text the learner sees; "Tooltip:" is shown only when the learner hovers or focuses the term; "Narration:" is the course voice-over script. "Transcript (authored, video):" and "Transcript (caption track, video):" are supplied media prose, with origin and media kind stated. Transcripts are a separate channel, not confirmed speech; they add no narration or playback time. Cite their owning block with channel "transcript" where the answer records a channel.`;

export async function writeBundle(
	course: Course,
	directory: string,
	view: string,
	promptVersion: string,
	prompt: string,
	extra: Record<string, unknown> = {},
): Promise<void> {
	await mkdir(directory, { recursive: true });
	const version = bundleVersion(course, promptVersion);
	const manifest = { ...(course.schema === "praxity-inspect/1" ? { coverage: "partial", limitations: typedLimits(course.projectionVersion), unlinkedNarrationCount: course.lessons.reduce((sum, lesson) => sum + (lesson.unlinkedNarrationCount ?? 0), 0) } : {}), view, promptVersion: version, courseHash: courseHash(course), ...extra };
	await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	await writeFile(join(directory, "course.md"), courseText(course));
	await writeFile(join(directory, "prompt.md"), course.projectionVersion === 2 ? prompt.replace(`"promptVersion": "${promptVersion}"`, `"promptVersion": "${version}"`) : prompt);
}

/**
 * Opens a model's answer: rejects another view, prompt version or course revision,
 * and returns field readers that name the offending path.
 */
export function readAnswer(json: string, course: Course, view: string, promptVersion: string) {
	const raw = JSON.parse(json) as Record<string, unknown>;
	const problem = (message: string): never => {
		throw new Error(`Invalid ${view} answer: ${message}`);
	};
	const version = bundleVersion(course, promptVersion);
	if (raw.view !== view || raw.promptVersion !== version) {
		problem(`expected view "${view}" and promptVersion "${version}"`);
	}
	if (raw.courseHash !== courseHash(course)) {
		problem("it was prepared for a different course revision; prepare a new bundle");
	}
	const types = new Map(locateBlocks(course).map((item) => [item.ref, item.block.type]));
	return {
		raw,
		problem,
		types,
		ref: (value: unknown, at: string): string =>
			typeof value === "string" && types.has(value) ? value : problem(`${at} is not a ref in this course`),
		text: (value: unknown, at: string): string => (typeof value === "string" ? value : problem(`${at} must be a string`)),
		list: (value: unknown, at: string): unknown[] => (Array.isArray(value) ? value : problem(`${at} must be an array`)),
		record: (value: unknown, at: string): Record<string, unknown> =>
			typeof value === "object" && value !== null ? (value as Record<string, unknown>) : problem(`${at} must be an object`),
	};
}

/** Read a quoted span from the cited block and channel, preserving terms' tooltip handling. */
export function readSpan(
	answer: ReturnType<typeof readAnswer>,
	block: Block,
	value: unknown,
	at: string,
	channel: "screen" | "narration" | "transcript",
	ref: string,
): string {
	const span = oneLine(answer.text(value, at));
	const texts = blockTexts(block);
	const source = channel === "screen" ? [texts.screen, ...texts.tooltips.map((tip) => tip.text)] : texts[channel];
	if (!span || !source.some((line) => oneLine(line).includes(span))) {
		answer.problem(`${at} "${span}" is not in the ${channel} text of ${ref}`);
	}
	return span;
}

export interface Interpretation {
	text: string;
	refs: string[];
}

export function readInterpretation(answer: ReturnType<typeof readAnswer>): Interpretation[] {
	const { raw, list, record, text, ref } = answer;
	return list(raw.interpretation ?? [], "interpretation").map((value, i) => {
		const item = record(value, `interpretation[${i}]`);
		return {
			text: text(item.text, `interpretation[${i}].text`),
			refs: list(item.refs, `interpretation[${i}].refs`).map((r, j) => ref(r, `interpretation[${i}].refs[${j}]`)),
		};
	});
}
