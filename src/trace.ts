import type { AlignmentView } from "./alignment-view.ts";
import type { LessonAnatomy } from "./anatomy.ts";
import type { ConceptsView } from "./concepts-view.ts";
import type { Course } from "./inspect.ts";
import { esc, pageKey, short, where, type Place } from "./places.ts";
import { legend, lessonVariants, method, viewBlock } from "./modes.ts";

/** One page per column; course and concept rows use filled cells. */
export type Phase = "set" | "hold" | "land";

export type Symbol = "fill" | "concept" | "stated" | "taught" | "activity" | "check";

export interface TraceColumn {
	lesson: number;
	page: number;
	title: string;
	phase: Phase;
	seconds: number;
}

export interface TraceRow {
	label: string;
	group: "Course" | "Concepts" | "Objectives";
	/** 1 for a sub-objective drawn under its parent. */
	depth: 0 | 1;
	/** Full objective group details shared by the row tooltip and Table mode. */
	members?: Array<{ id: string; text: string; ref: string; place?: Place; parent?: { id: string; text: string } }>;
	shared?: string[];
	marks: Array<{ column: number; symbol: Symbol; size?: number; note: string }>;
}

export interface TraceView {
	columns: TraceColumn[];
	lessons: Array<{ title: string; start: number; end: number }>;
	rows: TraceRow[];
	pageObjectives?: Array<{ stated: string[]; instructed: string[]; activities: string[]; checks: string[] }>;
}

const LAND = /\b(review\w*|reflect\w*|recap|wrap-?up|takeaways?)\b|\b(summar|conclu)/i;
const SET = /\b(welcome|introduc|overview|orientation|getting started|navigation|how to use|acknowledg|learning outcomes|objectives)/i;
const OUTCOMES = /by the end of|you will be able to|learning outcomes/i;

// ponytail: introduction and review come from page titles and objective phrases;
// add model classification only if designers find these title rules unreliable.
function phaseOf(page: Course["lessons"][number]["pages"][number], first: boolean): Phase {
	if (first) return "set";
	if (LAND.test(page.title)) return "land";
	if (SET.test(page.title) || OUTCOMES.test(JSON.stringify(page.blocks.map((block) => block.data)))) return "set";
	return "hold";
}

const STRENGTH: Record<Symbol, number> = { stated: 0, taught: 1, activity: 2, check: 3, fill: 0, concept: 0 };

