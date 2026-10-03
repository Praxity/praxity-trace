import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { GUIDES, isViewId } from "../src/guides.ts";
import { readHtmlCourse } from "../src/html.ts";
import { parseCourse, type Course } from "../src/inspect.ts";
import { LANGUAGE_STYLE, languageView, lengthReference, renderSentences, renderWords, sentences } from "../src/language.ts";
import { locateBlocks } from "../src/places.ts";
import { SECTIONS } from "../src/sections.ts";
import { blockTexts, narrations, narrationText, visibleStrings, wordCount } from "../src/text.ts";

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

/** Each row of one lesson in a rendered table, as the text of its cells. */
const lessonRows = (rendered: string, label: string, lesson: number) =>
	[...(rendered.split(`aria-label="${label}"`)[1]?.split("</table>")[0] ?? "").matchAll(new RegExp(`<tr data-lesson="${lesson}" role="row">([\\s\\S]*?)</tr>`, "g"))]
		.map((row) => [...(row[1] ?? "").matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => (cell[1] ?? "").replace(/<[^>]+>/g, "").trim()))
		.filter((cells) => cells.length > 1);
const lantern = parseCourse(readFileSync(new URL("./fixtures/lantern-marsh/inspect.json", import.meta.url), "utf8"));

test("paragraph breaks end sentences, while wrapped prose stays one sentence", () => {
	for (const newline of ["\n", "\r\n", "\r"]) {
		assert.deepEqual(sentences(`Keep the${newline}panel steady${newline} \t${newline}Read the ledger`), ["Keep the panel steady", "Read the ledger"]);
	}
	assert.deepEqual(sentences("<p>Keep the\n\npanel steady</p>"), ["Keep the panel steady"]);
});

test("Lantern Marsh 7.3 derived narration keeps the prompt and each option as a sentence", () => {
	const copy = structuredClone(lantern);
	const choice = locateBlocks(copy).find(item => item.block.data.typedNarrations && narrations(item.block.data).some(script => script.script.startsWith("What should your first new entry describe?")))!;
	const expected = [
		"What should your first new entry describe?",
		"Whether the panel stays or slips after release",
		"Why the earlier keeper missed the fault",
		"The name of the failed fastening",
	];
	const source = readFileSync(new URL("./fixtures/lantern-marsh/source/07-repair.prax", import.meta.url), "utf8");
	for (const text of expected) assert.ok(source.includes(text));
	assert.equal(choice.lessonNumber, 7);
	assert.equal(choice.page, 3);
	assert.deepEqual(sentences(narrationText(narrations(choice.block.data)[0]!)), expected);
	// The final label has six words: The / name / of / the / failed / fastening.
	assert.deepEqual(expected.map(wordCount), [7, 8, 7, 6]);
	for (const lesson of copy.lessons) for (const page of lesson.pages) page.blocks = page.blocks.filter(block => block.ref === choice.block.ref);
	assert.deepEqual(languageView(structuredClone(copy)).longest.toSorted((a, b) => a.id.localeCompare(b.id)).map(({ id, text, words }) => ({ id, text, words })), expected.map((text, i) => ({ id: `7.3.n${i + 1}`, text, words: [7, 8, 7, 6][i] })));
	const measured = languageView(lantern);
	assert.ok(measured.longest.some(sentence => sentence.channel === "narration"));
	assert.ok(measured.longest.every(sentence => !sentence.text.includes("release Why") && !sentence.text.includes("fault The name")));
});

test("sidecar narration keeps paragraph boundaries through the shared text interface", () => {
	const copy = structuredClone(lantern);
	for (const item of locateBlocks(copy)) item.block.data.typedNarrations = [];
	const block = copy.lessons[0]!.pages[0]!.blocks[0]!;
	const sidecar = lantern.lessons[0]!.narration!.find(script => script.origin === "sidecar" && !script.disabled)!;
	block.data.typedNarrations = [{ ...sidecar, value: "Keep the\npanel steady\n\nRead the ledger" }];
	assert.deepEqual(languageView(copy).lessons[0]!.channels.narration.lengths, [3, 4]);
	assert.deepEqual(blockTexts(block).narration, ["Keep the panel steady Read the ledger"]);
});

