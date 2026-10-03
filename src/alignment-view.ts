import { flowView, renderFlow } from "./flow.ts";
import { visibleText } from "./text.ts";
import { BLOOM, type Bloom, FINK, GAGNE, GAGNE_HELP, KNOWLEDGE_HELP, type VerbLevels, verbLevels } from "./outcomes.ts";

/** The Bloom level after combining the verb list with the model's reading; the source says which was used. */
export interface ObjectiveLevels {
	bloomSource?: "verb" | "generated" | null;
	verbBloom?: Bloom | null;
	modelBloom?: Bloom | null;
	levelReason?: string | null;
}
import { type AlignmentAnswer, type Channel, type Performance, type Purpose } from "./alignment.ts";

import type { Course } from "./inspect.ts";
import { buildPlaces, clip, courseAxis, esc, type LessonSpan, locateBlocks, pageKey, type Places, short, wheres } from "./places.ts";
import { absence, generated, generatedSummary, legend, method, sectionHead, segmented, viewBlock } from "./modes.ts";

export interface AlignmentView {
	partial?: true;
	model: string;
	/** Stated objectives with levels classified from their leading verb. */
	objectives: Array<AlignmentAnswer["objectives"][number] & VerbLevels & ObjectiveLevels>;
	objectiveGroups: Array<{ id: string; members: AlignmentView["objectives"] }>;
	/** Knowledge checks, reflections and worksheet activities, in course order. Surveys are counted only. */
	activities: Array<{
		ref: string;
		lesson: string;
		page: number;
		purpose: Exclude<Purpose, "survey">;
		label: string;
		objectives: string[];
	}>;
	/** Knowledge checks with the teaching each depends on. */
	checks: Array<{
		ref: string;
		lesson: string;
		page: number;
		position: number;
		question: string;
		/** Placed before its teaching on purpose, such as a pre-test. */
		pre: boolean;
		objectives: string[];
		support: Array<{ ref: string; channel: Channel; position: number; after: boolean }>;
	}>;
	surveys: number;
	/** Course-wide block count, the x extent of the support strip. */
	blocks: number;
	lessons: LessonSpan[];
	overlaps: AlignmentAnswer["overlaps"];
	interpretation: AlignmentAnswer["interpretation"];
	/** Readable locations for every ref the report shows. */
	places: Places;
}
export function groupObjectives(objectives: AlignmentView["objectives"], overlaps: AlignmentAnswer["overlaps"]): AlignmentView["objectiveGroups"] {
	const parent = new Map(objectives.map((objective) => [objective.id, objective.id]));
	const root = (id: string): string => {
		const current = parent.get(id) ?? id;
		if (current === id) return id;
		const result = root(current);
		parent.set(id, result);
		return result;
	};
	for (const overlap of overlaps) {
		const first = overlap.objectives[0];
		if (!first) continue;
		for (const id of overlap.objectives.slice(1)) parent.set(root(id), root(first));
	}
	const groups = new Map<string, AlignmentView["objectives"]>();
	for (const objective of objectives) {
		const key = root(objective.id);
		const members = groups.get(key) ?? [];
		members.push(objective);
		groups.set(key, members);
	}
	return [...groups.values()].map((members) => ({ id: members[0]?.id ?? "", members }));
}