export function traceView(
	course: Course,
	anatomy: LessonAnatomy[],
	models: { alignment?: AlignmentView; concepts?: ConceptsView },
): TraceView {
	const columns: TraceColumn[] = [];
	const lessons: TraceView["lessons"] = [];
	const columnOf = new Map<string, number>();
	course.lessons.forEach((lesson, l) => {
		const start = columns.length;
		for (const page of lesson.pages) {
			const pace = anatomy[l]?.pace.find((item) => item.number === page.number);
			columnOf.set(pageKey(l + 1, page.number), columns.length);
			columns.push({
				lesson: l + 1,
				page: page.number,
				title: page.title,
				phase: phaseOf(page, columns.length === start),
				seconds: Math.max(pace?.readingSeconds ?? 0, pace?.narrationSeconds ?? 0),
			});
		}
		lessons.push({ title: lesson.title, start, end: columns.length });
	});
	const at = (lesson: number, page: number) => columnOf.get(pageKey(lesson, page));

	const course_rows: TraceRow[] = [
		{ label: "Introduction", group: "Course", depth: 0, marks: [] },
		{ label: "Review and summary", group: "Course", depth: 0, marks: [] },
		{ label: "Practice", group: "Course", depth: 0, marks: [] },
	];
	columns.forEach((column, index) => {
		if (column.phase === "set") course_rows[0]?.marks.push({ column: index, symbol: "fill", note: column.title });
		if (column.phase === "land") course_rows[1]?.marks.push({ column: index, symbol: "fill", note: column.title });
		const marks = anatomy[column.lesson - 1]?.marks.filter((mark) => mark.page === column.page) ?? [];
		if (marks.some((mark) => mark.role === "response")) {
			course_rows[2]?.marks.push({ column: index, symbol: "fill", note: column.title });
		}
	});

	const rows: TraceRow[] = [...course_rows];

	if (models.concepts) {
		const firsts = new Map<number, string[]>();
		for (const concept of models.concepts.concepts) {
			const place = concept.firstDefined ? models.concepts.places[concept.firstDefined] : undefined;
			const column = place ? at(place.lesson, place.page) : undefined;
			if (column === undefined) continue;
			firsts.set(column, [...(firsts.get(column) ?? []), concept.name]);
		}
		rows.push({
			label: "New concepts defined (sized by volume)",
			group: "Concepts",
			depth: 0,
			marks: [...firsts].map(([column, names]) => ({ column, symbol: "concept", size: names.length, note: names.join(", ") })),
		});
	}

	const pageObjectives = columns.map(() => ({ stated: [] as string[], instructed: [] as string[], activities: [] as string[], checks: [] as string[] }));
	if (models.alignment) {
		const view = models.alignment;
		const columnOfRef = (ref: string) => {
			const place = view.places[ref];
			return place ? at(place.lesson, place.page) : undefined;
		};
		// A group's parent is the group holding a member's parent from outside the group. Children are
		// drawn right under their parent, so the indent reads as "builds toward the row above".
		const groups = view.objectiveGroups;
		const holder = new Map(groups.flatMap((group, index) => group.members.map((objective) => [objective.id, index] as const)));
		const parentOf = (group: (typeof groups)[number]) => {
			const parent = group.members.find((objective) => objective.parent && !group.members.some((member) => member.id === objective.parent))?.parent;
			return parent ? holder.get(parent) : undefined;
		};
		const tops = groups.filter((group) => parentOf(group) === undefined);
		const ordered = tops.flatMap((top) => [top, ...groups.filter((group) => group !== top && parentOf(group) === groups.indexOf(top))]);
		for (const group of [...ordered, ...groups.filter((group) => !ordered.includes(group))]) {
			const cells = new Map<number, { symbol: Symbol; note: string }>();
			const put = (ref: string, symbol: Symbol, note: string, ids: string[]) => {
				const column = columnOfRef(ref);
				if (column === undefined) return;
				const key: keyof (typeof pageObjectives)[number] | undefined = symbol === "stated" ? "stated" : symbol === "taught" ? "instructed" : symbol === "activity" ? "activities" : symbol === "check" ? "checks" : undefined;
				if (key) pageObjectives[column]![key].push(...ids);
				const current = cells.get(column);
				if (!current || STRENGTH[symbol] > STRENGTH[current.symbol]) cells.set(column, { symbol, note });
			};
			for (const objective of group.members) put(objective.ref, "stated", `${objective.id} stated here`, [objective.id]);
			for (const check of view.checks.filter((item) => group.members.some((objective) => item.objectives.includes(objective.id)))) {
				for (const support of check.support) put(support.ref, "taught", `Teaches what the check on ${short(view.places, check.ref)} needs`, group.members.filter((objective) => check.objectives.includes(objective.id)).map((objective) => objective.id));
			}
			for (const activity of view.activities.filter((item) => group.members.some((objective) => item.objectives.includes(objective.id)))) {
				put(activity.ref, activity.purpose === "knowledge" ? "check" : "activity", activity.label, group.members.filter((objective) => activity.objectives.includes(objective.id)).map((objective) => objective.id));
			}
			rows.push({
				label: `${group.members.map((objective) => objective.id).join(", ")} · ${group.members[0]?.text ?? ""}`,
				group: "Objectives",
				depth: tops.includes(group) ? 0 : 1,
				members: group.members.map((objective) => {
					const parent = view.objectives.find((member) => member.id === objective.parent);
					return { id: objective.id, text: objective.text, ref: objective.ref, place: view.places[objective.ref], ...(parent ? { parent: { id: parent.id, text: parent.text } } : {}) };
				}),
				shared: view.overlaps.filter((overlap) => overlap.objectives.some((id) => group.members.some((member) => member.id === id))).map((overlap) => overlap.note),
				marks: [...cells].map(([column, cell]) => ({ column, ...cell })),
			});
		}
	}
	return { columns, lessons, rows, pageObjectives };
}

