import { locateBlocks } from "./places.ts";
import { COURSE_TEXT_GUIDE, type Interpretation, readAnswer, readInterpretation, writeBundle } from "./bundle.ts";
import type { Course } from "./inspect.ts";
import { BLOOM, type Bloom, FINK, type Fink, GAGNE, GAGNE_HELP, type Gagne, KNOWLEDGE, KNOWLEDGE_HELP, type Knowledge } from "./outcomes.ts";


export const PROMPT_VERSION = "alignment/14";

const PROMPT = `# Alignment review

You are mapping a course's knowledge checks to its objectives and to the teaching each check depends on. ${COURSE_TEXT_GUIDE}

Write \`answer.json\` in this folder, matching this shape exactly:

\`\`\`json
{
  "view": "alignment",
  "promptVersion": "${PROMPT_VERSION}",
  "courseHash": "<copy from manifest.json>",
  "model": "<your model name>",
  "objectives": [{ "id": "O1", "text": "<objective as stated>", "ref": "<ref where it is stated>", "fink": ["<dimension>"], "parent": "<id of the broader objective it serves, or null>", "bloom": "<Bloom level or null>", "knowledge": "<knowledge type or null>", "gagne": "<Gagné capability or null>", "levelReason": "<one short clause naming the verb and its object>", "performance": { "action": "<words from the objective naming an observable action, or null>", "conditions": "<words stating under what conditions, or null>", "standard": "<words stating how well, or null>" } }],
  "checks": [
    {
      "ref": "<ref of an assessment block>",
      "purpose": "knowledge | survey | reflection | worksheet",
      "pre": false,
      "objectives": ["O1"],
      "support": [{ "ref": "<ref>", "channel": "screen | tooltip | narration | transcript" }]
    }
  ],
  "overlaps": [{ "objectives": ["O1", "O6"], "note": "<what they share, in one sentence>" }],
  "interpretation": [{ "text": "<one observation about the pattern>", "refs": ["<ref>"] }]
}
\`\`\`

Rules:

1. \`objectives\`: every learning objective or outcome the course states, verbatim, with the ref of the block that states it: what learners will know or be able to do. Leave out course tasks such as completing a survey, and include none you infer. \`fink\` names the one or two dimensions of Fink's significant learning the objective most targets: ${FINK.map((d) => `"${d}"`).join(", ")}. \`parent\` is the broader stated objective, usually a course-level one, that this objective is a step towards; null for top-level objectives. \`bloom\` (one of ${BLOOM.map((d) => `"${d}"`).join(", ")}) is the cognitive process the objective asks of learners, judged from its verb together with its object: "explain the steps" asks less than "explain why". Use the closest level for verbs no taxonomy list names, such as build, add or test. \`knowledge\` is Bloom's knowledge dimension, the kind of knowledge it works with: ${KNOWLEDGE.map((d) => `"${d}" (${KNOWLEDGE_HELP[d].toLowerCase().replace(/\.$/, "")})`).join("; ")}. \`gagne\` is the kind of capability it intends, after Gagné: ${GAGNE.map((d) => `"${d}" (${GAGNE_HELP[d].toLowerCase().replace(/\.$/, "")})`).join("; ")}. Using a keyboard does not make a skill a motor skill. When the objective names a product rather than an action ("a working prototype"), give the levels of the work it implies, or null when none is clear. \`levelReason\` says in one short clause what decided them. \`performance\` checks whether the objective states a performance a trainer could observe: copy from the objective's own text the words naming the observable action, the conditions, and the standard (how well, how many, to what criterion); use null for each part it does not state. Most objectives state an action and neither of the others.
2. \`checks\`: one entry for every assessment block in \`manifest.json\`'s \`checks\` list, with \`purpose\` \`knowledge\` when an answer can be right or wrong, \`survey\` when it asks for feedback on the course or training, and \`reflection\` when it is an open prompt asking learners to predict, explain, discuss, plan or reflect. Add one entry for every reflection prompt (\`purpose: "reflection"\`) and every activity that asks learners to use a worksheet (\`purpose: "worksheet"\`); these can be any block.
3. \`pre\`: true only for a knowledge check the course places before its teaching on purpose, to find out what learners already know or to prime them: a pre-test, a "what do you already know?" question, a warm-up the course says is not graded. Otherwise false, including for a check that comes before its teaching without saying why.
4. \`objectives\` on a check: the stated objectives this check gives evidence for. Use an empty list when none fits.
5. \`support\`: the fewest blocks, anywhere in the course, that teach what a learner needs to answer correctly. Use \`channel: "screen"\` when the needed information is visible, \`"tooltip"\` when it is only in a tooltip, and \`"narration"\` when it is only in narration, and \`"transcript"\` when supplied media prose teaches it. Use an empty list when the course never teaches it. Give support for knowledge checks only. Glossary tooltips are an intended way to teach definitions; tooltip-only support is not a gap.
6. \`overlaps\`: groups of two or more stated objectives whose intended learning substantially overlaps, such as a course outcome restated in a module or two modules promising the same capability. Say in one sentence what they share. Use an empty list when none overlap.
7. \`interpretation\`: up to five short observations about the pattern of objectives, checks and support, each citing refs in \`refs\`. Write the text for a designer: name lessons and pages in words, never as refs. Describe; do not grade or rewrite.
8. Output valid JSON only. Every ref must appear in \`course.md\`.
`;

