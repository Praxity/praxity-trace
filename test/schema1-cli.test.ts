import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parseFragment } from "parse5";
import { courseHash, parseCourse } from "../src/inspect.ts";
import { locateBlocks } from "../src/places.ts";
import { parseConcepts, PROMPT_VERSION } from "../src/concepts.ts";

const fixture = readFileSync(new URL("fixtures/examples.schema1.inspect.json", import.meta.url), "utf8");
const scratch = join(tmpdir(), "codex-schema1");
function directory() {
	mkdirSync(scratch, { recursive: true });
	return mkdtempSync(join(scratch, "trace-test-"));
}
function cli(args: string[], input?: string) {
	const result = spawnSync(process.execPath, [resolve("src/cli.ts"), ...args], { input, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return result.stdout;
}

test("real Studio schema 1 fixture reaches every prepare bundle and report over file and stdin", () => {
	const dir = directory();
	const input = join(dir, "inspect.json");
	writeFileSync(input, fixture);
	const expected = courseHash(parseCourse(fixture));
	for (const path of [input, "-"]) {
		const out = join(dir, path === "-" ? "stdin" : "file");
		cli(["report", path, "--out", out], fixture);
		const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
		assert.equal(report.courseHash, expected);
		assert.equal(report.coverage.status, "partial");
		assert.equal(Object.keys(report.source.places).length, 97);
		assert.equal(report.source.revision, JSON.parse(fixture).revision);
		assert.ok(Object.values(report.source.places).every((p) => typeof (p as { sourceRef: string }).sourceRef === "string"));
		for (const view of ["alignment", "concepts", "terms", "visuals", "distinctions", "recommendations"]) {
			const bundle = join(out, view);
			cli(["prepare", view, path, "--out", bundle, ...(view === "recommendations" ? ["--report", join(out, "report.json")] : [])], fixture);
			assert.equal(JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")).courseHash, expected);
			assert.match(readFileSync(join(bundle, "course.md"), "utf8"), /Workspace Safety Starter/);
		}
		const answerPath = join(out, "concepts", "answer.json");
		writeFileSync(answerPath, JSON.stringify({ view: "concepts", promptVersion: PROMPT_VERSION, courseHash: expected, model: "test", concepts: [], interpretation: [] }));
		cli(["report", path, "--out", out, "--concepts", answerPath], fixture);
		const html = readFileSync(join(out, "report.html"), "utf8");
		// Static evidence only: the controller checks keyboard use and reflow in a browser.
		const previews = JSON.parse(html.match(/<script type="application\/json" id="page-previews">([^<]*)<\/script>/)![1]!);
		assert.ok(Object.values(previews).some((p) => (p as { unknownResponses: number }).unknownResponses > 0));
		assert.ok(Object.values(previews).every((p) => (p as { partial: boolean }).partial));
		assert.match(html, /responses with unknown correctness/);
		const tree = parseFragment(html);
		const nodes: Array<{ tagName?: string; attrs?: Array<{ name: string; value: string }> }> = [];
		function walk(node: unknown) {
			const n = node as { tagName?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: unknown[] };
			nodes.push(n);
			for (const child of n.childNodes ?? []) walk(child);
		}
		walk(tree);
		const attrs = (node: typeof nodes[number]) => Object.fromEntries((node.attrs ?? []).map((a) => [a.name, a.value]));
		const regions = nodes.filter((n) => attrs(n).role === "region" && attrs(n).tabindex === "0");
		assert.ok(regions.length > 0, "table scroll regions remain keyboard reachable");
		for (const region of regions) assert.ok(attrs(region)["aria-label"] || attrs(region)["aria-labelledby"], "region is labelled");
		assert.ok(nodes.some((n) => n.tagName === "input" && attrs(n).type === "radio" && attrs(n)["aria-label"] === "Table"));
	}
});

const studio = process.env.TRACE_STUDIO_CLI;
const examples = process.env.TRACE_EXAMPLE_COURSE;
test("live Studio runs: transient IDs, revision freshness, Unicode and CRLF coordinates", { skip: !studio || !examples }, () => {
	const dir = directory();
	const courseDir = join(dir, "course");
	cpSync(examples!, courseDir, { recursive: true });
	function inspect() {
		const result = spawnSync(process.execPath, [studio!, "inspect", courseDir, "--schema", "1"], { encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout;
	}
	const first = inspect();
	const second = inspect();
	const course = parseCourse(first);
	const refs = (json: string) => locateBlocks(parseCourse(json)).map((b) => b.ref);
	assert.notEqual(first, second, "unsaved identities differ across producer processes");
	assert.equal(courseHash(course), courseHash(parseCourse(second)));
	assert.deepEqual(refs(first), refs(second));
	const answer = JSON.stringify({ view: "concepts", promptVersion: course.projectionVersion === 2 ? `${PROMPT_VERSION}-projection-2` : PROMPT_VERSION, courseHash: courseHash(course), model: "test", concepts: [], interpretation: [] });
	assert.doesNotThrow(() => parseConcepts(answer, parseCourse(second)));
	const hashes = (json: string) => parseCourse(json).lessons.map((l) => l.sha256);
	writeFileSync(join(courseDir, "narration.yaml"), "version: 1\nlessons:\n  minimal.prax:\n    enabled: false\n");
	const sidecar = inspect();
	assert.deepEqual(hashes(sidecar), hashes(first));
	assert.notEqual(courseHash(parseCourse(sidecar)), courseHash(course));
	assert.throws(() => parseConcepts(answer, parseCourse(sidecar)), /different course revision/);
	const manifestPath = join(courseDir, "course.yaml");
	writeFileSync(manifestPath, readFileSync(manifestPath, "utf8").replace("title: Examples", "title: Examples revised"));
	const manifest = inspect();
	assert.deepEqual(hashes(manifest), hashes(first));
	assert.notEqual(courseHash(parseCourse(manifest)), courseHash(parseCourse(sidecar)));
	assert.throws(() => parseConcepts(answer, parseCourse(manifest)), /different course revision/);
	const lessonPath = join(courseDir, "minimal.prax");
	writeFileSync(lessonPath, `${readFileSync(lessonPath, "utf8")}\nCafé 日本語 &lt;literal&gt;.\n`);
	const lf = inspect();
	const unicodeLine = readFileSync(lessonPath, "utf8").split("\n").findIndex((line) => line.startsWith("Café")) + 1;
	const unicodeBlock = JSON.parse(lf).lessons[0].pages.flatMap((p: { blocks: Array<{ texts: Array<{ value: string }>; location: { startLine: number; endLine: number } }> }) => p.blocks).find((b: { texts: Array<{ value: string }> }) => b.texts.some((t) => t.value.includes("Café")));
	assert.ok(unicodeBlock);
	assert.equal(unicodeBlock.location.startLine, unicodeLine);
	assert.equal(unicodeBlock.location.endLine, unicodeLine);
	writeFileSync(lessonPath, readFileSync(lessonPath, "utf8").replace(/\r?\n/g, "\r\n"));
	const crlf = inspect();
	const locations = (json: string) => JSON.parse(json).lessons.flatMap((l: { pages: Array<{ blocks: Array<{ location: unknown }> }> }) => l.pages.flatMap((p) => p.blocks.map((b) => b.location)));
	assert.deepEqual(locations(lf), locations(crlf));
	assert.match(crlf, /Café 日本語/);
	assert.notEqual(courseHash(parseCourse(lf)), courseHash(parseCourse(crlf)));
	const out = join(dir, "live-report");
	cli(["prepare", "concepts", "-", "--out", join(dir, "live-bundle")], second);
	cli(["report", "-", "--out", out], second);
	assert.equal(JSON.parse(readFileSync(join(out, "report.json"), "utf8")).courseHash, courseHash(course));
});
