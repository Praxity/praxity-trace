import { COURSE_TEXT_GUIDE, type Interpretation, readAnswer, readInterpretation, writeBundle } from "./bundle.ts";
import type { Course } from "./inspect.ts";
import { generated, generatedSummary, viewBlock } from "./modes.ts";
import { buildPlaces, lessonTags, esc, pageKey, type Places, wheres } from "./places.ts";

/**
 * Concept distinction coverage: pairs of ideas a learner could confuse, and whether the course
 * states the difference, shows contrasting examples, and asks learners to tell them apart.
 * Interleaved, discriminating examples help learners classify new cases (Kornell and Bjork, 2008).
 */
export const PROMPT_VERSION = "distinctions/2";

export interface Distinction {
	a: string;
	b: string;
	/** Why a learner could confuse them, in one sentence. */
	why: string;
	/** Blocks that state the difference or the criterion for telling them apart. */
	stated: string[];
	/** Blocks that set an example of one against an example of the other. */
	contrasted: string[];
	/** Checks that need the learner to tell them apart. */
	checked: string[];
}

export interface DistinctionsAnswer {
	model: string;
	pairs: Distinction[];
	interpretation: Interpretation[];
}

const PROMPT = `# Concept distinction review

You are finding pairs of ideas in a course that a learner could confuse, and how well the course helps learners tell them apart. ${COURSE_TEXT_GUIDE}

Write \`answer.json\` in this folder, matching this shape exactly:

\`\`\`json
{
  "view": "distinctions",
  "promptVersion": "${PROMPT_VERSION}",
  "courseHash": "<copy from manifest.json>",
  "model": "<your model name>",
  "pairs": [
    {
      "a": "<first idea, as the course names it>",
      "b": "<second idea>",
      "why": "<why a learner could confuse them, in one sentence>",
      "stated": ["<ref>"],
      "contrasted": ["<ref>"],
      "checked": ["<ref>"]
    }
  ],
  "interpretation": [{ "text": "<one observation about the pattern>", "refs": ["<ref>"] }]
}
\`\`\`

Rules:

1. \`pairs\`: pairs of terms, categories, principles, rules or procedures that share wording, overlap in meaning, or apply in similar situations, where mixing them up would lead a learner to a wrong answer or action. At most 15, most consequential first. A group of three or more similar ideas becomes the pairs most likely to be confused.
2. \`stated\`: blocks that say how the two differ or give a criterion for telling them apart. Defining each separately does not count unless the definitions sit together and contrast.
3. \`contrasted\`: blocks that set an example of one beside an example of the other.
4. \`checked\`: assessment blocks whose correct answer depends on telling the two apart.
5. Use empty lists where the course does nothing of that kind; that absence is what the designer needs to see.
6. \`interpretation\`: up to five short observations, each citing refs in \`refs\`. Name lessons and pages in words, never as refs. Describe; do not grade or rewrite.
7. Output valid JSON only. Every ref must appear in \`course.md\`.
`;

export async function prepareDistinctions(course: Course, directory: string): Promise<void> {
	await writeBundle(course, directory, "distinctions", PROMPT_VERSION, PROMPT);
}

export function parseDistinctions(json: string, course: Course): DistinctionsAnswer {
	const answer = readAnswer(json, course, "distinctions", PROMPT_VERSION);
	const { raw, problem, types, ref, text, list, record } = answer;
	const pairs = list(raw.pairs, "pairs").map((value, i) => {
		const at = `pairs[${i}]`;
		const item = record(value, at);
		const refs = (key: string) => list(item[key], `${at}.${key}`).map((r, j) => ref(r, `${at}.${key}[${j}]`));
		const checked = refs("checked");
		for (const check of checked) if (types.get(check) !== "assessment") problem(`${at}.checked ${check} is not an assessment block`);
		return {
			a: text(item.a, `${at}.a`),
			b: text(item.b, `${at}.b`),
			why: text(item.why, `${at}.why`),
			stated: refs("stated"),
			contrasted: refs("contrasted"),
			checked,
		};
	});
	return { model: text(raw.model, "model"), pairs, interpretation: readInterpretation(answer) };
}

export interface DistinctionsView {
	model: string;
	pairs: Distinction[];
	places: Places;
	interpretation: Interpretation[];
}

export function distinctionsView(course: Course, answer: DistinctionsAnswer): DistinctionsView {
	return {
		model: answer.model,
		pairs: answer.pairs,
		places: buildPlaces(course, [
			...answer.pairs.flatMap((pair) => [...pair.stated, ...pair.contrasted, ...pair.checked]),
			...answer.interpretation.flatMap((item) => item.refs),
		]),
		interpretation: answer.interpretation,
	};
}

/** A dot where the course does this for the pair, focusable to show where; a blank cell where it does not. */
function cell(refs: string[], places: Places, label: string): string {
	if (!refs.length) return `<td class="dist"><span class="sr">${label}: no passage linked</span></td>`;
	const at = wheres(places, refs).replace(/<[^>]*>/g, "");
	const first = places[refs[0] as string];
	return `<td class="dist"><span class="dist-yes" tabindex="0" role="img" aria-label="${esc(`${label}: ${at}`)}" title="${esc(at)}"${first ? ` data-page="${pageKey(first.lesson, first.page)}"` : ""}></span></td>`;
}

export function renderDistinctions(view: DistinctionsView): string {
	const gaps = (pair: Distinction) => [pair.stated, pair.contrasted, pair.checked].filter((refs) => refs.length === 0).length;
	const rows = [...view.pairs]
		.sort((a, b) => gaps(b) - gaps(a))
		.map(
			(pair) =>
				`<tr ${lessonTags(view.places, [...pair.stated, ...pair.contrasted, ...pair.checked])}><th scope="row"><span tabindex="0" title="${esc(pair.why)}">${esc(pair.a)} / ${esc(pair.b)}</span></th>${cell(pair.stated, view.places, "Difference stated")}${cell(pair.contrasted, view.places, "Contrasting examples")}${cell(pair.checked, view.places, "Checked")}</tr>`,
		)
		.join("");
	return `${viewBlock({ id: "distinctions", level: 3, title: "Confusable concepts", question: "Which pairs of ideas could learners mix up, and does the course tell them apart?", lead: `<p class="rule">${generated(view.model)}, with pairs missing the most linked passages first. A blank cell means this review linked no passage for that kind of support.</p>`, table: `<div class="table-wrap" tabindex="0" role="region" aria-label="Concept distinction coverage"><table class="blocks distinctions"><caption class="sr">Concept distinction coverage</caption><thead><tr><th scope="col">Pair</th><th scope="col" class="dist"><abbr class="defined" tabindex="0" title="The course says in words how the two ideas differ.">Stated</abbr></th><th scope="col" class="dist"><abbr class="defined" tabindex="0" title="The course shows examples of each side by side, so learners see the difference in action.">Contrasted</abbr></th><th scope="col" class="dist"><abbr class="defined" tabindex="0" title="A knowledge check asks learners to tell the two apart.">Checked</abbr></th></tr></thead><tbody>${rows}</tbody></table></div>` })}
${generatedSummary(view.model, view.interpretation.map((item) => `<li>${esc(item.text)} <span class="file">${wheres(view.places, item.refs)}</span></li>`).join(""), "confusable pairs")}`;
}

export const DISTINCTIONS_STYLE = `
.distinctions th[scope=row]{font-weight:400}.distinctions th[scope=row] span{border-bottom:1px dotted var(--muted)}
.distinctions .dist{text-align:center;width:6.5rem}
.dist-yes{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent);vertical-align:middle}
`;
