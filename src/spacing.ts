import { type LessonAnatomy, pageClock } from "./anatomy.ts";
import type { Role } from "./concepts.ts";
import { type ConceptsView, ROLE_LABEL } from "./concepts-view.ts";
import { legend, method, viewBlock } from "./modes.ts";
import { esc, pageKey } from "./places.ts";

/**
 * When each concept comes back, in course minutes. Spacing research (Cepeda et al., 2008)
 * ties the useful gap to how long learners must retain it, so the view shows gaps and
 * leaves the judgement to the designer.
 */
const ENCOUNTER: Role[] = ["defined", "example", "activity", "checked", "recap"];

export interface SpacingRow {
	name: string;
	encounters: Array<{ minute: number; role: Role; ref: string; page: string | null }>;
	definedAt: number | null;
	/** Minutes from the first definition to the first knowledge check after it. */
	toFirstCheck: number | null;
	longestGap: number;
	/** Minutes from the last encounter to the end of the course. */
	afterLast: number;
}

export interface SpacingView {
	totalMinutes: number;
	lessons: Array<{ title: string; start: number }>;
	rows: SpacingRow[];
}

export function spacingView(concepts: ConceptsView, anatomy: LessonAnatomy[]): SpacingView {
	const { startOf, lessons, totalMinutes } = pageClock(anatomy);
	const rows = concepts.concepts.map((concept) => {
		const encounters = concept.occurrences
			.filter((occurrence) => ENCOUNTER.includes(occurrence.role))
			.map((occurrence) => {
				const place = concepts.places[occurrence.ref];
				return { minute: place ? (startOf.get(pageKey(place.lesson, place.page)) ?? 0) : 0, role: occurrence.role, ref: occurrence.ref, page: place ? pageKey(place.lesson, place.page) : null };
			})
			.sort((a, b) => a.minute - b.minute);
		const defined = encounters.find((encounter) => encounter.role === "defined");
		const firstCheck = defined ? encounters.find((encounter) => encounter.role === "checked" && encounter.minute >= defined.minute) : undefined;
		const gaps = encounters.slice(1).map((encounter, index) => encounter.minute - (encounters[index]?.minute ?? 0));
		return {
			name: concept.name,
			encounters,
			definedAt: defined?.minute ?? null,
			toFirstCheck: defined && firstCheck ? firstCheck.minute - defined.minute : null,
			longestGap: Math.max(0, ...gaps),
			afterLast: totalMinutes - (encounters.at(-1)?.minute ?? 0),
		};
	});
	return { totalMinutes, lessons, rows };
}

const LABEL = 230;
const PLOT = 760;
const ROW = 18;

