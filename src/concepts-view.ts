import type { ConceptsAnswer, Role } from "./concepts.ts";
import type { Block, Course } from "./inspect.ts";
import { isKnowledgeCheck } from "./anatomy.ts";
import { absence, generated, generatedSummary, legend, method, sectionHead, viewBlock } from "./modes.ts";
import { buildPlaces, courseAxis, esc, type LessonSpan, lessonTags, locateBlocks, pageKey, type Places, where, wheres } from "./places.ts";

export interface ConceptLane {
	id: string;
	name: string;
	occurrences: Array<{ ref: string; role: Role; position: number }>;
	/** Ref of the first `defined` occurrence, or null when the course never defines it. */
	firstDefined: string | null;
	/** Uses, examples or checks on pages before the first definition; previews and the defining page do not count. */
	usedBeforeDefined: string[];
	checks: number;
	lessonCount: number;
}

export interface ConceptsView {
	partial?: true;
	model: string;
	concepts: ConceptLane[];
	dependencies: Array<{
		prerequisite: string;
		dependent: string;
		prerequisiteDefined: string | null;
		dependentDefined: string | null;
		direction: "before" | "same page" | "after" | "undefined";
		cycle: boolean;
	}>;
	blocks: number;
	lessons: LessonSpan[];
	places: Places;
	interpretation: ConceptsAnswer["interpretation"];
}

function earlierPage(places: Places, ref: string, than: string): boolean {
	const a = places[ref];
	const b = places[than];
	return !!a && !!b && (a.lesson < b.lesson || (a.lesson === b.lesson && a.page < b.page));
}

function sortKey(concept: { firstDefined: string | null; occurrences: Array<{ ref: string; position: number }> }): number {
	return concept.occurrences.find((occurrence) => occurrence.ref === concept.firstDefined)?.position ?? Infinity;
}

export function conceptsView(course: Course, answer: ConceptsAnswer): ConceptsView {
	const places = buildPlaces(course, [
		...answer.concepts.flatMap((concept) => concept.occurrences.map((occurrence) => occurrence.ref)),
		...answer.interpretation.flatMap((item) => item.refs),
	]);
	const blocks = new Map(locateBlocks(course).map((item) => [item.ref, item.block]));
	const concepts = answer.concepts
		.map((concept) => {
			// Only a question with a right answer is a knowledge check; an open prompt the model marked checked is an activity.
			const occurrences = concept.occurrences
				.map((occurrence) => ({
					...occurrence,
					// Demote a check only when the input shows it has no right answer; unknown correctness keeps the reviewer's reading.
					role: occurrence.role === "checked" && isKnowledgeCheck(blocks.get(occurrence.ref) as Block) === false ? ("activity" as const) : occurrence.role,
					position: places[occurrence.ref]?.position ?? 0,
				}))
				.sort((a, b) => a.position - b.position);
			const defined = occurrences.find((occurrence) => occurrence.role === "defined");
			return {
				id: concept.id,
				name: concept.name,
				occurrences,
				firstDefined: defined?.ref ?? null,
				usedBeforeDefined: occurrences
					.filter(
						(occurrence) =>
							(occurrence.role === "mentioned" ||
								occurrence.role === "example" ||
								occurrence.role === "activity" ||
								occurrence.role === "checked") &&
							(!defined || earlierPage(places, occurrence.ref, defined.ref)),
					)
					.map((occurrence) => occurrence.ref),
				checks: occurrences.filter((occurrence) => occurrence.role === "checked").length,
				lessonCount: new Set(occurrences.map((occurrence) => places[occurrence.ref]?.lesson)).size,
			};
		})
		// Teaching order: by first definition, so early uses sit left of each lane's first dot.
		.sort((a, b) => sortKey(a) - sortKey(b));
	const byId = new Map(concepts.map((concept) => [concept.id, concept]));
	const prerequisites = new Map(answer.concepts.map((concept) => [concept.id, concept.prerequisites]));
	const reaches = (from: string, target: string): boolean => {
		const seen = new Set<string>();
		const pending = [from];
		while (pending.length) {
			const id = pending.pop() as string;
			if (id === target) return true;
			if (seen.has(id)) continue;
			seen.add(id);
			pending.push(...(prerequisites.get(id) ?? []));
		}
		return false;
	};
	const dependencies: ConceptsView["dependencies"] = answer.concepts.flatMap((concept) =>
		concept.prerequisites.map((prerequisite) => {
			const prerequisiteDefined = byId.get(prerequisite)?.firstDefined ?? null;
			const dependentDefined = byId.get(concept.id)?.firstDefined ?? null;
			const first = prerequisiteDefined ? places[prerequisiteDefined] : undefined;
			const second = dependentDefined ? places[dependentDefined] : undefined;
			const direction =
				!first || !second
					? "undefined"
					: first.lesson === second.lesson && first.page === second.page
						? "same page"
						: first.position < second.position
							? "before"
								: "after";
			return {
				prerequisite,
				dependent: concept.id,
				prerequisiteDefined,
				dependentDefined,
				direction,
				cycle: reaches(prerequisite, concept.id),
			};
		}),
	);
	return { model: answer.model, ...(course.schema === "praxity-inspect/1" ? { partial: true as const } : {}), concepts, dependencies, ...courseAxis(course), places, interpretation: answer.interpretation };
}

