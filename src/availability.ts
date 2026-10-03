import type { AlignmentView } from "./alignment-view.ts";
import { type LessonAnatomy, pageClock, roleOf } from "./anatomy.ts";

import type { Course } from "./inspect.ts";
import { absence, legend, method, renderFeedback, segmented, viewBlock } from "./modes.ts";
import { clip, esc, indexCourse, pageKey, type Places, where, wheres } from "./places.ts";
import { blockTexts, feedbackText, type Feedback } from "./text.ts";

/**
 * Where the instruction a knowledge check needs is when the check comes: still in view, on an
 * earlier page, behind a click, only spoken, only in a tooltip, only after the check, or not found.
 * A pre-assessment, placed before its teaching on purpose, is its own case and not a concern.
 * Built from the alignment review's instruction links; the most available instruction decides.
 */
export const AVAILABLE = ["same-page", "earlier-page", "behind-click", "tooltip", "narration", "pre", "after", "none"] as const;
export type Available = (typeof AVAILABLE)[number];

export const AVAILABLE_LABEL: Record<Available, string> = {
	"same-page": "On the same page",
	"earlier-page": "On an earlier page",
	"behind-click": "Behind a click",
	tooltip: "In a glossary tooltip only",
	narration: "In narration only",
	pre: "Pre-assessment, taught after",
	after: "Only after the check",
	none: "No instruction found",
};

/** Places a designer may want to look at, drawn in orange. */
const LOOK = new Set<Available>(["behind-click", "tooltip", "narration", "after", "none"]);

export interface AvailabilityView {
	partial?: true;
	checks: Array<{
		ref: string;
		lesson: number;
		page: number;
		question: string;
		available: Available;
		/** The instruction that decided, or null when none was found before or after. */
		source: { ref: string; type: string } | null;
		/** Course minutes from the start of that instruction's page to the start of the check's page. */
		minutesBefore: number | null;
		/** Every block the alignment review found teaching what the check needs. */
		instruction: string[];
		instructionLinks: Array<{ ref: string; channel: "screen" | "tooltip" | "narration"; after: boolean; available: Available; text: string }>;
		feedback: Feedback;
	}>;
	lessons: number[];
	places: Places;
}

export function availabilityView(course: Course, alignment: AlignmentView, anatomy: LessonAnatomy[]): AvailabilityView {
	const index = indexCourse(course);
	const { startOf } = pageClock(anatomy);
	const minute = (ref: string) => {
		const place = alignment.places[ref];
		return place ? (startOf.get(pageKey(place.lesson, place.page)) ?? 0) : 0;
	};
	const checks = alignment.checks.map((check) => {
		const at = alignment.places[check.ref];
		// Schema 1 lists nested blocks separately, so instruction inside an accordion is its own block
		// whose parent chain, not its own type, shows that a learner must open something to see it.
		const insideExplore = (ref: string) => {
			let block = index.block(ref)?.block;
			for (let depth = 0; block && depth < 50; depth += 1) {
				if (roleOf(block) === "explore") return true;
				block = block.parentRef ? index.sourceBlock(block.parentRef)?.block : undefined;
			}
			return false;
		};
		const kind = (support: (typeof check.support)[number]): Available => {
			if (support.after) return "after";
			if (support.channel === "narration") return "narration";
			if (support.channel === "tooltip") return "tooltip";
			if (insideExplore(support.ref)) return "behind-click";
			const place = alignment.places[support.ref];
			return place && at && place.lesson === at.lesson && place.page === at.page ? "same-page" : "earlier-page";
		};
		// A pre-assessment comes before its teaching by design.
		const instruction = check.support.map((support) => support.ref);
		const instructionLinks = check.support.map(support => {
			const text = blockTexts(index.block(support.ref)!.block);
			return { ref: support.ref, channel: support.channel, after: support.after, available: kind(support), text: support.channel === "screen" ? text.screen : support.channel === "tooltip" ? text.tooltips.map(tip => `${tip.term}: ${tip.text}`).join(" ") : text.narration.join(" ") };
		});
		const feedback = feedbackText(index.block(check.ref)!.block);
		if (check.pre) return { ref: check.ref, lesson: at?.lesson ?? 0, page: at?.page ?? check.page, question: check.question, available: "pre" as const, source: null, minutesBefore: null, instruction, instructionLinks, feedback };
		// Most available first; among equals, the instruction nearest the check.
		const best = check.support
			.map((support) => ({ support, available: kind(support) }))
			.sort((a, b) => AVAILABLE.indexOf(a.available) - AVAILABLE.indexOf(b.available) || b.support.position - a.support.position)[0];
		return {
			ref: check.ref,
			lesson: at?.lesson ?? 0,
			page: at?.page ?? check.page,
			question: check.question,
			available: best?.available ?? "none",
			source: best ? { ref: best.support.ref, type: index.block(best.support.ref)?.block.type ?? "" } : null,
			minutesBefore: best && best.available !== "after" ? Math.max(0, minute(check.ref) - minute(best.support.ref)) : null,
			instruction,
			instructionLinks,
			feedback,
		};
	});
	return { ...(course.schema === "praxity-inspect/1" ? { partial: true as const } : {}), checks, lessons: [...new Set(checks.map((check) => check.lesson))].filter(Boolean).sort((a, b) => a - b), places: alignment.places };
}

