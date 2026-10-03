

import type { AlignmentView } from "./alignment-view.ts";
import { decodeAngles, visibleStrings } from "./text.ts";
import type { ConceptsView } from "./concepts-view.ts";
import type { Course } from "./inspect.ts";
import { buildPlaces, esc, isCreditPage, locateBlocks, type Places, where } from "./places.ts";
import { legend, method, viewBlock } from "./modes.ts";

export const KINDS = ["strong", "em", "mark", "u", "span.praxity-doodle"] as const;
export type EmphasisKind = (typeof KINDS)[number];
export type CrossReference = "names a concept" | "in an objective" | "other" | null;

export interface EmphasisSpan {
	ref: string;
	lesson: string;
	page: number;
	kind: EmphasisKind;
	text: string;
	crossReference: CrossReference;
}

export interface EmphasisView {
	lessons: Array<{
		file: string;
		title: string;
		counts: Record<EmphasisKind, number>;
		pages: Array<{ number: number; spans: number }>;
		emphasizedWords: number;
		screenWords: number;
		share: number | null;
	}>;
	spans: EmphasisSpan[];
	places: Places;
}

const TAG = /<\/?([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;

/** One visible HTML field; words in nested emphasis count once in the share. */
function extract(html: string): { spans: Array<{ kind: EmphasisKind; text: string }>; words: number; emphasizedWords: number } {
	const open: Array<{ tag: string; kind: EmphasisKind; text: string }> = [];
	const found: typeof open = [];
	let plain = "";
	let marked = "";
	let cursor = 0;
	const add = (part: string) => {
		plain += part;
		marked += open.length ? part : " ".repeat(part.length);
		for (const span of open) span.text += part;
	};
	for (const match of html.matchAll(TAG)) {
		add(html.slice(cursor, match.index));
		cursor = match.index + match[0].length;
		const tag = (match[1] ?? "").toLowerCase();
		const closing = match[0].startsWith("</");
		if (closing) {
			const index = open.findLastIndex((span) => span.tag === tag);
			if (index >= 0) open.splice(index, 1);
		} else {
			const className = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[2] ?? "");
			const doodle = tag === "span" && (className?.slice(1).find(Boolean) ?? "").split(/\s+/).includes("praxity-doodle");
			const kind = doodle ? "span.praxity-doodle" : KINDS.find((value) => value === tag);
			if (kind) {
				const span = { tag, kind, text: "" };
				open.push(span);
				found.push(span);
			}
		}
		if (/^<\/?(?:p|li|br|div|h[1-6])\b/i.test(match[0])) {
			plain += " ";
			marked += " ";
			for (const span of open) span.text += " ";
		}
	}
	add(html.slice(cursor));
	const words = [...plain.matchAll(/\S+/g)];
	return {
		spans: found.map(({ kind, text }) => ({ kind, text: decodeAngles(text).replace(/\s+/g, " ").trim() })).filter((span) => span.text),
		words: words.length,
		emphasizedWords: words.filter((word) => marked.slice(word.index, word.index + word[0].length).trim()).length,
	};
}

export function emphasisView(course: Course, concepts?: ConceptsView, alignment?: AlignmentView): EmphasisView {
	const spans: EmphasisSpan[] = [];
	const lessons = course.lessons.map((lesson) => ({
		file: lesson.file,
		title: lesson.title,
		counts: Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<EmphasisKind, number>,
		pages: lesson.pages.filter((page) => !isCreditPage(page.title)).map((page) => ({ number: page.number, spans: 0 })),
		emphasizedWords: 0,
		screenWords: 0,
		share: null as number | null,
	}));
	for (const item of locateBlocks(course)) {
		const lesson = lessons[item.lessonNumber - 1];
		// Headings are styled by the theme, not emphasised by the author, so they would swamp the count.
		if (!lesson || item.credit || item.block.type === "heading") continue;
		for (const html of visibleStrings(item.block.data)) {
			const extracted = extract(html.replace(/<h[1-6]\b[\s\S]*?<\/h[1-6]>/gi, " "));
			lesson.screenWords += extracted.words;
			lesson.emphasizedWords += extracted.emphasizedWords;
			for (const span of extracted.spans) {
				lesson.counts[span.kind] += 1;
				const pageCount = lesson.pages.find((page) => page.number === item.page);
				if (pageCount) pageCount.spans += 1;
				const phrase = span.text.toLocaleLowerCase();
				const crossReference: CrossReference = !concepts && !alignment ? null
					: concepts?.concepts.some((concept) => phrase.includes(concept.name.toLocaleLowerCase())) ? "names a concept"
					: alignment?.objectives.some((objective) => objective.text.toLocaleLowerCase().includes(phrase)) ? "in an objective"
					: "other";
				spans.push({ ref: item.ref, lesson: item.lesson, page: item.page, ...span, crossReference });
			}
		}
	}
	for (const lesson of lessons) lesson.share = lesson.screenWords ? lesson.emphasizedWords / lesson.screenWords : null;
	return { lessons, spans, places: buildPlaces(course, spans.map((span) => span.ref)) };
}

const KIND_LABEL: Record<EmphasisKind, string> = { strong: "Bold", em: "Italic", mark: "Highlight", u: "Underline", "span.praxity-doodle": "Doodle" };
const tagLabel = (kind: EmphasisKind) => KIND_LABEL[kind];

export function renderEmphasis(view: EmphasisView): string {
	// Only the kinds this course uses get a column.
	const used = KINDS.filter((kind) => view.lessons.some((lesson) => lesson.counts[kind] > 0));
	// One stacked bar per lesson on a shared scale: phrases by kind, then words and share at the right end.
	const total = (lesson: EmphasisView["lessons"][number]) => used.reduce((sum, kind) => sum + lesson.counts[kind], 0);
	const most = Math.max(1, ...view.lessons.map(total));
	const unit = 420 / most;
	const rows = view.lessons
		.map((lesson, index) => {
			const segments = used
				.filter((kind) => lesson.counts[kind] > 0)
				.map((kind) => `<span class="emphasis-segment k-${kind.replace(/\W/g, "")}" style="width:${(lesson.counts[kind] * unit).toFixed(1)}px" title="${KIND_LABEL[kind]}: ${lesson.counts[kind]}"><span class="sr">${KIND_LABEL[kind]} ${lesson.counts[kind]}, </span></span>`)
				.join("");
			const share = lesson.share === null ? "–" : `${(lesson.share * 100).toFixed(1)}%`;
			return `<tr data-lesson="${index + 1}"><th scope="row"><span title="${esc(lesson.title)}">L${index + 1}</span></th><td class="bar-cell"><span class="stack">${segments}</span><span class="bar-total">${total(lesson)}</span></td><td class="num">${lesson.emphasizedWords}</td><td class="num">${share}</td></tr>`;
		})
		.join("");
	const phrases = view.lessons.map((lesson, index) => {
		const spans = view.spans.filter((span) => span.lesson === lesson.file);
		if (!spans.length) return "";
		return `<h4 class="review-lesson" data-lesson="${index + 1}"><span title="${esc(lesson.title)}">L${index + 1}</span> <span class="num-inline">${spans.length}</span></h4><ul class="emphasis-spans">${spans
			.map((span) => `<li data-lesson="${view.places[span.ref]?.lesson}"><q>${esc(span.text)}</q> <span class="file">${esc(tagLabel(span.kind))} · ${where(view.places, span.ref)}${span.crossReference && span.crossReference !== "other" ? ` · <span class="xref">${esc(span.crossReference)}</span>` : ""}</span></li>`)
			.join("")}</ul>`;
	}).join("\n");
	const counts = view.lessons
		.map((lesson, index) => `<tr data-lesson="${index + 1}"><th scope="row"><span title="${esc(lesson.title)}">L${index + 1}</span></th>${used.map((kind) => `<td class="num">${lesson.counts[kind]}</td>`).join("")}<td class="num">${total(lesson)}</td><td class="num">${lesson.emphasizedWords}</td><td class="num">${lesson.share === null ? "–" : `${(lesson.share * 100).toFixed(1)}%`}</td></tr>`)
		.join("");
	const table = `<div class="table-wrap" tabindex="0" role="region" aria-label="Emphasised phrases by lesson"><table class="blocks"><caption class="sr">Emphasised phrases by lesson</caption><thead><tr><th scope="col">Lesson</th>${used.map((kind) => `<th scope="col" class="num">${KIND_LABEL[kind]}</th>`).join("")}<th scope="col" class="num">Phrases</th><th scope="col" class="num">Words</th><th scope="col" class="num">Share of on-screen words</th></tr></thead><tbody>${counts}</tbody></table></div>`;
	const chart = `${legend(used.map((kind) => [`k-${kind.replace(/\W/g, "")}`, KIND_LABEL[kind]]))}<div class="table-wrap" role="img" aria-label="Emphasised phrases per lesson as stacked bars; the table view has the numbers."><table class="emphasis-bars" aria-hidden="true"><caption class="sr">Emphasised phrases per lesson as stacked bars; the table view has the numbers.</caption><thead><tr><th>Lesson</th><th>Emphasised phrases</th><th class="num">Words</th><th class="num">Share of on-screen words</th></tr></thead><tbody>${rows}</tbody></table></div>`;
	return `${viewBlock({ id: "emphasis", level: 3, title: "Emphasis", question: "What does each lesson emphasise, and how much?", lead: `${method(`<p class="rule">Each strong, em, mark, u or span.praxity-doodle tag in on-screen block text counts once, including nested tags. Headings, source and credit pages, narration and tooltips are excluded. Words are separated by whitespace after HTML tags are removed; a word inside nested tags counts once in the share. The share is emphasised words divided by on-screen words in the same lesson; an empty lesson has no share. A phrase names a concept when it contains a concept name, ignoring case; otherwise it is in an objective when the objective contains the whole phrase, ignoring case. Other means neither supplied view matches; without model views no cross-reference is assigned.</p>`)}`, chart, table: table + (view.spans.length ? `<details class="review-group"><summary>Every emphasised phrase · ${view.spans.length}</summary>${phrases}</details>` : "") })}`;
}

export const EMPHASIS_STYLE = `
.emphasis-bars td.bar-cell{min-width:28rem;white-space:nowrap}
.emphasis-bars .stack{display:inline-flex;gap:2px;vertical-align:middle}
.emphasis-bars .emphasis-segment{display:inline-block;height:12px;min-width:3px}
.emphasis-bars .emphasis-segment:first-child{border-radius:2px 0 0 2px}.emphasis-bars .emphasis-segment:last-child{border-radius:0 2px 2px 0}
.emphasis-bars .bar-total{margin-left:.5rem;font-variant-numeric:tabular-nums;color:var(--ink-2)}
.k-strong{background:#52514e}.k-em{background:#4a3aa7}.k-mark{background:#008300}.k-u{background:#0f7c83}.k-spanpraxitydoodle{background:#b0306a}
.key.k-strong,.key.k-em,.key.k-mark,.key.k-u,.key.k-spanpraxitydoodle{width:12px;height:12px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-color-scheme:dark){.k-strong{background:#c3c2b7}.k-em{background:#9085e9}.k-mark{background:#0ca30c}.k-u{background:#22a6ae}.k-spanpraxitydoodle{background:#d55181}}
.emphasis-spans{padding-left:1.5rem;max-width:60rem;list-style:none}.emphasis-spans li{margin:.35rem 0;overflow-wrap:anywhere}
.emphasis-spans code{font-size:.8rem;color:var(--ink-2)}.xref{font-size:.8rem;color:var(--accent);font-weight:600}
`;