export function alignmentView(course: Course, answer: AlignmentAnswer): AlignmentView {
	const located = locateBlocks(course);
	const position = new Map(located.map((item, index) => [item.ref, index]));
	const byRef = new Map(located.map((item) => [item.ref, item]));
	const knowledge = answer.checks.filter((check) => check.purpose === "knowledge");
	// The verb list is a measurement; where it has no level, the model's reading of verb and object fills in, marked as generated.
	const objectives = answer.objectives.map((objective) => {
		const fromVerb = verbLevels(objective.text);
		const modelBloom = objective.modelBloom ?? null;
		return {
			...objective,
			...fromVerb,
			bloom: fromVerb.bloom ?? modelBloom,
			bloomSource: fromVerb.bloom ? ("verb" as const) : modelBloom ? ("generated" as const) : null,
			verbBloom: fromVerb.bloom,
			modelBloom,
			levelReason: objective.levelReason ?? null,
		};
	});
	return {
		model: answer.model, ...(course.schema === "praxity-inspect/1" ? { partial: true as const } : {}),
		objectives,
		objectiveGroups: groupObjectives(objectives, answer.overlaps),
		activities: answer.checks
			.filter((check) => check.purpose !== "survey")
			.map((check) => {
				const item = byRef.get(check.ref);
				const text = String(item?.block.data.question ?? visibleText(item?.block.data).join(" "));
				return {
					ref: check.ref,
					lesson: item?.lesson ?? "",
					page: item?.page ?? 0,
					purpose: check.purpose as Exclude<Purpose, "survey">,
					label: text.replace(/\s+/g, " ").trim(),
					objectives: check.objectives,
				};
			})
			.sort((a, b) => (position.get(a.ref) ?? 0) - (position.get(b.ref) ?? 0)),
		checks: knowledge
			.map((check) => {
				const item = byRef.get(check.ref);
				const at = position.get(check.ref) ?? 0;
				return {
					ref: check.ref,
					lesson: item?.lesson ?? "",
					page: item?.page ?? 0,
					position: at,
					question: String(item?.block.data.question ?? (item ? visibleText(item.block.data).join(" ") : "")).replace(/\s+/g, " ").trim(),
					pre: check.pre,
					objectives: check.objectives,
					support: check.support.map((support) => {
						const where = position.get(support.ref) ?? 0;
						return { ...support, position: where, after: where > at };
					}),
				};
			})
			.sort((a, b) => a.position - b.position),
		surveys: answer.checks.filter((check) => check.purpose === "survey").length,
		...courseAxis(course),
		overlaps: answer.overlaps,
		interpretation: answer.interpretation,
		places: buildPlaces(course, [
			...answer.objectives.map((objective) => objective.ref),
			...answer.checks.flatMap((check) => [check.ref, ...check.support.map((support) => support.ref)]),
			...answer.interpretation.flatMap((item) => item.refs),
		]),
	};
}

const PURPOSE_LABEL = { knowledge: "Knowledge check", reflection: "Online activity", worksheet: "Worksheet activity" } as const;
const plainLocation = (view: AlignmentView, ref: string) => {
	const place = view.places[ref];
	return place ? pageKey(place.lesson, place.page) : esc(ref);
};

const lessonsForRefs = (view: AlignmentView, refs: string[]) =>
	[...new Set(refs.flatMap((ref) => view.places[ref] ? [view.places[ref]!.lesson] : []))].sort((a, b) => a - b);

const groupLessons = (view: AlignmentView, group: AlignmentView["objectiveGroups"][number]) =>
	lessonsForRefs(view, [...group.members.map((objective) => objective.ref), ...view.activities.filter((activity) => group.members.some((objective) => activity.objectives.includes(objective.id))).map((activity) => activity.ref)]);

