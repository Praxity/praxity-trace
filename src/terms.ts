import { COURSE_TEXT_GUIDE, type Interpretation, readAnswer, readInterpretation, readSpan, writeBundle } from "./bundle.ts";
import type { Course } from "./inspect.ts";
import { buildPlaces, lessonTags, esc, locateBlocks, type Places, where, wheres } from "./places.ts";
import { generated, generatedSummary, method, viewBlock } from "./modes.ts";

export const PROMPT_VERSION = "terms/2";

export const KINDS = ["term", "reference", "premise"] as const;
export type Kind = (typeof KINDS)[number];

export interface Flag {
	ref: string;
	channel: "screen" | "narration" | "transcript";
	kind: Kind;
	/** Exact text from the block, as shown in course.md. */
	span: string;
	note: string;
	/** Where the course does explain it, when it does so elsewhere. */
	explainedAt: string | null;
}

export interface TermsAnswer {
	model: string;
	flags: Flag[];
	interpretation: Interpretation[];
}

const PROMPT = `# Terms and references review

You are reading a course as a newcomer to its subject would, marking language that asks more of the learner than the text supplies. ${COURSE_TEXT_GUIDE}

Write \`answer.json\` in this folder, matching this shape exactly:

\`\`\`json
{
  "view": "terms",
  "promptVersion": "${PROMPT_VERSION}",
  "courseHash": "<copy from manifest.json>",
  "model": "<your model name>",
  "flags": [
    {
      "ref": "<ref>",
      "channel": "screen | narration | transcript",
      "kind": "term | reference | premise",
      "span": "<exact words copied from that block's Screen, Narration or Transcript line>",
      "note": "<what the learner needs, in one sentence>",
      "explainedAt": "<ref where the course explains it, or null>"
    }
  ],
  "interpretation": [{ "text": "<one observation about the pattern>", "refs": ["<ref>"] }]
}
\`\`\`

Rules:

1. \`term\`: a word, name or acronym a newcomer may not know, which nothing on screen, in a tooltip, in narration or in a transcript has explained by this point. Flag its first unexplained use only. Everyday words and terms this block explains do not count.
2. \`reference\`: a word such as "this", "these", "it" or "however" whose referent or contrast is unclear, far away, or only in another channel.
3. \`premise\`: a statement that relies on a fact, step or claim the course has not given.
4. \`span\`: copy the words exactly, keeping case and punctuation, and keep it short: the term, or the few words that carry the reference or claim.
5. \`explainedAt\`: when the course explains the term later or elsewhere, give that ref; otherwise null.
6. \`interpretation\`: up to five short observations about the pattern, each citing refs in \`refs\`. Write the text for a designer: name lessons and pages in words, never as refs. Describe; do not grade or rewrite.
7. Glossary tooltips are an intended way to explain terms. Output valid JSON only; every ref must appear in \`course.md\`.
`;

export async function prepareTerms(course: Course, directory: string): Promise<void> {
	await writeBundle(course, directory, "terms", PROMPT_VERSION, PROMPT);
}

export function parseTerms(json: string, course: Course): TermsAnswer {
	const answer = readAnswer(json, course, "terms", PROMPT_VERSION);
	const { raw, problem, ref, text, list, record } = answer;
	const blocks = new Map(locateBlocks(course).map((item) => [item.ref, item.block]));
	const flags = list(raw.flags, "flags").map((value, i) => {
		const at = `flags[${i}]`;
		const item = record(value, at);
		const where = ref(item.ref, `${at}.ref`);
		const channel: Flag["channel"] =
			item.channel === "screen" || item.channel === "narration" || item.channel === "transcript" ? item.channel : problem(`${at}.channel must be screen, narration or transcript`);
		const kind = typeof item.kind === "string" && (KINDS as readonly string[]).includes(item.kind) ? (item.kind as Kind) : problem(`${at}.kind must be one of ${KINDS.join(", ")}`);
		const span = readSpan(answer, blocks.get(where)!, item.span, `${at}.span`, channel, where);
		return {
			ref: where,
			channel,
			kind,
			span,
			note: text(item.note, `${at}.note`),
			explainedAt: item.explainedAt === null || item.explainedAt === undefined ? null : ref(item.explainedAt, `${at}.explainedAt`),
		};
	});
	return { model: text(raw.model, "model"), flags, interpretation: readInterpretation(answer) };
}

export interface TermsView {
	model: string;
	flags: Flag[];
	lessons: string[];
	places: Places;
	interpretation: Interpretation[];
}

