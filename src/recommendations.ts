import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { COURSE_TEXT_GUIDE, readAnswer, writeBundle } from "./bundle.ts";
import { isViewId, type ViewId } from "./guides.ts";
import { presentViews } from "./sections.ts";
import { type Course, courseHash } from "./inspect.ts";
import { generated } from "./modes.ts";
import { buildPlaces, esc, wheres } from "./places.ts";
import type { Report } from "./report.ts";

export const PROMPT_VERSION = "recommendations/2";

export interface Recommendation {
	focus: string;
	why: string;
	views: ViewId[];
	refs: string[];
}

export interface RecommendationsView {
	model: string;
	items: Recommendation[];
	places: ReturnType<typeof buildPlaces>;
}

/**
 * The course findings a recommendations answer was written from, so changed findings ask for a
 * fresh answer. The guides are fixed tool text, not findings, so editing one leaves answers valid.
 */
export function reportHash(report: Report | Record<string, unknown>): string {
	return createHash("sha256").update(JSON.stringify({ ...report, recommendations: undefined, guides: undefined })).digest("hex");
}


const PROMPT = `# Recommendations

Write the short Recommendations section that opens a Praxity Trace report: the three to five things in this course most worth a learning designer's attention, distilled from the views below it.

Say what to inspect and which evidence in the views supports it. Include an alternative explanation only when a specific course passage supports that explanation, and cite that passage in refs.

## Material

- \`report.json\`: every view's measurements and generated readings. \`guides\` lists, per view id, patterns and what each could mean. Views that need a model answer appear only when that answer was supplied.
- \`course.md\`: the course text. ${COURSE_TEXT_GUIDE}

## Steps

1. Survey. Take each view id in \`guides\` that has data in \`report.json\` and note which of its patterns appear, with their numbers. Done when every present view has been checked.
2. Confirm. For each pattern you might recommend, read the cited blocks in \`course.md\` and confirm the pattern is what it seems. Done when each candidate has at least one ref you have read.
3. Choose three to five. Rank by how much a change would matter to learners and how much of the course it touches. Prefer a pattern that several views show together, such as checks whose instruction sits behind a click in a lesson that is also mostly text.
4. Write \`answer.json\`.

## Answer

\`\`\`json
{
  "view": "recommendations",
  "promptVersion": "${PROMPT_VERSION}",
  "courseHash": "<copy from manifest.json>",
  "reportHash": "<copy from manifest.json>",
  "model": "<your model name>",
  "recommendations": [
    {
      "focus": "<what to look at, one line of at most 100 characters>",
      "why": "<one or two sentences: the evidence with the numbers the views show; include an alternative explanation only when a specific course passage supports it>",
      "views": ["<view id from guides>"],
      "refs": ["<ref>"]
    }
  ]
}
\`\`\`

Rules:

1. Three to five recommendations, most important first.
2. Use the report's vocabulary: knowledge check (a question with a right answer), activity (a response without one), explore block, instruction, objective. Write pages as lesson.page, such as 3.9, never as refs.
3. \`why\` stays under 400 characters and cites numbers as the views give them. Leave out scores, praise and model names.
4. \`views\`: one or more view ids from \`guides\` whose data you used. \`refs\`: up to six refs from \`course.md\` where the designer should start.
5. Output valid JSON only.
`;

export async function prepareRecommendations(course: Course, reportPath: string, directory: string): Promise<void> {
	const report = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, unknown>;
	if (report.courseHash !== courseHash(course)) throw new Error("report.json was built from a different course revision; build the report again");
	const hash = reportHash(report);
	await writeBundle(course, directory, "recommendations", PROMPT_VERSION, PROMPT, { reportHash: hash });
	const { recommendations: _, ...rest } = report;
	await writeFile(join(directory, "report.json"), `${JSON.stringify(rest, null, 2)}\n`);
}

export function parseRecommendations(json: string, course: Course, report: Report): RecommendationsView {
	const answer = readAnswer(json, course, "recommendations", PROMPT_VERSION);
	const { raw, problem, ref, text, list, record } = answer;
	if (raw.reportHash !== reportHash(report)) problem("it was written from a different report; prepare a new bundle from this report");
	const present = new Set(presentViews(report));
	const values = list(raw.recommendations, "recommendations");
	if (values.length < 3 || values.length > 5) problem("recommendations must contain 3 to 5 items");
	const items = values.map((value, i) => {
		const at = `recommendations[${i}]`;
		const item = record(value, at);
		const focus = text(item.focus, `${at}.focus`).trim();
		if (!focus || focus.length > 100) problem(`${at}.focus must be one line of at most 100 characters`);
		const why = text(item.why, `${at}.why`).trim();
		if (!why || why.length > 400) problem(`${at}.why must be at most 400 characters`);
		const views = list(item.views, `${at}.views`).map((view, j) =>
			isViewId(view) && present.has(view) ? view : problem(`${at}.views[${j}] is not a view in this report`),
		);
		if (!views.length) problem(`${at}.views must name at least one view`);
		const refs = list(item.refs ?? [], `${at}.refs`).map((value, j) => ref(value, `${at}.refs[${j}]`));
		if (refs.length > 6) problem(`${at}.refs must contain at most 6 refs`);
		return { focus, why, views, refs };
	});
	return { model: text(raw.model, "model"), items, places: buildPlaces(course, items.flatMap((item) => item.refs)) };
}

/** `titles` maps view ids to the headings the report draws (already escaped), so links read as the views do. */
export function renderRecommendations(view: RecommendationsView, titles: Map<string, string>): string {
	const items = view.items
		.map((item) => {
			const links = item.views.map((id) => `<a href="#view-${id}">${titles.get(id) ?? id}</a>`).join(", ");
			const pages = item.refs.length ? ` · ${wheres(view.places, item.refs)}` : "";
			return `<li><strong>${esc(item.focus)}</strong><p>${esc(item.why)}</p><p class="file">See ${links}${pages}</p></li>`;
		})
		.join("");
	return `<section aria-labelledby="recommendations">
<div class="section-head"><h2 id="recommendations">Recommendations</h2><p class="rule">${generated(view.model, "Generated recommendations")} linked to the views and course pages below.</p></div>
<ol class="recommendation-list">${items}</ol>
</section>`;
}

export const RECOMMENDATIONS_STYLE = `
.recommendation-list{margin:0;padding-left:1.4rem;max-width:46rem;display:grid;gap:1rem}
.recommendation-list li::marker{color:var(--ink-2);font-variant-numeric:tabular-nums}
.recommendation-list strong{font-weight:600}.recommendation-list p{margin:.2rem 0 0;line-height:1.55}
.recommendation-list .file{font-size:.85rem;color:var(--ink-2)}
`;