function matrix(view: AlignmentView): string {
	type Activity = AlignmentView["activities"][number];
	const pages = new Map<string, Activity[]>();
	for (const activity of view.activities) {
		const place = view.places[activity.ref];
		const key = place ? pageKey(place.lesson, place.page) : activity.ref;
		pages.set(key, [...(pages.get(key) ?? []), activity]);
	}
	const rows = [
		...view.objectiveGroups.map((group) => ({
			lessons: groupLessons(view, group),
			unlinked: false,
			// One line per group: the first objective in full, the rest as ids whose text shows on hover,
			// so a large group does not stretch its row. The chart is aria-hidden, so the ids hover but take no
			// focus; Table mode and the Course trace list every member in full.
			label: (() => {
				const [first, ...rest] = group.members;
				if (!first) return "";
				const place = view.places[first.ref];
				const also = rest.length
					? `<span class="group-also">with ${rest.map((objective) => `<abbr class="defined oid-ref" title="${esc(`${objective.id} · ${objective.text}`)}">${esc(objective.id)}</abbr>`).join(", ")}</span>`
					: "";
				return `<span class="group-member"${place ? ` data-page="${pageKey(place.lesson, place.page)}"` : ""}><span class="oid">${esc(first.id)}</span><span class="otext clamp" title="${esc(first.text)}">${esc(first.text)}</span></span>${also}`;
			})(),
			has: (activity: Activity) => group.members.some((objective) => activity.objectives.includes(objective.id)),
		})),
		...(view.activities.some((activity) => activity.objectives.length === 0) ? [{
			lessons: lessonsForRefs(view, view.activities.filter((activity) => activity.objectives.length === 0).map((activity) => activity.ref)),
			unlinked: true,
			label: `<em>${absence(view.partial, "No stated objective", "A linked stated objective was")}</em>`,
			has: (activity: Activity) => activity.objectives.length === 0,
		}] : []),
	];
	const starts = (index: number, entries: Array<[string, Activity[]]>) =>
		index === 0 || view.places[entries[index - 1]?.[1][0]?.ref ?? ""]?.lesson !== view.places[entries[index]?.[1][0]?.ref ?? ""]?.lesson ? " lesson-start" : "";
	const entries = [...pages];
	const head = entries
		.map(([key, activities], index) => `<th scope="col" class="check${starts(index, entries)}" title="${esc(activities.map((activity) => `${PURPOSE_LABEL[activity.purpose]}: ${activity.label}`).join("\n"))}">${key}</th>`)
		.join("");
	const body = rows
		.map((row) => {
			const cells = entries.map(([_, activities], index) =>
				`<td class="cell${starts(index, entries)}">${activities.filter(row.has).map((activity) => `<span class="mark-${activity.purpose}" data-page="${short(view.places, activity.ref)}" title="${esc(`${PURPOSE_LABEL[activity.purpose]} · ${activity.label}`)}"></span>`).join("")}</td>`,
			);
			const none = !row.unlinked && !view.activities.some(row.has);
			return `<tr data-lessons="${row.lessons.join(" ")}"${row.unlinked ? ' class="unlinked"' : none ? ' class="no-evidence"' : ""}><th scope="row">${row.label}</th>${cells.join("")}</tr>`;
		})
		.join("");
	return `<div class="scroll" tabindex="0" role="region" aria-label="Evidence dot matrix"><div role="img" aria-label="${view.objectiveGroups.length} objective groups across ${pages.size} pages; Table mode lists every check and activity."><table class="matrix" aria-hidden="true"><caption class="sr">${view.objectiveGroups.length} objective groups across ${pages.size} pages; Table mode lists every check and activity.</caption><thead><tr><th scope="col">Objective group</th>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}

function evidenceTable(view: AlignmentView): string {
	const rows = [...view.objectiveGroups.map((group) => ({
		lessons: groupLessons(view, group),
		label: group.members.map((objective) => `<span class="group-member"><span class="oid">${esc(objective.id)}</span><span class="otext">${esc(objective.text)}</span></span>`).join(""),
		stated: group.members.map((objective) => `<span class="group-member"><span class="oid">${esc(objective.id)}</span>${plainLocation(view, objective.ref)}</span>`).join(""),
		has: (activity: AlignmentView["activities"][number]) => group.members.some((objective) => activity.objectives.includes(objective.id)),
	})), ...(view.activities.some((activity) => activity.objectives.length === 0) ? [{ lessons: lessonsForRefs(view, view.activities.filter((activity) => activity.objectives.length === 0).map((activity) => activity.ref)), label: absence(view.partial, "No stated objective", "A linked stated objective was"), stated: "", has: (activity: AlignmentView["activities"][number]) => activity.objectives.length === 0 }] : [])];
	const kinds = ["knowledge", "reflection", "worksheet"] as const;
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Evidence by objective group"><table class="blocks evidence-table"><caption class="sr">Evidence by objective group</caption><thead><tr><th scope="col">Objective group</th><th scope="col">Stated at</th><th scope="col" class="num">Knowledge checks</th><th scope="col" class="num">Online activities</th><th scope="col" class="num">Worksheet activities</th><th scope="col">Checks and activities</th></tr></thead><tbody>${rows.map((row) => {
		const items = view.activities.filter(row.has);
		return `<tr data-lessons="${row.lessons.join(" ")}"${items.length ? "" : ' class="no-evidence"'}><th scope="row">${row.label}</th><td class="where">${row.stated}</td>${kinds.map((kind) => `<td class="num">${items.filter((item) => item.purpose === kind).length}</td>`).join("")}<td>${items.map((item) => `<div>${PURPOSE_LABEL[item.purpose]}: <span>${plainLocation(view, item.ref)}</span> · ${esc(item.label)}</div>`).join("") || absence(view.partial, "None", "A check or activity was")}</td></tr>`;
	}).join("")}</tbody></table></div>`;
}

