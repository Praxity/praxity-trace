import { type LessonAnatomy, READING_WPM, type Rhythm, type Stretch } from "./anatomy.ts";
import { absence, generated, legend, lessonVariants, method, segmented, viewBlock } from "./modes.ts";
import { esc, lessonHeading, pageKey } from "./places.ts";

/** The report fields the Anatomy and Pace sections draw from. */
type Shape = { anatomy: LessonAnatomy[]; rhythm: Rhythm; speakingWpm: number };

const LANES = ["text", "media", "explore", "activity", "check", "unknown"] as const;
const lanesFor = (lessons: LessonAnatomy[]) => LANES.filter(lane => lane !== "unknown" || lessons.some(lesson => lesson.marks.some(mark => mark.knowledgeCheck === null)));
const LANE_LABEL: Record<(typeof LANES)[number], string> = {
	unknown: "Response (unknown)",
	text: "Text",
	media: "Media",
	explore: "Explore",
	activity: "Activity",
	check: "Knowledge check",
};
const LANE_HELP: Record<(typeof LANES)[number], string> = {
	unknown: "Assessment whose correct answers are not supplied by the input.",
	text: "Text read on screen: paragraphs, lists, tables, notes, quotes, code, visible cards and sequences.",
	media: "Images, video, audio, charts and embedded documents.",
	explore: "Content the learner opens or steps through: accordions, tabs, flip cards, card carousels, scrollable horizontal sequences and labelled graphics. Interactive, but nothing to answer.",
	activity: "A response without a right answer, such as a reflection or a checklist.",
	check: "A question with a right answer.",
};
const partialInput = (lessons: LessonAnatomy[]) => lessons.some(lesson => lesson.pace.some(page => page.measurementStatus === "partial"));
const laneHelp = (role: (typeof LANES)[number], partial: boolean) => role === "unknown" ? absence(partial, LANE_HELP[role], "Correctness", "text") : LANE_HELP[role];
const laneHeading = (role: (typeof LANES)[number], partial: boolean) => `<abbr class="defined" tabindex="0" title="${esc(laneHelp(role, partial))}">${LANE_LABEL[role]}</abbr>${role === "unknown" && partial ? ` <span class="file">${absence(true, "", "Correctness")}</span>` : ""}`;
function lane(mark: LessonAnatomy["marks"][number]): (typeof LANES)[number] {
	return mark.knowledgeCheck === null ? "unknown" : mark.knowledgeCheck ? "check" : mark.role === "response" ? "activity" : mark.role;
}

function rhythmNote({ withoutAction, textOnly, generatedBy }: Rhythm, partial: boolean): string {
	const page = (lesson: number, number: number) => `<span data-page="${pageKey(lesson, number)}">${pageKey(lesson, number)}</span>`;
	const group = (title: string, runs: Stretch[], none: string) =>
		`<div><p class="rhythm-title">${title}</p>${
			runs.length
				? `<ul>${runs.map((run) => `<li>${page(run.lesson, run.from)}–${page(run.lesson, run.to)} <span class="file">${run.pages} pages, ${Math.max(1, Math.round(run.seconds / 60))} min</span></li>`).join("")}</ul>`
				: `<p class="rule">${none}</p>`
		}</div>`;
	// Activities written as prose instructions come from the alignment review, so say when they count.
	const action = partial ? `Longest stretches where ${absence(true, "", "an activity or knowledge check was")}${generatedBy ? `, counting activities ${generated(generatedBy, "generated")} from prose instructions` : ""}` : generatedBy ? `Longest stretches without an activity or knowledge check, counting activities ${generated(generatedBy, "generated")} from prose instructions` : "Longest stretches without an activity or knowledge check";
	return `<div class="rhythm">${group(action, withoutAction, "No lesson goes four or more pages without one.")}${group("Longest runs of text-only pages", textOnly, "No lesson has four or more in a row.")}</div>`;
}

function barCell(value: number, max: number): string {
	const width = max === 0 ? 0 : (value / max) * 100;
	return `<td class="num"><span class="bar" style="width:${((4 * width) / 100).toFixed(2)}rem" aria-hidden="true"></span>${value}</td>`;
}

