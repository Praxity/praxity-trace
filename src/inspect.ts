import { createHash } from "node:crypto";

/** Output of Studio's `praxity inspect`. Block `data` is opaque grammar data. */
export interface SourceLocation { file: string; startLine: number; endLine: number }
export interface TypedText { ref: string; role: string; value: string; format: "html" | "markdown" | "plain"; location: SourceLocation | null }
export interface Asset { uri: string; availability: "present" | "missing" | "remote" | "blocked"; sha256: string | null }
export interface FormattedText { value: string; format: TypedText["format"] }
export interface TypedMedia { kind: string; source: Asset | null; alt: string | null; decorative: boolean; description: FormattedText | null; caption: FormattedText | null; transcript: FormattedText | null; captionTracks: Array<{ source: Asset | null; language: string | null; label: string | null; kind: string | null; default: boolean }> }
export interface TypedAssessment { responseType: string; correctness: "keyed" | "open" | "unavailable"; scoring: { gradingMode: string; scored: boolean; points: number | null; required: boolean; attempts: number; feedbackMode: string | null }; [key: string]: unknown }
export interface TypedAssessmentGroup { memberRefs: string[]; unresolvedMemberCount: number; mode: string; requireAll: boolean; passingScore: number | null; pointsOverride: number | null; aggregation: string }
export interface TypedNarration extends TypedText { blockRef: string | null; pageRef: string | null; origin: "sidecar" | "derived"; disabled: boolean; audio?: Asset | null; duration?: { seconds: number; provenance: "sidecar-recorded"; measurement: "unknown"; isFullFileDuration: false } | null; timings?: unknown; audioProvenance?: unknown; unresolvedAnchor?: { kind: string; type: string | null; page: number | null; label: string | null } }

export interface Block {
	ref?: string;
	parentRef?: string | null;
	location?: SourceLocation | null;
	coverage?: "text" | "container" | "unsupported";
	assessment?: TypedAssessment;
	assessmentGroup?: TypedAssessmentGroup;
	media?: TypedMedia[];
	id: string;
	type: string;
	line: number | null;
	data: Record<string, unknown>;
}

export interface Page {
	ref?: string;
	id: string;
	number: number;
	title: string;
	data: Record<string, unknown>;
	blocks: Block[];
}

export interface Lesson {
	narration?: TypedNarration[];
	unlinkedNarrationCount?: number;
	unlinkedNarration?: TypedNarration[];
	file: string;
	title: string;
	sha256: string;
	pages: Page[];
}