export const availabilityLabel = (available: Available, partial?: boolean, format: "html" | "svg" | "text" = "html") => available === "none" ? absence(partial, AVAILABLE_LABEL.none, "Instruction", format) : AVAILABLE_LABEL[available];

const minutes = (value: number | null) => (value === null ? "" : value < 1 ? "under 1 min" : `${Math.round(value)} min`);

function chart(view: AvailabilityView): string {
	const LABEL = view.partial ? 420 : 190, COL = Math.max(56, Math.min(120, 720 / Math.max(1, view.lessons.length))), ROW = 28, TOP = 8, GAP = 12;
	const height = TOP + AVAILABLE.length * ROW + 24;
	const width = LABEL + view.lessons.length * COL + 8;
	const y = (index: number) => TOP + index * ROW + ROW / 2;
	let out = "";
	AVAILABLE.forEach((available, index) => {
		out += `<line class="grid" x1="${LABEL}" x2="${width}" y1="${y(index)}" y2="${y(index)}"/><text class="lane" x="${LABEL - 10}" y="${y(index) + 4}" text-anchor="end">${availabilityLabel(available, view.partial, "svg")}</text>`;
	});
	view.lessons.forEach((lesson, column) => {
		const cx = LABEL + column * COL + COL / 2;
		out += `<text class="page-label" x="${cx}" y="${height - 6}" text-anchor="middle">L${lesson}</text>`;
		AVAILABLE.forEach((available, index) => {
			const here = view.checks.filter((check) => check.lesson === lesson && check.available === available);
			const perLine = Math.max(1, Math.floor((COL - 8) / GAP));
			here.forEach((check, k) => {
				const line = Math.floor(k / perLine), inLine = k % perLine, count = Math.min(perLine, here.length - line * perLine);
				const x = cx + (inLine - (count - 1) / 2) * GAP;
				const note = check.minutesBefore !== null && check.available !== "same-page" ? `\nInstruction ${minutes(check.minutesBefore)} before` : "";
				out += `<rect class="avail${LOOK.has(available) ? " look" : ""}" x="${(x - 4.5).toFixed(1)}" y="${(y(index) + line * 9 - (here.length > perLine ? 4 : 0) - 4.5).toFixed(1)}" width="9" height="9" data-page="${pageKey(check.lesson, check.page)}"><title>${esc(clip(check.question, 120))}${note}</title></rect>`;
			});
		});
	});
	return `${legend([["avail-key", "Knowledge check"], ["avail-key look", "Worth a look"]])}<div class="scroll" tabindex="0" role="region" aria-label="Knowledge checks by where their instruction is"><svg width="${width}" height="${height}" role="img" aria-label="${view.checks.length} knowledge checks by lesson and by where the instruction they need is; the table view lists each check.">${out}</svg></div>`;
}

