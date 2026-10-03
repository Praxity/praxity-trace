import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { GUIDES, isViewId } from "../src/guides.ts";
import { parseCourse } from "../src/inspect.ts";
import { languageView, lengthReference, renderSentences, renderWords } from "../src/language.ts";
import { SECTIONS } from "../src/sections.ts";

const course = parseCourse(JSON.stringify({
	ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0",
	course: { title: "Language filters", locale: "en" },
	lessons: ["The XYZ answer is recorded with flibbertigibbet.", "The Xylophone Yellow Zebra (XYZ) answer is recorded with flibbertigibbet."].map((content, index) => ({
		file: `lesson-${index + 1}.prax`, title: `Lesson ${index + 1}`, sha256: "x",
		pages: [{ id: "p1", number: 1, title: "Page", blocks: [{ id: "b1", type: "text", line: 1, data: { content, narration: "The answer is recorded." } }] }],
	})),
}));
const view = languageView(course);
const html = renderSentences(view) + renderWords(view);
const tableBody = (label: string) => html.split(`aria-label="${label}"`)[1]?.split("</table>")[0]?.split("</thead>")[1] ?? "";

test("language lesson filters tag both rows of each screen/narration pair and every sentence", () => {
	for (const label of ["Sentences by length", "Text profile by lesson", "Sentence structure by lesson", "Word familiarity by lesson"]) {
		assert.deepEqual([...tableBody(label).matchAll(/<tr data-lesson="(\d+)" role="row">/g)].map((match) => match[1]), label === "Sentence structure by lesson" ? ["1", "1", "1", "2", "2", "2"] : ["1", "1", "2", "2"], label);
	}
	const longest = html.split('<ol class="longest">')[1]?.split("</ol>")[0] ?? "";
	assert.equal([...longest.matchAll(/<li data-lesson="[12]">/g)].length, view.longest.length);
	const review = [...html.matchAll(/<li id="([12])\.[^"]+" data-lesson="([12])">/g)];
	assert.equal(review.length, Object.values(view.flagged).flat().length);
	assert.ok(review.length > 0);
	for (const match of review) assert.equal(match[1], match[2]);
});

test("merged sentence views keep examples below their data and retire the separate view ids", () => {
	type Node = DefaultTreeAdapterMap["node"];
	const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
	const walk = (node: Node): Node[] => [node, ...children(node).flatMap(walk)];
	const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find((item) => item.name === name)?.value : undefined;
	const tag = (node: Node) => "tagName" in node ? node.tagName : "";
	const nodes = walk(parseFragment(renderSentences(view)));
	const length = nodes.find((node) => attr(node, "data-view") === "sentence-length")!;
	const longest = children(length).find((node) => attr(node, "class") === "longest")!;
	assert.ok(longest, "one shared example list stays visible in both modes");
	for (const mode of ["mode-chart", "mode-table"]) {
		const panel = children(length).find((node) => attr(node, "class") === mode)!;
		assert.ok(panel);
		assert.ok(children(length).indexOf(panel) < children(length).indexOf(longest));
	}
	assert.equal(children(longest).filter((node) => tag(node) === "li").length, view.longest.length);
	const structure = nodes.find((node) => attr(node, "data-view") === "structure")!;
	const tableRegion = walk(structure).find((node) => attr(node, "aria-label") === "Sentence structure by lesson")!;
	assert.equal(attr(tableRegion, "tabindex"), "0");
	assert.equal(attr(tableRegion, "role"), "region");
	assert.equal(walk(structure).filter((node) => tag(node) === "tbody").length, 2, "each lesson has its own row group");
	const rows = walk(structure).filter((node) => tag(node) === "tr" && attr(node, "data-lesson"));
	for (const lesson of [1, 2]) {
		const lessonRows = rows.filter((node) => attr(node, "data-lesson") === String(lesson));
		assert.equal(lessonRows.length, 3, "two channel rows followed by the lesson's examples");
		const examples = walk(lessonRows[2]!);
		const disclosures = examples.filter((node) => tag(node) === "details");
		assert.ok(disclosures.length);
		for (const disclosure of disclosures) assert.equal(attr(disclosure, "open"), undefined);
		assert.deepEqual(examples.filter((node) => tag(node) === "li").map((node) => attr(node, "id")), view.flagged.passive.filter((sentence) => sentence.lesson === lesson).map((sentence) => sentence.id));
	}
	assert.match(renderSentences(view), /<summary>Possible passive patterns · 2<\/summary>/);
	const french = renderSentences(languageView({ ...course, course: { ...course.course, locale: "fr" } }));
	assert.match(french, /Sentence examples need English/);
	assert.match(french, /<td class="num" role="cell" data-label="Sentences">1<\/td><td colspan="5" role="cell">Not measured for this language/);
	assert.doesNotMatch(french, /<details class="review-group">/);
	assert.match(french, /<ol class="longest">/);
	for (const id of ["review", "longest"]) {
		assert.equal(isViewId(id), false);
		assert.equal(Object.hasOwn(GUIDES, id), false);
		assert.ok(SECTIONS.every((section) => section.views.every((view) => view.id !== id)));
		assert.ok(nodes.every((node) => attr(node, "data-view") !== id));
	}
});

test("language rows retain all known lessons for rare words and acronym source pointers", () => {
	assert.match(tableBody("Rare words"), /<tr data-lessons="1 2" role="row"><th scope="row" role="rowheader" data-label="Word">flibbertigibbet<\/th>/);
	assert.match(tableBody("Acronyms"), /<tr data-lessons="1 2" role="row"><th scope="row" role="rowheader" data-label="Acronym">XYZ<\/th>/);
});

test("word familiarity keeps Zipf values and frequency thresholds inside method disclosures", () => {
	const outsideMethods = html.replace(/<details class="method">[\s\S]*?<\/details>/g, "");
	assert.doesNotMatch(outsideMethods, /Zipf|per million|in a million/);
	assert.match(outsideMethods, /Uncommon per 1,000 words/);
	assert.match(outsideMethods, /Rare per 1,000 words/);
	assert.match(html, /uncommon means Zipf 3 to below 4/);
	assert.match(html, /rare means below Zipf 3/);
	assert.ok(view.vocabulary?.rare.some((word) => typeof word.zipf === "number" || word.zipf === null));
});


test("sentence length plots the reference inside a shared scale, including references above 30 words", () => {
	for (const lengths of [[1, 1, 1, 60], [30, 30], []]) {
		const sample = structuredClone(view);
		for (const lesson of sample.lessons) for (const channel of ["screen", "narration"] as const) lesson.channels[channel].lengths = [];
		sample.lessons[0]!.channels.screen.lengths = lengths;
		const rendered = renderSentences(sample);
		const reference = lengthReference(sample);
		const match = rendered.match(/<line class="reference" x1="([\d.]+)"/);
		if (reference === null) {
			assert.equal(match, null);
			assert.match(rendered, /There are no sentences to plot/);
			continue;
		}
		const cap = Math.max(30, (Math.floor(reference / 5) + 1) * 5);
		assert.ok(match);
		assert.equal(Number(match[1]), 260 + reference / cap * 560);
		assert.ok(Number(match[1]) < 820);
		assert.ok(rendered.includes(`>${cap}+</text>`));
		assert.ok(rendered.includes(`Sentences of ${cap} words or more sit at ${cap}+`));
	}
});

test("a rare plural joins its rare singular, summing uses, and a lone plural stays as written", () => {
	const plurals = languageView(parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0",
		course: { title: "Plurals", locale: "en" },
		lessons: [{ file: "a.prax", title: "A", sha256: "x", pages: [{ id: "p1", number: 1, title: "Page", blocks: [
			{ id: "b1", type: "text", line: 1, data: { content: "One flibbertigibbet waited. Two flibbertigibbets left. Three quokkas slept." } },
		] }] }],
	})));
	const rare = plurals.vocabulary?.rare ?? [];
	const joined = rare.find((word) => word.word === "flibbertigibbet");
	assert.deepEqual(joined?.forms, ["flibbertigibbet", "flibbertigibbets"]);
	assert.equal(joined?.uses, 2);
	assert.ok(!rare.some((word) => word.word === "flibbertigibbets"));
	assert.ok(rare.some((word) => word.word === "quokkas" && !word.forms));
});
