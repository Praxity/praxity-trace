import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { anatomy } from "../src/anatomy.ts";
import { locateBlocks } from "../src/places.ts";
import { readHtmlCourse } from "../src/html.ts";
import { courseHash, parseCourse } from "../src/inspect.ts";
import { languageView } from "../src/language.ts";

const fixtures = resolve(import.meta.dirname, "fixtures/html");
const run = promisify(execFile);

test("Studio export keeps pages, source pointers, authored narration and assessment data", async () => {
	const course = await readHtmlCourse(join(fixtures, "studio"));
	assert.equal(course.schema, "praxity-html/0");
	assert.deepEqual(course.course, { title: "Synthetic course", locale: "en" });
	assert.deepEqual(course.lessons.map((lesson) => [lesson.file, lesson.pages.length]), [["lesson-one.html", 2], ["lesson-two.html", 1]]);
	assert.deepEqual(course.lessons[0]?.pages.map((page) => page.title), ["Opening", "Practice"]);
	assert.deepEqual(course.lessons[0]?.pages[0]?.blocks.map((block) => block.type), ["heading", "text"]);
	assert.equal(course.lessons[0]?.pages[0]?.blocks[0]?.line, 6);
	assert.equal(course.lessons[0]?.pages[0]?.blocks[0]?.id, "h1");
	assert.match(String(course.lessons[0]?.pages[0]?.blocks[1]?.data.content), /A short note/);
	assert.doesNotMatch(String(course.lessons[0]?.pages[0]?.blocks[1]?.data.content), /Hidden definition/);
	assert.equal(course.lessons[0]?.pages[0]?.blocks[0]?.data.narration, undefined);
	assert.equal(course.lessons[0]?.pages[0]?.blocks[1]?.data.narration, "Read this note aloud.");
	assert.equal(course.lessons[0]?.pages[1]?.blocks[0]?.data.question, "Choose one.");
	assert.deepEqual(course.lessons[0]?.pages[1]?.blocks[0]?.data.options, [{ text: "Yes", correct: true }, { text: "No", correct: false }]);
	assert.deepEqual(locateBlocks(course).map((item) => item.ref), ["1.1.1", "1.1.2", "1.2.1", "2.1.1.1"]);
	assert.ok(course.lessons.every((lesson) => /^[0-9a-f]{64}$/.test(lesson.sha256)));
	assert.equal(anatomy(course).lessons[0]?.counts.response, 1);
	assert.equal(courseHash(course), courseHash(await readHtmlCourse(join(fixtures, "studio"))));
});

test("SCORM manifest sets lesson order and semantic HTML becomes blocks", async () => {
	const course = await readHtmlCourse(join(fixtures, "scorm"));
	assert.deepEqual(course.lessons.map((lesson) => lesson.file), ["second.html", "first.html"]);
	assert.equal(course.course.locale, "fr");
	assert.deepEqual(course.lessons[0]?.pages[0]?.blocks.map((block) => block.type), ["heading", "video", "assessment"]);
	assert.equal(course.lessons[0]?.pages[0]?.blocks[1]?.data.narration, undefined);
	assert.deepEqual(course.lessons[0]?.pages[0]?.blocks[1]?.data.transcripts, [{ text: "A caption sentence.", origin: "caption-track", kind: "video" }]);
	assert.deepEqual(course.lessons[1]?.pages.map((page) => page.title), ["Start", "Second topic"]);
	assert.deepEqual(course.lessons[1]?.pages.flatMap((page) => page.blocks.map((block) => block.type)), ["heading", "text", "text", "heading", "table"]);
	assert.equal(new Set(course.lessons[1]?.pages.flatMap((page) => page.blocks.map((block) => block.id))).size, 5);
	assert.ok(!JSON.stringify(course).includes("Hidden copy"));
	assert.ok(!JSON.stringify(course).includes("Navigation copy"));
});

test("script-only HTML fails with the player limitation", async () => {
	await assert.rejects(readHtmlCourse(join(fixtures, "script-only")), /No readable course content.*Scripted players.*JavaScript/);
});

