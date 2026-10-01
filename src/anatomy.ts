import type { Block, Course, SourceLocation, TypedNarration, TypedAssessment } from "./inspect.ts";
import { contentBlocks, pageKey } from "./places.ts";
import { countWords, narrations, type PreviewLine, previewLines, narrationText, wordCount } from "./text.ts";

/** A question with a right answer (GLOSSARY.md): a correct option or a matching pair. */
export function isKnowledgeCheck(block: Block): boolean | null {
	if (block.type !== "assessment") return false;
	if (block.ref) return block.assessment?.correctness === "keyed" ? true : null;
	const options = Array.isArray(block.data.options) ? (block.data.options as Array<Record<string, unknown>>) : [];
	return options.some((option) => option.correct === true) || (Array.isArray(block.data.pairs) && block.data.pairs.length > 0);
}


/**
 * What the learner does with a block. Chosen for design decisions, not grammar
 * categories: a table is read like text, an accordion is explored.
 */
export const ROLES = ["text", "media", "explore", "response"] as const;
export type Role = (typeof ROLES)[number];

/** Default roles; card and sequence settings are resolved by roleOf. */
export const ROLE_BY_TYPE: Record<string, Role> = {
	text: "text",
	quote: "text",
	note: "text",
	code: "text",
	equation: "text",
	table: "text",
	stats: "text",
	image: "media",
	video: "media",
	audio: "media",
	document: "media",
	embed: "media",
	imageComparison: "media",
	chart: "media",
	heroCover: "media",
	accordion: "explore",
	tabs: "explore",
	sequence: "text",
	card: "explore",
	labeledGraphic: "explore",
	assessment: "response",
	checklist: "response",
	rating: "response",
	signature: "response",
};

/**
 * A block's role. Cards hide content only as flip cards or a carousel (`layout: slides`); a grid,
 * masonry or rows of cards shows every card at once, so it reads like text.
 * Sequences put steps in a scroll strip only when horizontal and scrollable. Schema 1 omits
 * those settings, so its sequences count as text without inferring hidden content.
 */
export function roleOf(block: { type: string; data?: Record<string, unknown> }): Role | undefined {
	if (block.type === "sequence") return block.data?.orientation === "horizontal" && block.data?.scrollable === true ? "explore" : "text";
	if (block.type !== "card") return ROLE_BY_TYPE[block.type];
	const items = Array.isArray(block.data?.items) ? block.data.items : [];
	const flips = items.some((item) => typeof item === "object" && item !== null && typeof (item as { back?: unknown }).back === "string" && (item as { back: string }).back.trim() !== "");
	return block.data?.layout === "slides" || flips ? "explore" : "text";
}

export interface Mark {
	ref?: string;
	sourceRef?: string;
	parentRef?: string | null;
	location?: SourceLocation | null;
	narration?: TypedNarration[];
	lesson: string;
	page: number;
	/** Position within the lesson, counting only charted blocks. */
	order: number;
	role: Role;
	type: string;
	knowledgeCheck?: boolean | null;
	scoring?: TypedAssessment["scoring"];
	coverage?: Block["coverage"];
	line: number | null;
	words: number;
}

/** Adult silent reading of non-fiction (Brysbaert, 2019). */
export const READING_WPM = 238;
/** Used for schema 1 script estimates and when schema 0 has no measured audio. */
const FALLBACK_SPEAKING_WPM = 150;

export interface PagePace {
	measurementStatus?: "partial";
	narrationDurationKnown?: boolean;
	narration?: TypedNarration[];
	number: number;
	title: string;
	words: number;
	readingSeconds: number;
	/** Measured schema 0 audio plus script estimates; schema 1 is all script estimates. */
	narrationSeconds: number;
	estimatedNarrationSeconds: number;
	recordedNarration?: Array<{ ref: string; seconds: number; location: SourceLocation | null; provenance: "sidecar-recorded" }>;
	preview?: { lines: PreviewLine[]; narrated: boolean; checks: number; activities: number; unknownResponses?: number };
}

export interface LessonAnatomy {
	file: string;
	title: string;
	pages: number;
	words: number;
	counts: Record<Role, number>;
	marks: Mark[];
	pace: PagePace[];
}

/** Course minutes at the start of each page, keyed "lesson.page"; a page lasts its narration or reading time, whichever is longer. */
export function pageClock(anatomy: LessonAnatomy[]): { startOf: Map<string, number>; lessons: Array<{ title: string; start: number }>; totalMinutes: number } {
	const startOf = new Map<string, number>();
	const lessons: Array<{ title: string; start: number }> = [];
	let clock = 0;
	anatomy.forEach((lesson, l) => {
		lessons.push({ title: lesson.title, start: clock / 60 });
		for (const page of lesson.pace) {
			startOf.set(pageKey(l + 1, page.number), clock / 60);
			clock += Math.max(page.readingSeconds, page.narrationSeconds);
		}
	});
	return { startOf, lessons, totalMinutes: clock / 60 };
}

/** A run of consecutive pages within one lesson, with the time they take. */
export interface Stretch {
	lesson: number;
	from: number;
	to: number;
	pages: number;
	/** Each page's narration or reading time, whichever is longer. */
	seconds: number;
}