const LABEL = 260;
const ROW = 17;
const GROUP_GAP = 22;

function symbol(mark: TraceRow["marks"][number], x: number, y: number, cell: number, title: string, page: string): string {
	const tip = `<title>${title}</title>`;
	const at = ` data-page="${page}"`;
	const side = Math.max(5, Math.min(cell - 1, 8));
	switch (mark.symbol) {
		case "fill":
			// Adjacent pages join into one run: a pixel strip with no gaps.
			return `<rect class="t-fill"${at} x="${x - cell / 2}" y="${y - 6}" width="${cell + 0.3}" height="12">${tip}</rect>`;
		case "check":
			return `<rect class="t-check"${at} x="${x - side / 2}" y="${y - side / 2}" width="${side}" height="${side}">${tip}</rect>`;
		case "activity":
			return `<rect class="t-activity"${at} x="${x - side / 2}" y="${y - side / 2}" width="${side}" height="${side}">${tip}</rect>`;
		case "taught":
			return `<circle class="t-taught"${at} cx="${x}" cy="${y}" r="${side / 2}">${tip}</circle>`;
		case "stated":
			return `<path class="t-stated"${at} d="M${x} ${y - side / 2} L${x + side / 2} ${y} L${x} ${y + side / 2} L${x - side / 2} ${y} Z">${tip}</path>`;
		case "concept":
			// Area grows with the number of concepts first defined on the page.
			return `<circle class="t-concept"${at} cx="${x}" cy="${y}" r="${Math.min(8, 1.6 + 2 * Math.sqrt(mark.size ?? 1)).toFixed(1)}">${tip}</circle>`;
	}
}

/** One lesson's pages only, drawn wider: the lesson filter's expanded view. */
function lessonTrace(view: TraceView, lesson: number): TraceView {
	const keep = view.columns.map((column, index) => (column.lesson === lesson ? index : -1)).filter((index) => index >= 0);
	const remap = new Map(keep.map((old, index) => [old, index]));
	return {
		columns: keep.map((index) => view.columns[index] as TraceColumn),
		lessons: [{ title: view.lessons[lesson - 1]?.title ?? "", start: 0, end: keep.length }],
		// Objective rows with nothing in this lesson are left out; course and concept rows stay as the frame.
		rows: view.rows
			.map((row) => ({ ...row, marks: row.marks.filter((mark) => remap.has(mark.column)).map((mark) => ({ ...mark, column: remap.get(mark.column) as number })) }))
			.filter((row) => row.group !== "Objectives" || row.marks.length > 0),
		pageObjectives: view.pageObjectives && keep.map((index) => view.pageObjectives?.[index] ?? { stated: [], instructed: [], activities: [], checks: [] }),
	};
}

