import { inlineClient } from "./client.ts";
import { groupObjectives, type AlignmentView } from "./alignment-view.ts";
import { esc, pageKey } from "./places.ts";
import { absence, legend, method, viewBlock } from "./modes.ts";

/**
 * Constructive alignment as an alluvial chart: objectives flow to checks and
 * activities, and checks flow on to where their instruction sits.
 * One unit is one objective–item pair, so every stage adds up to the same total.
 */
export type Status = "before" | "earlier-lesson" | "narration" | "after" | "untaught" | "practised" | "no-evidence";

const STATUS_LABEL: Record<Status, string> = {
	before: "Earlier in the same lesson",
	"earlier-lesson": "In an earlier lesson",
	narration: "In narration only",
	after: "Only after the check",
	untaught: "Not taught in this course (prior knowledge?)",
	practised: "Activity",
	"no-evidence": "No check or activity",
};
const STATUS_ORDER: Status[] = ["before", "earlier-lesson", "narration", "after", "untaught"];
const CONCERN = new Set<Status>(["narration", "after", "untaught", "no-evidence"]);

export interface FlowView {
	partial?: true;
	objectives: Array<{ id: string; text: string; depth: 0 | 1; page?: string }>;
	evidence: string[];
	/** One per objective group and item; groups without evidence get one to "No check or activity". */
	pairs: Array<{ objective: string; evidence: string; status: Status }>;
}

function statusOf(check: AlignmentView["checks"][number], lessonOf: (ref: string) => number | undefined): Status {
	if (check.support.length === 0) return "untaught";
	const before = check.support.filter((support) => !support.after);
	if (before.length === 0) return "after";
	if (before.every((support) => support.channel === "narration")) return "narration";
	const own = lessonOf(check.ref);
	return before.some((support) => lessonOf(support.ref) === own) ? "before" : "earlier-lesson";
}

export function flowView(view: Omit<AlignmentView, "objectiveGroups"> & { objectiveGroups?: AlignmentView["objectiveGroups"] }): FlowView {
	const lessonOf = (ref: string) => view.places[ref]?.lesson;
	const groups = view.objectiveGroups ?? groupObjectives(view.objectives, view.overlaps);
	const label = (lesson: number | undefined, purpose: string) =>
		`L${lesson ?? "?"} ${purpose === "knowledge" ? "Knowledge checks" : "Activities"}`;
	const pairs: FlowView["pairs"] = [];
	for (const group of groups) {
		const items = view.activities.filter((activity) => group.members.some((objective) => activity.objectives.includes(objective.id)));
		if (items.length === 0) pairs.push({ objective: group.id, evidence: STATUS_LABEL["no-evidence"], status: "no-evidence" });
		for (const item of items) {
			const check = view.checks.find((candidate) => candidate.ref === item.ref);
			pairs.push({
				objective: group.id,
				evidence: label(lessonOf(item.ref), item.purpose),
				status: item.purpose === "knowledge" && check ? statusOf(check, lessonOf) : "practised",
			});
		}
	}
	const evidence = [...new Set(pairs.map((pair) => pair.evidence))].sort((a, b) => {
		const key = (text: string) => (text === STATUS_LABEL["no-evidence"] ? 99 : Number(text.match(/^L(\d+)/)?.[1] ?? 98) + (text.includes("Activities") ? 0.5 : 0));
		return key(a) - key(b);
	});
	return {
		...(view.partial ? { partial: true as const } : {}),
		objectives: groups.map((group) => {
			const first = group.members[0];
			const place = first ? view.places[first.ref] : undefined;
			return { id: group.id, text: `${group.members.map((objective) => objective.id).join(", ")} · ${group.members.map((objective) => objective.text).join("; ")}`, depth: group.members.some((objective) => objective.parent === null) ? 0 as const : 1 as const, page: place ? pageKey(place.lesson, place.page) : undefined };
		}),
		evidence,
		pairs,
	};
}