const CHANNEL_LABEL: Record<Channel, string> = {
	screen: "on screen",
	tooltip: "in a glossary tooltip",
	narration: "in narration only",
};

const PLOT = 640;
const LABEL = 300;
const ROW = 18;

function supportStrip(view: AlignmentView): string {
	const x = (position: number) => LABEL + (position / Math.max(view.blocks - 1, 1)) * PLOT;
	const top = 22;
	const height = top + view.checks.length * ROW + 4;
	const width = LABEL + PLOT + (view.partial ? 430 : 12);
	const lessons = view.lessons
		.filter((lesson) => lesson.start >= 0)
		.map(
			(lesson, index) =>
				`<line class="page" x1="${x(lesson.start) - 2}" x2="${x(lesson.start) - 2}" y1="${top - 6}" y2="${height}"/><text class="page-label" x="${x(lesson.start)}" y="12">L${index + 1}<title>${esc(lesson.title)}</title></text>`,
		)
		.join("");
	const rows = view.checks
		.map((check, index) => {
			const y = top + index * ROW + ROW / 2;
			const span = [check.position, ...check.support.map((support) => support.position)];
			const marks = check.support
				.map(
					(support) =>
						`<circle class="support" data-page="${short(view.places, support.ref)}" cx="${x(support.position)}" cy="${y}" r="4"><title>Instruction ${CHANNEL_LABEL[support.channel]}${support.after ? ", after the check" : ""}</title></circle>`,
				)
				.join("");
			return `<g><text class="lane" x="0" y="${y + 4}">${esc(clip(`${short(view.places, check.ref)}  ${check.question}`, 48))}<title>${esc(check.question)}</title></text><line class="grid" x1="${x(Math.min(...span))}" x2="${x(Math.max(...span))}" y1="${y}" y2="${y}"/>${marks}<rect class="check-tick" data-page="${short(view.places, check.ref)}" x="${x(check.position) - 4}" y="${y - 4}" width="8" height="8"><title>Knowledge check</title></rect>${
				check.support.length === 0 ? `<text class="page-label" x="${x(check.position) + 6}" y="${y + 4}">${absence(view.partial, "no instruction found", "Instruction", "svg")}</text>` : ""
			}</g>`;
		})
		.join("");
	return `<div class="scroll" tabindex="0" role="region" aria-label="Support for each knowledge check">
<svg width="${width}" height="${height}" role="img" aria-label="${view.checks.length} knowledge checks with the teaching each depends on, across the course.">${lessons}${rows}</svg></div>`;
}


const dot = (count: number) =>
	count
		? `<svg width="20" height="20" role="img" aria-label="${count}"><circle class="level-dot" cx="10" cy="10" r="${Math.min(9, 3 * Math.sqrt(count)).toFixed(1)}"/></svg>`
		: "";