function table(view: AvailabilityView): string {
	const rows = view.checks
		.map(
			(check) =>
				`<tr data-lesson="${check.lesson}"><th scope="row">${esc(check.question)}</th><td>${LOOK.has(check.available) ? `<strong>${availabilityLabel(check.available, view.partial)}</strong>` : availabilityLabel(check.available, view.partial)}${check.source && check.available === "behind-click" ? ` (${esc(check.source.type)})` : ""}</td><td class="num">${check.available === "same-page" ? "" : minutes(check.minutesBefore)}</td><td class="where">${check.source ? where(view.places, check.source.ref) : ""}</td><td class="where">${where(view.places, check.ref)}</td><td class="where">${wheres(view.places, check.instruction)}</td><td>${renderFeedback(check.feedback)}</td></tr>`,
		)
		.join("");
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Where each knowledge check's instruction is"><table class="blocks availability-table"><caption class="sr">Where each knowledge check's instruction is</caption><thead><tr><th scope="col">Knowledge check</th><th scope="col">Instruction it needs</th><th scope="col" class="num two-line">Minutes<br>before</th><th scope="col">Instruction at</th><th scope="col">Check at</th><th scope="col">All instruction</th><th scope="col"><abbr class="defined" tabindex="0" title="Supplied feedback text, without a quality classification. Empty feedback means a supplied field contains no text; not supplied by the input means no feedback field was included.">Feedback after responding</abbr></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** `positions` is the course-position strip of each check and its instruction, a second way to read the same links. */
export function renderAvailability(view: AvailabilityView, positions = ""): string {
	const look = view.checks.filter((check) => LOOK.has(check.available)).length;
	const pre = view.checks.filter((check) => check.available === "pre").length;
	return viewBlock({
		id: "availability",
		level: 3,
		title: "Instruction for knowledge checks",
		question: "Where is the instruction each knowledge check needs?",
		lead: `<p class="rule">${look} of ${view.checks.length} checks fall in the orange instruction categories${pre ? `; ${pre} ${pre === 1 ? "is a pre-assessment" : "are pre-assessments"}` : ""}. Instruction links are generated interpretations.</p>${method("<p class=\"rule\">Pre-assessments have their own category. Otherwise, where several passages are linked, the first available category counts in this order: on the same page, on an earlier page, behind a click, glossary tooltip only, narration only, then after the check. Ties use the latest passage in course order. No instruction found means the review linked none. Minutes before measures estimated course time between the instruction page and the check page.</p>")}`,
		controls: positions
			? segmented("availability-view", "Chart shown", [
					{ value: "where", label: "Where each check's instruction is", icon: "layout-rows", checked: true },
					{ value: "positions", label: "Each check and its instruction across the course", icon: "chart-dots" },
				])
			: "",
		chart: positions
			? `<div class="avail-mode" data-mode="where">${chart(view)}</div><div class="avail-mode" data-mode="positions"><p class="rule">One row per knowledge check, in course order. Circles right of a square are instruction that comes after the check.</p>${positions}</div>`
			: chart(view),
		table: table(view),
	});
}

export const AVAILABILITY_STYLE = `
.availability-table td{overflow-wrap:anywhere}.availability-table td:last-child{min-width:14rem;max-width:28rem}

.view:has(input[name=availability-view][value=where]:checked) .avail-mode[data-mode=positions],.view:has(input[name=availability-view][value=positions]:checked) .avail-mode[data-mode=where]{display:none}
svg .avail{fill:var(--accent);stroke:var(--surface);stroke-width:1}svg .avail.look{fill:var(--look)}
.key.avail-key{background:var(--accent);border-radius:1px}.key.avail-key.look{background:var(--look)}
`;