const flowLabel = (view: FlowView, text: string, format: "html" | "text" = "html") =>
	text === STATUS_LABEL.untaught ? absence(view.partial, text, "Instruction", format) : text === STATUS_LABEL["no-evidence"] ? absence(view.partial, text, "A check or activity was", format) : format === "text" ? text : esc(text);

const UNIT = 7;
const GAP = 9;
const NODE = 10;
const X = [470, 850, 1200];
const WIDTH = 1600;

interface Node {
	key: string;
	y: number;
	height: number;
}

function stack(keys: string[], value: (key: string) => number, top: number, groupStart: (key: string) => boolean = () => false): Map<string, Node> {
	const nodes = new Map<string, Node>();
	let y = top;
	for (const key of keys) {
		if (groupStart(key) && y > top) y += GAP * 2;
		const height = Math.max(value(key) * UNIT, 28);
		nodes.set(key, { key, y, height });
		y += height + GAP;
	}
	return nodes;
}

function band(x0: number, y0: number, x1: number, y1: number, width: number): string {
	const mid = (x0 + x1) / 2;
	return `M${x0} ${y0} C${mid} ${y0} ${mid} ${y1} ${x1} ${y1} L${x1} ${y1 + width} C${mid} ${y1 + width} ${mid} ${y0 + width} ${x0} ${y0 + width} Z`;
}