export function renderSpacing(view: SpacingView): string {
	const x = (minute: number) => LABEL + (minute / Math.max(view.totalMinutes, 1)) * PLOT;
	const top = 22;
	const height = top + view.rows.length * ROW + 6;
	let axis = "";
	const step = view.totalMinutes > 120 ? 30 : view.totalMinutes > 40 ? 10 : 5;
	for (let minute = 0; minute <= view.totalMinutes; minute += step) {
		axis += `<text class="page-label" x="${x(minute)}" y="${height + 12}" text-anchor="middle">${minute}</text>`;
	}
	const lessons = view.lessons
		.map((lesson, index) => `<line class="page" x1="${x(lesson.start)}" x2="${x(lesson.start)}" y1="${top - 6}" y2="${height}"/><text class="page-label" x="${x(lesson.start) + 3}" y="12">L${index + 1}<title>${esc(lesson.title)}</title></text>`)
		.join("");
	const rows = view.rows
		.map((row, index) => {
			const y = top + index * ROW + ROW / 2;
			const segments = row.encounters
				.slice(1)
				.map((encounter, i) => {
					const previous = row.encounters[i];
					if (!previous) return "";
					const gap = encounter.minute - previous.minute;
					return `<line class="gap"${encounter.page ? ` data-lessons="${[...new Set([previous.page, encounter.page].flatMap((page) => (page ? [page.split(".")[0]] : [])))].join(" ")}"` : ""} x1="${x(previous.minute)}" x2="${x(encounter.minute)}" y1="${y}" y2="${y}"><title>${esc(row.name)}\n${Math.round(gap)} min between encounters</title></line>`;
				})
				.join("");
			const dots = row.encounters
				.map((encounter) => {
					const tip = `<title>${esc(row.name)}\n${ROLE_LABEL[encounter.role]} at minute ${Math.round(encounter.minute)}</title>`;
					const cx = x(encounter.minute);
					const at = encounter.page ? ` data-page="${encounter.page}"` : "";
					// Symbols follow CONTEXT.md, as in the concept lanes.
					return encounter.role === "defined"
						? `<circle class="c-defined"${at} cx="${cx}" cy="${y}" r="4.5">${tip}</circle>`
						: encounter.role === "checked"
							? `<rect class="c-checked"${at} x="${cx - 4}" y="${y - 4}" width="8" height="8">${tip}</rect>`
							: encounter.role === "activity"
								? `<rect class="c-activity"${at} x="${cx - 3.5}" y="${y - 3.5}" width="7" height="7">${tip}</rect>`
								: `<circle class="c-minor"${at} cx="${cx}" cy="${y}" r="2.8">${tip}</circle>`;
				})
				.join("");
			return `<g><text class="lane" x="0" y="${y + 4}">${esc(row.name.length > 32 ? `${row.name.slice(0, 31)}…` : row.name)}<title>${esc(row.name)}</title></text>${segments}${dots}</g>`;
		})
		.join("");
	const fmt = (minutes: number | null) => (minutes === null ? "–" : minutes.toFixed(0));
	const table = view.rows
		.map(
			(row) =>
				`<tr data-lessons="${[...new Set(row.encounters.flatMap((item) => item.page ? [item.page.split(".")[0]] : []))].join(" ")}"><th scope="row">${esc(row.name)}</th><td class="num">${fmt(row.definedAt)}</td><td class="num">${row.encounters.length}</td><td class="num">${fmt(row.toFirstCheck)}</td><td class="num">${fmt(row.longestGap)}</td><td class="num">${fmt(row.afterLast)}</td></tr>`,
		)
		.join("");
	return `${viewBlock({ id: "spacing", level: 3, title: "Concept spacing", question: "How long does the course leave between encounters with each concept?", lead: `<p class="rule">Horizontal distance shows estimated minutes between encounters.</p>${method(`<p class="rule">A page lasts its narration or reading time, whichever is longer. Encounters are definitions, examples or recaps, activities and knowledge checks; mentions and previews are left out. These gaps measure course time, not retention. Useful spacing depends on how long learners must remember, as studied by Cepeda et al., 2008.</p>`)}`, chart: `${legend([["c-defined", "Defined"], ["c-minor", "Example or recap"], ["c-activity", "Activity"], ["c-checked", "Knowledge check"]])}
<div class="scroll" tabindex="0" role="region" aria-label="Concept encounters over course time">
<svg width="${LABEL + PLOT + 20}" height="${height + 18}" role="img" aria-label="Encounters with ${view.rows.length} concepts across ${Math.round(view.totalMinutes)} course minutes.">${lessons}${rows}${axis}</svg></div>`, table: `<div class="table-wrap" tabindex="0" role="region" aria-label="Concept spacing in minutes"><table class="blocks"><thead><tr><th scope="col">Concept</th><th scope="col" class="num">Defined at (min)</th><th scope="col" class="num">Encounters</th><th scope="col" class="num">Definition to first check (min)</th><th scope="col" class="num">Longest gap (min)</th><th scope="col" class="num">Last encounter to course end (min)</th></tr></thead><tbody>${table}</tbody></table></div>` })}`;
}

export const SPACING_STYLE = `
svg .gap{stroke:var(--muted);stroke-width:1.5}

`;