export async function prepareAlignment(course: Course, directory: string): Promise<void> {
	await writeBundle(course, directory, "alignment", PROMPT_VERSION, PROMPT, {
		checks: locateBlocks(course)
			.filter((item) => item.block.type === "assessment")
			.map((item) => item.ref),
	});
}

export type Channel = "screen" | "tooltip" | "narration" | "transcript";
export type Purpose = "knowledge" | "survey" | "reflection" | "worksheet";

export interface AlignmentAnswer {
	model: string;
	objectives: Array<{
		id: string;
		text: string;
		ref: string;
		fink: Fink[];
		parent: string | null;
		modelBloom?: Bloom | null;
		knowledge?: Knowledge | null;
		gagne?: Gagne | null;
		levelReason?: string | null;
		performance?: Performance | null;
	}>;
	checks: Array<{
		ref: string;
		purpose: Purpose;
		/** A knowledge check placed before its teaching on purpose, such as a pre-test. */
		pre: boolean;
		objectives: string[];
		support: Array<{ ref: string; channel: Channel }>;
	}>;
	overlaps: Array<{ objectives: string[]; note: string }>;
	interpretation: Interpretation[];
}

const FINK_SET = new Set<string>(FINK);
const PURPOSES = new Set<string>(["knowledge", "survey", "reflection", "worksheet"]);
const CHANNELS = new Set<string>(["screen", "tooltip", "narration", "transcript"]);

/** Rejects answers for another course revision or citing refs the course does not have. */
/** Words quoted from an objective for each part of a performance objective (Mager): null when not stated. */
export interface Performance {
	action: string | null;
	conditions: string | null;
	standard: string | null;
}

function performanceOf(value: unknown, objective: string, at: string, problem: (message: string) => never): Performance | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "object" || Array.isArray(value)) return problem(`${at} must be an object with action, conditions and standard`);
	const record = value as Record<string, unknown>;
	const part = (name: "action" | "conditions" | "standard") => {
		const quoted = record[name];
		if (quoted === null || quoted === undefined) return null;
		if (typeof quoted !== "string" || !quoted.trim()) return problem(`${at}.${name} must be words from the objective or null`);
		// Quoted, not paraphrased, so a designer can see exactly what the objective states.
		if (!objective.toLowerCase().includes(quoted.trim().toLowerCase())) problem(`${at}.${name} must be copied from the objective's text`);
		return quoted.trim();
	};
	return { action: part("action"), conditions: part("conditions"), standard: part("standard") };
}