test("screen fields keep list items, headings, options, table cells and card titles separate in both schemas", () => {
	const labels = ["Keep the panel steady", "Read the ledger", "Check the keeper", "Station name", "Latest signal"];
	const legacy = { content: "<h2>Keep the panel steady</h2><ul><li>Read the ledger</li><li>Check the keeper</li></ul><table><tr><th>Station name</th><th>Latest signal</th></tr></table>", options: [{ text: "First choice" }, { text: "Second choice" }], items: [{ title: "First card", content: "First body" }, { title: "Second card", content: "Second body" }] };
	const expected = [...labels, "First choice", "Second choice", "First card", "First body", "Second card", "Second body"];
	const typed = { typedTexts: expected.map((value, i) => ({ ref: `text/${i}`, role: i === 0 || i === 7 || i === 9 ? "heading" : i === 5 || i === 6 ? "option" : "body", value, format: "plain", location: null })) };
	for (const data of [legacy, typed]) {
		assert.deepEqual(visibleStrings(data).flatMap(sentences), expected);
		const sample = structuredClone(course);
		sample.lessons = [sample.lessons[0]!];
		sample.lessons[0]!.pages[0]!.blocks[0]!.data = data;
		assert.deepEqual(languageView(sample).lessons[0]!.channels.screen.lengths, [2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 4]);
	}
	for (const format of ["plain", "markdown", "html"]) {
		const data = { typedTexts: [{ ref: "text/1", role: "body", value: "Keep the\n\npanel steady", format, location: null }] };
		assert.deepEqual(visibleStrings(data).flatMap(sentences), format === "html" ? ["Keep the panel steady"] : ["Keep the", "panel steady"]);
	}
});

test("authored plain and Markdown transcript paragraphs end sentences in both schemas", () => {
	for (const format of ["plain", "markdown"] as const) {
		const sample = retranscribed(null);
		locateBlocks(sample).find(item => item.ref === "4.2.2")!.block.media![0]!.transcript = { value: "Keep the\npanel steady\n\nRead the ledger", format };
		assert.deepEqual(languageView(sample).lessons[3]!.channels.transcript!.lengths, [3, 4]);
	}
	const legacy = structuredClone(course);
	legacy.lessons[0]!.pages[0]!.blocks[0]!.data = { transcript: "Keep the\npanel steady\n\nRead the ledger" };
	assert.deepEqual(languageView(legacy).lessons[0]!.channels.transcript!.lengths, [3, 4]);
});

