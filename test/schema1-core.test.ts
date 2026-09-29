import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCourse, courseHash } from "../src/inspect.ts";
import { anatomy, isKnowledgeCheck } from "../src/anatomy.ts";
import { buildPlaces, indexCourse } from "../src/places.ts";
import { blockTexts, countWords, narrations, narrationText, visibleText, stripTags } from "../src/text.ts";
import { languageView } from "../src/language.ts";
import { courseText, readAnswer, readSpan } from "../src/bundle.ts";

const fixture = () => JSON.parse(readFileSync(new URL("fixtures/examples.schema1.inspect.json", import.meta.url), "utf8"));

test("schema 1 validates references, format and source ranges without parsing opaque refs", () => {
	for (const mutate of [
		(raw: any) => { raw.lessons[0].pages[0].blocks[1].ref = raw.lessons[0].pages[0].blocks[0].ref; },
		(raw: any) => { raw.lessons[0].pages[0].blocks[0].parentRef = "missing"; },
		(raw: any) => { raw.lessons[0].pages[0].blocks[0].texts[0].format = "guess"; },
		(raw: any) => { raw.lessons[0].pages[0].blocks[0].location.endLine = 1; },
		(raw: any) => { raw.lessons[0].narration[0].pageRef = "missing"; },
		(raw: any) => { raw.lessons[0].narration[0].blockRef = "missing"; },
		(raw: any) => { raw.lessons[0].narration[0].disabled = "false"; },
		(raw: any) => { raw.lessons[0].pages[0].blocks[0].texts[0].value = 123; },
		(raw: any) => { raw.lessons[0].pages[0].blocks[0].texts[0].format = ["html"]; },
		(raw: any) => { raw.lessons[0].pages[0].blocks[0].coverage = ["text"]; },
		(raw: any) => { raw.lessons[1].file = raw.lessons[0].file; },
	]) { const raw = fixture(); mutate(raw); assert.throws(() => parseCourse(JSON.stringify(raw)), /Invalid inspect JSON/); }
	const course = parseCourse(JSON.stringify(fixture()));
	const block = course.lessons[0]!.pages[0]!.blocks[0]!;
	const found = indexCourse(course).sourceBlock(block.ref!)!;
	assert.equal(indexCourse(course), indexCourse(course));
	assert.equal(found.block, block);
	assert.deepEqual(buildPlaces(course, [found.ref])[found.ref]!.location, block.location);
	const raw = fixture(); raw.lessons[0].pages[0].blocks[0].id = "another transient id";
	assert.equal(courseHash(parseCourse(JSON.stringify(raw))), courseHash(course));
	raw.revision = "a".repeat(64);
	assert.notEqual(courseHash(parseCourse(JSON.stringify(raw))), courseHash(course));
});

test("typed text counts descendants once and respects plain, markdown, glossary and feedback roles", () => {
	const course = parseCourse(JSON.stringify(fixture()));
	const block = course.lessons[0]!.pages[0]!.blocks[0]!;
	const typed = (role: string, value: string, format = "plain") => ({ ref: role, role, value, format, location: null });
	block.data.typedTexts = [typed("body", "<tag> &lt; [pause]"), typed("body", "**bold** <tag> &amp;lt;", "markdown"), typed("body", "<p>un<em>broken</em> &eacute;</p><script>hidden</script>", "html"), typed("glossary-term", "term"), typed("glossary-definition", "<p>definition</p>", "html"), typed("feedback", "After answering")];
	// Tag boundaries read as spaces, as they always have, so quotes reviewers took from course.md stay valid.
	assert.deepEqual(visibleText(block.data).map((text) => text.replace(/\s+/g, " ").trim()), ["<tag> &lt; [pause]", "bold <tag> &lt;", "un broken é"]);
	assert.equal(countWords(block.data), 9); // "un broken" counts as two words, as tag boundaries always have
	assert.deepEqual(blockTexts(block).tooltips, [{ term: "term", text: "definition" }]);
	assert.ok(!blockTexts(block).screen.includes("After answering"));
	const columns = course.lessons.flatMap(lesson => lesson.pages).flatMap(page => page.blocks).find(block => block.type === "columns");
	if (columns) assert.equal(indexCourse(course).blocks.filter(item => item.block.ref === columns.ref).length, 1);
});

