import { COURSE_TEXT_GUIDE, type Interpretation, readAnswer, readInterpretation, writeBundle } from "./bundle.ts";
import type { Course } from "./inspect.ts";

export const PROMPT_VERSION = "concepts/3";

export const ROLES = ["preview", "defined", "example", "mentioned", "activity", "checked", "recap"] as const;
export type Role = (typeof ROLES)[number];

export interface ConceptsAnswer {
	model: string;
	concepts: Array<{ id: string; name: string; prerequisites: string[]; occurrences: Array<{ ref: string; role: Role }> }>;
	interpretation: Interpretation[];
}

const PROMPT = `# Concept review

You are mapping where a course introduces, explains and uses its concepts. ${COURSE_TEXT_GUIDE}

Write \`answer.json\` in this folder, matching this shape exactly:

\`\`\`json
{
  "view": "concepts",
  "promptVersion": "${PROMPT_VERSION}",
  "courseHash": "<copy from manifest.json>",
  "model": "<your model name>",
  "concepts": [
    {
      "id": "C1",
      "name": "<the concept as the course names it>",
      "prerequisites": ["C3"],
      "occurrences": [{ "ref": "<ref>", "role": "preview | defined | example | mentioned | activity | checked | recap" }]
    }
  ],
  "interpretation": [{ "text": "<one observation about the pattern>", "refs": ["<ref>"] }]
}
\`\`\`

Rules:

1. \`concepts\`: the ideas a learner must understand to meet the course's objectives or answer its checks, such as terms, principles, standards and named laws or plans. At most 30. Treat different wordings of one idea as one concept.
2. \`prerequisites\`: ids of other concepts a learner must already understand for this one to make sense; use [] when there are none.
3. \`occurrences\`: every block where the concept meaningfully appears, once per block, with the role that block plays for it:
   - \`preview\`: names it ahead of teaching it on purpose, as in learning outcomes, an overview or a "coming up" page;
   - \`defined\`: explains what the concept is, including in a glossary tooltip or narration;
   - \`example\`: applies it to a case or scenario;
   - \`mentioned\`: uses it without explaining it;
   - \`activity\`: a reflection prompt or worksheet activity asks learners to apply or connect it;
   - \`checked\`: an assessment that needs it to answer correctly;
   - \`recap\`: a summary or review of earlier teaching.
4. \`interpretation\`: up to five short observations about when concepts are introduced, explained, used and checked, each citing refs in \`refs\`. Write the text for a designer: name lessons and pages in words, never as refs. Describe; do not grade or rewrite.
5. Output valid JSON only. Every ref must appear in \`course.md\`.
`;

export async function prepareConcepts(course: Course, directory: string): Promise<void> {
	await writeBundle(course, directory, "concepts", PROMPT_VERSION, PROMPT);
}

const ROLE_SET = new Set<string>(ROLES);

export function parseConcepts(json: string, course: Course): ConceptsAnswer {
	const answer = readAnswer(json, course, "concepts", PROMPT_VERSION);
	const { raw, problem, ref, text, list, record } = answer;
	const concepts = list(raw.concepts, "concepts").map((value, i) => {
		const item = record(value, `concepts[${i}]`);
		const seen = new Set<string>();
		return {
			id: text(item.id, `concepts[${i}].id`),
			name: text(item.name, `concepts[${i}].name`),
			prerequisites: list(item.prerequisites, `concepts[${i}].prerequisites`).map((value, j) =>
				text(value, `concepts[${i}].prerequisites[${j}]`),
			),
			occurrences: list(item.occurrences, `concepts[${i}].occurrences`).map((entry, j) => {
				const at = `concepts[${i}].occurrences[${j}]`;
				const occurrence = record(entry, at);
				const where = ref(occurrence.ref, `${at}.ref`);
				if (seen.has(where)) problem(`${at} repeats ${where}; give one role per block`);
				seen.add(where);
				if (typeof occurrence.role !== "string" || !ROLE_SET.has(occurrence.role)) {
					problem(`${at}.role must be one of ${ROLES.join(", ")}`);
				}
				return { ref: where, role: occurrence.role as Role };
			}),
		};
	});
	const ids = new Set(concepts.map((concept) => concept.id));
	if (ids.size !== concepts.length) problem("concept ids must be unique");
	for (const [i, concept] of concepts.entries()) {
		for (const [j, prerequisite] of concept.prerequisites.entries()) {
			const at = `concepts[${i}].prerequisites[${j}]`;
			if (!ids.has(prerequisite)) problem(`${at} is not a concept id in this answer`);
			if (prerequisite === concept.id) problem(`${at} cannot refer to its own concept`);
		}
	}
	return { model: text(raw.model, "model"), concepts, interpretation: readInterpretation(answer) };
}
