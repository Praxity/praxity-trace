import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMENTS_SCRIPT, formatCommentsMarkdown, isSentenceId, parseComments, quoteContext, sourceFromTitle, type CommentsFile } from "../src/comments.ts";

const example: CommentsFile = {
	schema: "praxity-trace-comments/0",
	course: "A course",
	courseHash: "abc123",
	comments: [{
		id: "c1", created: "2026-09-25T12:00:00.000Z", updated: "2026-09-25T12:01:00.000Z",
		view: "alignment", heading: "Evidence by objective group",
		target: { label: "O3 · Analyze training data", page: { lesson: 3, page: 9 }, objectives: ["O3", "O11"], sentence: null, row: "O3, O11" },
		source: { file: "lesson-03.prax", line: 118 },
		quote: { exact: "training data", prefix: "Analyze ", suffix: " for harm" },
		note: "Keep O3 and O11 separate.",
	}],
};

const changed = (mutate: (value: CommentsFile) => void) => {
	const copy = structuredClone(example);
	mutate(copy);
	return JSON.stringify(copy);
};

test("parseComments accepts a complete file and rejects malformed or extra fields", () => {
	assert.deepEqual(parseComments(JSON.stringify(example)), example);
	assert.throws(() => parseComments("{"), /Invalid comments JSON/);
	assert.throws(() => parseComments(changed((file) => { file.schema = "other" as CommentsFile["schema"]; })));
	assert.throws(() => parseComments(changed((file) => { file.comments[0]!.target.page!.page = 0; })));
	assert.throws(() => parseComments(changed((file) => { file.comments[0]!.target.objectives = ["O3", "O3"]; })));
	assert.throws(() => parseComments(changed((file) => { file.comments[0]!.source!.line = -1; })));
	assert.throws(() => parseComments(changed((file) => { file.comments[0]!.quote!.prefix = "x".repeat(33); })));
	assert.throws(() => parseComments(changed((file) => { file.comments[0]!.created = "not a date"; })));
	assert.throws(() => parseComments(changed((file) => { (file.comments[0] as unknown as Record<string, unknown>).extra = true; })));
	assert.throws(() => parseComments(changed((file) => { file.comments.push(structuredClone(file.comments[0]!)); })));
});

test("Markdown keeps the course, location, quoted words and note together", () => {
	assert.equal(formatCommentsMarkdown(example),
		"# Comments on A course (abc123)\n\n" +
		"These are a designer's notes on a Praxity Trace report. They refer to the course through the pages and files given; page 3.9 is lesson 3, page 9.\n\n" +
		"1. Alignment › Evidence by objective group · O3, O11 · page 3.9 · lesson-03.prax:118\n" +
		"   Quote: “training data”\n   Note: Keep O3 and O11 separate.\n");
});

test("title source and quote context retain the exact source and 32 characters on either side", () => {
	assert.deepEqual(sourceFromTitle("Lesson title, page 9 · lesson-03.prax:118"), { file: "lesson-03.prax", line: 118 });
	assert.equal(sourceFromTitle("Lesson title, page 9 · lesson-03.prax"), null);
	assert.deepEqual(quoteContext("a".repeat(40) + "term" + "b".repeat(40), 40, 44),
		{ exact: "term", prefix: "a".repeat(32), suffix: "b".repeat(32) });
	assert.throws(() => quoteContext("abc", 2, 2));
});