/**
 * Where each lesson's objectives sit in one taxonomy: lessons across, levels up, one dot per objective.
 * The same objectives appear under Bloom and Fink, so switching shows how they correspond.
 */
type Taxonomy = "bloom" | "fink" | "gagne";
const TAXONOMY_NAME: Record<Taxonomy, string> = { bloom: "Bloom level", fink: "Fink dimension", gagne: "Gagné capability" };

function taxonomyByLesson(view: AlignmentView): string {
	const lessons = [...new Set(view.objectives.map((objective) => view.places[objective.ref]?.lesson ?? 0))].filter(Boolean).sort((a, b) => a - b);
	const LABEL = 170, COL = Math.max(56, Math.min(120, 720 / Math.max(1, lessons.length))), ROW = 30, TOP = 8, DOT = 5, GAP = 12;
	const levelsOf = (objective: AlignmentView["objectives"][number], taxonomy: Taxonomy): string[] =>
		taxonomy === "fink" ? objective.fink : taxonomy === "gagne" ? (objective.gagne ? [objective.gagne] : []) : objective.bloom ? [objective.bloom] : [];
	const describe = (objective: AlignmentView["objectives"][number]) =>
		`${objective.id} · ${objective.text} · Bloom: ${objective.bloom ?? "unclassified"}${objective.bloomSource === "generated" ? " (generated)" : ""} · Fink: ${objective.fink.join(", ") || "–"} · Gagné: ${objective.gagne ?? "–"}`;
	const chart = (taxonomy: Taxonomy, levels: readonly string[], ordered: boolean) => {
		const unplaced = view.objectives.filter((objective) => levelsOf(objective, taxonomy).length === 0);
		const rows = [...levels, ...(unplaced.length ? ["Unclassified"] : [])];
		const height = TOP + rows.length * ROW + 24;
		const width = LABEL + lessons.length * COL + 8;
		// Ordered taxonomies read upward from the lowest level; Fink's dimensions are not a hierarchy.
		const y = (index: number) => TOP + (ordered ? rows.length - 1 - index : index) * ROW + ROW / 2;
		let out = "";
		rows.forEach((level, index) => {
			out += `<line class="grid" x1="${LABEL}" x2="${width}" y1="${y(index)}" y2="${y(index)}"/><text class="lane" x="${LABEL - 10}" y="${y(index) + 4}" text-anchor="end">${esc(level)}</text>`;
		});
		lessons.forEach((lesson, column) => {
			const cx = LABEL + column * COL + COL / 2;
			out += `<text class="page-label" x="${cx}" y="${height - 6}" text-anchor="middle">L${lesson}</text>`;
			rows.forEach((level, index) => {
				const here = view.objectives.filter((objective) => (view.places[objective.ref]?.lesson ?? 0) === lesson && (level === "Unclassified" ? levelsOf(objective, taxonomy).length === 0 : levelsOf(objective, taxonomy).includes(level)));
				const perLine = Math.max(1, Math.floor((COL - 8) / GAP));
				here.forEach((objective, k) => {
					const line = Math.floor(k / perLine), inLine = k % perLine, count = Math.min(perLine, here.length - line * perLine);
					const x = cx + (inLine - (count - 1) / 2) * GAP;
					const place = view.places[objective.ref];
					out += `<circle class="taxo-dot${taxonomy === "fink" && objective.fink[0] !== level ? " second" : ""}" cx="${x.toFixed(1)}" cy="${(y(index) + line * 9 - (here.length > perLine ? 4 : 0)).toFixed(1)}" r="${DOT}"${place ? ` data-page="${pageKey(place.lesson, place.page)}"` : ""}><title>${esc(describe(objective))}</title></circle>`;
				});
			});
		});
		return `<div class="taxo" data-taxonomy="${taxonomy}"><div class="scroll" tabindex="0" role="region" aria-label="Objectives by lesson and ${TAXONOMY_NAME[taxonomy]}"><svg width="${width}" height="${height}" role="img" aria-label="${view.objectives.length} objectives by lesson and ${TAXONOMY_NAME[taxonomy]}; the table view lists each objective with all three.">${out}</svg></div></div>`;
	};
	// Each framework reads upward from its foundations, as Bloom does from Remember: Fink from foundational
	// knowledge, Gagné from verbal information through cognitive strategies, then attitudes and motor skills.
	return `${chart("bloom", BLOOM, true)}${chart("fink", FINK, true)}${chart("gagne", GAGNE, true)}`;
}

