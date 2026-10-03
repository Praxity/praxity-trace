import { COURSE_TEXT_GUIDE, readAnswer, readSpan, writeBundle } from "./bundle.ts";
import type { AlignmentView } from "./alignment-view.ts";
import { isKnowledgeCheck } from "./anatomy.ts";
import { availabilityLabel, type AvailabilityView } from "./availability.ts";
import type { Course } from "./inspect.ts";
import { absence, generated, lessonVariants, method, renderFeedback, viewBlock } from "./modes.ts";
import { buildPlaces, esc, indexCourse, locateBlocks, pageKey, type Places } from "./places.ts";
import { feedbackText, type Feedback } from "./text.ts";

export const TAXONOMY_VERSION = "conole-task-families/1";
export const PROMPT_VERSION = "tasks/3";
export const TASK_TYPES = ["assimilative", "information handling", "communicative", "productive", "experiential", "adaptive"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type AssessmentPurpose = "none" | "diagnostic" | "practice" | "summative" | "unknown";

export interface TaskAnnotation {
	ref: string;
	evidence: Array<{ ref: string; channel: "screen" | "narration" | "transcript"; quote: string }>;
	taskTypes: TaskType[] | ["unknown"];
	explanation: string;
	work: "inside" | "outside";
	assessmentPurpose: AssessmentPurpose;
}

export interface TasksAnswer {
	model: string;
	annotations: TaskAnnotation[];
}

const PROMPT = `# Learner task review

Classify what each page asks learners to do. ${COURSE_TEXT_GUIDE}

Task types: assimilative = read, watch or listen; information handling = find, compare, organise or interpret information; communicative = exchange ideas with a person; productive = make an artifact; experiential = practise a decision or action in a case; adaptive = change a model or simulation and inspect its response. A reveal click is not adaptive. A choice control alone does not establish information handling. See docs/task-coding-guide.md for matched examples if available.

Write answer.json in this folder:

\`\`\`json
{
  "view": "tasks",
  "promptVersion": "${PROMPT_VERSION}",
  "taxonomyVersion": "${TAXONOMY_VERSION}",
  "courseHash": "<copy from manifest.json>",
  "model": "<your model name>",
  "annotations": [{
    "ref": "<ref of the task instruction or content to read>",
    "evidence": [{ "ref": "<ref>", "channel": "screen", "quote": "<exact words from Screen, Narration or Transcript>" }],
    "taskTypes": ["assimilative"],
    "explanation": "<one sentence explaining the requested work>",
    "work": "inside",
    "assessmentPurpose": "none"
  }]
}
\`\`\`

Use one annotation per distinct task request. Every annotation needs a quote from its primary ref; extra evidence may cite other blocks. Use one or more of the six types. For a visible request that cannot be classified, use ["unknown"] alone. A page may have several annotations. Work is inside or outside the course as instructed, never a claim that the learner completed it. Assessment purpose is separate: none, diagnostic (prior knowledge), practice (rehearsal), summative (establishing success), or unknown. Cite the page where the learner meets the request; do not infer tasks from a button, block type, answer key, or unsupported text. Output valid JSON only. Do not set preferred proportions or grade the course.
`;

export async function prepareTasks(course: Course, directory: string): Promise<void> {
	await writeBundle(course, directory, "tasks", PROMPT_VERSION, PROMPT, { taxonomyVersion: TAXONOMY_VERSION });
}

export function parseTasks(json: string, course: Course): TasksAnswer {
	const answer = readAnswer(json, course, "tasks", PROMPT_VERSION);
	const { raw, problem, ref, text, list, record } = answer;
	if (raw.taxonomyVersion !== TAXONOMY_VERSION) problem(`taxonomyVersion must be ${TAXONOMY_VERSION}`);
	const blocks = new Map(locateBlocks(course).map((item) => [item.ref, item.block]));
	const annotations: TaskAnnotation[] = list(raw.annotations, "annotations").map((value, i): TaskAnnotation => {
		const at = `annotations[${i}]`;
		const item = record(value, at);
		const primary = ref(item.ref, `${at}.ref`);
		const evidence = list(item.evidence, `${at}.evidence`).map((value, j) => {
			const path = `${at}.evidence[${j}]`;
			const source = record(value, path);
			const cited = ref(source.ref, `${path}.ref`);
			const channel: "screen" | "narration" | "transcript" = source.channel === "screen" || source.channel === "narration" || source.channel === "transcript" ? source.channel : problem(`${path}.channel must be screen, narration or transcript`);
			return { ref: cited, channel, quote: readSpan(answer, blocks.get(cited)!, source.quote, `${path}.quote`, channel, cited) };
		});
		if (!evidence.some((item) => item.ref === primary)) problem(`${at}.evidence must quote ${primary}`);
		const taskTypes = list(item.taskTypes, `${at}.taskTypes`).map((value, j) => {
			if (value === "unknown" || (TASK_TYPES as readonly unknown[]).includes(value)) return value as TaskType | "unknown";
			return problem(`${at}.taskTypes[${j}] is not a task type`);
		});
		if (!taskTypes.length || new Set(taskTypes).size !== taskTypes.length || (taskTypes.includes("unknown") && taskTypes.length !== 1)) problem(`${at}.taskTypes must be distinct task types or ["unknown"]`);
		const explanation = text(item.explanation, `${at}.explanation`).trim();
		if (!explanation) problem(`${at}.explanation must not be empty`);
		const work: "inside" | "outside" = item.work === "inside" || item.work === "outside" ? item.work : problem(`${at}.work must be inside or outside`);
		const purposes = ["none", "diagnostic", "practice", "summative", "unknown"];
		const assessmentPurpose = typeof item.assessmentPurpose === "string" && purposes.includes(item.assessmentPurpose) ? item.assessmentPurpose as AssessmentPurpose : problem(`${at}.assessmentPurpose is unknown`);
		return { ref: primary, evidence, taskTypes: taskTypes as TaskAnnotation["taskTypes"], explanation, work, assessmentPurpose };
	});
	const model = text(raw.model, "model").trim();
	if (!model) problem("model must not be empty");
	return { model, annotations };
}

export interface TaskPage {
	key: string;
	lesson: number;
	title: string;
	ref: string | null;
	taskTypes: TaskType[];
	unknown: boolean;
	unsupported: boolean;
}

export interface TasksView {
	model: string;
	partial?: true;
	alignmentModel?: string;
	evidenceKind: "interpretation";
	countingUnit: "page presence";
	taxonomyVersion: string;
	annotations: Array<TaskAnnotation & {
		/** Exact primary/evidence-ref join, derived from two generated answers. */
		alignment?: {
			refs: string[];
			objectives: Array<Pick<AlignmentView["objectives"][number], "id" | "text" | "ref">>;
			checks: AvailabilityView["checks"];
		};
		feedback?: Array<{ ref: string; feedback: Feedback }>;
	}>;
	pages: TaskPage[];
	counts: Record<TaskType | "unclassified" | "unsupported", number>;
	places: Places;
}

export function tasksView(course: Course, answer: TasksAnswer, links?: { alignment: AlignmentView; availability: AvailabilityView }): TasksView {
	const index = indexCourse(course);
	const annotations: TasksView["annotations"] = answer.annotations.map(item => {
		const refs = new Set([item.ref, ...item.evidence.map(evidence => evidence.ref)]);
		const matches = links?.alignment.activities.filter(activity => refs.has(activity.ref));
		const checks = links?.availability.checks.filter(check => refs.has(check.ref)) ?? [];
		const feedback = links ? checks.map(check => ({ ref: check.ref, feedback: check.feedback })) : [...refs].flatMap(ref => {
			const block = index.block(ref)!.block;
			return isKnowledgeCheck(block) === true ? [{ ref, feedback: feedbackText(block) }] : [];
		});
		return {
			...item,
			...(links ? { alignment: {
				refs: [...new Set(matches!.map(match => match.ref))],
				objectives: links.alignment.objectives.filter(objective => matches!.some(match => match.objectives.includes(objective.id))).map(({ id, text, ref }) => ({ id, text, ref })),
				checks,
			} } : {}),
			...(feedback.length ? { feedback } : {}),
		};
	});
	const pages = course.lessons.flatMap((lesson, l) => lesson.pages.map((page) => {
		const blocks = index.blocks.filter((item) => item.lessonNumber === l + 1 && item.page === page.number);
		const annotations = answer.annotations.filter((item) => {
			const anchor = index.block(item.ref)!;
			return anchor.lessonNumber === l + 1 && anchor.page === page.number;
		});
		const taskTypes = TASK_TYPES.filter((type) => annotations.some((item) => item.taskTypes.some((assigned) => assigned === type)));
		const unsupported = blocks.some((item) => item.block.coverage === "unsupported");
		return { key: pageKey(l + 1, page.number), lesson: l + 1, title: page.title, ref: blocks.find((item) => item.block.coverage === "unsupported")?.ref ?? blocks[0]?.ref ?? null, taskTypes, unknown: taskTypes.length === 0, unsupported };
	}));
	const counts = Object.fromEntries([...TASK_TYPES.map((type) => [type, pages.filter((page) => page.taskTypes.includes(type)).length]), ["unclassified", pages.filter((page) => page.unknown).length], ["unsupported", pages.filter((page) => page.unsupported).length]]) as TasksView["counts"];
	return { model: answer.model, ...(course.schema === "praxity-inspect/1" ? { partial: true as const } : {}), ...(links ? { alignmentModel: links.alignment.model } : {}), evidenceKind: "interpretation", countingUnit: "page presence", taxonomyVersion: TAXONOMY_VERSION, annotations, pages, counts, places: buildPlaces(course, [...answer.annotations.flatMap((item) => [item.ref, ...item.evidence.map((source) => source.ref)]), ...annotations.flatMap(item => [...(item.alignment?.objectives.map(objective => objective.ref) ?? []), ...(item.alignment?.checks.flatMap(check => check.instruction) ?? [])]), ...pages.flatMap((page) => page.ref ? [page.ref] : [])]) };
}

const ROWS = [...TASK_TYPES, "unclassified", "unsupported"] as const;
const label = (type: string) => type[0]!.toUpperCase() + type.slice(1);

function chart(view: TasksView, lesson: number | null): string {
	const pages = view.pages.filter((page) => lesson === null || page.lesson === lesson);
	const row = (type: typeof ROWS[number]) => `<div class="task-chart-label">${label(type)} <span>${pages.filter((page) => type === "unclassified" ? page.unknown : type === "unsupported" ? page.unsupported : page.taskTypes.includes(type)).length}</span></div>${pages.map((page) => {
		const present = type === "unclassified" ? page.unknown : type === "unsupported" ? page.unsupported : page.taskTypes.includes(type);
		const ref = type === "unclassified" || type === "unsupported" ? page.ref : view.annotations.find((item) => item.taskTypes.some((assigned) => assigned === type) && pageKey(view.places[item.ref]!.lesson, view.places[item.ref]!.page) === page.key)?.ref;
		const place = ref ? view.places[ref] : null;
		return `<span class="task-chart-cell${present ? ` task-present task-${type.replaceAll(" ", "-")}` : ""}" data-page="${page.key}"${present && ref ? ` data-ref="${ref}"` : ""} title="${esc(`${page.key} ${page.title}: ${present ? label(type) : absence(view.partial, `${label(type)} absent`, label(type), "text")}${present && place ? ` · ${place.file}:${place.line ?? "?"}` : ""}`)}"></span>`;
	}).join("")}`;
	return `<div class="task-chart-scroll"><div class="task-chart" style="--task-pages:${pages.length}"><div class="task-chart-label">Task type <span>pages</span></div>${pages.map((page) => `<span class="task-chart-page" data-page="${page.key}" title="${esc(page.title)}">${page.key}</span>`).join("")}${ROWS.map(row).join("")}</div></div>`;
}

export function renderTasks(view: TasksView): string {
	const byRef = new Map(Object.entries(view.places));
	const annotations = [...view.annotations].sort((a, b) => (byRef.get(a.ref)?.position ?? 0) - (byRef.get(b.ref)?.position ?? 0));
	const source = (ref: string) => {
		const place = view.places[ref];
		return place ? `${place.file}${place.line === null ? "" : `:${place.line}`} · ${ref}` : ref;
	};
	const pointer = (ref: string) => `<span data-ref="${esc(ref)}"${view.places[ref] ? ` data-page="${pageKey(view.places[ref]!.lesson, view.places[ref]!.page)}"` : ""}>${esc(source(ref))}</span>`;
	const connections = (item: TasksView["annotations"][number]) => {
		const linked = item.alignment;
		const objectives = linked ? `<dt>Objectives · ${generated(view.alignmentModel!)}</dt><dd>${linked.refs.length ? `${linked.objectives.length ? linked.objectives.map(objective => `${esc(objective.id)}: ${esc(objective.text)} <span class="file">Stated at ${pointer(objective.ref)}</span>`).join("") : "No stated objective linked by the alignment review."}<span class="file">Linked through the alignment review: ${linked.refs.map(pointer).join(", ")}</span>` : "No alignment link"}</dd>` : "";
		const instruction = linked ? `<dt>Instruction · ${generated(view.alignmentModel!)}</dt><dd>${linked.checks.length ? linked.checks.map(check => `<div>${availabilityLabel(check.available, view.partial)}<span class="file">Check at ${pointer(check.ref)}</span>${check.instructionLinks.map(link => `<blockquote>${esc(link.text)}<cite>${pointer(link.ref)} · ${link.channel} · ${link.after ? "Only after the check" : availabilityLabel(link.available)}</cite></blockquote>`).join("")}</div>`).join("") : "Instruction links are recorded for knowledge checks only"}</dd>` : "";
		const feedback = item.feedback ? `<dt>Feedback after responding</dt><dd>${item.feedback.map(check => `<div><span class="file">Check at ${pointer(check.ref)}</span>${renderFeedback(check.feedback)}</div>`).join("")}</dd>` : "";
		return objectives || instruction || feedback ? `<dl class="task-links">${objectives}${instruction}${feedback}</dl>` : "";
	};
	const rows = annotations.map((item) => {
		const place = view.places[item.ref]!;
		const page = pageKey(place.lesson, place.page);
		return `<tr data-page="${page}" title="${esc(`${place.lessonTitle}, page ${place.page} · ${place.file}:${place.line ?? "?"}`)}"><th scope="row">${page}</th><td>${item.taskTypes.map(label).join(", ")}</td><td>${item.work === "outside" ? "Outside course (requested)" : "Inside course"}</td><td>${item.evidence.map((evidence) => `<blockquote>“${esc(evidence.quote)}” <cite>${esc(source(evidence.ref))} · ${evidence.channel}</cite></blockquote>`).join("")}</td><td>${esc(item.explanation)}<span class="file">Assessment purpose: ${item.assessmentPurpose}</span>${connections(item)}</td></tr>`;
	}).join("");
	const statusRows = view.pages.filter((page) => page.unknown || page.unsupported).flatMap((page) => [page.unknown ? "Unclassified" : null, page.unsupported ? "Unsupported input" : null].filter(Boolean).map((status) => {
		const place = page.ref ? view.places[page.ref] : null;
		return `<tr data-page="${page.key}"${place ? ` title="${esc(`${place.lessonTitle}, page ${place.page} · ${place.file}:${place.line ?? "?"}`)}"` : ""}><th scope="row">${page.key}</th><td>${status}</td><td>—</td><td>${page.ref ? esc(source(page.ref)) : esc(page.title)}</td><td>${status === "Unsupported input" ? "Inspection marks a block on this page as unsupported." : absence(view.partial, "No supported task type was assigned to this page.", "A supported task type for this page was")}</td></tr>`;
	})).join("");
	const lead = `<p class="rule">Task types are linked to ${view.pages.length - view.counts.unclassified} ${view.pages.length - view.counts.unclassified === 1 ? "page" : "pages"}; ${view.counts.unclassified} unclassified and ${view.counts.unsupported} with unsupported input. ${generated(view.model)} of requested work.</p>`;
	return `${viewBlock({ id: "tasks", level: 2, headingId: "tasks", title: "Learner tasks", question: "Where does the course ask learners to use each task type?", lead: `${lead}${method(`<p class="rule">One page counts once per task type, even with several annotations. Mixed pages appear in several rows, so rows do not sum to 100%. Unclassified means no supported type was assigned; unsupported means inspect marks at least one block's text coverage unsupported. These are generated interpretations of requested work, not the measured Anatomy block inventory or evidence of participation. Taxonomy ${esc(view.taxonomyVersion)}.${view.alignmentModel ? " Objective and instruction links are generated joins of the task and alignment answers, matching primary or quoted evidence refs exactly to check and activity refs. Shared pages and instruction refs alone do not establish a link. Instruction categories reuse the instruction availability view; supporting passages retain their channels and order. Feedback is supplied text, with no quality classification." : ""}</p>`)}`, chart: `<p class="rule">Rows show page presence in course order. Read the table for every annotation and quote.</p>${lessonVariants([...new Set(view.pages.map((page) => page.lesson))], (lesson) => chart(view, lesson))}`, table: `<div class="table-wrap task-table-wrap" tabindex="0" role="region" aria-label="Learner task annotations and evidence"><table class="blocks tasks-table"><caption class="sr">Learner task annotations and evidence</caption><thead><tr><th scope="col">Page</th><th scope="col">Task type</th><th scope="col">Work</th><th scope="col">Quoted evidence and source</th><th scope="col">Explanation and assessment purpose</th></tr></thead><tbody>${rows}${statusRows}</tbody></table></div>` })}`;
}

export const TASKS_STYLE = `
.task-chart-scroll{overflow-x:auto}.task-chart{display:grid;grid-template-columns:minmax(10rem,auto) repeat(var(--task-pages),minmax(2rem,1fr));min-width:max-content;align-items:center;gap:1px;background:var(--grid);border:1px solid var(--grid);font-size:.8rem}.task-chart>*{background:var(--surface);min-height:1.8rem;padding:.3rem}.task-chart-label{font-weight:600;display:flex;justify-content:space-between;gap:.5rem}.task-chart-label span{color:var(--ink-2);font-weight:400}.task-chart-page{text-align:center;font-variant-numeric:tabular-nums}.task-chart-cell{display:block;position:relative}.task-chart-cell.task-present::after{content:"";position:absolute;inset:.48rem;background:var(--ink-2)}.task-chart-cell.task-unclassified::after{background:none;border:2px solid var(--ink-2)}.task-chart-cell.task-unsupported::after{background:repeating-linear-gradient(45deg,var(--ink-2) 0 2px,transparent 2px 4px)}
.tasks-table{width:100%;table-layout:fixed}.tasks-table th,.tasks-table td{overflow-wrap:anywhere;vertical-align:top}.tasks-table th:first-child{width:4rem}.tasks-table th:nth-child(2){width:10rem}.tasks-table th:nth-child(3){width:8rem}.tasks-table th:nth-child(4){width:32%}.tasks-table blockquote{margin:0 0 .4rem}.tasks-table cite{display:block;font-size:.75rem;color:var(--ink-2);font-style:normal}.task-links{margin:.75rem 0 0}.task-links dt{font-weight:600;margin-top:.5rem}.task-links dd{margin:0}
`;
