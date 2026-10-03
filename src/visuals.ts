import type { LessonAnatomy } from "./anatomy.ts";
import { COURSE_TEXT_GUIDE, type Interpretation, readAnswer, readInterpretation, readSpan, writeBundle } from "./bundle.ts";
import type { Course } from "./inspect.ts";
import { generated, generatedSummary, viewBlock } from "./modes.ts";
import { buildPlaces, lessonTags, esc, locateBlocks, type Places, where, wheres } from "./places.ts";

export const PROMPT_VERSION = "visuals/1";

export const STRUCTURES = ["sequence", "cause", "comparison", "hierarchy", "mapping", "change"] as const;
export type Structure = (typeof STRUCTURES)[number];

export interface Opportunity {
	ref: string;
	channel: "screen" | "narration";
	span: string;
	structure: Structure;
	elements: string[];
	form: string;
	note: string;
}

export interface VisualsAnswer {
	model: string;
	opportunities: Opportunity[];
	interpretation: Interpretation[];
}

const PROMPT = `# Visual opportunities review

Find prose that states a relationship a diagram could show more clearly. ${COURSE_TEXT_GUIDE}

Write \`answer.json\` in this folder, matching this shape exactly:

\`\`\`json
{
  "view": "visuals",
  "promptVersion": "${PROMPT_VERSION}",
  "courseHash": "<copy from manifest.json>",
  "model": "<your model name>",
  "opportunities": [
    {
      "ref": "<ref>",
      "channel": "screen | narration",
      "span": "<exact words copied from that block's Screen or Narration line>",
      "structure": "sequence | cause | comparison | hierarchy | mapping | change",
      "elements": ["<short label copied from the span>", "<another label>"],
      "form": "<suggested diagram form, e.g. timeline, flow, two-column comparison, matrix>",
      "note": "<one sentence: what the diagram would make visible, and any source constraint>"
    }
  ],
  "interpretation": [{ "text": "<one observation about the pattern>", "refs": ["<ref>"] }]
}
\`\`\`

Rules:

1. Find sequences or processes, cause and effect, comparisons or contrasts, hierarchies or classifications, mappings between two sets, and change over time. Include only passages where a diagram could expose a relationship more clearly than the current prose. At most 20 opportunities, most useful first.
2. \`span\`: copy the relationship-bearing words exactly from one block's Screen or Narration line, keeping case and punctuation. Cite that block in \`ref\` and its channel in \`channel\`.
3. \`elements\`: give 2 to 8 short labels copied from the span, in the order or grouping the text states. Do not invent labels or relationships.
4. Keep qualifications and conditional wording. Use only relationships the text states; do not combine separate examples into a new causal chain.
5. Suggest a form that shows the stated relationship. A diagram should replace or expose prose, not repeat a list already well organised on screen.
6. \`note\`: in one sentence, say what the form would make visible and name any source constraint the designer must preserve. Describe the opportunity; the designer decides whether to revise.
7. \`interpretation\`: up to five short observations about the pattern, each citing refs in \`refs\`. Name lessons and pages in words, never as refs. Describe; do not grade or rewrite.
8. Output valid JSON only; every ref must appear in \`course.md\`.
`;

export async function prepareVisuals(course: Course, directory: string): Promise<void> {
	await writeBundle(course, directory, "visuals", PROMPT_VERSION, PROMPT);
}

export function parseVisuals(json: string, course: Course): VisualsAnswer {
	const answer = readAnswer(json, course, "visuals", PROMPT_VERSION);
	const { raw, problem, ref, text, list, record } = answer;
	const blocks = new Map(locateBlocks(course).map((item) => [item.ref, item.block]));
	const values = list(raw.opportunities, "opportunities");
	if (values.length > 20) problem("opportunities must contain at most 20 items");
	const opportunities = values.map((value, i) => {
		const at = `opportunities[${i}]`;
		const item = record(value, at);
		const sourceRef = ref(item.ref, `${at}.ref`);
		const channel: Opportunity["channel"] =
			item.channel === "screen" || item.channel === "narration" ? item.channel : problem(`${at}.channel must be screen or narration`);
		const span = readSpan(answer, blocks.get(sourceRef)!, item.span, `${at}.span`, channel, sourceRef);
		const structure =
			typeof item.structure === "string" && (STRUCTURES as readonly string[]).includes(item.structure)
				? (item.structure as Structure)
				: problem(`${at}.structure must be one of ${STRUCTURES.join(", ")}`);
		const elements = list(item.elements, `${at}.elements`).map((value, j) => text(value, `${at}.elements[${j}]`).replace(/\s+/g, " ").trim());
		if (elements.length < 2 || elements.length > 8) problem(`${at}.elements must contain 2 to 8 labels`);
		for (const [j, element] of elements.entries()) {
			if (!element || element.length > 80 || !span.includes(element)) {
				problem(`${at}.elements[${j}] must be a short label copied from span`);
			}
		}
		return {
			ref: sourceRef,
			channel,
			span,
			structure,
			elements,
			form: text(item.form, `${at}.form`),
			note: text(item.note, `${at}.note`),
		};
	});
	return { model: text(raw.model, "model"), opportunities, interpretation: readInterpretation(answer) };
}