test("HTML exports keep structural screen items and narration segments separate, but join VTT cue prose", async () => {
	const dir = await mkdtemp(join(tmpdir(), "trace-sentence-breaks-"));
	try {
		await writeFile(join(dir, "captions.vtt"), "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nKeep the\npanel\n\n00:00:01.000 --> 00:00:02.000\nsteady until release.\n");
		await writeFile(join(dir, "index.html"), '<main><p>Keep the\n\npanel steady</p><ul><li>Keep the panel steady</li><li>Read the ledger</li></ul><video><track kind="captions" src="captions.vtt"></video></main>');
		const ordinary = languageView(await readHtmlCourse(dir)).lessons[0]!.channels;
		assert.deepEqual(ordinary.screen.lengths, [3, 4, 4]);
		assert.deepEqual(ordinary.transcript!.lengths, [6]);
		await writeFile(join(dir, "index.html"), `<script id="praxity-config" type="application/json">${JSON.stringify({ deckPages: [{ id: "p1", segments: [{ blockId: "b1", script: "Keep the panel steady" }, { blockId: "b1", script: "Read the ledger" }] }] })}</script><main><article class="deck-slide" data-deck-slide="p1"><div data-block-id="b1" data-block-type="text"><h2>Keep the panel steady</h2><ul><li>Read the ledger</li></ul><table><tr><th>Station name</th><th>Latest signal</th><td>First cell</td><td>Second cell</td></tr></table></div></article></main>`);
		const deck = languageView(await readHtmlCourse(dir)).lessons[0]!.channels;
		assert.deepEqual(deck.screen.lengths, [2, 2, 2, 2, 3, 4]);
		assert.deepEqual(deck.narration.lengths, [3, 4]);
		await writeFile(join(dir, "index.html"), '<main><article class="deck-slide"><div data-block-id="b1" data-block-type="text">Keep the\n\npanel steady</div></article></main>');
		assert.deepEqual(languageView(await readHtmlCourse(dir)).lessons[0]!.channels.screen.lengths, [4]);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
/** Lantern Marsh with every media transcript set to `value`, or removed when null. */
const retranscribed = (value: string | null): Course => {
	const copy = structuredClone(lantern);
	for (const item of locateBlocks(copy)) for (const media of item.block.media ?? []) media.transcript = value === null ? null : { value, format: "plain" };
	return copy;
};

test("courses without transcript text keep two channels and the earlier wording", () => {
	assert.deepEqual(Object.keys(view.lessons[0]!.channels), ["screen", "narration"]);
	assert.deepEqual(Object.keys(view.vocabulary!.lessons[0]!), ["screen", "narration"]);
	// The sentence-length guide already suggests a transcript; it is shared advice, not a transcript measure.
	assert.doesNotMatch(html.replace(/<details class="method guide">[\s\S]*?<\/details>/g, ""), /transcript/i);
	for (const text of [
		"On-screen text and narration are measured separately.",
		"It includes on-screen and narration sentences. The examples list up to 12 longest sentences across the course; identical on-screen and narration text on the same page appears once.",
		"n means narration. Lists combine on-screen and narration sentences, so their counts sum both channels.",
		"Shared words: adjacent sentences on the same page, on screen or in narration, that share",
		"Runs of two to six capital letters, on screen, in tooltips and in narration.",
		'aria-label="Sentence lengths in words for each lesson, on screen and in narration."',
		'height="108"',
		"How long are the sentences, on screen and in narration?",
		"sentences (dot area)",
	]) assert.ok(html.includes(text), text);
	assert.doesNotMatch(html, /<rect class="sentence/);
	assert.equal(lessonRows(html, "Sentences by length", 1).length, 2);
	// A blank transcript is no transcript.
	assert.equal(languageView(retranscribed("  ")).lessons[3]!.channels.transcript, undefined);
});

test("Lantern Marsh media transcripts form a third channel, measured like narration, and leave the other channels unchanged", () => {
	const measured = languageView(lantern);
	const plain = languageView(retranscribed(null));
	// L4: "A short high tone sounds. A quiet gap follows. A second short high tone sounds. No speech is present."
	assert.deepEqual(measured.lessons[3]!.channels.transcript, { ...measured.lessons[3]!.channels.transcript!, sentences: 4, words: 19, lengths: [4, 4, 5, 6], medianLength: 5 });
	// L6: "An amber panel moves from the left edge towards a white lantern disc. It stops halfway across the disc. The final state is amber. No speech is present."
	assert.deepEqual(measured.lessons[5]!.channels.transcript, { ...measured.lessons[5]!.channels.transcript!, sentences: 4, words: 28, lengths: [4, 5, 6, 13], medianLength: 6 });
	assert.deepEqual(measured.lessons.map((lesson) => lesson.channels.transcript?.sentences), [0, 0, 0, 4, 0, 4, 0, 0, 0]);
	measured.lessons.forEach((lesson, index) => {
		assert.deepEqual(lesson.channels.screen, plain.lessons[index]!.channels.screen);
		assert.deepEqual(lesson.channels.narration, plain.lessons[index]!.channels.narration);
		assert.deepEqual(measured.vocabulary!.lessons[index]!.screen, plain.vocabulary!.lessons[index]!.screen);
		assert.deepEqual(measured.vocabulary!.lessons[index]!.narration, plain.vocabulary!.lessons[index]!.narration);
	});
	// Amber twice and lantern once sit between Zipf 3 and 4.
	assert.deepEqual(measured.vocabulary!.lessons[5]!.transcript, { words: 28, lessCommon: 3, rare: 0 });
	assert.deepEqual(measured.vocabulary!.lessons[3]!.transcript, { words: 19, lessCommon: 0, rare: 0 });
});

test("Lantern Marsh transcript rows appear in every language table and in the sentence-length chart", () => {
	const measured = languageView(lantern);
	const rendered = renderSentences(measured) + renderWords(measured);
	assert.deepEqual(lessonRows(rendered, "Sentences by length", 4).map((row) => row.at(-8)), ["On screen", "Narration", "Transcript"]);
	assert.deepEqual(lessonRows(rendered, "Sentences by length", 1).map((row) => row.at(-8)), ["On screen", "Narration", "Transcript"]);
	assert.deepEqual(lessonRows(rendered, "Sentences by length", 4)[2], ["Transcript", "4", "4", "0", "0", "0", "5", "6"]);
	assert.deepEqual(lessonRows(rendered, "Sentences by length", 6)[2], ["Transcript", "4", "3", "1", "0", "0", "6", "13"]);
	assert.deepEqual(lessonRows(rendered, "Text profile by lesson", 4)[2], ["Transcript", "19", "5", "0", "–", "–", "–", "–", "–"]);
	assert.deepEqual(lessonRows(rendered, "Sentence structure by lesson", 4)[2], ["Transcript", "4", "0", "0", "0", "0", "0"]);
	assert.deepEqual(lessonRows(rendered, "Word familiarity by lesson", 6)[2], ["Transcript", "28", "107", "0"]);
	for (const label of ["Sentences by length", "Text profile by lesson", "Word familiarity by lesson"]) {
		const body = rendered.split(`aria-label="${label}"`)[1]!.split("</table>")[0]!;
		assert.equal([...body.matchAll(/<th scope="rowgroup" rowspan="3"/g)].length, 9, label);
	}
	assert.equal([...rendered.matchAll(/<td class="num" rowspan="3" role="cell" data-label="Distinct rare words">/g)].length, 9);
	const chart = rendered.split('aria-label="Sentence lengths by lesson"')[1]!.split("</svg>")[0]!;
	assert.match(chart, /height="568"/);
	assert.match(chart, /aria-label="Sentence lengths in words for each lesson, on screen, in narration and in transcripts\."/);
	const lessonFour = [...chart.matchAll(/<g data-lesson="4">([\s\S]*?)<\/g>/g)].map((group) => group[1]!);
	assert.equal(lessonFour.length, 3);
	assert.match(lessonFour[2]!, />Transcript<\/text>/);
	// A filled square with the area of the circle for the same count, centred on the length: side = √π × radius.
	const squares = (group: string) => [...group.matchAll(/<rect class="sentence transcript" ([^>]*)><title>([^<]+)<\/title><\/rect>/g)].map((match) => `${match[1]} ${match[2]}`);
	assert.deepEqual(squares(lessonFour[2]!), [
		'x="331.9" y="247.2" width="5.5" height="5.5" 2 sentences of 4 words',
		'x="351.4" y="248.1" width="3.9" height="3.9" 1 sentence of 5 words',
		'x="370.1" y="248.1" width="3.9" height="3.9" 1 sentence of 6 words',
	]);
	const lessonSix = [...chart.matchAll(/<g data-lesson="6">([\s\S]*?)<\/g>/g)].map((group) => group[1]!);
	assert.deepEqual(squares(lessonSix[2]!), [
		'x="332.7" y="368.1" width="3.9" height="3.9" 1 sentence of 4 words',
		'x="351.4" y="368.1" width="3.9" height="3.9" 1 sentence of 5 words',
		'x="370.1" y="368.1" width="3.9" height="3.9" 1 sentence of 6 words',
		'x="500.7" y="368.1" width="3.9" height="3.9" 1 sentence of 13 words',
	]);
	assert.doesNotMatch(chart, /<circle class="sentence transcript"/);
	assert.match(lessonFour[2]!, /<title>Median 5 words<\/title>/);
	assert.match(rendered, /<span class="key sentence-transcript"><\/span>Transcript<\/span>/);
	// Filled dark grey, never the orange reserved for things to look at, nor the narration blue.
	assert.match(LANGUAGE_STYLE, /svg \.sentence\.transcript\{fill:var\(--ink\)\}/);
	assert.match(LANGUAGE_STYLE, /\.key\.sentence-transcript\{background:var\(--ink\);width:7px;height:7px\}/);
	assert.doesNotMatch(LANGUAGE_STYLE.split("\n").flatMap((line) => line.split("}")).filter((rule) => rule.includes("transcript")).join("}"), /--look|--accent/);
	for (const text of [
		"On-screen text, narration and transcripts are measured separately.",
		"They follow the same counting rules as narration and stay a separate channel.",
		"Caption cue boundaries and line wraps do not end a sentence, because one sentence can span several cues.",
		"Trace does not time them, because it has no playback length for the media.",
		"Studio's inspect output does not include caption track contents",
		"It includes on-screen, narration and transcript sentences.",
		"n means narration and t a transcript.",
		"on screen, in tooltips, in narration and in transcripts.",
		"How long are the sentences, on screen, in narration and in transcripts?",
		"sentences (mark area)",
	]) assert.ok(rendered.includes(text), text);
	assert.doesNotMatch(rendered, /on screen and in narration\?|dot area/);
});

test("transcript sentences carry t ids and the media block as their source pointer in review lists, rare words and acronyms", () => {
	const course = retranscribed(null);
	locateBlocks(course).find((item) => item.ref === "4.2.2")!.block.media![0]!.transcript = { value: "The gauge was checked by a flibbertigibbet near the XQZ post. No speech is present.", format: "plain" };
	const measured = languageView(course);
	const passive = measured.flagged.passive.find((sentence) => sentence.channel === "transcript");
	assert.deepEqual(passive && { id: passive.id, ref: passive.ref, lesson: passive.lesson, page: passive.page, text: passive.text, words: passive.words }, { id: "4.2.t1", ref: "4.2.2", lesson: 4, page: 2, text: "The gauge was checked by a flibbertigibbet near the XQZ post.", words: 11 });
	assert.deepEqual({ file: measured.places["4.2.2"]!.file, line: measured.places["4.2.2"]!.line }, { file: "04-bells.prax", line: 18 });
	const rare = measured.vocabulary!.rare.find((word) => word.word === "flibbertigibbet");
	assert.deepEqual(rare && { firstUse: rare.firstUse, ref: rare.ref, lessons: rare.lessons }, { firstUse: "4.2.t1", ref: "4.2.2", lessons: [4] });
	assert.deepEqual(measured.acronyms.find((item) => item.acronym === "XQZ"), { acronym: "XQZ", uses: 1, firstUse: "4.2.2", expandedAt: null, usedBeforeExpansion: true });
	assert.match(renderSentences(measured), /<li id="4\.2\.t1" data-lesson="4"><q>The gauge <mark>was<\/mark> <mark>checked<\/mark> by a flibbertigibbet near the XQZ post\.<\/q> <span class="file"><code>4\.2\.t1<\/code> · transcript · /);
});

test("caption track text from exported HTML is a transcript, not narration", async () => {
	const scorm = languageView(await readHtmlCourse(fileURLToPath(new URL("./fixtures/html/scorm", import.meta.url))));
	assert.deepEqual(scorm.lessons[0]!.channels.transcript, { ...scorm.lessons[0]!.channels.transcript!, sentences: 1, words: 3, lengths: [3] });
	assert.equal(scorm.lessons[0]!.channels.narration.words, 0);
	assert.equal(scorm.lessons[1]!.channels.transcript!.sentences, 0);
	const caption = scorm.longest.find((sentence) => sentence.channel === "transcript");
	assert.deepEqual(caption && { id: caption.id, ref: caption.ref, text: caption.text }, { id: "1.1.t1", ref: "1.1.2", text: "A caption sentence." });
	assert.deepEqual(lessonRows(renderSentences(scorm), "Sentences by length", 1)[2], ["Transcript", "1", "1", "0", "0", "0", "3", "3"]);
});

test("a transcript square sits above the median halo at the same length, so a lone sentence stays visible", async () => {
	const scorm = languageView(await readHtmlCourse(fileURLToPath(new URL("./fixtures/html/scorm", import.meta.url))));
	const chart = renderSentences(scorm).split('aria-label="Sentence lengths by lesson"')[1]!.split("</svg>")[0]!;
	const row = [...chart.matchAll(/<g data-lesson="1">([\s\S]*?)<\/g>/g)].map((group) => group[1]!)[2]!;
	assert.match(row, />Transcript<\/text>/);
	// Halo, then median line, then the square: the 6px halo would otherwise paint over the 3.9px square at the same x.
	const marks = [...row.matchAll(/<(line|rect) class="([^"]+)"[^>]*>(?:<title>([^<]+)<\/title>)?/g)].map((match) => `${match[2]}${match[3] ? ` ${match[3]}` : ""}`);
	assert.deepEqual(marks, ["median-halo", "median Median 3 words", "sentence transcript 1 sentence of 3 words"]);
	// Screen and narration rows keep their marks below the median.
	for (const lesson of [...chart.matchAll(/<g data-lesson="\d+">([\s\S]*?)<\/g>/g)].map((group) => group[1]!).filter((group) => !group.includes(">Transcript</text>") && group.includes("median-halo"))) {
		assert.ok(lesson.lastIndexOf("<circle") < lesson.indexOf("median-halo"), lesson);
	}
});

test("code in media transcripts stays out of vocabulary and acronyms", () => {
	for (const format of ["plain", "markdown", "html"] as const) {
		const code = format === "html" ? "Use <code>flibbertigibbet</code> and <code>XQZ</code>." : "Use `flibbertigibbet` and `XQZ`.";
		const sample = retranscribed(code);
		for (const item of locateBlocks(sample)) for (const media of item.block.media ?? []) if (media.transcript) media.transcript.format = format;
		const measured = languageView(sample);
		assert.equal(measured.vocabulary!.lessons[3]!.transcript!.words, 2, format);
		assert.ok(!measured.vocabulary!.rare.some((word) => word.word === "flibbertigibbet"), format);
		assert.ok(!measured.acronyms.some((item) => item.acronym === "XQZ"), format);
	}
});

test("nonblank transcript text without a sentence still adds an empty transcript channel", () => {
	const dots = languageView(retranscribed("..."));
	const plain = languageView(retranscribed(null));
	assert.deepEqual(dots.lessons.map((lesson) => lesson.channels.transcript?.sentences), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
	assert.deepEqual(dots.lessons[3]!.channels.transcript, { sentences: 0, words: 0, medianLength: null, p90Length: null, longWordShare: null, grade: null, lengths: [], structure: null, cohesion: { adjacentPairs: 0, overlapping: 0, causal: 0, contrastive: 0 } });
	assert.deepEqual(dots.vocabulary!.lessons[3]!.transcript, { words: 0, lessCommon: 0, rare: 0 });
	assert.deepEqual(dots.lessons.map((lesson) => ({ ...lesson, channels: { screen: lesson.channels.screen, narration: lesson.channels.narration } })), plain.lessons);
	const rendered = renderSentences(dots) + renderWords(dots);
	assert.deepEqual(lessonRows(rendered, "Sentences by length", 4)[2], ["Transcript", "0", "0", "0", "0", "0", "–", "–"]);
	assert.deepEqual(lessonRows(rendered, "Word familiarity by lesson", 4)[2], ["Transcript", "0", "0", "0"]);
	const chart = rendered.split('aria-label="Sentence lengths by lesson"')[1]!.split("</svg>")[0]!;
	assert.match(chart, /height="568"/);
	assert.doesNotMatch(chart, /<rect class="sentence/);
	assert.match(rendered, /<span class="key sentence-transcript"><\/span>Transcript<\/span>/);
});

test("HTML transcript paragraphs end sentences without punctuation", () => {
	const html = retranscribed(null);
	locateBlocks(html).find((item) => item.ref === "4.2.2")!.block.media![0]!.transcript = { value: "<p>Walk across the road</p><p>Watch the light</p>", format: "html" };
	const transcript = languageView(html).lessons[3]!.channels.transcript!;
	assert.deepEqual(transcript, { ...transcript, sentences: 2, words: 7, lengths: [3, 4] });
});

test("plain transcript angle brackets stay literal words in counts and source-pointed examples", () => {
	const plain = retranscribed(null);
	locateBlocks(plain).find((item) => item.ref === "4.2.2")!.block.media![0]!.transcript = { value: "The <signal> was shown.", format: "plain" };
	const measured = languageView(plain);
	assert.deepEqual(measured.lessons[3]!.channels.transcript, { ...measured.lessons[3]!.channels.transcript!, sentences: 1, words: 4, lengths: [4] });
	const pick = (sentence: { id: string; ref: string; text: string; words: number } | undefined) => sentence && { id: sentence.id, ref: sentence.ref, text: sentence.text, words: sentence.words };
	// "was shown" is a possible passive pattern, so the sentence is listed with its source pointer.
	assert.deepEqual(pick(measured.flagged.passive.find((sentence) => sentence.channel === "transcript")), { id: "4.2.t1", ref: "4.2.2", text: "The <signal> was shown.", words: 4 });
	assert.match(renderSentences(measured), /<li id="4\.2\.t1" data-lesson="4"><q>The &#60;signal&#62; <mark>was<\/mark> <mark>shown<\/mark>\.<\/q>/);
});
