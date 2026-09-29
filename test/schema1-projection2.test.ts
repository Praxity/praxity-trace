import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { anatomy, isKnowledgeCheck } from "../src/anatomy.ts";
import { courseText, readAnswer } from "../src/bundle.ts";
import { courseHash, parseCourse } from "../src/inspect.ts";
import { locateBlocks } from "../src/places.ts";
import { blockTexts } from "../src/text.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}.inspect.json`, import.meta.url), "utf8");
const smoke = () => parseCourse(fixture("smoke.projection2"));

test("earlier schema 1 remains partial; projection 2 validates its marker and consumed evidence", () => {
	const earlier = parseCourse(fixture("examples.schema1"));
	assert.equal(earlier.projectionVersion, undefined);
	assert.equal(isKnowledgeCheck(locateBlocks(earlier).find(item => item.block.type === "assessment")!.block), null);
	const raw = JSON.parse(fixture("smoke.projection2"));
	assert.equal(parseCourse(JSON.stringify({ ...raw, extraField: true })).projectionVersion, 2);
	for (const change of [
		(r: any) => { r.projectionVersion = 3; },
		(r: any) => { r.lessons[0].pages[0].blocks[2].assessment.correctness = "guessed"; },
		(r: any) => { r.lessons[0].pages[1].blocks.find((b: any) => b.media).media[0].source.availability = "maybe"; },
		(r: any) => { r.lessons[0].unlinkedNarration[0].pageRef = r.lessons[0].pages[0].ref; },
		(r: any) => { r.lessons[0].unlinkedNarration[0].duration.measurement = "measured"; },
	]) { const copy = structuredClone(raw); change(copy); assert.throws(() => parseCourse(JSON.stringify(copy)), /Invalid inspect JSON/); }
});

test("correctness determines checks; scoring and groups remain separate", () => {
	const course = parseCourse(fixture("examples.projection2"));
	const blocks = locateBlocks(course);
	const unscoredKey = blocks.find(item => item.block.assessment?.correctness === "keyed" && !item.block.assessment.scoring.scored)!;
	const open = blocks.find(item => item.block.assessment?.correctness === "open")!;
	assert.equal(isKnowledgeCheck(unscoredKey.block), true);
	assert.equal(isKnowledgeCheck(open.block), null);
	assert.ok(blocks.some(item => item.block.assessmentGroup?.memberRefs.length));
	assert.ok(blocks.filter(item => item.block.assessmentGroup).every(item => item.block.type !== "assessment"));
	const shape = anatomy(course);
	assert.equal(shape.lessons.flatMap(lesson => lesson.marks).filter(mark => mark.knowledgeCheck).length, 13);
	assert.ok(shape.lessons.flatMap(lesson => lesson.marks).some(mark => mark.scoring?.scored === false && mark.knowledgeCheck));
	const raw = JSON.parse(fixture("examples.projection2"));
	const first = raw.lessons.flatMap((lesson: any) => lesson.pages.flatMap((page: any) => page.blocks)).find((block: any) => block.assessment);
	first.assessment.correctness = "unavailable";
	assert.equal(isKnowledgeCheck(locateBlocks(parseCourse(JSON.stringify(raw))).find(item => item.block.ref === first.ref)!.block), null);
	assert.match(courseText(course), /Assessment group \(aggregation context, not a question\)/);
});

test("screen words exclude hidden keys, feedback, alternatives and narration; Markdown escapes stay literal", () => {
	const course = smoke(), blocks = locateBlocks(course);
	assert.equal(anatomy(course).lessons[0]!.words, 68);
	const canary = blocks.find(item => JSON.stringify(item.block.assessment ?? "").includes("key-canary-739"))!.block;
	assert.doesNotMatch(blockTexts(canary).screen, /key-canary-739/);
	assert.match(courseText(course), /Answer key and response semantics \(not screen\).*key-canary-739/);
	const match = blocks.find(item => item.block.assessment?.responseType === "matching")!.block;
	assert.match(blockTexts(match).screen, /A::B/);
	assert.doesNotMatch(blockTexts(match).screen, /A\\::B/);
	const escaped = { ...match, data: { typedTexts: [{ ref: "synthetic", role: "option", value: "\\*literal\\* A\\|B \\{x\\} \\~tilde", format: "markdown", location: null }] } };
	assert.equal(blockTexts(escaped).screen, "*literal* A|B {x} ~tilde");
	const nested = parseCourse(fixture("examples.projection2"));
	assert.ok(locateBlocks(nested).some(item => item.block.parentRef));
	assert.equal(anatomy(nested).lessons.reduce((sum, lesson) => sum + lesson.words, 0), 634);
	const media = blocks.find(item => item.block.media?.[0]?.alt)?.block;
	assert.ok(media);
	assert.doesNotMatch(blockTexts(media).screen, /A blue square/);
});