/** Presentation rhythm, described rather than judged: the longest runs of one kind of page. */
export interface Rhythm {
	withoutAction: Stretch[];
	textOnly: Stretch[];
	/** The model whose alignment review also found activities in prose, or null when blocks alone decided. */
	generatedBy: string | null;
}

const MIN_STRETCH = 4;

/** `generated` holds the "lesson.page" keys where an alignment review found an activity or check, prose instructions included. */
export function rhythm(lessons: LessonAnatomy[], generated?: { model: string; pages: Set<string> }): Rhythm {
	const acting = generated?.pages ?? new Set<string>();
	const runs = (keep: (marks: Mark[], key: string) => boolean) =>
		lessons
			.flatMap((lesson, index) => {
				const found: Stretch[] = [];
				let run: Stretch | null = null;
				for (const page of lesson.pace) {
					if (!keep(lesson.marks.filter((mark) => mark.page === page.number), pageKey(index + 1, page.number))) {
						run = null;
						continue;
					}
					const seconds = Math.max(page.readingSeconds, page.narrationSeconds);
					if (run) Object.assign(run, { to: page.number, pages: run.pages + 1, seconds: run.seconds + seconds });
					else found.push((run = { lesson: index + 1, from: page.number, to: page.number, pages: 1, seconds }));
				}
				return found;
			})
			.filter((run) => run.pages >= MIN_STRETCH)
			.sort((a, b) => b.seconds - a.seconds || b.pages - a.pages)
			.slice(0, 3);
	return {
		withoutAction: runs((marks, key) => !acting.has(key) && !marks.some((mark) => mark.role === "response")),
		textOnly: runs((marks) => marks.every((mark) => mark.role === "text")),
		generatedBy: generated?.model ?? null,
	};
}


export function anatomy(course: Course): { speakingWpm: number; lessons: LessonAnatomy[] } {
	const timed = course.lessons
		.flatMap((lesson) => lesson.pages)
		.flatMap((page) => narrations([page.data, page.blocks]))
		.filter((segment) => segment.seconds !== null);
	const timedSeconds = timed.reduce((sum, segment) => sum + (segment.seconds ?? 0), 0);
	const speakingWpm =
		timedSeconds > 0
			? (timed.reduce((sum, segment) => sum + wordCount(narrationText(segment)), 0) / timedSeconds) * 60
			: FALLBACK_SPEAKING_WPM;
	const lessons = course.lessons.map((lesson) => {
		const counts: Record<Role, number> = { text: 0, media: 0, explore: 0, response: 0 };
		const marks: Mark[] = [];
		const pace: PagePace[] = [];
		let words = 0;
		for (const page of lesson.pages) {
			let pageWords = 0;
			const blocks = page.blocks.flatMap(contentBlocks);
			for (const block of blocks) {
				const blockWords = countWords(block.data ?? {});
				pageWords += blockWords;
				const role = roleOf(block);
				if (!role) continue;
				counts[role] += 1;
				marks.push({
					lesson: lesson.file,
					page: page.number,
					order: marks.length,
					role,
					type: block.type,
					knowledgeCheck: block.type === "assessment" ? isKnowledgeCheck(block) : undefined,
					...(block.assessment ? { scoring: block.assessment.scoring } : {}),
					line: block.line,
					coverage: block.coverage,
					ref: course.schema === "praxity-inspect/1" ? `${course.lessons.indexOf(lesson) + 1}.${page.number}.${page.blocks.indexOf(block) + 1}` : undefined,
					sourceRef: block.ref, parentRef: block.parentRef, location: block.location, narration: block.data.typedNarrations as TypedNarration[] | undefined,
					words: blockWords,
				});
			}
			words += pageWords;
			let measured = 0;
			let estimated = 0;
			for (const segment of narrations([page.data, page.blocks])) {
				if (segment.seconds === null) estimated += (wordCount(narrationText(segment)) / speakingWpm) * 60;
				else measured += segment.seconds;
			}
			pace.push({
				number: page.number,
				measurementStatus: course.schema === "praxity-inspect/1" ? "partial" : undefined,
				narrationDurationKnown: course.schema === "praxity-inspect/1" ? false : undefined,
				narration: lesson.narration?.filter(item => item.pageRef === page.ref),
				...(course.projectionVersion === 2 ? { recordedNarration: (lesson.narration ?? []).filter(item => item.pageRef === page.ref && item.duration != null).map(item => ({ ref: item.ref, seconds: item.duration!.seconds, location: item.location, provenance: "sidecar-recorded" as const })) } : {}),
				title: page.title,
				words: pageWords,
				readingSeconds: (pageWords / READING_WPM) * 60,
				narrationSeconds: measured + estimated,
				estimatedNarrationSeconds: estimated,
				preview: {
					lines: previewLines(page.blocks, page.title),
					narrated: measured + estimated > 0,
					checks: blocks.filter(isKnowledgeCheck).length,
					...(course.schema === "praxity-inspect/1" ? { unknownResponses: blocks.filter((block) => isKnowledgeCheck(block) === null).length } : {}),
					activities: blocks.filter((block) => roleOf(block) === "response" && isKnowledgeCheck(block) === false).length,
				},
			});
		}
		return {
			file: lesson.file,
			title: lesson.title,
			pages: lesson.pages.length,
			words,
			counts,
			marks,
			pace,
		};
	});
	return { speakingWpm, lessons };
}