const minutes = (seconds: number) => Math.round(seconds / 6) / 10;
/** "17 s", "1 min 22 s", "3 min". */
export function duration(seconds: number): string {
	const total = Math.round(seconds);
	if (total < 60) return `${total} s`;
	// Past ten minutes, seconds are noise.
	if (total >= 600) return `${Math.round(total / 60)} min`;
	const rest = total % 60;
	return `${Math.floor(total / 60)} min${rest ? ` ${rest} s` : ""}`;
}

function compositionTable(lessons: LessonAnatomy[]): string {
	const columns: Array<[string, (lesson: LessonAnatomy) => number]> = [
		["Pages", (lesson) => lesson.pages],
		["Words", (lesson) => lesson.words],
		["Reading min", (lesson) => minutes(lesson.pace.reduce((sum, page) => sum + page.readingSeconds, 0))],
		["Narration min", (lesson) => minutes(lesson.pace.reduce((sum, page) => sum + page.narrationSeconds, 0))],
		...lanesFor(lessons).map((role): [string, (lesson: LessonAnatomy) => number] => [
			laneHeading(role, partialInput(lessons)),
			(lesson) => lesson.marks.filter((mark) => lane(mark) === role).length,
		]),
	];
	// Each column has its own scale, shared by every lesson in that column.
	const maxima = columns.map(([, get]) => Math.max(...lessons.map(get)));
	const rows = lessons
		.map(
			(lesson, index) =>
				`<tr data-lesson="${index + 1}"><th scope="row"><span title="${esc(lesson.file)}">${esc(lessonHeading(index + 1, lesson.title))}</span></th>${columns
					.map(([, get], index) => barCell(get(lesson), maxima[index] ?? 0))
					.join("")}</tr>`,
		)
		.join("");
	return `<table class="composition"><caption>Lesson totals</caption><thead><tr><th scope="col">Lesson</th>${columns
		.map(([label]) => `<th scope="col" class="num">${label}</th>`)
		.join("")}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** Column width for course-wide charts: every page fits the content width. */
const courseCell = (pages: number, max = 14) => Math.max(4, Math.min(max, 1000 / Math.max(1, pages)));
const GRID_LABEL = 120;
const GRID_TOP = 20;

/**
 * Block types by page across the whole course, as a pixel grid like the course trace: one column per
 * page, one row per role, darker for more blocks of that role on the page.
 */
function blockGrid(lessons: LessonAnatomy[], firstLesson = 1): string {
	const pages = lessons.flatMap((lesson, index) => lesson.pace.map((page, pageIndex) => ({ lesson: index + firstLesson, number: page.number, title: page.title, start: pageIndex === 0, marks: lesson.marks.filter((mark) => mark.page === page.number) })));
	// Square cells: the row pitch follows the column width, so a long course gets shorter rows, not taller pixels.
	const cell = courseCell(pages.length);
	const pitch = Math.max(cell + 2, 15);
	const width = GRID_LABEL + pages.length * cell + 4;
	const height = GRID_TOP + lanesFor(lessons).length * pitch + 4;
	const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);
	const rows = lanesFor(lessons).map((role, row) => {
		const y = GRID_TOP + row * pitch;
		const cells = pages.map((page, index) => {
			const matching = page.marks.filter((mark) => lane(mark) === role);
			const n = matching.length;
			if (!n) return "";
			const scored = matching.filter(mark => mark.scoring?.scored).length;
			return `<rect class="bg ${role} l${level(n)}" data-page="${pageKey(page.lesson, page.number)}" x="${GRID_LABEL + index * cell + 0.5}" y="${y + (pitch - cell + 1) / 2}" width="${cell - 1}" height="${cell - 1}"><title>${esc(LANE_LABEL[role])}: ${n} ${n === 1 ? "block" : "blocks"}${scored ? `; ${scored} scored` : ""}</title></rect>`;
		}).join("");
		return `<text class="lane" x="0" y="${y + pitch / 2 + 4}">${LANE_LABEL[role]}<title>${esc(laneHelp(role, partialInput(lessons)))}</title></text><line class="grid" x1="${GRID_LABEL}" x2="${width}" y1="${y + pitch - 0.5}" y2="${y + pitch - 0.5}"/>${cells}`;
	}).join("");
	const lessonMarks = pages.map((page, index) => (page.start ? `<line class="page" x1="${GRID_LABEL + index * cell}" x2="${GRID_LABEL + index * cell}" y1="4" y2="${height}"/><text class="page-label" x="${GRID_LABEL + index * cell + 3}" y="12">L${page.lesson}</text>` : "")).join("");
	const total = lessons.reduce((sum, lesson) => sum + lesson.marks.length, 0);
	return `${legend([["bg-key-1", "1 block"], ["bg-key-2", "2–3"], ["bg-key-3", "4–6"], ["bg-key-4", "7 or more"]])}
<div class="scroll" tabindex="0" role="region" aria-label="Block types by page"><svg width="${width}" height="${height}" role="img" aria-label="${total} blocks across ${pages.length} pages, by role; the table view lists every block.">${lessonMarks}${rows}</svg></div>`;
}

const AXIS_WIDTH = 40;

function paceAxis(max: number): { step: number; ceiling: number; unit: "seconds" | "minutes" } {
	const unit = max <= 120 ? "seconds" : "minutes";
	const steps = unit === "seconds" ? [10, 20, 30, 60] : [1, 2, 5, 10, 20, 50, 100, 200, 500];
	const value = unit === "seconds" ? max : max / 60;
	const step = steps.find((candidate) => candidate >= value / 5) ?? 1000;
	return { step, ceiling: Math.ceil(value / step) * step, unit };
}

function cumulativePace(lessons: LessonAnatomy[]): LessonAnatomy[] {
	let reading = 0;
	let narration = 0;
	let estimated = 0;
	return lessons.map((lesson) => ({
		...lesson,
		pace: lesson.pace.map((page) => ({
			...page,
			readingSeconds: (reading += page.readingSeconds),
			narrationSeconds: (narration += page.narrationSeconds),
			estimatedNarrationSeconds: (estimated += page.estimatedNarrationSeconds),
		})),
	}));
}

/** A running total reads as lines: the whole course on one fixed-width chart, lessons marked. */
function cumulativeChart(pages: Array<{ page: LessonAnatomy["pace"][number]; lesson: number; start: boolean }>, maxSeconds: number): string {
	const W = 1100;
	const H = 220;
	const axis = paceAxis(maxSeconds);
	const scale = axis.unit === "seconds" ? 1 : 60;
	const step = (W - AXIS_WIDTH - 8) / Math.max(1, pages.length);
	const x = (index: number) => AXIS_WIDTH + (index + 0.5) * step;
	const y = (seconds: number) => 16 + H - (seconds / (axis.ceiling * scale)) * H;
	let grid = "";
	for (let tick = 0; tick <= axis.ceiling; tick += axis.step) {
		grid += `<line class="${tick === 0 ? "page" : "grid"}" x1="${AXIS_WIDTH}" x2="${W}" y1="${y(tick * scale) + 0.5}" y2="${y(tick * scale) + 0.5}"/><text class="page-label" x="${AXIS_WIDTH - 4}" y="${y(tick * scale) + 4}" text-anchor="end">${tick}</text>`;
	}
	const line = (value: (page: LessonAnatomy["pace"][number]) => number) => pages.map(({ page }, index) => `${x(index).toFixed(1)},${y(value(page)).toFixed(1)}`).join(" ");
	const narration = pages.map(({ page }, index) => {
		const previous = pages[index - 1]?.page;
		const before = previous?.narrationSeconds ?? 0;
		const estimated = page.estimatedNarrationSeconds - (previous?.estimatedNarrationSeconds ?? 0);
		const measured = Math.max(0, page.narrationSeconds - before - estimated);
		const x1 = index ? x(index - 1) : x(0) - step / 2;
		const x2 = x(index);
		const middle = page.narrationSeconds === before ? x2 : x1 + (x2 - x1) * measured / (page.narrationSeconds - before);
		return measured <= 0 && estimated <= 0
			? `<line class="cumulative-narration" x1="${x1}" y1="${y(before)}" x2="${x2}" y2="${y(before)}"/>`
			: `${measured > 0 ? `<line class="cumulative-narration" x1="${x1}" y1="${y(before)}" x2="${middle}" y2="${y(before + measured)}"/>` : ""}${estimated > 0 ? `<line class="cumulative-narration estimated" x1="${middle}" y1="${y(before + measured)}" x2="${x2}" y2="${y(page.narrationSeconds)}"/>` : ""}`;
	}).join("");
	const lessonsMarks = pages.map(({ lesson, start }, index) => (start ? `<line class="page" x1="${x(index) - step / 2}" x2="${x(index) - step / 2}" y1="12" y2="${16 + H}"/><text class="page-label" x="${x(index) - step / 2 + 3}" y="10">L${lesson}</text>` : "")).join("");
	const hits = pages.map(({ page, lesson }, index) => `<g data-page="${pageKey(lesson, page.number)}"><title>Reading so far\t${duration(page.readingSeconds)}\nNarration so far\t${duration(page.narrationSeconds)}</title><rect class="hit" x="${x(index) - step / 2}" y="16" width="${step}" height="${H}"/><line class="crosshair" x1="${x(index)}" x2="${x(index)}" y1="16" y2="${16 + H}"/><circle class="crosshair-dot narration" cx="${x(index)}" cy="${y(page.narrationSeconds)}" r="3.5"/><circle class="crosshair-dot reading" cx="${x(index)}" cy="${y(page.readingSeconds)}" r="3.5"/></g>`).join("");
	return `<svg width="${W}" height="${H + 24}" viewBox="0 0 ${W} ${H + 24}" style="max-width:100%;height:auto" role="img" aria-label="Cumulative reading and narration in ${axis.unit} across ${pages.length} pages; dashed narration stretches are estimated from scripts without measured durations. The table view has the numbers."><text class="axis-label" x="8" y="${16 + H / 2}" transform="rotate(-90 8 ${16 + H / 2})" text-anchor="middle">${axis.unit}</text>${grid}${lessonsMarks}${narration}<polyline class="cumulative-reading" points="${line((page) => page.readingSeconds)}"/>${hits}</svg>`;
}

function paceChart(lessons: LessonAnatomy[], maxSeconds: number, cumulative = false, firstLesson = 1): string {
	const pages = lessons.flatMap((lesson, index) => lesson.pace.map((page, pageIndex) => ({ page, lesson: index + firstLesson, start: pageIndex === 0 })));
	if (cumulative) return cumulativeChart(pages, maxSeconds);
	// Per page: the whole course on one fixed-width chart, like the cumulative view.
	const W = 1100;
	const H = 150;
	const axis = paceAxis(maxSeconds);
	const scale = axis.unit === "seconds" ? 1 : 60;
	const step = (W - AXIS_WIDTH - 8) / Math.max(1, pages.length);
	const bar = Math.max(2, step * 0.7);
	const x = (index: number) => AXIS_WIDTH + index * step + (step - bar) / 2;
	const y = (seconds: number) => 16 + H - (Math.min(seconds, axis.ceiling * scale) / (axis.ceiling * scale)) * H;
	let grid = "";
	for (let tick = 0; tick <= axis.ceiling; tick += axis.step) {
		grid += `<line class="${tick === 0 ? "page" : "grid"}" x1="${AXIS_WIDTH}" x2="${W}" y1="${y(tick * scale) + 0.5}" y2="${y(tick * scale) + 0.5}"/><text class="page-label" x="${AXIS_WIDTH - 4}" y="${y(tick * scale) + 4}" text-anchor="end">${tick}</text>`;
	}
	const lessonMarks = pages.map(({ lesson, start }, index) => (start ? `<line class="page" x1="${AXIS_WIDTH + index * step}" x2="${AXIS_WIDTH + index * step}" y1="12" y2="${16 + H}"/><text class="page-label" x="${AXIS_WIDTH + index * step + 3}" y="10">L${lesson}</text>` : "")).join("");
	const bands = pages.map(({ page, lesson }, index) => {
		const measured = page.narrationSeconds - page.estimatedNarrationSeconds;
		const title = `Reading\t${duration(page.readingSeconds)}\nNarration\t${duration(page.narrationSeconds)}${page.estimatedNarrationSeconds > 0 ? `, ${page.estimatedNarrationSeconds === page.narrationSeconds ? "all" : duration(page.estimatedNarrationSeconds)} estimated from script` : ""}`;
		return `<g data-page="${pageKey(lesson, page.number)}"><title>${title}</title><rect class="hit" x="${AXIS_WIDTH + index * step}" y="16" width="${step}" height="${H}"/>${
			measured > 0 ? `<rect class="narration" x="${x(index)}" y="${y(measured)}" width="${bar}" height="${16 + H - y(measured)}"/>` : ""
		}${page.estimatedNarrationSeconds > 0 ? `<rect class="narration-estimated" x="${x(index) + 0.5}" y="${y(page.narrationSeconds) + 0.5}" width="${bar - 1}" height="${Math.max(y(measured) - y(page.narrationSeconds) - 1, 0)}"/>` : ""}<line class="reading" x1="${x(index) - 1}" x2="${x(index) + bar + 1}" y1="${y(page.readingSeconds)}" y2="${y(page.readingSeconds)}"/></g>`;
	}).join("");
	return `<svg width="${W}" height="${H + 24}" viewBox="0 0 ${W} ${H + 24}" style="max-width:100%;height:auto" role="img" aria-label="Reading and narration time per page in ${axis.unit} across ${pages.length} pages; the table view has the numbers."><text class="axis-label" x="8" y="${16 + H / 2}" transform="rotate(-90 8 ${16 + H / 2})" text-anchor="middle">${axis.unit}</text>${grid}${lessonMarks}${bands}</svg>`;
}

/** A lesson's own running total, from zero at its first page. */
function lessonRunningTotal(lesson: LessonAnatomy, number: number): string {
	const running = cumulativePace([lesson]);
	const max = Math.max(30, ...(running[0]?.pace ?? []).flatMap((page) => [page.readingSeconds, page.narrationSeconds]));
	return paceChart(running, max, true, number);
}

function paceTable(lessons: LessonAnatomy[]): string {
	const cumulative = cumulativePace(lessons);
	const rows = lessons
		.flatMap((lesson, lessonIndex) =>
			lesson.pace.map(
				(page, pageIndex) => {
					const total = cumulative[lessonIndex]?.pace[pageIndex];
					return `<tr data-lesson="${lessonIndex + 1}"><th scope="row">${esc(page.title)}</th><td class="where"><span data-page="${pageKey(lessonIndex + 1, page.number)}" title="${esc(lesson.file)}">${pageKey(lessonIndex + 1, page.number)}</span></td><td class="num">${page.words}</td><td class="num">${Math.round(page.readingSeconds)}</td><td class="num">${Math.round(page.narrationSeconds)}</td><td class="num">${Math.round(page.estimatedNarrationSeconds)}</td><td class="num">${Math.round(total?.readingSeconds ?? 0)}</td><td class="num">${Math.round(total?.narrationSeconds ?? 0)}</td></tr>`;
				},
			),
		)
		.join("");
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Pace times by page"><table class="blocks"><caption class="sr">Pace times by page</caption><thead><tr><th scope="col">Page</th><th scope="col">Where</th><th scope="col" class="num">Words</th><th scope="col" class="num two-line">Reading<br>s</th><th scope="col" class="num two-line">Narration<br>s</th><th scope="col" class="num two-line">Estimated<br>s</th><th scope="col" class="num two-line">Cumulative<br>reading s</th><th scope="col" class="num two-line">Cumulative<br>narration s</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function blockTable(lessons: LessonAnatomy[]): string {
	const expanded = lessons.some(lesson => lesson.marks.some(mark => mark.scoring));
	const rows = lessons
		.flatMap((lesson, lessonIndex) =>
			lesson.marks.map(
				(mark) =>
					`<tr data-lesson="${lessonIndex + 1}"><th scope="row">${esc(mark.type)}</th><td>${LANE_LABEL[lane(mark)]}${mark.knowledgeCheck === null && partialInput(lessons) ? `<span class="file">${absence(true, "", "Correctness")}</span>` : ""}</td>${expanded ? `<td>${mark.scoring ? `${mark.scoring.scored ? "Scored" : "Completion-only"}; ${esc(mark.scoring.gradingMode)}; ${mark.scoring.points === null ? mark.scoring.scored ? "runtime default 100 points" : "no authored points" : `${mark.scoring.points} authored points`}` : "–"}</td>` : ""}<td class="num">${mark.words}</td><td class="where"><span data-page="${pageKey(lessonIndex + 1, mark.page)}">${pageKey(lessonIndex + 1, mark.page)}</span> <span class="channel">${esc(lesson.file)}:${mark.line ?? "?"}</span></td></tr>`,
			),
		)
		.join("");
	return `<h4 class="chart-title">Every block, in course order</h4><div class="table-wrap" tabindex="0" role="region" aria-label="Every block"><table class="blocks"><caption class="sr">Every block</caption><thead><tr><th scope="col">Block type</th><th scope="col">Role</th>${expanded ? `<th scope="col">Scoring</th>` : ""}<th scope="col" class="num">Words</th><th scope="col">Where</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderAnatomy(report: Shape): string {
	return `${viewBlock({
	id: "anatomy",
	level: 3,
	title: "Anatomy",
	question: "What is each lesson made of, and where do learners act?",
	lead: `<div class="table-wrap" tabindex="0" role="region" aria-label="Blocks, words and time by lesson">${compositionTable(report.anatomy)}</div>${method(`<p class="rule">Blocks are grouped by what learners do with them; blocks inside columns count individually, and headings, dividers, buttons and logic are left out. Sequences count as explore only when horizontal and scrollable. Schema 1 omits these settings, so its sequences count as text; scrolling cannot be determined. Words are on-screen text, headings included, narration and alt text excluded. The bar beside each number compares lessons within its column.</p>`)}`,
	chart: `<h4 class="chart-title">Block types by page</h4>${lessonVariants(report.anatomy.map((_, index) => index + 1), (lesson) => (lesson === null ? blockGrid(report.anatomy) : blockGrid([report.anatomy[lesson - 1] as LessonAnatomy], lesson)))}`,
	table: blockTable(report.anatomy),
	after: rhythmNote(report.rhythm, partialInput(report.anatomy)),
})}`;
}

export function renderPace(report: Shape): string {
	const cumulative = cumulativePace(report.anatomy);
	const expanded = report.anatomy.some(lesson => lesson.pace.some(page => page.recordedNarration !== undefined));
	const perPageMax = Math.max(30, ...report.anatomy.flatMap((lesson) => lesson.pace.flatMap((page) => [page.readingSeconds, page.narrationSeconds])));
	const cumulativeMax = Math.max(30, ...cumulative.flatMap((lesson) => lesson.pace.flatMap((page) => [page.readingSeconds, page.narrationSeconds])));
	return `${viewBlock({
	id: "pace",
	level: 3,
	title: "Pace",
	question: "How long does each page take to read and to listen to?",
	controls: segmented("pace-view", "Time shown", [
		{ value: "page", label: "Time per page", icon: "chart-histogram", checked: true },
		{ value: "cumulative", label: "Running total across the course", icon: "chart-line" },
	]),
	lead: method(`<p class="rule">Reading time is on-screen words read once at ${READING_WPM} words per minute (Brysbaert, 2019). ${expanded ? `Narration time is estimated from enabled resolved scripts at ${Math.round(report.speakingWpm)} words per minute. Sidecar-recorded endpoints are shown separately; they do not measure full-file duration or speaking rate.` : `Where a page has a narration script but no measured duration, narration is estimated at ${Math.round(report.speakingWpm)} words per minute.`}</p>`, "How time is estimated"),
	chart: `<div class="pace-mode" data-mode="page">${legend(expanded ? [["narration-estimated", "Narration estimate from script"], ["reading", "Reading on-screen text"]] : [["narration", "Narration audio"], ["narration-estimated", "Narration estimate from script"], ["reading", "Reading on-screen text"]])}${lessonVariants(report.anatomy.map((_, index) => index + 1), (lesson) => (lesson === null ? paceChart(report.anatomy, perPageMax) : paceChart([report.anatomy[lesson - 1] as LessonAnatomy], perPageMax, false, lesson)))}</div>
<div class="pace-mode" data-mode="cumulative">${legend([["cumulative-narration", expanded ? "Narration estimate from scripts" : "Narration (dashed where estimated from a script)"], ["cumulative-reading", "Reading on-screen text"]])}${lessonVariants(cumulative.map((_, index) => index + 1), (lesson) => (lesson === null ? paceChart(cumulative, cumulativeMax, true) : lessonRunningTotal(report.anatomy[lesson - 1] as LessonAnatomy, lesson)))}</div>`,
	table: paceTable(report.anatomy),
})}`;
}