export interface Course {
	schema: "praxity-inspect/0" | "praxity-inspect/1" | "praxity-html/0";
	revision?: string;
	projectionVersion?: 2;
	studioVersion: string;
	course: { title: string; locale: string };
	lessons: Lesson[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function fail(path: string, expected: string): never {
	throw new Error(`Invalid inspect JSON at ${path}: expected ${expected}.`);
}

function string(value: unknown, path: string): string {
	return typeof value === "string" ? value : fail(path, "a string");
}

function array(value: unknown, path: string): unknown[] {
	return Array.isArray(value) ? value : fail(path, "an array");
}

function object(value: unknown, path: string): Record<string, unknown> {
	return isObject(value) ? value : fail(path, "an object");
}

/** Validates the fields Trace reads; everything else passes through untouched. */
export function parseCourse(json: string): Course {
	const root = object(JSON.parse(json), "$");
	if (root.ok !== true) fail("$.ok", "true (inspect reported an error)");
	if (root.schema === "praxity-inspect/1") return parseTypedCourse(root);
	if (root.schema !== "praxity-inspect/0") fail("$.schema", '"praxity-inspect/0"');
	const course = object(root.course, "$.course");
	return {
		schema: root.schema,
		studioVersion: string(root.studioVersion, "$.studioVersion"),
		course: { title: string(course.title, "$.course.title"), locale: string(course.locale, "$.course.locale") },
		lessons: array(root.lessons, "$.lessons").map((rawLesson, l) => {
			const lesson = object(rawLesson, `$.lessons[${l}]`);
			return {
				file: string(lesson.file, `$.lessons[${l}].file`),
				title: string(lesson.title, `$.lessons[${l}].title`),
				sha256: string(lesson.sha256, `$.lessons[${l}].sha256`),
				pages: array(lesson.pages, `$.lessons[${l}].pages`).map((rawPage, p) => {
					const at = `$.lessons[${l}].pages[${p}]`;
					const page = object(rawPage, at);
					return withPageNarration({
						id: string(page.id, `${at}.id`),
						number: typeof page.number === "number" ? page.number : fail(`${at}.number`, "a number"),
						title: string(page.title, `${at}.title`),
						data: isObject(page.data) ? page.data : {},
						blocks: array(page.blocks, `${at}.blocks`).map((rawBlock, b) => {
							const block = object(rawBlock, `${at}.blocks[${b}]`);
							return {
								id: string(block.id, `${at}.blocks[${b}].id`),
								type: string(block.type, `${at}.blocks[${b}].type`),
								line: typeof block.line === "number" ? block.line : null,
								data: isObject(block.data) ? block.data : {},
							};
						}),
					});
				}),
			};
		}),
	};
}

/**
 * Views read narration from blocks. Studio can also narrate a whole page; that narration plays with the
 * page, so Trace attributes it to the page's first block.
 */
export function withPageNarration(page: Page): Page {
	const narration = typeof page.data.narration === "string" ? page.data.narration.trim() : "";
	const [head, ...rest] = page.blocks;
	if (!narration || !head) return page;
	const own = typeof head.data.narration === "string" ? head.data.narration : "";
	return { ...page, blocks: [{ ...head, data: { ...head.data, narration: own ? `${narration}\n\n${own}` : narration } }, ...rest] };
}

/** Identifies the course revision: changes whenever any lesson source changes. */
export function courseHash(course: Course): string {
	if (course.schema === "praxity-inspect/1") return createHash("sha256").update(`trace-inspect/3\0${course.revision}`).digest("hex");
	return createHash("sha256")
		.update(course.lessons.map((lesson) => `${lesson.file}\0${lesson.sha256}`).join("\n"))
		.digest("hex");
}

/** Schema 1 is a text projection, never opaque grammar data. */
function parseTypedCourse(root: Record<string, unknown>): Course {
	if (root.projectionVersion !== undefined && root.projectionVersion !== 2) fail("$.projectionVersion", "2 or absent for earlier schema 1");
	const expanded = root.projectionVersion === 2;
	const refs = new Set<string>();
	const ref = (value: unknown, at: string) => {
		const result = string(value, at);
		if (!result || refs.has(result)) fail(at, "a nonempty, unique ref");
		refs.add(result); return result;
	};
	const integer = (value: unknown, at: string, min = 1): number => typeof value === "number" && Number.isSafeInteger(value) && value >= min ? value : fail(at, `an integer >= ${min}`);
	const location = (value: unknown, at: string): SourceLocation | null => {
		if (value === null) return null;
		const raw = object(value, at);
		const startLine = integer(raw.startLine, `${at}.startLine`);
		return { file: string(raw.file, `${at}.file`), startLine, endLine: integer(raw.endLine, `${at}.endLine`, startLine) };
	};
	const text = (value: unknown, at: string): TypedText => {
		const raw = object(value, at);
		if (typeof raw.format !== "string" || !["html", "markdown", "plain"].includes(raw.format)) fail(`${at}.format`, "html, markdown or plain");
		return { ref: ref(raw.ref, `${at}.ref`), role: string(raw.role, `${at}.role`), value: string(raw.value, `${at}.value`), format: raw.format as TypedText["format"], location: location(raw.location, `${at}.location`) };
	};
	const optional = (value: unknown, at: string) => value === null ? null : string(value, at);
	const boolean = (value: unknown, at: string) => typeof value === "boolean" ? value : fail(at, "a boolean");
	const finite = (value: unknown, at: string) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fail(at, "a nonnegative finite number");
	const asset = (value: unknown, at: string): Asset | null => {
		if (value === null) return null;
		const raw = object(value, at), availability = raw.availability;
		if (!["present", "missing", "remote", "blocked"].includes(availability as string)) fail(`${at}.availability`, "present, missing, remote or blocked");
		const sha256 = optional(raw.sha256, `${at}.sha256`);
		if (sha256 !== null && !/^[a-f0-9]{64}$/.test(sha256)) fail(`${at}.sha256`, "a SHA-256 fingerprint or null");
		if ((availability === "present") !== (sha256 !== null)) fail(`${at}.sha256`, "a hash exactly when the local asset is present");
		return { uri: string(raw.uri, `${at}.uri`), availability: availability as Asset["availability"], sha256 };
	};
	const formatted = (value: unknown, at: string): FormattedText | null => {
		if (value === null) return null;
		const raw = object(value, at);
		if (!["html", "markdown", "plain"].includes(raw.format as string)) fail(`${at}.format`, "html, markdown or plain");
		return { value: string(raw.value, `${at}.value`), format: raw.format as FormattedText["format"] };
	};
	const narrationEvidence = (raw: Record<string, unknown>, at: string) => {
		if (!expanded) return {};
		const duration = raw.duration === null ? null : object(raw.duration, `${at}.duration`);
		if (duration && (duration.provenance !== "sidecar-recorded" || duration.measurement !== "unknown" || duration.isFullFileDuration !== false)) fail(`${at}.duration`, "sidecar-recorded duration with unknown measurement and non-full-file status");
		return {
			audio: asset(raw.audio, `${at}.audio`),
			timings: raw.timings ?? null,
			audioProvenance: raw.audioProvenance ?? null,
			duration: duration ? { seconds: finite(duration.seconds, `${at}.duration.seconds`), provenance: "sidecar-recorded" as const, measurement: "unknown" as const, isFullFileDuration: false as const } : null,
		};
	};
	const metadata = object(root.course, "$.course");
	const revision = string(root.revision, "$.revision");
	if (!/^[a-f0-9]{64}$/.test(revision)) fail("$.revision", "a SHA-256 fingerprint");
	const files = new Set<string>();
	const lessons = array(root.lessons, "$.lessons").map((value, l): Lesson => {
		const at = `$.lessons[${l}]`, raw = object(value, at);
		const file = string(raw.file, `${at}.file`);
		if (files.has(file)) fail(`${at}.file`, "a unique lesson file");
		files.add(file);
		const blockPages = new Map<string, Page>();
		const assessmentRefs = new Set<string>();
		const numbers = new Set<number>();
		const pages = array(raw.pages, `${at}.pages`).map((value, p): Page => {
			const path = `${at}.pages[${p}]`, rawPage = object(value, path);
			const number = integer(rawPage.number, `${path}.number`);
			if (numbers.has(number)) fail(`${path}.number`, "a unique page number");
			numbers.add(number);
			const page: Page = { ref: ref(rawPage.ref, `${path}.ref`), id: rawPage.id === null ? "" : string(rawPage.id, `${path}.id`), number, title: string(rawPage.title, `${path}.title`), data: {}, blocks: [] };
			const ancestry: string[] = [];
			page.blocks = array(rawPage.blocks, `${path}.blocks`).map((value, b): Block => {
				const where = `${path}.blocks[${b}]`, rawBlock = object(value, where);
				const blockRef = ref(rawBlock.ref, `${where}.ref`);
				const parentRef = rawBlock.parentRef === null ? null : string(rawBlock.parentRef, `${where}.parentRef`);
				if (parentRef !== null && !ancestry.includes(parentRef)) fail(`${where}.parentRef`, "an ancestor in this page's preorder list");
				ancestry.splice(parentRef === null ? 0 : ancestry.indexOf(parentRef) + 1); ancestry.push(blockRef);
				if (typeof rawBlock.coverage !== "string" || !["text", "container", "unsupported"].includes(rawBlock.coverage)) fail(`${where}.coverage`, "text, container or unsupported");
				const source = location(rawBlock.location, `${where}.location`);
				if (source && source.file !== file) fail(`${where}.location.file`, "the containing lesson file");
				blockPages.set(blockRef, page);
				if (rawBlock.type === "assessment") assessmentRefs.add(blockRef);
				let assessment: TypedAssessment | undefined;
				if (expanded && rawBlock.assessment !== undefined) {
					const raw = object(rawBlock.assessment, `${where}.assessment`), score = object(raw.scoring, `${where}.assessment.scoring`);
					if (!["keyed", "open", "unavailable"].includes(raw.correctness as string)) fail(`${where}.assessment.correctness`, "keyed, open or unavailable");
					assessment = { ...raw, responseType: string(raw.responseType, `${where}.assessment.responseType`), correctness: raw.correctness as TypedAssessment["correctness"], scoring: { gradingMode: string(score.gradingMode, `${where}.assessment.scoring.gradingMode`), scored: boolean(score.scored, `${where}.assessment.scoring.scored`), points: score.points === null ? null : finite(score.points, `${where}.assessment.scoring.points`), required: boolean(score.required, `${where}.assessment.scoring.required`), attempts: integer(score.attempts, `${where}.assessment.scoring.attempts`, 0), feedbackMode: optional(score.feedbackMode, `${where}.assessment.scoring.feedbackMode`) } };
				}
				let assessmentGroup: TypedAssessmentGroup | undefined;
				if (expanded && rawBlock.assessmentGroup !== undefined) {
					const raw = object(rawBlock.assessmentGroup, `${where}.assessmentGroup`);
					if (raw.aggregation !== "mean-of-scored-member-percentages") fail(`${where}.assessmentGroup.aggregation`, "mean-of-scored-member-percentages");
					assessmentGroup = { memberRefs: array(raw.memberRefs, `${where}.assessmentGroup.memberRefs`).map((v, i) => string(v, `${where}.assessmentGroup.memberRefs[${i}]`)), unresolvedMemberCount: integer(raw.unresolvedMemberCount, `${where}.assessmentGroup.unresolvedMemberCount`, 0), mode: string(raw.mode, `${where}.assessmentGroup.mode`), requireAll: boolean(raw.requireAll, `${where}.assessmentGroup.requireAll`), passingScore: raw.passingScore === null ? null : finite(raw.passingScore, `${where}.assessmentGroup.passingScore`), pointsOverride: raw.pointsOverride === null ? null : finite(raw.pointsOverride, `${where}.assessmentGroup.pointsOverride`), aggregation: raw.aggregation };
				}
				const media = expanded && rawBlock.media !== undefined ? array(rawBlock.media, `${where}.media`).map((value, i): TypedMedia => {
					const at = `${where}.media[${i}]`, raw = object(value, at);
					return { kind: string(raw.kind, `${at}.kind`), source: asset(raw.source, `${at}.source`), alt: optional(raw.alt, `${at}.alt`), decorative: boolean(raw.decorative, `${at}.decorative`), description: formatted(raw.description, `${at}.description`), caption: formatted(raw.caption, `${at}.caption`), transcript: formatted(raw.transcript, `${at}.transcript`), captionTracks: array(raw.captionTracks, `${at}.captionTracks`).map((value, j) => { const path = `${at}.captionTracks[${j}]`, track = object(value, path); return { source: asset(track.source, `${path}.source`), language: optional(track.language, `${path}.language`), label: optional(track.label, `${path}.label`), kind: optional(track.kind, `${path}.kind`), default: boolean(track.default, `${path}.default`) }; }) };
			}) : undefined;
				return { ref: blockRef, parentRef, id: rawBlock.id === null ? "" : string(rawBlock.id, `${where}.id`), type: string(rawBlock.type, `${where}.type`), coverage: rawBlock.coverage as Block["coverage"], location: source, line: source?.startLine ?? null, assessment, assessmentGroup, media, data: { typedTexts: array(rawBlock.texts, `${where}.texts`).map((value, t) => text(value, `${where}.texts[${t}]`)), typedNarrations: [] } };
			});
			return page;
		});
		const narration = array(raw.narration, `${at}.narration`).map((value, n): TypedNarration => {
			const path = `${at}.narration[${n}]`, rawNarration = object(value, path), base = text(value, path);
			if (base.role !== "narration" || base.format !== "plain") fail(path, "plain narration text");
			if (typeof rawNarration.disabled !== "boolean") fail(`${path}.disabled`, "a boolean");
			if (rawNarration.origin !== "sidecar" && rawNarration.origin !== "derived") fail(`${path}.origin`, "sidecar or derived");
			const pageRef = string(rawNarration.pageRef, `${path}.pageRef`), page = pages.find(page => page.ref === pageRef);
			if (!page) fail(`${path}.pageRef`, "a page in this lesson");
			const blockRef = rawNarration.blockRef === null ? null : string(rawNarration.blockRef, `${path}.blockRef`);
			if (blockRef !== null && blockPages.get(blockRef) !== page) fail(`${path}.blockRef`, "a block in the narration page");
			const item: TypedNarration = { ...base, blockRef, pageRef, origin: rawNarration.origin, disabled: rawNarration.disabled, ...narrationEvidence(rawNarration, path) };
			// A narration-only page still needs a positional ref for quotes and reviewer answers.
			// This internal carrier has no Studio block identity; each script retains its page provenance.
			if (!page.blocks.length) page.blocks.push({ id: "", type: "narration", parentRef: null, location: null, line: null, data: { typedTexts: [], typedNarrations: [] } });
			const owner = blockRef === null ? page.blocks[0]! : page.blocks.find(block => block.ref === blockRef)!;
			(owner.data.typedNarrations as TypedNarration[]).push(item);
			return item;
		});
		const unlinkedNarration = expanded ? array(raw.unlinkedNarration, `${at}.unlinkedNarration`).map((value, n): TypedNarration => {
			const path = `${at}.unlinkedNarration[${n}]`, item = object(value, path), base = text(value, path), anchor = object(item.unresolvedAnchor, `${path}.unresolvedAnchor`);
			if (base.role !== "narration" || base.format !== "plain" || item.blockRef !== null || item.pageRef !== null || item.origin !== "sidecar") fail(path, "unlinked sidecar narration without current block or page refs");
			return { ...base, blockRef: null, pageRef: null, origin: "sidecar", disabled: boolean(item.disabled, `${path}.disabled`), unresolvedAnchor: { kind: string(anchor.kind, `${path}.unresolvedAnchor.kind`), type: optional(anchor.type, `${path}.unresolvedAnchor.type`), page: anchor.page === null ? null : integer(anchor.page, `${path}.unresolvedAnchor.page`), label: optional(anchor.label, `${path}.unresolvedAnchor.label`) }, ...narrationEvidence(item, path) };
		}) : undefined;
		const unlinkedNarrationCount = integer(raw.unlinkedNarrationCount, `${at}.unlinkedNarrationCount`, 0);
		if (expanded && unlinkedNarrationCount !== unlinkedNarration?.length) fail(`${at}.unlinkedNarrationCount`, "the number of unlinked entries");
		for (const page of pages) for (const block of page.blocks) for (const member of block.assessmentGroup?.memberRefs ?? []) if (!assessmentRefs.has(member)) fail(`${at}.pages.assessmentGroup.memberRefs`, "an assessment block in this lesson");
		return { file, title: string(raw.title, `${at}.title`), sha256: string(raw.sha256, `${at}.sha256`), pages, narration, unlinkedNarrationCount, unlinkedNarration };
	});
	return { schema: "praxity-inspect/1", ...(expanded ? { projectionVersion: 2 as const } : {}), revision, studioVersion: string(root.studioVersion, "$.studioVersion"), course: { title: string(metadata.title, "$.course.title"), locale: string(metadata.locale, "$.course.locale") }, lessons };
}

export const TYPED_LIMITS = "Partial text projection: unsupported blocks may contain additional text or media. Correct answers and scoring are unknown; assessments are not automatically classified as activities or knowledge checks. Media details and audio durations are unknown. Narration time is estimated from enabled resolved scripts; disabled and unlinked scripts are excluded. Feedback is separate from on-screen prose counts. Reading and course timing omit unprojected content and media playback.";
export const EXPANDED_LIMITS = "Partial text projection: unsupported blocks may contain additional prose or media. Assessment correctness and scoring reflect authored source and course/lesson defaults, not workspace settings; open or unsupported correctness stays unknown. Media sources and asset status are known, but remote contents, caption-track prose, and audio/video playback lengths are not measured. Stored narration durations are sidecar-recorded alignment endpoints, not measured full-file durations; narration time remains a script estimate at 150 words per minute. Disabled and unlinked scripts are excluded from spoken counts. Feedback, glossary definitions, media alternatives and transcripts are separate from on-screen prose. Transcript prose has its own channel and adds no narration or playback time. Reading and course timing omit unprojected content and media playback.";
export const typedLimits = (projectionVersion?: number) => projectionVersion === 2 ? EXPANDED_LIMITS : TYPED_LIMITS;