export interface VisualOpportunity extends Opportunity {
	hasMedia: boolean | null;
}

export interface VisualsView {
	model: string;
	opportunities: VisualOpportunity[];
	places: Places;
	interpretation: Interpretation[];
}

export function visualsView(course: Course, answer: VisualsAnswer, anatomy: LessonAnatomy[]): VisualsView {
	const places = buildPlaces(course, [
		...answer.opportunities.map((item) => item.ref),
		...answer.interpretation.flatMap((item) => item.refs),
	]);
	return {
		model: answer.model,
		opportunities: answer.opportunities
			.map((item) => {
				const place = places[item.ref]!;
				return {
					...item,
					hasMedia: anatomy[place.lesson - 1]?.marks.some((mark) => mark.page === place.page && mark.role === "media") ? true : course.schema === "praxity-inspect/1" ? null : false,
				};
			})
			.sort((a, b) => places[a.ref]!.position - places[b.ref]!.position),
		places,
		interpretation: answer.interpretation,
	};
}

const RELATIONSHIP_LABEL: Record<string, string> = {
	sequence: "Sequence",
	cause: "Cause and effect",
	comparison: "Comparison",
	hierarchy: "Hierarchy",
	mapping: "Mapping",
	change: "Change over time",
};

export function renderVisuals(view: VisualsView): string {
	const rows = view.opportunities
		.map((item) => {
			const media = item.hasMedia === null ? "Unknown" : item.hasMedia ? "Yes" : "No";
			const elements = esc(item.elements.join(item.structure === "sequence" ? " → " : " · "));
			return `<tr ${lessonTags(view.places, [item.ref])}><th scope="row"><details class="visual-source"><summary>${elements}</summary><p><q>${esc(item.span)}</q></p><p>${esc(item.note)}</p></details></th><td>${item.channel === "screen" ? "On screen" : "Narration"}</td><td>${media}</td><td class="where">${where(view.places, item.ref)}</td><td class="rec">${RELATIONSHIP_LABEL[item.structure] ?? esc(item.structure)}</td><td>${esc(item.form)}</td></tr>`;
		})
		.join("");
	return `${viewBlock({ id: "visuals", level: 3, title: "Diagram opportunities", question: "Where does the text state a relationship a diagram could show more clearly?", lead: `<p class="rule">${generated(view.model)} of relationships and possible diagrams. Open a passage for the quoted text and qualifications a diagram must keep.</p>`, table: `<div class="table-wrap" tabindex="0" role="region" aria-label="Diagram opportunities"><table class="blocks visuals"><caption class="sr">Diagram opportunities</caption><thead><tr><th scope="colgroup" colspan="4">Now</th><th scope="colgroup" colspan="2" class="rec">Possible diagram · ${generated(view.model)}</th></tr><tr><th scope="col">Passage</th><th scope="col">Shown as</th><th scope="col">Page has an image or chart</th><th scope="col">Where</th><th scope="col" class="rec">Relationship stated</th><th scope="col">Diagram</th></tr></thead><tbody>${rows}</tbody></table></div>` })}
${generatedSummary(view.model, view.interpretation.map((item) => `<li>${esc(item.text)} <span class="file">${wheres(view.places, item.refs)}</span></li>`).join(""), "diagram opportunities")}`;
}

export const VISUALS_STYLE = `
.visuals td,.visuals th{white-space:nowrap}
.visuals .rec{border-left:1px solid var(--axis)}
.visuals thead tr:first-child th{color:var(--ink);border-bottom:none;padding-bottom:0}
.visuals .yes{color:var(--ink)}.visuals .no{color:var(--ink-2)}.visuals tbody th{white-space:normal;min-width:18rem;font-weight:400}
.visuals .visual-source{margin:0}.visuals .visual-source summary{color:var(--ink);white-space:normal}
.visuals .visual-source p{white-space:normal;max-width:36rem;margin:.25rem 0}
.visuals td.num{color:var(--ink-2)}
`;