test("report and prepare accept an HTML directory through the CLI", async () => {
	const output = await mkdtemp(join(tmpdir(), "praxity-html-test-"));
	try {
		const input = join(fixtures, "studio");
		await run(process.execPath, ["src/cli.ts", "report", input, "--out", join(output, "report")], { cwd: resolve(import.meta.dirname, "..") });
		assert.ok((await stat(join(output, "report", "report.html"))).size > 0);
		const html = await readFile(join(output, "report", "report.html"), "utf8");
		assert.match(html, /Tabler/);
		assert.match(html, /Permission is hereby granted/);
		assert.match(html, /Copyright \(c\) 2020-2026 Paweł Kuna/);
		assert.match(html, /SOFTWARE\.\n-->/);
		const report = JSON.parse(await readFile(join(output, "report", "report.json"), "utf8"));
		assert.equal(report.source.schema, "praxity-html/0");
		await run(process.execPath, ["src/cli.ts", "prepare", "concepts", input, "--out", join(output, "bundle")], { cwd: resolve(import.meta.dirname, "..") });
		assert.equal(JSON.parse(await readFile(join(output, "bundle", "manifest.json"), "utf8")).courseHash, report.courseHash);
	} finally { await rm(output, { recursive: true, force: true }); }
});

test("Studio page layout groups one file per page into lessons in course order, with page narration", async () => {
	const course = await readHtmlCourse(join(fixtures, "studio-pages"));
	assert.equal(course.course.title, "Paged course");
	assert.deepEqual(course.lessons.map((lesson) => [lesson.title, lesson.pages.map((page) => page.title)]), [["Lesson one", ["First", "Second"]], ["Lesson two", ["Third"]]]);
	assert.equal(course.lessons[0]?.pages[0]?.blocks[0]?.data.narration, "Welcome to the first page.");
	assert.equal(languageView(course).lessons[0]?.channels.narration.sentences, 1);
});

test("inspect page narration is read even when the page opens with a heading", () => {
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0", course: { title: "C", locale: "en" },
		lessons: [{ file: "a.prax", title: "A", sha256: "x", pages: [{ id: "p1", number: 1, title: "P", data: { narration: "Watch the walkthrough. Then try it." },
			blocks: [{ id: "h", type: "heading", line: 1, data: { content: "<p>Walkthrough</p>" } }] }] }],
	}));
	assert.equal(languageView(course).lessons[0]?.channels.narration.sentences, 2);
	assert.equal(languageView(course).lessons[0]?.channels.screen.sentences, 0);
});

test("the course index numbers lessons, keys pages, flags credit pages and places column children", async () => {
	const { indexCourse, pageKey } = await import("../src/places.ts");
	const { parseCourse } = await import("../src/inspect.ts");
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0", course: { title: "Index", locale: "en" },
		lessons: [
			{ file: "a.prax", title: "A", sha256: "x", pages: [{ id: "p1", number: 1, title: "Start", blocks: [{ id: "t", type: "text", line: 1, data: { content: "Hi" } }] }] },
			{ file: "b.prax", title: "B", sha256: "y", pages: [
				{ id: "p2", number: 9, title: "Two columns", blocks: [{ id: "c", type: "columns", line: 4, data: { items: [{ children: [{ id: "l", type: "text", data: { content: "Left" } }] }, { children: [{ id: "r", type: "image", data: {} }] }] } }] },
				{ id: "p3", number: 10, title: "Sources", blocks: [{ id: "s", type: "text", line: 9, data: { content: "Cited" } }] },
			] },
		],
	}));
	const index = indexCourse(course);
	assert.equal(indexCourse(course), index);
	assert.deepEqual(index.blocks.map((item) => [item.ref, item.lessonNumber, pageKey(item.lessonNumber, item.page), item.position, item.credit, item.block.line]), [
		["1.1.1", 1, "1.1", 0, false, 1],
		["2.9.1.1", 2, "2.9", 1, false, 4],
		["2.9.1.2", 2, "2.9", 2, false, 4],
		["2.10.1", 2, "2.10", 3, true, 9],
	]);
	assert.equal(index.lessonNumber("b.prax"), 2);
	assert.equal(index.lessonNumber("missing.prax"), 0);
	assert.equal(index.page(2, 10)?.title, "Sources");
	assert.deepEqual(index.axis.lessons.map((lesson) => lesson.start), [0, 1]);
});