export function termsView(course: Course, answer: TermsAnswer): TermsView {
	const places = buildPlaces(course, [
		...answer.flags.flatMap((flag) => [flag.ref, ...(flag.explainedAt ? [flag.explainedAt] : [])]),
		...answer.interpretation.flatMap((item) => item.refs),
	]);
	return {
		model: answer.model,
		flags: [...answer.flags].sort((a, b) => (places[a.ref]?.position ?? 0) - (places[b.ref]?.position ?? 0)),
		lessons: course.lessons.map((lesson) => lesson.title),
		places,
		interpretation: answer.interpretation,
	};
}

const KIND_LABEL: Record<Kind, string> = { term: "Unexplained term", reference: "Unclear reference", premise: "Unstated premise" };
const KIND_HELP: Record<Kind, string> = {
	term: "A word, name or acronym a newcomer may not know, used before anything on screen, in a tooltip, in narration or in a transcript explains it.",
	reference: "A word such as this, it or however whose referent or contrast is unclear, far away, or only in the other channel.",
	premise: "A statement that relies on a fact, step or claim the course has not given.",
};
/** The kind's name, defined on hover and keyboard focus. */
const kindName = (kind: Kind) => `<abbr class="defined" tabindex="0" title="${esc(KIND_HELP[kind])}">${KIND_LABEL[kind]}</abbr>`;

const dot = (count: number) =>
	count
		? `<svg width="20" height="20" role="img" aria-label="${count}"><circle class="level-dot" cx="10" cy="10" r="${Math.min(9, 3 * Math.sqrt(count)).toFixed(1)}"/></svg>`
		: "";

function kindMatrix(view: TermsView): string {
	const rows = KINDS.map((kind) => {
		const cells = view.lessons
			.map((_, index) => dot(view.flags.filter((flag) => flag.kind === kind && view.places[flag.ref]?.lesson === index + 1).length))
			.map((cell, index) => `<td class="cell" data-lesson="${index + 1}">${cell}</td>`)
			.join("");
		return `<tr ${lessonTags(view.places, view.flags.filter((flag) => flag.kind === kind).map((flag) => flag.ref))}><th scope="row">${KIND_LABEL[kind]}</th>${cells}<td class="num">${view.flags.filter((flag) => flag.kind === kind).length}</td></tr>`;
	}).join("");
	return `<table class="matrix levels"><caption class="sr">Flagged terms by kind and lesson</caption><thead><tr><th scope="col">Kind</th>${view.lessons
		.map((title, index) => `<th scope="col" class="num" title="${esc(title)}">L${index + 1}</th>`)
		.join("")}<th scope="col" class="num">Flags</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function flagTable(view: TermsView): string {
	const rows = view.flags
		.map(
			(flag) =>
				`<tr ${lessonTags(view.places, [flag.ref, ...(flag.explainedAt ? [flag.explainedAt] : [])])}><th scope="row"><mark>${esc(flag.span)}</mark></th><td>${kindName(flag.kind)}</td><td>${esc(flag.note)}</td><td class="where">${where(view.places, flag.ref)} <span class="channel">${flag.channel === "screen" ? "on screen" : flag.channel}</span></td><td class="where">${flag.explainedAt ? where(view.places, flag.explainedAt) : "–"}</td></tr>`,
		)
		.join("");
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Flagged terms and references"><table class="blocks terms"><caption class="sr">Flagged terms and references</caption><thead><tr><th scope="col">Words</th><th scope="col">Kind</th><th scope="col">What the learner needs</th><th scope="col">Where</th><th scope="col">Explained at</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderTerms(view: TermsView): string {
	return `${viewBlock({
		id: "terms",
		level: 3,
		title: "Terms and missing explanations",
		question: "Where might a newcomer to the subject get stuck?",
		lead: `<p class="rule">Flags are ${generated(view.model, "interpretations")} of what a newcomer may need explained; dot area shows their count.</p>${method(`<p class="rule">Glossary tooltips count as explanations.</p>`)}`,
		chart: `<div class="table-wrap" role="img" aria-label="Flags by lesson and kind; the table view lists each flag.">${kindMatrix(view)}</div>`,
		table: flagTable(view),
	})}
${generatedSummary(view.model, view.interpretation.map((item) => `<li>${esc(item.text)} <span class="file">${wheres(view.places, item.refs)}</span></li>`).join(""), "unexplained terms")}`;
}

export const TERMS_STYLE = `
.terms mark{background:none;color:var(--ink);font-weight:600;box-shadow:inset 0 -2px 0 var(--accent)}
.terms .file{display:block}
`;