export function renderFlow(view: FlowView, objectiveLessons: Record<string, number[]> = {}): string {
	const width = view.partial ? 1840 : WIDTH;
	const top = 24;
	const count = (predicate: (pair: FlowView["pairs"][number]) => boolean) => view.pairs.filter(predicate).length;
	const statuses = STATUS_ORDER.filter((status) => view.pairs.some((pair) => pair.status === status));
	const topLevel = new Set(view.objectives.filter((o) => o.depth === 0).map((o) => o.id));
	const left = stack(view.objectives.map((o) => o.id), (id) => count((p) => p.objective === id), top, (id) => topLevel.has(id));
	const middle = stack(view.evidence, (key) => count((p) => p.evidence === key), top);
	const right = stack(statuses, (status) => count((p) => p.status === status), top);
	const height = Math.max(top, ...[left, middle, right].flatMap((nodes) => [...nodes.values()].map((node) => node.y + node.height))) + 20;

	// Short keys let the highlight script trace exact objective–evidence–instruction paths.
	const oKey = new Map(view.objectives.map((o, i) => [o.id, `o${i}`]));
	const eKey = new Map(view.evidence.map((e, i) => [e, `e${i}`]));
	const sKey = new Map(statuses.map((st, i) => [st, `s${i}`]));
	const keysOf = <T>(values: T[], map: Map<T, string>) => [...new Set(values.map((value) => map.get(value)))].join(" ");
	// Each node hands out its bands top to bottom in the order of their far end, to limit crossings.
	const offsets = new Map<string, number>();
	const take = (side: string, node: Node, units: number) => {
		const used = offsets.get(side) ?? 0;
		offsets.set(side, used + units * UNIT);
		return node.y + used;
	};
	const firstLinks = view.objectives.flatMap((objective) =>
		view.evidence
			.map((evidence) => ({ objective: objective.id, evidence, units: count((p) => p.objective === objective.id && p.evidence === evidence) }))
			.filter((link) => link.units > 0),
	);
	const firstBands = firstLinks
		.map((link) => {
			const a = left.get(link.objective) as Node;
			const b = middle.get(link.evidence) as Node;
			const y0 = take(`L:${link.objective}`, a, link.units);
			const y1 = take(`M-in:${link.evidence}`, b, link.units);
			const concern = link.evidence === STATUS_LABEL["no-evidence"];
			const leads = keysOf(view.pairs.filter((p) => p.objective === link.objective && p.evidence === link.evidence).map((p) => p.status), sKey);
			return `<path class="flow${concern ? " concern" : ""}" data-o="${oKey.get(link.objective)}" data-e="${eKey.get(link.evidence)}" data-s="${leads}" d="${band(X[0] as number, y0, X[1] as number, y1, link.units * UNIT)}"><title>${esc(link.objective)} → ${esc(flowLabel(view, link.evidence, "text"))}: ${link.units}</title></path>`;
		})
		.join("");
	const secondLinks = view.evidence.flatMap((evidence) =>
		statuses
			.map((status) => ({ evidence, status, units: count((p) => p.evidence === evidence && p.status === status) }))
			.filter((link) => link.units > 0),
	);
	const secondBands = secondLinks
		.map((link) => {
			const a = middle.get(link.evidence) as Node;
			const b = right.get(link.status) as Node;
			const y0 = take(`M-out:${link.evidence}`, a, link.units);
			const y1 = take(`R:${link.status}`, b, link.units);
			const from = keysOf(view.pairs.filter((p) => p.evidence === link.evidence && p.status === link.status).map((p) => p.objective), oKey);
			return `<path class="flow${CONCERN.has(link.status) ? " concern" : ""}" data-o="${from}" data-e="${eKey.get(link.evidence)}" data-s="${sKey.get(link.status)}" d="${band(X[1] as number + NODE, y0, X[2] as number, y1, link.units * UNIT)}"><title>${esc(flowLabel(view, link.evidence, "text"))} → ${esc(flowLabel(view, STATUS_LABEL[link.status], "text"))}: ${link.units}</title></path>`;
		})
		.join("");
	const nodeRects = (nodes: Map<string, Node>, x: number, label: (key: string) => string, side: "left" | "right", concern: (key: string) => boolean, strong: (key: string) => boolean = () => false, page: (key: string) => string | undefined = () => undefined) =>
		[...nodes.values()]
			.map((node) => {
				const text = label(node.key);
				const full = x === X[0] ? view.objectives.find((objective) => objective.id === node.key)?.text ?? text : text;
				const labelSide = node.key === STATUS_LABEL["no-evidence"] ? "right" : side;
				const tx = labelSide === "left" ? x - 9 : x + NODE + 26;
				const labelWidth = Math.min(440, text.length * 8.2 + 26);
				const bx = labelSide === "left" ? tx - labelWidth - 2 : tx - 21;
				const sx = bx + 10;
				const sy = node.y + node.height / 2;
				const symbol = x === X[0]
					? `<path class="flow-stated" d="M${sx} ${sy - 4} L${sx + 4} ${sy} L${sx} ${sy + 4} L${sx - 4} ${sy} Z"/>`
					: x === X[1] && node.key.includes("Knowledge checks") ? `<rect class="flow-check" x="${sx - 4}" y="${sy - 4}" width="8" height="8"/>`
					: x === X[1] && node.key.includes("Activities") ? `<rect class="flow-activity" x="${sx - 4}" y="${sy - 4}" width="8" height="8"/>`
					: x === X[2] ? `<circle class="flow-instruction" cx="${sx}" cy="${sy}" r="4"/>` : "";
				const nodeKey = x === X[0] ? `data-node="o" data-key="${oKey.get(node.key)}"` : x === X[1] ? `data-node="e" data-key="${eKey.get(node.key)}"` : `data-node="s" data-key="${sKey.get(node.key as Status)}"`;
				return `<g class="flow-node" ${nodeKey}><rect class="node${concern(node.key) ? " concern" : ""}"${page(node.key) ? ` data-page="${page(node.key)}"` : ""} x="${x}" y="${node.y}" width="${NODE}" height="${node.height}"><title>${esc(full)}</title></rect><rect class="flow-label-bg" x="${bx}" y="${node.y + (node.height - 20) / 2}" width="${labelWidth}" height="20"/>${symbol}<text class="lane${strong(node.key) ? " strong" : ""}" x="${tx}" y="${sy + 5}" text-anchor="${labelSide === "left" ? "end" : "start"}">${esc(text)}<title>${esc(full)}</title></text></g>`;
			})
			.join("");
	const objectiveLabel = (id: string) => {
		const objective = view.objectives.find((o) => o.id === id);
		const text = objective?.text ?? id;
		return text.length > 54 ? `${text.slice(0, 53)}…` : text;
	};
	const total = view.pairs.length;
	const keys: Array<[string, string]> = [];
	if (view.pairs.some((pair) => pair.status !== "no-evidence")) keys.push(["flow-ordinary", "Linked pair"]);
	if (view.pairs.some((pair) => CONCERN.has(pair.status))) keys.push(["flow-concern", view.partial ? `Something to look at: narration only, instruction after a check, or ${absence(true, "", "instruction or evidence")}` : "Something to look at: narration only, instruction after a check, no instruction, or no evidence"]);
	const table = flowTable(view, objectiveLessons);
	return viewBlock({
		id: "flow",
		level: 3,
		title: "Constructive alignment flow",
		question: "How do objectives connect to evidence, and evidence to instruction?",
		lead: `<p class="rule">Click a node or band to trace its paths; Escape clears.</p>${method(`<p class="rule">Each band pairs one objective group with one check or activity, ${total} in all; a check linked to two groups counts twice. Checks continue to when their instruction comes; activities stop at Evidence.</p>`)}`,
		chart: `${keys.length ? legend(keys) : ""}
<div class="scroll" tabindex="0" role="region" aria-label="Constructive alignment flow">
	<svg class="flow-chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="min-width:960px;max-width:100%;height:auto" role="img" aria-label="Alignment flow: ${view.objectives.length} objective groups, ${view.evidence.length} evidence groups, ${statuses.length} instruction timings; Table mode lists the linked items.">
<text class="page-label" x="${X[0]}" y="14" text-anchor="end">Objective groups</text><text class="page-label" x="${X[1]}" y="14">Evidence</text><text class="page-label" x="${X[2]}" y="14">Instruction</text>
${firstBands}${secondBands}
${nodeRects(left, X[0] as number, objectiveLabel, "left", (id) => count((p) => p.objective === id && p.status !== "no-evidence") === 0, (id) => topLevel.has(id), (id) => view.objectives.find((o) => o.id === id)?.page)}
	${nodeRects(middle, X[1] as number, (key) => `${flowLabel(view, key, "text")} (${count((p) => p.evidence === key)})`, "left", (key) => key === STATUS_LABEL["no-evidence"])}
	${nodeRects(right, X[2] as number, (status) => `${flowLabel(view, STATUS_LABEL[status as Status], "text")} (${count((p) => p.status === status)})`, "right", (status) => CONCERN.has(status as Status))}
	</svg></div>`,
		table,
	});
}