test("typed narration is resolved once, disabled scripts stay out, and missing semantics are explicit", () => {
	const raw = fixture(); const page = raw.lessons[0].pages[0], block = page.blocks[0];
	raw.lessons[0].narration = [false, true].map((disabled, i) => ({ ref: `n-${i}`, role: "narration", value: "[pause] **literal**", format: "plain", blockRef: i ? null : block.ref, pageRef: page.ref, origin: "sidecar", disabled, location: null }));
	const course = parseCourse(JSON.stringify(raw)), parsed = course.lessons[0]!.pages[0]!.blocks[0]!;
	assert.deepEqual(narrations(parsed.data).map(narrationText), ["[pause] **literal**"]);
	const check = indexCourse(course).blocks.find(item => item.block.type === "assessment")!;
	assert.equal(isKnowledgeCheck(check.block), null);
	assert.equal(anatomy(course).lessons[0]!.pace[0]!.narrationDurationKnown, false);
	assert.match(courseText(course), /Correct answers and scoring: unknown/);
	assert.match(courseText(course), /"origin":"sidecar","disabled":true/);
});


test("flat nested containers count their own text once and opaque refs cannot shadow reviewer refs", () => {
	const raw = fixture(), page = raw.lessons[0].pages[0];
	const source = { file: raw.lessons[0].file, startLine: 1, endLine: 3 };
	const text = (ref: string, role: string, value: string) => ({ ref, role, value, format: "plain", location: source });
	page.blocks = [
		{ ref: "1.1.2", parentRef: null, id: "card", type: "card", coverage: "container", location: source, texts: [text("title", "heading", "Container title")] },
		{ ref: "opaque child", parentRef: "1.1.2", id: "child", type: "text", coverage: "text", location: source, texts: [text("body", "body", "Nested body words")] },
		{ ref: "choice", parentRef: "1.1.2", id: "choice", type: "assessment", coverage: "text", location: source, texts: [text("prompt", "prompt", "Choose one"), text("option", "option", "Option A"), text("feedback-a", "feedback", "Repeated feedback"), text("feedback-b", "feedback", "Repeated feedback")] },
	];
	raw.lessons = [{ ...raw.lessons[0], pages: [page], narration: [] }];
	const course = parseCourse(JSON.stringify(raw)), index = indexCourse(course);
	assert.equal(index.sourceBlock("1.1.2")!.block.id, "card");
	assert.equal(index.block("1.1.2")!.block.id, "child");
	assert.equal(index.blocks.length, 3);
	assert.equal(anatomy(course).lessons[0]!.words, 9);
	assert.equal(courseText(course).match(/Feedback: Repeated feedback/g)?.length, 1);
	assert.deepEqual(index.block("1.1.2")!.block.location, source);
});


test("page narration without content or on structural content remains reviewable and counted once", () => {
	for (const structural of [false, true]) {
		const raw = fixture(), page = raw.lessons[0].pages[0];
		page.blocks = structural ? [{ ...page.blocks[0], type: "divider", coverage: "unsupported", texts: [] }] : [];
		raw.lessons = [{ ...raw.lessons[0], pages: [page], narration: [false, true].map((disabled, i) => ({ ref: `page-narration-${i}`, role: "narration", value: disabled ? "Disabled words must stay out." : "Enabled page narration is counted once.", format: "plain", blockRef: null, pageRef: page.ref, origin: "sidecar", disabled, location: null })) }];
		const course = parseCourse(JSON.stringify(raw)), index = indexCourse(course), item = index.blocks[0]!;
		assert.equal(index.blocks.length, 1);
		if (!structural) assert.equal(item.block.ref, undefined);
		assert.deepEqual(blockTexts(item.block).narration, ["Enabled page narration is counted once."]);
		const bundle = courseText(course);
		assert.match(bundle, /\[1\.1\.1\]/);
		assert.match(bundle, /Narration: Enabled page narration is counted once\./);
		assert.doesNotMatch(bundle, /Disabled words must stay out/);
		assert.match(bundle, /"blockRef":null/);
		const answer = readAnswer(JSON.stringify({ view: "test", promptVersion: "test/1", courseHash: courseHash(course) }), course, "test", "test/1");
		assert.equal(answer.ref(item.ref, "ref"), "1.1.1");
		assert.equal(readSpan(answer, item.block, "Enabled page narration", "span", "narration", item.ref), "Enabled page narration");
		const language = languageView(course);
		assert.equal(language.lessons[0]!.channels.narration.words, 6);
		assert.equal(anatomy(course).lessons[0]!.pace[0]!.narrationSeconds, 6 / 150 * 60);
	}
});


test("every tag boundary separates words, block or inline, keeping earlier quotes stable", () => {
	assert.equal(stripTags("before<div>two</div>after<table><tr><td>left</td><td>right</td></tr></table>").replace(/\s+/g, " ").trim(), "before two after left right");
	assert.equal(stripTags("un<em>broken</em>").trim(), "un broken");
});