test("media status, recorded endpoints and unresolved sidecar source reach the report and bundle", () => {
	const course = smoke(), item = course.lessons[0]!.unlinkedNarration![0]!;
	assert.equal(item.location?.file, "narration.yaml");
	assert.deepEqual([item.location?.startLine, item.location?.endLine], [6, 14]);
	assert.equal(item.blockRef, null);
	assert.equal(item.pageRef, null);
	assert.deepEqual(item.duration, { seconds: 1, provenance: "sidecar-recorded", measurement: "unknown", isFullFileDuration: false });
	assert.deepEqual(course.lessons[0]!.pages.flatMap(page => page.blocks.flatMap(block => block.media ?? [])).map(media => media.source?.availability), ["present", "present", "missing"]);
	assert.ok(parseCourse(fixture("examples.projection2")).lessons.flatMap(lesson => lesson.pages.flatMap(page => page.blocks.flatMap(block => block.media ?? []))).some(media => media.source?.availability === "remote"));
	const pace = anatomy(course);
	assert.equal(pace.speakingWpm, 150);
	assert.ok(pace.lessons[0]!.pace.every(page => page.narrationDurationKnown === false && page.narrationSeconds === page.estimatedNarrationSeconds));
	const dir = mkdtempSync(join(tmpdir(), "trace-projection2-"));
	const result = spawnSync(process.execPath, [resolve("src/cli.ts"), "report", resolve("test/fixtures/smoke.projection2.inspect.json"), "--out", dir], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
	const html = readFileSync(join(dir, "report.html"), "utf8");
	assert.deepEqual(report.source.mediaInventory.map((media: any) => media.source.availability), ["present", "present", "missing"]);
	assert.equal(report.source.unlinkedNarration[0].location.file, "narration.yaml");
	assert.match(html, /missing: \/assets\/missing.mp4/);
	assert.match(html, /narration.yaml:6–14/);
	assert.match(html, /sidecar-recorded endpoint, full-file duration unknown/);
	assert.match(html, /Scored; exact/);
	assert.doesNotMatch(html, /no correct answers, scoring, media details/);
	assert.match(courseText(course), /Unresolved narration in L1 \(not linked or confirmed spoken\)/);
	const bundle = join(dir, "alignment");
	const prepared = spawnSync(process.execPath, [resolve("src/cli.ts"), "prepare", "alignment", resolve("test/fixtures/smoke.projection2.inspect.json"), "--out", bundle], { encoding: "utf8" });
	assert.equal(prepared.status, 0, prepared.stderr);
	assert.equal(JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")).promptVersion, "alignment/13-projection-2");
	assert.match(readFileSync(join(bundle, "prompt.md"), "utf8"), /"promptVersion": "alignment\/13-projection-2"/);
});

test("producer revisions reject answers after media, lesson and sidecar changes", () => {
	const base = smoke(), answer = JSON.stringify({ view: "concepts", promptVersion: "concepts/3-projection-2", courseHash: courseHash(base) });
	assert.doesNotThrow(() => readAnswer(answer, base, "concepts", "concepts/3"));
	const stable = smoke();
	assert.equal(courseHash(base), courseHash(stable));
	assert.deepEqual(locateBlocks(base).map(item => item.ref), locateBlocks(stable).map(item => item.ref));
	for (const name of ["smoke.projection2.media", "smoke.projection2.lesson", "smoke.projection2.sidecar"]) {
		const changed = parseCourse(fixture(name));
		assert.notEqual(courseHash(changed), courseHash(base), name);
		assert.throws(() => readAnswer(answer, changed, "concepts", "concepts/3"), /different course revision/);
	}
	assert.equal(parseCourse(fixture("smoke.projection2.media")).lessons[0]!.sha256, base.lessons[0]!.sha256);
	assert.equal(parseCourse(fixture("smoke.projection2.sidecar")).lessons[0]!.sha256, base.lessons[0]!.sha256);
});

const producer = process.env.TRACE_STUDIO_CLI;
const source = process.env.TRACE_SMOKE_COURSE;
test("unchanged input has stable producer revision and refs across independent runs", { skip: !producer || !source }, () => {
	const dir = mkdtempSync(join(tmpdir(), "trace-live-projection2-"));
	cpSync(source!, dir, { recursive: true });
	const inspect = () => { const result = spawnSync(process.execPath, [producer!, "inspect", dir, "--schema", "1"], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); return parseCourse(result.stdout); };
	const first = inspect(), second = inspect();
	assert.equal(courseHash(first), courseHash(second));
	assert.deepEqual(locateBlocks(first).map(item => item.block.ref), locateBlocks(second).map(item => item.block.ref));
	assert.deepEqual(locateBlocks(first).map(item => item.ref), locateBlocks(second).map(item => item.ref));
	const asset = join(dir, "assets/diagram.svg");
	writeFileSync(asset, readFileSync(asset, "utf8") + "\n<!-- changed bytes -->\n");
	const media = inspect();
	assert.equal(media.lessons[0]!.sha256, first.lessons[0]!.sha256);
	assert.notEqual(courseHash(media), courseHash(first));
});
