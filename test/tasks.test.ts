import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseCourse } from "../src/inspect.ts";
import { parseTasks, prepareTasks, renderTasks, TASKS_STYLE, tasksView } from "../src/tasks.ts";

const fixture = async (name: string) => {
	const root = new URL(`fixtures/tasks/${name}/`, import.meta.url);
	const course = parseCourse(await readFile(new URL("inspect.json", root), "utf8"));
	const json = await readFile(new URL("answer.json", root), "utf8");
	return { course, json, answer: parseTasks(json, course) };
};

test("task coding distinguishes prose from simulation and keeps mixed and outside requests", async () => {
	const awareness = tasksView((await fixture("awareness")).course, (await fixture("awareness")).answer);
	const proceduralFixture = await fixture("procedural");
	const procedural = tasksView(proceduralFixture.course, proceduralFixture.answer);
	const judgmentFixture = await fixture("judgment");
	const judgment = tasksView(judgmentFixture.course, judgmentFixture.answer);
	assert.deepEqual(awareness.pages[0]?.taskTypes, ["assimilative"]);
	assert.deepEqual(judgment.pages[2]?.taskTypes, ["information handling", "adaptive"]);
	assert.equal(awareness.pages[4]?.unsupported, true);
	assert.equal(awareness.pages[4]?.unknown, true);
	assert.deepEqual(judgment.pages[3]?.taskTypes, ["communicative", "productive"]);
	assert.deepEqual(judgment.annotations.filter((item) => item.ref === "1.4.2").map((item) => item.work), ["inside", "outside"]);
	assert.equal(procedural.annotations.find((item) => item.ref === "1.5.2")?.work, "outside");
	assert.equal(awareness.annotations.find((item) => item.ref === "1.3.3")?.assessmentPurpose, "diagnostic");
	assert.equal(judgment.annotations.find((item) => item.ref === "1.1.2")?.assessmentPurpose, "summative");
	assert.equal(judgment.counts.productive, 2);
	assert.equal(judgment.counts.communicative, 1);
	assert.equal(judgment.evidenceKind, "interpretation");
	assert.equal(judgment.countingUnit, "page presence");
	const doubled = tasksView(judgmentFixture.course, { ...judgmentFixture.answer, annotations: [...judgmentFixture.answer.annotations, judgmentFixture.answer.annotations.find((item) => item.ref === "1.3.2")!] });
	assert.equal(doubled.counts.adaptive, 1, "a page counts once per type even with two annotations");
});

test("task answer rejects bad refs, invented quotes, categories and stale versions or courses", async () => {
	const { course, json } = await fixture("procedural");
	const raw = JSON.parse(json);
	const changed = (edit: (answer: typeof raw) => void) => { const copy = structuredClone(raw); edit(copy); return JSON.stringify(copy); };
	assert.throws(() => parseTasks(changed((a) => { a.annotations[0].ref = "9.9.9"; }), course), /not a ref/);
	assert.throws(() => parseTasks(changed((a) => { a.annotations[0].evidence[0].quote = "invented instruction"; }), course), /not in the screen text/);
	assert.throws(() => parseTasks(changed((a) => { a.annotations[0].taskTypes = ["assessment"]; }), course), /not a task type/);
	assert.throws(() => parseTasks(changed((a) => { a.annotations[0].taskTypes = ["unknown", "productive"]; }), course), /must be distinct task types or/);
	assert.throws(() => parseTasks(changed((a) => { a.annotations[0].evidence = []; }), course), /must quote/);
	assert.throws(() => parseTasks(changed((a) => { a.courseHash = "old"; }), course), /different course revision/);
	assert.throws(() => parseTasks(changed((a) => { a.promptVersion = "tasks\/1"; }), course), /expected view/);
	assert.throws(() => parseTasks(changed((a) => { a.taxonomyVersion = "other"; }), course), /taxonomyVersion/);
});

test("tasks bundle and table expose the coding rule, every quote and page status", async () => {
	const { course, answer } = await fixture("awareness");
	const directory = await mkdtemp(join(tmpdir(), "trace-task-bundle-"));
	await prepareTasks(course, directory);
	const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
	const prompt = await readFile(join(directory, "prompt.md"), "utf8");
	assert.equal(manifest.taxonomyVersion, "conole-task-families/1");
	assert.equal(manifest.promptVersion, "tasks/2-projection-2");
	assert.match(prompt, /"promptVersion": "tasks\/2-projection-2"/);
	assert.match(prompt, /adaptive = change a model or simulation/);
	const view = tasksView(course, answer);
	const html = renderTasks(view);
	const table = html.match(/<table class="blocks tasks-table" role="table">[\s\S]*?<\/table>/)?.[0] ?? "";
	assert.match(html, /Task types are linked to/);
	assert.match(html, /One page counts once per task type/);
	assert.match(html, /rows do not sum to 100%/);
	assert.doesNotMatch(html, /Generated page presence:/);
	assert.match(html, /data-page="1\.5"[\s\S]*?task-unsupported/);
	assert.match(table, /<caption class="sr">Learner task annotations and evidence<\/caption>/);
	assert.match(table, /<th scope="col" role="columnheader">Quoted evidence and source<\/th>/);
	assert.match(table, /<th scope="row" role="rowheader" data-label="Page">1\.1<\/th>/);
	assert.equal((table.match(/<blockquote>/g) ?? []).length, answer.annotations.reduce((sum, item) => sum + item.evidence.length, 0));
	assert.match(table, /Unsupported input/);
	assert.match(table, /Unclassified/);
	assert.match(table, /Assessment purpose: diagnostic/);
	assert.doesNotMatch(TASKS_STYLE, /max-width:600px|data-label/, "Narrow table layout belongs to the shared reflow rule");
});