/** Every objective group, evidence and instruction triple, with how many pairs follow it. */
function flowTable(view: FlowView, objectiveLessons: Record<string, number[]>): string {
	const rows = new Map<string, { objective: string; evidence: string; status: Status; count: number }>();
	for (const pair of view.pairs) {
		const key = `${pair.objective}\u0000${pair.evidence}\u0000${pair.status}`;
		const row = rows.get(key) ?? { objective: pair.objective, evidence: pair.evidence, status: pair.status, count: 0 };
		row.count += 1;
		rows.set(key, row);
	}
	const text = (id: string) => view.objectives.find((objective) => objective.id === id)?.text ?? "";
	const body = [...rows.values()]
		.map((row) => `<tr data-lessons="${(objectiveLessons[row.objective] ?? []).join(" ")}"><th scope="row"><span class="objective-id">${esc(row.objective)}</span> ${esc(text(row.objective))}</th><td>${flowLabel(view, row.evidence)}</td><td>${row.status === "no-evidence" ? "–" : flowLabel(view, STATUS_LABEL[row.status])}</td><td class="num">${row.count}</td></tr>`)
		.join("");
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Constructive alignment pairs"><table class="blocks"><caption class="sr">Constructive alignment pairs</caption><thead><tr><th scope="col">Objective group</th><th scope="col">Evidence</th><th scope="col">Instruction</th><th scope="col" class="num">Pairs</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Hover previews a node's or band's paths; click pins them; Escape or a click on empty space clears. */
export function flowClient() {
  document.querySelectorAll<SVGSVGElement>('svg.flow-chart').forEach((svg) => {
    const bands = [...svg.querySelectorAll<SVGElement>('path.flow')];
    const nodes = [...svg.querySelectorAll<SVGElement>('.flow-node')];
    const has = (el: SVGElement, col: string | undefined, key: string | undefined) => !!col && !!key && (el.dataset[col] || '').split(' ').includes(key);
    let pinned: SVGElement | null = null;
    const lit = (target: SVGElement | null) => {
      if (!target) return null;
      if (target.classList.contains('flow-node')) {
        const col = target.dataset.node, key = target.dataset.key;
        return bands.filter((band) => has(band, col, key));
      }
      // A band lights every band on the same objective–evidence–instruction paths.
      const o = (target.dataset.o || '').split(' '), e = target.dataset.e, s = (target.dataset.s || '').split(' ');
      return bands.filter((band) => band === target || (band.dataset.e === e && o.some((key) => has(band, 'o', key)) && s.some((key) => has(band, 's', key))));
    };
    const show = (target: SVGElement | null) => {
      const on = lit(target);
      svg.classList.toggle('tracing', !!on);
      bands.forEach((band) => band.classList.toggle('lit', !!on && on.includes(band)));
      nodes.forEach((node) => node.classList.toggle('lit', !!on && on.some((band) => has(band, node.dataset.node, node.dataset.key))));
    };
    const targetOf = (event: Event) => event.target instanceof Element ? event.target.closest<SVGElement>('.flow-node, path.flow') : null;
    svg.addEventListener('pointerover', (event) => { if (!pinned) show(targetOf(event)); });
    svg.addEventListener('pointerleave', () => { if (!pinned) show(null); });
    svg.addEventListener('click', (event) => { const target = targetOf(event); pinned = target && target !== pinned ? target : null; show(pinned); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && pinned) { pinned = null; show(null); } });
  });
}
export const FLOW_SCRIPT = inlineClient(flowClient);