/** Objectives by lesson and level for each framework: does demand rise across the course? */

/** A level and where it came from: the verb list, or the model's reading of verb and object. */
function levelCell(level: string | null, source: "verb" | "generated" | null, fromVerb: string | null, fromModel: string | null, reason: string | null, model: string, candidates: string[] = []): string {
	if (level === null) return `<span class="unclassified">Unclassified</span>`;
	const why = reason ? ` ${reason}.` : "";
	const listed = candidates.length > 1 ? `The verb lists place this verb at ${candidates.slice(0, -1).join(", ")} or ${candidates.at(-1)}, so the object decides.` : "No verb list places this verb.";
	if (source === "generated") return `${level} <abbr class="defined level-source" tabindex="0" title="${esc(`${listed} Estimated by ${model} from the verb and its object.${why}`)}">generated</abbr>`;
	if (fromModel && fromModel !== fromVerb) return `${level} <abbr class="defined level-source" tabindex="0" title="${esc(`The verb list says ${fromVerb}; ${model} reads the whole objective as ${fromModel}.${why}`)}">or ${fromModel}</abbr>`;
	return level;
}

/** A category with its definition on hover and focus, or a dash. */
function defined(value: string | null, help: (value: string) => string): string {
	return value ? `<abbr class="defined" tabindex="0" title="${esc(help(value))}">${esc(value)}</abbr>` : "–";
}

/** Which parts of a performance objective (Mager) the objective states, with the quoted words on hover. */
function performanceCell(performance: Performance | null | undefined): string {
	if (!performance) return "–";
	const parts = (["action", "conditions", "standard"] as const).filter((part) => performance[part]);
	if (!parts.length) return `<span class="unclassified">No observable action</span>`;
	const quoted = parts.map((part) => `${part}: “${performance[part]}”`).join(" · ");
	const label = parts.map((part, index) => (index ? part : part.charAt(0).toUpperCase() + part.slice(1))).join(", ");
	return `<abbr class="defined" tabindex="0" title="${esc(quoted)}">${label}</abbr>`;
}