export function parseAlignment(json: string, course: Course): AlignmentAnswer {
	const answer = readAnswer(json, course, "alignment", PROMPT_VERSION);
	const { raw, problem, types: refs, ref, text, list, record } = answer;

	const objectives = list(raw.objectives, "objectives").map((value, i) => {
		const item = record(value, `objectives[${i}]`);
		const fink = list(item.fink ?? [], `objectives[${i}].fink`).map((value, j) =>
			typeof value === "string" && FINK_SET.has(value) ? (value as Fink) : problem(`objectives[${i}].fink[${j}] must be one of ${FINK.join(", ")}`),
		);
		const level = <T extends string>(value: unknown, levels: readonly T[], at: string): T | null =>
			value === null || value === undefined ? null : typeof value === "string" && (levels as readonly string[]).includes(value) ? (value as T) : problem(`${at} must be one of ${levels.join(", ")} or null`);
		return {
			id: text(item.id, `objectives[${i}].id`),
			text: text(item.text, `objectives[${i}].text`),
			ref: ref(item.ref, `objectives[${i}].ref`),
			fink,
			parent: item.parent === null || item.parent === undefined ? null : text(item.parent, `objectives[${i}].parent`),
			modelBloom: level<Bloom>(item.bloom, BLOOM, `objectives[${i}].bloom`),
			knowledge: level<Knowledge>(item.knowledge, KNOWLEDGE, `objectives[${i}].knowledge`),
			gagne: level<Gagne>(item.gagne, GAGNE, `objectives[${i}].gagne`),
			levelReason: typeof item.levelReason === "string" && item.levelReason.trim() ? item.levelReason.trim() : null,
			performance: performanceOf(item.performance, text(item.text, `objectives[${i}].text`), `objectives[${i}].performance`, problem),
		};
	});
	const objectiveIds = new Set(objectives.map((objective) => objective.id));
	for (const objective of objectives) {
		if (objective.parent !== null && (objective.parent === objective.id || !objectiveIds.has(objective.parent))) {
			problem(`objective ${objective.id} has parent ${objective.parent}, which is not another stated objective`);
		}
	}
	const checks = list(raw.checks, "checks").map((value, i) => {
		const item = record(value, `checks[${i}]`);
		const at = `checks[${i}]`;
		const checkRef = ref(item.ref, `${at}.ref`);
		const purpose = text(item.purpose, `${at}.purpose`);
		if (!PURPOSES.has(purpose)) problem(`${at}.purpose must be knowledge, survey, reflection or worksheet`);
		if ((purpose === "knowledge" || purpose === "survey") && refs.get(checkRef) !== "assessment") {
			problem(`${at}.ref must be an assessment block for purpose ${purpose}`);
		}
		if (item.pre !== undefined && typeof item.pre !== "boolean") problem(`${at}.pre must be true or false`);
		if (item.pre === true && purpose !== "knowledge") problem(`${at}.pre is only for knowledge checks`);
		return {
			ref: checkRef,
			purpose: purpose as Purpose,
			pre: item.pre === true,
			objectives: list(item.objectives, `${at}.objectives`).map((id, j) =>
				typeof id === "string" && objectiveIds.has(id) ? id : problem(`${at}.objectives[${j}] is not an objective id`),
			),
			support: list(item.support, `${at}.support`).map((entry, j) => {
				const support = record(entry, `${at}.support[${j}]`);
				if (typeof support.channel !== "string" || !CHANNELS.has(support.channel)) {
					problem(`${at}.support[${j}].channel must be screen, tooltip, narration or transcript`);
				}
				return { ref: ref(support.ref, `${at}.support[${j}].ref`), channel: support.channel as Channel };
			}),
		};
	});
	const overlaps = list(raw.overlaps ?? [], "overlaps").map((value, i) => {
		const item = record(value, `overlaps[${i}]`);
		const ids = list(item.objectives, `overlaps[${i}].objectives`).map((id, j) =>
			typeof id === "string" && objectiveIds.has(id) ? id : problem(`overlaps[${i}].objectives[${j}] is not an objective id`),
		);
		if (ids.length < 2) problem(`overlaps[${i}] needs at least two objectives`);
		return { objectives: ids, note: text(item.note, `overlaps[${i}].note`) };
	});
	const interpretation = readInterpretation(answer);
	return { model: text(raw.model, "model"), objectives, checks, overlaps, interpretation };
}