function traceSvg(view: TraceView, maxCell = 12): string {
	const cell = Math.min(maxCell, 860 / Math.max(1, view.columns.length));
	const x = (column: number) => LABEL + column * cell + cell / 2;
	const top = 26;
	let y = top;
	let body = "";
	let previousGroup = "";
	for (const row of view.rows) {
		if (row.group !== previousGroup) {
			if (previousGroup) y += GROUP_GAP;
			body += `<text class="group-label" x="0" y="${y + 10}">${row.group}</text>`;
			y += ROW;
			previousGroup = row.group;
		}
		const cy = y + ROW / 2;
		const label = row.label.length > 40 - row.depth * 3 ? `${row.label.slice(0, 39 - row.depth * 3)}…` : row.label;
		const title = row.members ? [...row.members.map((member) => `${member.id} · ${member.text}`), ...(row.shared?.map((note) => `What the group shares: ${note}`) ?? [])].join("\n") : row.label;
		body += `<g><text class="lane" x="${row.depth ? 14 : 4}" y="${cy + 4}">${esc(label)}<title>${esc(title)}</title></text>${row.group === "Course" ? `<rect class="t-track" x="${LABEL}" y="${cy - 6}" width="${view.columns.length * cell}" height="12"/>` : `<line class="t-baseline" x1="${LABEL}" x2="${LABEL + view.columns.length * cell}" y1="${cy + 0.5}" y2="${cy + 0.5}"/>`}${row.marks
			.map((mark) => {
				const column = view.columns[mark.column];
				// The page preview names the page; the title says only what the mark is.
				const note = mark.note && mark.note !== column?.title ? `\n${esc(mark.note)}` : "";
				const what = mark.symbol === "concept" ? (mark.size === 1 ? "New concept" : `${mark.size} new concepts`) : row.label;
				const title = `${esc(what)}${note}`;
				return symbol(mark, x(mark.column), cy, cell, title, `${column?.lesson}.${column?.page}`);
			})
			.join("")}</g>`;
		y += ROW;
	}
	const height = y + 6;
	const lessons = view.lessons
		.filter((lesson) => lesson.end > lesson.start)
		.map((lesson) => {
			const x0 = LABEL + lesson.start * cell;
			return `<line class="page" x1="${x0}" x2="${x0}" y1="${top - 8}" y2="${height}"/><text class="page-label" x="${x0 + 3}" y="14">L${view.columns[lesson.start]?.lesson ?? ""}<title>${esc(lesson.title)}</title></text>`;
		})
		.join("");
	return `<div class="scroll" tabindex="0" role="region" aria-label="Course trace grid"><svg width="${LABEL + view.columns.length * cell + 12}" height="${height}" role="img" aria-label="Course trace across ${view.columns.length} pages and ${view.rows.length} rows; use Table mode for all values.">${lessons}${body}</svg></div>`;
}