function objectiveTable(view: AlignmentView): string {
	const count = (id: string, purposes: string[]) =>
		view.activities.filter((activity) => purposes.includes(activity.purpose) && activity.objectives.includes(id)).length;
	const rows = view.objectives
		.map(
			(objective) =>
				`<tr data-lesson="${view.places[objective.ref]?.lesson ?? ""}"><th scope="row"><span class="group-member"><span class="oid">${esc(objective.id)}</span><span class="otext">${esc(objective.text)}</span></span></th><td class="where">${plainLocation(view, objective.ref)}</td><td>${levelCell(objective.bloom, objective.bloomSource ?? null, objective.verbBloom ?? null, objective.modelBloom ?? null, objective.levelReason ?? null, view.model, objective.bloomCandidates ?? [])}</td><td>${defined(objective.knowledge ?? null, (value) => KNOWLEDGE_HELP[value as keyof typeof KNOWLEDGE_HELP])}</td><td>${defined(objective.gagne ?? null, (value) => GAGNE_HELP[value as keyof typeof GAGNE_HELP])}</td><td>${esc(objective.fink.join(", ") || "–")}</td><td>${performanceCell(objective.performance)}</td><td class="num">${count(objective.id, ["knowledge"])}</td><td class="num">${count(objective.id, ["reflection", "worksheet"])}</td></tr>`,
		)
		.join("");
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Objectives with their levels"><table class="blocks objectives"><caption class="sr">Objectives with their levels</caption><thead><tr><th scope="col">Objective</th><th scope="col">Stated at</th><th scope="col">Bloom</th><th scope="col">Knowledge</th><th scope="col">Gagné</th><th scope="col">Fink</th><th scope="col"><abbr class="defined" tabindex="0" title="Whether the objective states an observable action, the conditions and a standard (Mager). Hover a cell for the words it quotes.">Performance</abbr></th><th scope="col" class="num">Knowledge checks</th><th scope="col" class="num">Activities</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function outcomeReview(view: AlignmentView): string {
	return viewBlock({
		id: "outcomes",
		level: 3,
		title: "What the objectives ask for",
		question: "What level and kind of learning does each objective ask for?",
		controls: segmented("taxonomy", "Taxonomy", [
			{ value: "bloom", label: "Bloom (revised): cognitive process", icon: "pyramid", checked: true },
			{ value: "fink", label: "Fink: kinds of significant learning", icon: "flower" },
			{ value: "gagne", label: "Gagné: kind of capability intended", icon: "category" },
		]),
		lead: `<p class="rule">Each dot is one objective, in the lesson that states it.</p>${method(`<p class="rule">Bloom levels come from the objective's leading verb where published verb lists place it at one level (Stanny 2016; Hodge and Tauber, <i>Community Nutrition</i>; after Anderson and Krathwohl 2001). Common verbs such as explain and identify sit at several levels; for those, and for unlisted verbs, an ${generated(view.model, "interpretation")} of the verb and its object decides. Fink dimensions and Gagné capabilities are generated. They are kinds of learning rather than levels; each chart puts its foundations at the bottom, as the frameworks present them. An objective with two Fink dimensions appears in both rows, the second paler.</p>`, "How levels are assigned")}`,
		chart: taxonomyByLesson(view),
		table: objectiveTable(view),
	});
}

export function renderAlignment(view: AlignmentView, availability: (positions: string) => string = () => ""): string {
	const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const tally = (["knowledge", "reflection", "worksheet"] as const).map((purpose) => view.activities.filter((activity) => activity.purpose === purpose).length);
	const evidenceLegend: Array<[string, string]> = [];
	if (tally[0]) evidenceLegend.push(["mark-knowledge", "Knowledge check"]);
	if (tally[1] || tally[2]) evidenceLegend.push(["mark-reflection", "Activity"]);
	const unevidenced = view.objectiveGroups.filter((group) => !view.activities.some((activity) => group.members.some((objective) => activity.objectives.includes(objective.id)))).length;
	const instructionLegend: Array<[string, string]> = [];
	if (view.checks.length) instructionLegend.push(["mark-knowledge", "Knowledge check"]);
	if (view.checks.some((check) => check.support.length)) instructionLegend.push(["support-key", "Instruction"]);
	return `<section aria-labelledby="alignment">
${sectionHead("alignment", "Alignment", "Do the checks and activities give evidence for every stated objective, and is each check taught first?", `<p class="rule">${count(tally[0] ?? 0, "knowledge check", "knowledge checks")} and ${count((tally[1] ?? 0) + (tally[2] ?? 0), "activity", "activities")} (${count(tally[1] ?? 0, "online", "online")}, ${count(tally[2] ?? 0, "worksheet", "worksheet")})${view.surveys ? `; ${count(view.surveys, "survey question", "survey questions")} left out` : ""}. Which objectives they serve, and what teaches them, is ${generated(view.model, "generated")}.</p>`)}
${outcomeReview(view)}
${renderFlow(flowView(view), Object.fromEntries(view.objectiveGroups.map((group) => [group.id, groupLessons(view, group)])))}
${viewBlock({
	id: "evidence",
	level: 3,
	title: "Evidence by objective group",
	question: "Which knowledge checks and activities give evidence for each objective?",
	lead: `<p class="rule">${unevidenced ? `${count(unevidenced, "objective group has", "objective groups have")} no knowledge check or activity. ` : ""}A check or activity counts once per group it serves.</p>`,
	chart: `${evidenceLegend.length || unevidenced ? legend([...evidenceLegend, ...(unevidenced ? [["no-evidence-key", "No check or activity"] as [string, string]] : [])]) : ""}${matrix(view)}`,
	table: evidenceTable(view),
})}
${availability(`${instructionLegend.length ? legend(instructionLegend) : ""}${supportStrip(view)}`)}
${generatedSummary(view.model, view.interpretation.map((item) => `<li>${esc(item.text)} <span class="file">${wheres(view.places, item.refs)}</span></li>`).join(""), "alignment")}
</section>`;
}

