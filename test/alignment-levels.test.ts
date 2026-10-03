import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { alignmentView, renderAlignment, type AlignmentView } from "../src/alignment-view.ts";
import { parseAlignment, PROMPT_VERSION } from "../src/alignment.ts";
import { courseHash, parseCourse } from "../src/inspect.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/objective-levels/${name}.json`, import.meta.url), "utf8");
const input = fixture("inspect");
const course = parseCourse(input);
const answerJson = JSON.stringify({ ...JSON.parse(fixture("answer")), promptVersion: PROMPT_VERSION, courseHash: courseHash(course) });
const answer = parseAlignment(answerJson, course);

const expectedLevels = [
	{ id: "O1", bloom: "Understand", verbBloom: "Understand", modelBloom: "Analyze", bloomCandidates: ["Understand"], bloomSource: "verb", bloomDiffers: true, levelReason: "paraphrase why requires examining causes of policy failure" },
	{ id: "O2", bloom: "Understand", verbBloom: "Understand", modelBloom: "Understand", bloomCandidates: ["Understand"], bloomSource: "verb", bloomDiffers: false, levelReason: "paraphrase the steps restates the policy" },
	{ id: "O3", bloom: "Analyze", verbBloom: null, modelBloom: "Analyze", bloomCandidates: ["Understand", "Apply", "Evaluate", "Create"], bloomSource: "generated", bloomDiffers: false, levelReason: "explain why requires examining causes of policy failure" },
	{ id: "O4", bloom: "Apply", verbBloom: null, modelBloom: "Apply", bloomCandidates: [], bloomSource: "generated", bloomDiffers: false, levelReason: "teach a crew requires using the policy" },
	{ id: "O5", bloom: "Analyze", verbBloom: null, modelBloom: "Analyze", bloomCandidates: ["Remember", "Understand", "Evaluate"], bloomSource: "generated", bloomDiffers: false, levelReason: "describe why requires examining causes of policy failure" },
	{ id: "O6", bloom: "Understand", verbBloom: "Understand", modelBloom: null, bloomCandidates: ["Understand"], bloomSource: "verb", bloomDiffers: false, levelReason: null },
];
const levels = (objectives: AlignmentView["objectives"]) => objectives.map(({ id, bloom, verbBloom, modelBloom, bloomCandidates, bloomSource, bloomDiffers, levelReason }) => ({ id, bloom, verbBloom, modelBloom, bloomCandidates, bloomSource, bloomDiffers, levelReason }));

function textOf(html: string): string {
	const read = (node: DefaultTreeAdapterTypes.Node): string => "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(read).join(" ") : "";
	return read(parseFragment(html)).replace(/\s+/g, " ").trim();
}

function assertRenderedDifference(html: string) {
	const table = html.split('aria-label="Objectives with their levels"')[1]?.split("</table>")[0] ?? "";
	const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(match => match[0]);
	const first = rows.find(row => /class="oid">O1<\/span>/.test(row)) ?? "";
	const visible = textOf(first);
	assert.match(visible, /Listed: Understand/);
	assert.match(visible, /Reviewer: Analyze/);
	assert.match(visible, /generated/);
	assert.match(visible, /paraphrase why requires examining causes of policy failure/);
	assert.match(visible, /policy\.prax:10/);
	for (const id of ["O2", "O3", "O4", "O5", "O6"]) {
		const row = rows.find(row => row.includes(`class="oid">${id}</span>`)) ?? "";
		assert.ok(row, id);
		assert.doesNotMatch(row, /bloom-difference/);
	}
	const bloom = html.split('data-taxonomy="bloom"')[1]?.split('data-taxonomy="fink"')[0] ?? "";
	const differenceMarks = [...bloom.matchAll(/<(?:line|circle|rect|path)\b[^>]*class="[^"]*\bbloom-difference\b[^"]*"[^>]*>/g)].map(match => match[0]);
	assert.ok(differenceMarks.length > 0, "Bloom chart marks the differing listed and reviewer levels");
	assert.match(textOf(bloom), /O1 Reviewer: Analyze/);
	assert.match(textOf(bloom), /generated/);
	assert.match(bloom, /data-page="1\.1"/);
	assert.match(bloom, /policy\.prax:10/);
	for (const id of ["O2", "O3", "O4", "O5", "O6"]) assert.doesNotMatch(textOf(bloom), new RegExp(`${id} Reviewer:`));
}

test("alignment parser preserves the reviewer's object-aware Bloom level and reason", () => {
	assert.deepEqual(answer.objectives.map(({ id, modelBloom, levelReason }) => ({ id, modelBloom, levelReason })), [
		{ id: "O1", modelBloom: "Analyze", levelReason: "paraphrase why requires examining causes of policy failure" },
		{ id: "O2", modelBloom: "Understand", levelReason: "paraphrase the steps restates the policy" },
		{ id: "O3", modelBloom: "Analyze", levelReason: "explain why requires examining causes of policy failure" },
		{ id: "O4", modelBloom: "Apply", levelReason: "teach a crew requires using the policy" },
		{ id: "O5", modelBloom: "Analyze", levelReason: "describe why requires examining causes of policy failure" },
		{ id: "O6", modelBloom: null, levelReason: null },
	]);
});

test("alignment marks a difference only between a single listed level and a non-null reviewer level", () => {
	const view = alignmentView(course, answer);
	assert.deepEqual(levels(view.objectives), expectedLevels);
	assert.equal(view.places["1.1.1"]?.sourceRef, "policy/O1");
	assert.deepEqual(view.places["1.1.1"]?.location, { file: "policy.prax", startLine: 10, endLine: 10 });
	const noReviewer = structuredClone(answer);
	delete noReviewer.objectives[0]!.modelBloom;
	assert.equal(alignmentView(course, noReviewer).objectives[0]?.bloomDiffers, false);
});

test("alignment displays listed and reviewer levels, a visible reason and source in both modes", () => {
	assertRenderedDifference(renderAlignment(alignmentView(course, answer)));
});

test("CLI report retains listed levels, the reviewer interpretation and the difference boolean", () => {
	const directory = mkdtempSync(join(tmpdir(), "trace-objective-levels-"));
	const inputPath = join(directory, "inspect.json"), answerPath = join(directory, "answer.json"), output = join(directory, "report");
	writeFileSync(inputPath, input);
	writeFileSync(answerPath, answerJson);
	const run = spawnSync(process.execPath, [resolve("src/cli.ts"), "report", inputPath, "--alignment", answerPath, "--out", output], { encoding: "utf8" });
	assert.equal(run.status, 0, run.stderr || run.stdout);
	const report = JSON.parse(readFileSync(join(output, "report.json"), "utf8"));
	assert.deepEqual(levels(report.alignment.objectives), expectedLevels);
	assert.equal(report.alignment.objectives[0].ref, "1.1.1");
	assert.equal(report.alignment.model, "synthetic-reviewer");
	assert.equal(report.courseHash, courseHash(course));
	assertRenderedDifference(readFileSync(join(output, "report.html"), "utf8"));
});

test("alignment rejects malformed reviewer Bloom levels before rendering", () => {
	for (const bloom of ["Analysis", "analyze", 3, ["Analyze"], {}]) {
		const malformed = JSON.parse(answerJson);
		malformed.objectives[0].bloom = bloom;
		assert.throws(() => parseAlignment(JSON.stringify(malformed), course), /Invalid alignment answer: objectives\[0\]\.bloom must be one of Remember, Understand, Apply, Analyze, Evaluate, Create or null/);
	}
});