test("browser script is plain JavaScript", () => {
	assert.doesNotThrow(() => new Function(COMMENTS_SCRIPT));
	assert.equal([...COMMENTS_SCRIPT.matchAll(/function formatCommentsMarkdown\(/g)].length, 1);
	const inlined = new Function("document", `${COMMENTS_SCRIPT}\nreturn formatCommentsMarkdown;`)(
		{ getElementById: () => null, querySelector: () => null },
	) as typeof formatCommentsMarkdown;
	assert.equal(inlined(example), formatCommentsMarkdown(example));
});

test("prepare --comments adds only that view's comments to the prompt", async () => {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join, resolve } = await import("node:path");
	const dir = await mkdtemp(join(tmpdir(), "trace-comments-"));
	try {
		const comment = (id: string, view: string, note: string) => ({ id, created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", view, heading: null, target: { label: null, page: null, objectives: ["O1"], sentence: null, row: null }, source: null, quote: null, note });
		await writeFile(join(dir, "comments.json"), JSON.stringify({ schema: "praxity-trace-comments/0", course: "C", courseHash: "old", comments: [comment("a", "alignment", "Keep O1 separate."), comment("b", "language", "Fine."), comment("c", "trace", "Split the trace group.")] }));
		const root = resolve(import.meta.dirname, "..");
		await promisify(execFile)(process.execPath, ["src/cli.ts", "prepare", "alignment", "test/fixtures/examples.inspect.json", "--out", join(dir, "bundle"), "--comments", join(dir, "comments.json")], { cwd: root });
		const prompt = await readFile(join(dir, "bundle", "prompt.md"), "utf8");
		assert.match(prompt, /## Designer comments/);
		assert.match(prompt, /Keep O1 separate\./);
		assert.match(prompt, /Split the trace group\./);
		assert.doesNotMatch(prompt, /Fine\./);
		assert.match(prompt, /earlier revision of the course/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a comment can point at an on-screen, narration or transcript sentence, and older saved ids still read", () => {
	for (const sentence of ["3.9.s2", "3.9.n1", "3.9.t2", "L3.p9.s2"]) {
		assert.equal(isSentenceId(sentence), true);
		assert.equal(parseComments(changed((file) => { file.comments[0]!.target.sentence = sentence; })).comments[0]?.target.sentence, sentence);
	}
	for (const sentence of ["3.9", "3.9.x2", "L3 p9", "0.9.s2", "0.9.t2", "3.0.t2", "3.9.t0", "3.9.t02", "3.9.t-2", "3.9.t2.1", "L3.p9.t2"]) {
		assert.equal(isSentenceId(sentence), false);
		assert.throws(() => parseComments(changed((file) => { file.comments[0]!.target.sentence = sentence; })), /Invalid comment target/);
	}
});

test("sentences inside a table row keep their own comment page and source through export", () => {
	const code = COMMENTS_SCRIPT.slice(COMMENTS_SCRIPT.indexOf("const anchorOf ="), COMMENTS_SCRIPT.indexOf("const quoteFor ="));
	const helpers = COMMENTS_SCRIPT.slice(COMMENTS_SCRIPT.indexOf("const pageOf ="), COMMENTS_SCRIPT.indexOf("const rowText ="));
	const { pageOf, sentenceId } = new Function("isSentenceId", `${helpers}\nreturn { pageOf, sentenceId };`)(isSentenceId);
	const anchorOf = new Function("sectionOf", "rowText", "sentenceId", "pageOf", "label", "source", "meta", "headingOf", `${code}\nreturn anchorOf;`)(
		() => ({ getAttribute: () => "sentences" }), () => null, sentenceId, pageOf,
		() => null, (value: string) => value ? sourceFromTitle(value) : null, {}, () => "Sentence structure",
	);
	const pointer = (page: string, line: number) => ({ dataset: { page, tip: `Lesson, page ${page} · lesson.prax:${line}` }, getAttribute: () => null });
	const first = pointer("1.1", 10), second = pointer("1.2", 20);
	const tableRow = { querySelector: (selector: string) => selector === "[data-page]" ? first : null };
	for (const id of ["1.2.s1", "1.2.n1", "1.2.t1"]) {
		const sentence = { id, querySelector: (selector: string) => selector === "[data-page]" ? second : null };
		const quote = {
			closest: (selector: string) => selector.split(",").includes("li[id]") ? sentence : selector === "tr" ? tableRow : null,
			getAttribute: () => null, dataset: {},
		};
		const comment = anchorOf(quote, null);
		assert.equal(comment.view, "sentences");
		assert.equal(comment.heading, "Sentence structure");
		assert.equal(comment.target.sentence, id);
		assert.deepEqual(comment.target.page, { lesson: 1, page: 2 });
		assert.deepEqual(comment.source, { file: "lesson.prax", line: 20 });
		const exported = structuredClone(example);
		exported.comments[0] = { ...exported.comments[0]!, ...comment };
		assert.deepEqual(parseComments(JSON.stringify(exported)).comments[0], exported.comments[0]);
	}
});

test("the browser derives a transcript comment page from its sentence id without a page mark", () => {
	const code = COMMENTS_SCRIPT.slice(COMMENTS_SCRIPT.indexOf("const anchorOf ="), COMMENTS_SCRIPT.indexOf("const quoteFor ="));
	const helpers = COMMENTS_SCRIPT.slice(COMMENTS_SCRIPT.indexOf("const pageOf ="), COMMENTS_SCRIPT.indexOf("const rowText ="));
	const { pageOf, sentenceId } = new Function("isSentenceId", `${helpers}\nreturn { pageOf, sentenceId };`)(isSentenceId);
	const anchorOf = new Function("sectionOf", "rowText", "sentenceId", "pageOf", "label", "source", "meta", "headingOf", `${code}\nreturn anchorOf;`)(
		() => ({ getAttribute: () => "sentences" }), () => null, sentenceId, pageOf,
		() => null, sourceFromTitle, { lessons: [{ number: 3, file: "lesson-03.prax" }] }, () => "Sentence structure",
	);
	const sentence = { id: "3.9.t2", querySelector: () => null };
	const element = {
		closest: (selector: string) => selector.split(",").includes("li[id]") ? sentence : null,
		getAttribute: () => "Transcript · lesson-03.prax:118", dataset: {},
	};
	const comment = anchorOf(element, null);
	assert.equal(comment.target.sentence, "3.9.t2");
	assert.deepEqual(comment.target.page, { lesson: 3, page: 9 });
	assert.deepEqual(comment.source, { file: "lesson-03.prax", line: 118 });
});

test("the browser reads stored comments with the same validator the command line uses", () => {
	assert.equal(COMMENTS_SCRIPT.match(/const commentsFile = /g)?.length, 1);
	assert.doesNotMatch(COMMENTS_SCRIPT, /const valid = /);
	const inlined = new Function(`${COMMENTS_SCRIPT.slice(0, COMMENTS_SCRIPT.lastIndexOf("\n("))}\nreturn commentsFile;`)() as (value: unknown) => CommentsFile;
	for (const sentence of ["3.9.s2", "3.9.n1", "3.9.t2", "L3.p9.s2"]) {
		assert.equal(inlined(JSON.parse(changed((file) => { file.comments[0]!.target.sentence = sentence; }))).comments[0]?.target.sentence, sentence);
	}
	assert.throws(() => inlined(JSON.parse(changed((file) => { file.comments[0]!.target.sentence = "3.9.t0"; }))), /Invalid comment target/);
	assert.throws(() => inlined(JSON.parse(changed((file) => { file.comments[0]!.target.page!.page = 0; }))));
});