export const ROLE_LABEL: Record<Role, string> = {
	preview: "Preview",
	defined: "Defined",
	example: "Example",
	mentioned: "Mentioned",
	activity: "Activity",
	checked: "Knowledge check",
	recap: "Recap",
};

const LABEL = 230;
const PLOT = 700;
const ROW = 18;

/** Symbols follow GLOSSARY.md: one meaning per symbol across the report. */
function mark(role: Role, x: number, y: number, title: string, page: string | null = null): string {
	const tip = `<title>${title}</title>`;
	const at = page ? ` data-page="${page}"` : "";
	switch (role) {
		case "defined":
			return `<circle class="c-defined"${at} cx="${x}" cy="${y}" r="4.5">${tip}</circle>`;
		case "activity":
			return `<rect class="c-activity"${at} x="${x - 3.5}" y="${y - 3.5}" width="7" height="7">${tip}</rect>`;
		case "checked":
			return `<rect class="c-checked"${at} x="${x - 4}" y="${y - 4}" width="8" height="8">${tip}</rect>`;
		case "preview":
			return `<circle class="c-preview"${at} cx="${x}" cy="${y}" r="2.5">${tip}</circle>`;
		default:
			return `<circle class="c-minor"${at} cx="${x}" cy="${y}" r="2.8">${tip}</circle>`;
	}
}

function lanes(view: ConceptsView): string {
	const x = (position: number) => LABEL + (position / Math.max(view.blocks - 1, 1)) * PLOT;
	const top = 22;
	const height = top + view.concepts.length * ROW + 4;
	const width = LABEL + PLOT + 12;
	const lessons = view.lessons
		.filter((lesson) => lesson.start >= 0)
		.map(
			(lesson, index) =>
				`<line class="page" x1="${x(lesson.start) - 2}" x2="${x(lesson.start) - 2}" y1="${top - 6}" y2="${height}"/><text class="page-label" x="${x(lesson.start)}" y="12">L${index + 1}<title>${esc(lesson.title)}</title></text>`,
		)
		.join("");
	// Mentions draw first so the stronger roles sit on top where marks coincide.
	const order: Role[] = ["preview", "mentioned", "recap", "example", "activity", "defined", "checked"];
	const rows = view.concepts
		.map((concept, index) => {
			const y = top + index * ROW + ROW / 2;
			const first = concept.occurrences[0]?.position ?? 0;
			const last = concept.occurrences.at(-1)?.position ?? 0;
			const marks = [...concept.occurrences]
				.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
				.map((occurrence) => {
					const place = view.places[occurrence.ref];
					const title = `${esc(concept.name)}\n${ROLE_LABEL[occurrence.role]}${place ? ` on ${pageKey(place.lesson, place.page)}` : ""}`;
					return mark(occurrence.role, x(occurrence.position), y, title, place ? pageKey(place.lesson, place.page) : null);
				})
				.join("");
			return `<g><text class="lane" x="0" y="${y + 4}">${esc(concept.name.length > 34 ? `${concept.name.slice(0, 33)}…` : concept.name)}<title>${esc(concept.name)}</title></text><line class="grid" x1="${x(first)}" x2="${x(last)}" y1="${y}" y2="${y}"/>${marks}</g>`;
		})
		.join("");
	return `<div class="scroll" tabindex="0" role="region" aria-label="Where each concept appears">
<svg width="${width}" height="${height}" role="img" aria-label="${view.concepts.length} concepts across the course, marking where each is defined, exemplified, mentioned, checked and recapped.">${lessons}${rows}</svg></div>`;
}