export function renderTrace(view: TraceView): string {
	const cell = (text: string) => `<td>${esc(text)}</td>`;
	const groups = view.rows.filter((row) => row.members?.length);
	const objectiveTable = groups.length ? `<p class="chart-title">Objective groups</p><div class="table-wrap" tabindex="0" role="region" aria-label="Course trace objective groups"><table class="blocks trace-table objective-groups"><caption class="sr">Course trace objective groups</caption><thead><tr><th scope="col">Objective</th><th scope="col">Group</th><th scope="col">Stated at</th><th scope="col">Builds toward</th><th scope="col">What the group shares</th></tr></thead><tbody>${groups.flatMap((row) => row.members!.map((member, index) => `<tr data-lesson="${member.place?.lesson ?? ""}"${index === 0 ? ' class="group-start"' : ""}><th scope="row"><span class="group-member"><span class="oid">${esc(member.id)}</span><span>${esc(member.text)}</span></span></th>${cell(row.members!.map((item) => item.id).join(", "))}<td>${where(member.place ? { [member.ref]: member.place } : {}, member.ref)}</td>${cell(member.parent ? `${member.parent.id} · ${member.parent.text}` : "")}${cell(row.shared?.join(" ") ?? "")}</tr>`)).join("")}</tbody></table></div>` : "";
	const table = `<div class="table-wrap" tabindex="0" role="region" aria-label="Course trace by page"><table class="blocks trace-table"><caption class="sr">Course trace by page</caption><thead><tr><th scope="col">Page</th><th scope="col">Page title</th><th scope="col">Introduction</th><th scope="col">Review and summary</th><th scope="col">Practice</th><th scope="col">New concepts</th><th scope="col">Objectives stated</th><th scope="col">Instruction</th><th scope="col">Activities</th><th scope="col">Knowledge checks</th></tr></thead><tbody>${view.columns.map((column, index) => {
		const has = (label: string) => view.rows.some((row) => row.label === label && row.marks.some((mark) => mark.column === index));
		const concepts = view.rows.find((row) => row.group === "Concepts")?.marks.find((mark) => mark.column === index)?.note ?? "";
		const links = view.pageObjectives?.[index];
		const ids = (items: string[] | undefined) => [...new Set(items ?? [])].join(", ");
		return `<tr data-lesson="${column.lesson}"><th scope="row">${pageKey(column.lesson, column.page)}</th>${cell(column.title)}${cell(has("Introduction") ? "Yes" : "")}${cell(has("Review and summary") ? "Yes" : "")}${cell(has("Practice") ? "Yes" : "")}${cell(concepts)}${cell(ids(links?.stated))}${cell(ids(links?.instructed))}${cell(ids(links?.activities))}${cell(ids(links?.checks))}</tr>`;
	}).join("")}</tbody></table></div>`;
	// Course and concept rows are labelled in place; the legend covers the objective symbols only.
	const keys: Array<[Symbol, string]> = [["stated", "Objective stated"], ["taught", "Instruction"], ["activity", "Activity"], ["check", "Knowledge check"]];
	const items = keys.filter(([symbol]) => view.rows.some((row) => row.marks.some((mark) => mark.symbol === symbol))).map(([symbol, label]): [string, string] => [`t-${symbol}`, label]);
	const lessonNumbers = [...new Set(view.columns.map((column) => column.lesson))];
	const chart = `${items.length ? legend(items) : ""}${lessonVariants(lessonNumbers, (lesson) => (lesson === null ? traceSvg(view) : traceSvg(lessonTrace(view, lesson), 24)))}`;
	return `<section aria-labelledby="trace">
${viewBlock({ id: "trace", level: 2, headingId: "trace", title: "Course trace", question: "Where is each objective stated, taught, practised and checked?", lead: `<p class="rule">Where a page has several marks for one objective group, the chart shows one, in this order: knowledge check, activity, instruction, objective stated.</p>${method(`<p class="rule">Each column is one page. Introduction is each lesson's first page and pages with objectives or orientation; Review and summary covers review, reflection and summary pages; Practice is any page with a knowledge check or activity. An indented objective group builds toward the group above it. The table lists every objective link, each group's members and where they are stated. Groups and their links are interpretations from the alignment review. Comment on a group to split it.</p>`)}`, chart, table: `${table}${objectiveTable}` })}
</section>`;
}

export const TRACE_STYLE = `
svg .group-label{font-weight:600;fill:var(--ink)}
svg .t-track{fill:var(--grid);opacity:.55}svg .t-baseline{stroke:var(--grid)}
svg .t-fill{fill:var(--accent);shape-rendering:crispEdges}svg .t-track{shape-rendering:crispEdges}svg .t-concept{fill:var(--ink-2);stroke:var(--surface);stroke-width:1}
svg .t-check{fill:var(--accent)}svg .t-activity{fill:none;stroke:var(--accent);stroke-width:1.5}
svg .t-taught{fill:none;stroke:var(--ink);stroke-width:1.5}svg .t-stated{fill:none;stroke:var(--muted);stroke-width:1.5}
.key.t-fill,.key.t-concept{background:var(--ink-2)}.key.t-concept{opacity:.7}
.key.t-check{background:var(--accent)}.key.t-activity{border:1.5px solid var(--accent)}
.key.t-taught{border:1.5px solid var(--ink);border-radius:50%}.key.t-stated{border:1.5px solid var(--muted);transform:rotate(45deg) scale(.8)}
.trace-table th,.trace-table td{vertical-align:top}.trace-table th[scope=row]{white-space:nowrap}.trace-table td{overflow-wrap:anywhere}.objective-groups th[scope=row]{white-space:normal}
`;