export const FLOW_STYLE = `
svg.flow-chart text{font-size:16px}
svg .flow{fill:var(--muted);fill-opacity:.4;stroke:var(--surface);stroke-width:1}svg .flow.concern{fill:var(--look);fill-opacity:.7}
svg .flow-label-bg{fill:var(--surface)}
svg.flow-chart .flow,svg.flow-chart .flow-node{cursor:pointer;transition:opacity .12s}
svg.flow-chart.tracing .flow:not(.lit){opacity:.12}svg.flow-chart.tracing .flow.lit{fill-opacity:.75}
svg.flow-chart.tracing .flow-node:not(.lit){opacity:.35}
@media (prefers-reduced-motion:reduce){svg.flow-chart .flow,svg.flow-chart .flow-node{transition:none}}
svg .flow:hover{fill-opacity:1}
svg .lane.strong{font-weight:600;fill:var(--ink)}
svg .node{fill:var(--ink-2)}svg .node.concern{fill:var(--look)}
svg .flow-stated{fill:none;stroke:var(--muted);stroke-width:1.5}svg .flow-check{fill:var(--accent)}svg .flow-activity{fill:none;stroke:var(--accent);stroke-width:1.5}svg .flow-instruction{fill:none;stroke:var(--ink);stroke-width:1.5}
.key.flow-ordinary,.key.flow-concern{height:4px;vertical-align:3px}.key.flow-ordinary{background:var(--muted)}.key.flow-concern{background:var(--look)}
`;