function conceptTable(view: ConceptsView): string {
	const rows = view.concepts
		.map((concept) => {
			const count = (role: Role) => concept.occurrences.filter((occurrence) => occurrence.role === role).length;
			const before = concept.usedBeforeDefined.length
				? `${concept.firstDefined ? "Used before defined" : absence(view.partial, "Never defined", "A definition was")}: ${wheres(view.places, concept.usedBeforeDefined)}`
				: "";
			return `<tr ${lessonTags(view.places, concept.occurrences.map((item) => item.ref))}><th scope="row">${esc(concept.name)}</th><td>${concept.firstDefined ? where(view.places, concept.firstDefined) : "–"}</td><td class="num">${count("example")}</td><td class="num">${count("mentioned")}</td><td class="num">${concept.checks}${concept.checks === 0 && view.partial ? `<span class="file">${absence(true, "", "A knowledge check was")}</span>` : ""}</td><td class="num">${count("activity")}</td><td class="num">${count("recap")}</td><td class="num">${concept.lessonCount}</td><td>${before}</td></tr>`;
		})
		.join("");
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Concept summary"><table class="blocks"><caption class="sr">Concept summary</caption><thead><tr><th scope="col">Concept</th><th scope="col">First defined</th><th scope="col" class="num">Examples</th><th scope="col" class="num">Mentions</th><th scope="col" class="num">Knowledge checks</th><th scope="col" class="num">Activities</th><th scope="col" class="num">Recaps</th><th scope="col" class="num">Lessons</th><th scope="col">Before its definition</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** Collapse flagged cycle links before measuring the longest prerequisite chain. */
export function prerequisiteLayers(view: ConceptsView): ConceptLane[][] {
	const group = new Map(view.concepts.map((concept) => [concept.id, concept.id]));
	for (const link of view.dependencies.filter((link) => link.cycle)) {
		const from = group.get(link.prerequisite), to = group.get(link.dependent);
		for (const [id, value] of group) if (value === to) group.set(id, from as string);
	}
	const incoming = new Map([...group.values()].map((id) => [id, new Set<string>()]));
	for (const link of view.dependencies) {
		const from = group.get(link.prerequisite), to = group.get(link.dependent);
		if (from !== undefined && to !== undefined && from !== to) incoming.get(to)?.add(from);
	}
	const depths = new Map<string, number>();
	const depth = (id: string): number => {
		const known = depths.get(id);
		if (known !== undefined) return known;
		const value = Math.max(-1, ...[...(incoming.get(id) ?? [])].map(depth)) + 1;
		depths.set(id, value);
		return value;
	};
	const columns: ConceptLane[][] = [];
	for (const concept of view.concepts) {
		const d = depth(group.get(concept.id) as string);
		(columns[d] ??= []).push(concept);
	}
	const ranks = new Map<string, number>();
	const courseOrder = new Map(view.concepts.map((concept, i) => [concept.id, i]));
	for (const column of columns) {
		const centre = (concept: ConceptLane) => {
			const positions = view.dependencies.filter((link) => link.dependent === concept.id && !link.cycle)
				.flatMap((link) => ranks.has(link.prerequisite) ? [ranks.get(link.prerequisite) as number] : []);
			return positions.length ? positions.reduce((sum, value) => sum + value, 0) / positions.length : 0;
		};
		column.sort((a, b) => centre(a) - centre(b) || (courseOrder.get(a.id) as number) - (courseOrder.get(b.id) as number));
		column.forEach((concept, i) => ranks.set(concept.id, i));
	}
	return columns;
}

function prerequisiteColumns(view: ConceptsView): string {
	if (!view.dependencies.length) return "";
	const columns = prerequisiteLayers(view);
	const COLUMN = 320, NODE = 232, ROW = 40, LEFT = 32, TOP = 52;
	const cyclic = new Set(view.dependencies.filter((link) => link.cycle).flatMap((link) => [link.prerequisite, link.dependent]));
	const positions = new Map(columns.flatMap((column, depth) => column.map((concept, row) => {
		const cycle = cyclic.has(concept.id) ? " · cycle" : "";
		// ponytail: estimate 12px chart text by character count; measure text if font variation needs exact placement.
		const limit = cycle ? 20 : 28;
		const label = (concept.name.length > limit ? `${concept.name.slice(0, limit - 1)}…` : concept.name) + cycle;
		return [concept.id, { x: LEFT + depth * COLUMN, y: TOP + row * ROW, depth, label, end: Math.min(NODE, 12 + label.length * 12 * 0.6 + 4) }] as const;
	})));
	const place = (ref: string | null) => (ref ? view.places[ref] : undefined);
	const late = (direction: string) => direction === "after" || direction === "undefined";
	const byId = new Map(view.concepts.map((concept) => [concept.id, concept]));
	const drawn = new Set(view.dependencies);
	const outgoing = new Map(view.concepts.map((concept) => [concept.id, view.dependencies.filter((link) => link.prerequisite === concept.id)]));
	for (const link of view.dependencies) {
		if (late(link.direction)) continue;
		drawn.delete(link);
		const seen = new Set<string>();
		const pending = [link.prerequisite];
		while (pending.length) {
			const id = pending.pop()!;
			if (seen.has(id)) continue;
			seen.add(id);
			for (const next of outgoing.get(id) ?? []) if (drawn.has(next)) pending.push(next.dependent);
		}
		// Reduce against the remaining graph so alternate routes through cycles cannot all disappear.
		if (!seen.has(link.dependent)) drawn.add(link);
	}
	const links = view.dependencies.filter((link) => drawn.has(link)).map((link) => {
		const a = positions.get(link.prerequisite), b = positions.get(link.dependent);
		if (!a || !b) return "";
		const lessons = [...new Set([place(link.prerequisiteDefined)?.lesson, place(link.dependentDefined)?.lesson].filter((lesson) => lesson !== undefined))];
		const title = `${byId.get(link.dependent)?.name} builds on ${byId.get(link.prerequisite)?.name}\n${
			link.direction === "undefined" ? absence(view.partial, "The prerequisite is never defined", "A prerequisite definition was", "text") : late(link.direction) ? "The prerequisite is defined later" : link.direction === "same page" ? "Both are defined on the same page" : "The prerequisite comes first"
		}${link.cycle ? "\nPart of a cycle" : ""}`;
		let curve = `M${a.x + a.end} ${a.y}`;
		if (link.cycle) {
			const right = a.x + NODE + 8, left = a.x - 16, gap = a.y + ROW / 2;
			curve += ` C${right + 8} ${a.y} ${right + 8} ${gap} ${right} ${gap} L${left} ${gap} C${left - 8} ${gap} ${left - 8} ${b.y} ${b.x - 5} ${b.y}`;
		} else {
			let previous = { x: a.x + NODE + 8, y: a.y };
			curve += ` L${previous.x} ${previous.y}`;
			const through = (point: { x: number; y: number }) => {
				const mid = (previous.x + point.x) / 2;
				curve += ` C${mid} ${previous.y} ${mid} ${point.y} ${point.x} ${point.y}`;
				previous = point;
			};
			for (let depth = a.depth + 1; depth < b.depth; depth++) {
				const ideal = a.y + (b.y - a.y) * (depth - a.depth) / (b.depth - a.depth);
				const row = Math.max(0, Math.min(columns[depth]!.length - 1, Math.round((ideal - TOP) / ROW - 0.5)));
				const y = TOP + (row + 0.5) * ROW, x = LEFT + depth * COLUMN;
				// Cross the whole label area at a row gap; change height only between columns.
				through({ x: x - 12, y });
				curve += ` L${x + NODE + 8} ${y}`;
				previous = { x: x + NODE + 8, y };
			}
			through({ x: b.x - 5, y: b.y });
		}
		return `<path class="dep-arc${late(link.direction) ? " late" : ""}" data-lessons="${lessons.join(" ")}" d="${curve}"><title>${esc(title)}</title></path>`;
	}).join("");
	const headings = columns.map((_, depth) => `<text x="${LEFT + depth * COLUMN}" y="18">${depth === 0 ? "No earlier prerequisite step" : `Builds on ${depth} ${depth === 1 ? "step" : "steps"}`}</text>`).join("");
	const nodes = columns.flatMap((column) => column.map((concept) => {
		const { x, y, label, end } = positions.get(concept.id)!;
		const at = place(concept.firstDefined);
		const cycle = cyclic.has(concept.id) ? " · cycle" : "";
		return `<g${at ? ` data-page="${pageKey(at.lesson, at.page)}"` : ""}><title>${esc(concept.name)}\n${at ? `Defined on ${pageKey(at.lesson, at.page)}` : absence(view.partial, "Never defined", "A definition was", "text")}${cycle ? "\nPart of a cycle" : ""}</title><rect class="dep-label" x="${x - 6}" y="${y - 12}" width="${end + 4}" height="24"/><circle class="dep-node${concept.firstDefined ? "" : " undefined"}" cx="${x}" cy="${y}" r="3.5"/><text class="lane" x="${x + 12}" y="${y + 4}">${esc(label)}</text></g>`;
	})).join("");
	const width = LEFT + columns.length * COLUMN - (COLUMN - NODE) + 16;
	const height = TOP + Math.max(...columns.map((column) => column.length)) * ROW;
	return `${legend([["dep-key", "Builds on, in course order"], ["dep-key late", view.partial ? `Builds on a concept defined later, or with ${absence(true, "", "a definition")}` : "Builds on a concept defined later or never"]])}<div class="scroll" tabindex="0" role="region" aria-label="Prerequisite links"><svg width="${width}" height="${height}" role="img" aria-label="${drawn.size} drawn prerequisite links of ${view.dependencies.length} total between ${view.concepts.length} concepts, from prerequisite on the left to dependent on the right. Concepts in a cycle share a column and are labelled cycle; the table view lists each link.">${headings}${links}${nodes}</svg></div>`;
}

function dependencyOrder(view: ConceptsView): string {
	const byId = new Map(view.concepts.map((concept) => [concept.id, concept]));
	const at = (ref: string | null) => (ref ? where(view.places, ref) : absence(view.partial, "not defined", "A definition was"));
	const late = (direction: string) => direction === "after" || direction === "undefined";
	const rows = view.concepts
		.map((concept) => {
			const links = view.dependencies.filter((link) => link.dependent === concept.id);
			if (!links.length) return "";
			const chips = links
				.map((link) => {
					const prerequisite = byId.get(link.prerequisite);
					const note = link.direction === "undefined" ? ` (${absence(view.partial, "never defined", "A definition was")})` : late(link.direction) ? ` (defined later, ${at(link.prerequisiteDefined)})` : "";
					return `<span class="dep${late(link.direction) ? " late" : ""}${link.cycle ? " cycle" : ""}">${esc(prerequisite?.name ?? link.prerequisite)}${note}</span>`;
				})
				.join(", ");
			return `<tr ${lessonTags(view.places, concept.occurrences.map((item) => item.ref))}><th scope="row">${esc(concept.name)}</th><td>${at(concept.firstDefined)}</td><td>${chips}</td></tr>`;
		})
		.join("");
	const total = view.dependencies.length;
	const backward = view.dependencies.filter((link) => late(link.direction)).length;
	return viewBlock({ id: "prerequisites", level: 3, title: "Prerequisite order", question: "Does each concept come after the ideas it builds on?", lead: `<p class="rule">${total - backward} of ${total} prerequisite links come in order${backward ? `; ${backward} ${backward === 1 ? "does" : "do"} not, shown in orange` : ""}.</p>${method(`<p>Definitions on the same page count as in order. Orange links point to a prerequisite defined later or not found. Each column is one step beyond the deepest prerequisite, based on the generated concept links. Concepts in a cycle share a column, ignoring steps within that cycle. Within columns, concepts are arranged to reduce crossing links, with course definition order breaking ties. The chart omits links implied by longer chains except orange links; the table retains every link. Hollow circles mean ${absence(view.partial, "never defined", "a definition was")}.</p>`)}`, chart: prerequisiteColumns(view) || undefined, table: `<div class="table-wrap" tabindex="0" role="region" aria-label="What each concept builds on"><table class="blocks dependencies"><caption class="sr">What each concept builds on</caption><thead><tr><th scope="col">Concept</th><th scope="col">Defined</th><th scope="col">Builds on</th></tr></thead><tbody>${rows}</tbody></table></div>` });
}

/** Callbacks keep headings in reading order: spacing, Concepts interpretation, then distinctions. */
export function renderConcepts(view: ConceptsView, extra: () => string = () => "", distinctions: () => string = () => ""): string {
	const before = view.concepts.filter((concept) => concept.usedBeforeDefined.length > 0).length;
	const unchecked = view.concepts.filter((concept) => concept.firstDefined && concept.checks === 0).length;
	return `<section aria-labelledby="concepts">
${sectionHead("concepts", "Concepts", "Which ideas does the course introduce, in what order, and how often does it come back to them?", `<p class="rule">Concept identities and their page links are ${generated(view.model, "generated interpretations")}.</p>`)}
${viewBlock({
	id: "concepts",
	level: 3,
	title: "Concept appearances",
	question: "Where is each concept defined, used, practised and checked?",
	lead: `<p class="rule">${before} ${before === 1 ? "concept is" : "concepts are"} used on a page before ${before === 1 ? "its" : "their"} first definition, not counting previews; ${view.partial ? `For ${unchecked} defined ${unchecked === 1 ? "concept" : "concepts"}, ${absence(true, "", "a knowledge check was")}` : `${unchecked} defined ${unchecked === 1 ? "concept has" : "concepts have"} no knowledge check`}.</p>`,
	chart: `${legend([["c-preview", "Preview"], ["c-defined", "Defined"], ["c-minor", "Example, mention or recap"], ["c-activity", "Activity"], ["c-checked", "Knowledge check"]])}${lanes(view)}`,
	table: conceptTable(view),
})}
${dependencyOrder(view)}
${extra()}
${generatedSummary(view.model, view.interpretation.map((item) => `<li>${esc(item.text)} <span class="file">${wheres(view.places, item.refs)}</span></li>`).join(""), "concepts")}
${distinctions()}
</section>`;
}

export const CONCEPTS_STYLE = `
svg .dep-arc{fill:none;stroke:var(--muted);stroke-width:1.5}svg .dep-arc.late{stroke:var(--look);stroke-width:2}svg .dep-arc:hover{stroke-width:3}
svg .dep-label{fill:var(--surface)}
svg .dep-node{fill:var(--ink)}svg .dep-node.undefined{fill:none;stroke:var(--ink);stroke-width:1.2}
.key.dep-key{height:2px;background:var(--muted);vertical-align:3px;border-radius:0}.key.dep-key.late{background:var(--look)}
.dependencies .dep.late{font-weight:600}
.dependencies .dep.late::before{content:"";display:inline-block;width:.55em;height:.55em;margin-right:.3em;background:var(--look);vertical-align:.05em}
.dependencies .dep.cycle{font-style:italic}
svg .c-defined{fill:var(--ink)}svg .c-minor{fill:var(--muted)}svg .c-checked{fill:var(--accent)}
svg .c-preview{fill:none;stroke:var(--muted);stroke-width:1.2}svg .c-activity{fill:var(--surface);stroke:var(--accent);stroke-width:1.8}
.key.c-preview{border-radius:50%;border:1.2px solid var(--muted);width:6px;height:6px}
.key.c-defined{border-radius:50%;background:var(--ink);width:9px;height:9px}
.key.c-minor{border-radius:50%;background:var(--muted);width:6px;height:6px}
.key.c-activity{border:1.8px solid var(--accent);width:8px;height:8px}
.key.c-checked{background:var(--accent);width:9px;height:9px}
`;