export const ALIGNMENT_STYLE = `
.matrix th[scope=row]{font-weight:400;min-width:16rem;max-width:22rem;font-size:.875rem;line-height:1.35}
.matrix .num{padding:.3rem .35rem}.matrix thead .num{font-size:.8rem}
.matrix thead .count-head{vertical-align:bottom;line-height:1.15;min-width:4.5rem;white-space:nowrap}
.matrix .oid{font-weight:600}
tr.no-evidence>th[scope=row]{box-shadow:inset 4px 0 0 var(--look)}
.key.no-evidence-key{width:4px;background:var(--look);border-radius:0}
svg .taxo-dot{fill:var(--ink-2);stroke:var(--surface);stroke-width:1.5}svg .taxo-dot.second{opacity:.4}
.view:has(input[name=taxonomy][value=bloom]:checked) .taxo:not([data-taxonomy=bloom]),.view:has(input[name=taxonomy][value=fink]:checked) .taxo:not([data-taxonomy=fink]),.view:has(input[name=taxonomy][value=gagne]:checked) .taxo:not([data-taxonomy=gagne]){display:none}
.level-source{font-size:.75rem;color:var(--ink-2);margin-left:.25rem}.unclassified{color:var(--muted)}
.matrix .group-also{display:block;font-size:.8rem;color:var(--ink-2);margin-top:.15rem;padding-left:2.4rem}.matrix .oid-ref{font-weight:600}
.matrix .otext.clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.objective-groups tr.group-start>*{border-top:1px solid var(--axis)}
.matrix th.check{font-size:.7rem;font-weight:400;color:var(--muted);padding:.3rem .15rem;writing-mode:vertical-rl;transform:rotate(180deg)}
.matrix td.cell{padding:.3rem .15rem;text-align:center;min-width:1.1rem}
.matrix .lesson-start{border-left:1px solid var(--axis)}
.mark-knowledge,.mark-reflection,.mark-worksheet{display:inline-block;width:9px;height:9px;box-sizing:border-box;margin-right:2px}
.legend .mark-knowledge,.legend .mark-reflection,.legend .mark-worksheet{margin-right:.45rem}
.mark-knowledge{background:var(--accent)}
.mark-reflection,.mark-worksheet{border:1.5px solid var(--accent)}
.matrix tbody tr.unlinked th{color:var(--ink-2)}
.evidence-table th[scope=row]{min-width:13rem}.evidence-table td:last-child{min-width:16rem}.evidence-table td:last-child div+div{margin-top:.25rem}
svg .support{fill:var(--surface);stroke:var(--ink);stroke-width:1.5}
svg .check-tick{fill:var(--accent)}
.key.support-key{border-radius:50%;border:1.5px solid var(--ink);width:9px;height:9px}
.levels th[scope=row],.levels th[scope=rowgroup]{min-width:0;font-size:.85rem;font-weight:400}
.levels th[scope=rowgroup]{font-weight:600;vertical-align:top}
.levels .framework-start>*{border-top:1px solid var(--axis)}
.levels td.cell{text-align:center;min-width:2.2rem}
svg .level-dot{fill:var(--accent)}
.objectives th[scope=row]{font-weight:400;max-width:26rem}
.objectives .file{display:block}
`;
