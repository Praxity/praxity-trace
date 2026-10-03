import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { anatomy } from "../src/anatomy.ts";
import { alignmentView } from "../src/alignment-view.ts";
import { parseAlignment, prepareAlignment, PROMPT_VERSION as ALIGNMENT_VERSION } from "../src/alignment.ts";
import { availabilityView, renderAvailability } from "../src/availability.ts";
import { courseText, readAnswer } from "../src/bundle.ts";
import { parseConcepts, prepareConcepts } from "../src/concepts.ts";
import { prepareDistinctions } from "../src/distinctions.ts";
import { emphasisView } from "../src/emphasis.ts";
import { readHtmlCourse } from "../src/html.ts";
import { courseHash, parseCourse } from "../src/inspect.ts";
import { locateBlocks } from "../src/places.ts";
import { prepareRecommendations } from "../src/recommendations.ts";
import { parseTasks, prepareTasks, PROMPT_VERSION as TASKS_VERSION, renderTasks, tasksView } from "../src/tasks.ts";
import { parseTerms, prepareTerms, PROMPT_VERSION as TERMS_VERSION, renderTerms, termsView } from "../src/terms.ts";
import { blockTexts, countWords, narrations, previewLines, transcriptStrings, transcripts } from "../src/text.ts";
import { parseVisuals, prepareVisuals, PROMPT_VERSION as VISUALS_VERSION, renderVisuals, visualsView } from "../src/visuals.ts";

const fixture = async () => parseCourse(await readFile(new URL("fixtures/lantern-marsh/inspect.json", import.meta.url), "utf8"));
const videoText = "An amber panel moves from the left edge towards a white lantern disc. It stops halfway across the disc. The final state is amber. No speech is present.";

test("authored transcript extraction retains its media block and adds no screen words, emphasis or time", async () => {
	const course = await fixture();
	const video = locateBlocks(course).find(item => item.block.media?.some(media => media.kind === "video"))!;
	assert.deepEqual(transcripts(video.block), [{ text: videoText, origin: "authored", kind: "video" }]);
	assert.deepEqual(blockTexts(video.block).transcript, [videoText]);
	assert.deepEqual(blockTexts(video.block).narration, []);
	assert.equal(video.lesson, "06-shutter-motion.prax");
	assert.equal(video.block.line, 18);
	const shape = anatomy(course), emphasis = emphasisView(course);
	const changed = structuredClone(course);
	for (const item of locateBlocks(changed)) for (const media of item.block.media ?? []) media.transcript = null;
	assert.deepEqual(anatomy(changed), shape, "supplied prose cannot add playback or narration time");
	assert.deepEqual(emphasisView(changed), emphasis);
	assert.match(courseText(course), /Transcript \(authored, video\): An amber panel moves/);
	assert.match(courseText(course), /Transcript \(authored, audio\): A short high tone sounds/);
	assert.match(courseText(course), /Caption tracks \(contents unavailable\)/);
});

test("schema 0 authored media prose uses the same transcript interface and keeps glossary syntax out of screen evidence", () => {
	const block = { id: "a", type: "audio", line: 4, data: { title: "A recording", transcript: "A [tone]{A sound} **ends**.", narration: "Read the title." } };
	assert.deepEqual(transcripts(block), [{ text: "A tone ends.", origin: "authored", kind: "audio" }]);
	assert.deepEqual(blockTexts(block), { screen: "A recording", tooltips: [], narration: ["Read the title."], transcript: ["A tone ends."] });
	assert.equal(countWords(block.data), 2);
	assert.deepEqual(previewLines([block], "Page"), [{ kind: "heading", text: "A recording" }]);
});

test("transcript source markup remains available for code exclusions without re-reading media fields", async () => {
	const course = await fixture(), video = locateBlocks(course).find(item => item.block.type === "video")!.block;
	const source = { ...video, media: [{ ...video.media![0]!, transcript: { value: "Use <code>ABC</code> before prose.", format: "html" as const } }] };
	assert.deepEqual(transcriptStrings(source), [{ text: "Use <code>ABC</code> before prose.", origin: "authored", kind: "video" }]);
	assert.deepEqual(transcripts(source), [{ text: "Use ABC before prose.", origin: "authored", kind: "video" }]);
	const markdown = { ...video, media: [{ ...video.media![0]!, transcript: { value: "Use `ABC` and **amber**.", format: "markdown" as const } }] };
	assert.deepEqual(transcriptStrings(markdown), [{ text: "Use `ABC` and amber.", origin: "authored", kind: "video" }]);
	const plain = { ...video, media: [{ ...video.media![0]!, transcript: { value: "Read <code>XYZ</code> literally.", format: "plain" as const } }] };
	assert.deepEqual(transcriptStrings(plain), [{ text: "Read &lt;code&gt;XYZ&lt;/code&gt; literally.", origin: "authored", kind: "video" }]);
	assert.deepEqual(transcripts(plain), [{ text: "Read <code>XYZ</code> literally.", origin: "authored", kind: "video" }]);
});

test("HTML captions and subtitles supply only cue prose in ordinary HTML and both Studio layouts", async () => {
	const dir = await mkdtemp(join(tmpdir(), "trace-transcript-html-"));
	try {
		await writeFile(join(dir, "captions.vtt"), "WEBVTT\n\nNOTE hidden note\nhidden note continuation\n\nSTYLE\n::cue { color: red; }\n\nscene-a\n00:00:00.000 --> 00:00:02.000 align:start\n<v Speaker><b>A caption</b> &amp; a subtitle.</v>\n\nscene-b\n00:00:02.000 --> 00:00:50.000\n<00:00:03.000>Another line.\n");
		await writeFile(join(dir, "subtitles.vtt"), "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nA translated sentence.\n");
		const media = '<video><track kind="captions" src="captions.vtt"><track kind="subtitles" src="subtitles.vtt"><track kind="captions" src="missing.vtt"><track kind="captions" src="https://invalid.example/remote.vtt"></video>';
		for (const layout of ["ordinary", "deck", "page"]) {
			const body = layout === "ordinary" ? media : `<div data-block-id="video-block" data-block-type="video">${media}</div>`;
			const config = layout === "page" ? '<script id="praxity-config" type="application/json">{"pageId":"p1","lessonId":"l1","currentPage":1,"blocks":[]}</script>' : "";
			await writeFile(join(dir, "index.html"), `<!doctype html><html><head><title>Captions</title></head><body>${config}<main>${layout === "deck" ? `<article class="deck-slide">${body}</article>` : body}</main></body></html>`);
			const course = await readHtmlCourse(dir), block = locateBlocks(course)[0]!.block;
			assert.deepEqual(transcripts(block), [{ text: "A caption & a subtitle. Another line.", origin: "caption-track", kind: "video" }, { text: "A translated sentence.", origin: "caption-track", kind: "video" }], layout);
			assert.deepEqual(narrations(block.data), []);
			assert.equal(countWords(block.data), 0);
			assert.equal(anatomy(course).lessons[0]!.pace[0]!.narrationSeconds, 0);
			assert.match(courseText(course), /Transcript \(caption track, video\): A caption & a subtitle/);
			const prior = courseHash(course);
			await writeFile(join(dir, "subtitles.vtt"), "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nChanged prose.\n");
			assert.notEqual(courseHash(await readHtmlCourse(dir)), prior, layout);
			await writeFile(join(dir, "subtitles.vtt"), "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nA translated sentence.\n");
		}
		await mkdir(join(dir, "directory.vtt"));
		await writeFile(join(dir, "index.html"), '<main><video><track kind="captions" src="directory.vtt"></video></main>');
		await assert.rejects(readHtmlCourse(dir), { code: "EISDIR" });
	} finally { await rm(dir, { recursive: true, force: true }); }
});

for (const layout of ["ordinary", "deck", "page"]) test(`${layout} HTML freshness follows caption evidence when it moves between media blocks`, async () => {
	const dir = await mkdtemp(join(tmpdir(), "trace-transcript-ownership-"));
	try {
		const first = '<video id="first"><track kind="captions" src="a.vtt"></video>';
		const second = '<video id="second"><track kind="captions" src="b.vtt"><track kind="subtitles" src="c.vtt"></video>';
		const body = layout === "ordinary" ? first + second : `<div data-block-id="first" data-block-type="video">${first}</div><div data-block-id="second" data-block-type="video">${second}</div>`;
		const config = layout === "page" ? '<script id="praxity-config" type="application/json">{"pageId":"p1","lessonId":"l1","currentPage":1,"blocks":[]}</script>' : "";
		const html = `<!doctype html><html><head><title>Captions</title></head><body>${config}<main>${layout === "deck" ? `<article class="deck-slide">${body}</article>` : body}</main></body></html>`;
		await writeFile(join(dir, "index.html"), html);
		const captions = async (values: string[]) => {
			for (const [index, value] of values.entries()) await writeFile(join(dir, ["a.vtt", "b.vtt", "c.vtt"][index]!), `WEBVTT\n\n${value ? `00:00:00.000 --> 00:00:01.000\n${value}\n` : ""}`);
		};
		await captions(["", "", ""]);
		const empty = await readHtmlCourse(dir);
		assert.equal(empty.lessons[0]!.sha256, createHash("sha256").update(html).digest("hex"), "no caption prose preserves the HTML byte hash");
		await captions(["A", "B", ""]);
		const before = await readHtmlCourse(dir);
		assert.deepEqual(locateBlocks(before).map(item => [item.ref, blockTexts(item.block).transcript]), [["1.1.1", ["A"]], ["1.1.2", ["B"]]]);
		await captions(["", "A", "B"]);
		const after = await readHtmlCourse(dir);
		assert.deepEqual(locateBlocks(after).map(item => [item.ref, blockTexts(item.block).transcript]), [["1.1.1", []], ["1.1.2", ["A", "B"]]]);
		assert.deepEqual(locateBlocks(after).flatMap(item => transcripts(item.block)), locateBlocks(before).flatMap(item => transcripts(item.block)), "overall ordered caption evidence is unchanged");
		assert.equal(await readFile(join(dir, "index.html"), "utf8"), html);
		assert.notEqual(courseHash(after), courseHash(before), "moved source evidence invalidates saved answers");
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("Terms, Tasks and Visuals quote the transcript channel separately, and render its label", async () => {
	const course = await fixture(), video = locateBlocks(course).find(item => item.block.type === "video")!;
	const common = { courseHash: courseHash(course), model: "synthetic-test", interpretation: [] };
	const terms = { ...common, view: "terms", promptVersion: `${TERMS_VERSION}-projection-2`, flags: [{ ref: video.ref, channel: "transcript", span: "left edge", kind: "term", note: "Check the colour description.", explainedAt: null }] };
	const parsed = parseTerms(JSON.stringify(terms), course);
	assert.equal(parsed.flags[0]!.channel, "transcript");
	assert.match(renderTerms(termsView(course, parsed)), /class="channel">transcript/);
	for (const channel of ["screen", "narration"]) assert.throws(() => parseTerms(JSON.stringify({ ...terms, flags: [{ ...terms.flags[0], channel }] }), course), new RegExp(`not in the ${channel} text`));
	assert.throws(() => parseTerms(JSON.stringify({ ...terms, flags: [{ ...terms.flags[0], span: "Video demonstration" }] }), course), /not in the transcript text/);
	const task = { ...common, view: "tasks", promptVersion: `${TASKS_VERSION}-projection-2`, taxonomyVersion: "conole-task-families/1", annotations: [{ ref: video.ref, evidence: [{ ref: video.ref, channel: "transcript", quote: "It stops halfway across the disc." }], taskTypes: ["assimilative"], work: "inside", explanation: "Read the supplied demonstration prose.", assessmentPurpose: "none" }] };
	assert.match(renderTasks(tasksView(course, parseTasks(JSON.stringify(task), course))), /· transcript/);
	assert.throws(() => parseTasks(JSON.stringify({ ...task, annotations: [{ ...task.annotations[0], evidence: [{ ...task.annotations[0]!.evidence[0], channel: "narration" }] }] }), course), /not in the narration text/);
	const visuals = { ...common, view: "visuals", promptVersion: `${VISUALS_VERSION}-projection-2`, opportunities: [{ ref: video.ref, channel: "transcript", span: "It stops halfway across the disc.", structure: "change", elements: ["halfway", "disc"], form: "Two positions", note: "Preserve the halfway stopping point." }] };
	assert.match(renderVisuals(visualsView(course, parseVisuals(JSON.stringify(visuals), course), anatomy(course).lessons)), /<td[^>]*>Transcript<\/td>/);
	assert.throws(() => parseVisuals(JSON.stringify({ ...visuals, opportunities: [{ ...visuals.opportunities[0], channel: "screen" }] }), course), /not in the screen text/);
});

test("Alignment carries transcript instruction text and Concepts merge evidence at the owning block", async () => {
	const course = await fixture(), blocks = locateBlocks(course), video = blocks.find(item => item.block.type === "video")!, check = blocks.find(item => item.lessonNumber === 6 && item.block.type === "assessment")!;
	const answer = parseAlignment(JSON.stringify({ view: "alignment", promptVersion: `${ALIGNMENT_VERSION}-projection-2`, courseHash: courseHash(course), model: "synthetic-test", objectives: [], checks: [{ ref: check.ref, purpose: "knowledge", objectives: [], support: [{ ref: video.ref, channel: "transcript" }] }], overlaps: [], interpretation: [] }), course);
	const availability = availabilityView(course, alignmentView(course, answer), anatomy(course).lessons);
	assert.equal(availability.checks[0]!.available, "transcript");
	assert.equal(availability.checks[0]!.instructionLinks[0]!.text, videoText);
	assert.equal(availability.checks[0]!.instructionLinks[0]!.channel, "transcript");
	assert.match(renderAvailability(availability), /In a transcript only/);
	assert.doesNotMatch(renderAvailability(availability), /class="avail look"/);
	const concepts = parseConcepts(JSON.stringify({ view: "concepts", promptVersion: "concepts/4-projection-2", courseHash: courseHash(course), model: "synthetic-test", concepts: [{ id: "C1", name: "Final state", prerequisites: [], occurrences: [{ ref: video.ref, role: "example" }] }], interpretation: [] }), course);
	assert.deepEqual(concepts.concepts[0]!.occurrences, [{ ref: video.ref, role: "example" }]);
});

test("all shared-guide prompts advance, and stale versions or interpretation fingerprints are rejected", async () => {
	const course = await fixture(), dir = await mkdtemp(join(tmpdir(), "trace-transcript-bundles-"));
	try {
		const versions = [
			["alignment", "alignment/14", "alignment/13", prepareAlignment], ["concepts", "concepts/4", "concepts/3", prepareConcepts], ["terms", "terms/2", "terms/1", prepareTerms], ["tasks", "tasks/3", "tasks/2", prepareTasks], ["visuals", "visuals/2", "visuals/1", prepareVisuals], ["distinctions", "distinctions/2", "distinctions/1", prepareDistinctions],
		] as const;
		for (const [view, version, old, prepare] of versions) {
			const path = join(dir, view); await prepare(course, path);
			assert.equal(JSON.parse(await readFile(join(path, "manifest.json"), "utf8")).promptVersion, `${version}-projection-2`);
			const prompt = await readFile(join(path, "prompt.md"), "utf8");
			assert.ok(prompt.includes(`"promptVersion": "${version}-projection-2"`));
			assert.match(prompt, /Transcripts are a separate channel/);
			assert.throws(() => readAnswer(JSON.stringify({ view, promptVersion: `${old}-projection-2`, courseHash: courseHash(course) }), course, view, version), /expected view/);
		}
		const report = join(dir, "report.json"); await writeFile(report, JSON.stringify({ courseHash: courseHash(course) }));
		await prepareRecommendations(course, report, join(dir, "recommendations"));
		assert.equal(JSON.parse(await readFile(join(dir, "recommendations", "manifest.json"), "utf8")).promptVersion, "recommendations/3-projection-2");
		assert.throws(() => readAnswer(JSON.stringify({ view: "recommendations", promptVersion: "recommendations/2-projection-2", courseHash: courseHash(course) }), course, "recommendations", "recommendations/3"), /expected view/);
		const oldHash = createHash("sha256").update(`trace-inspect/2\0${course.revision}`).digest("hex");
		assert.notEqual(courseHash(course), oldHash);
		assert.equal(courseHash(course), createHash("sha256").update(`trace-inspect/3\0${course.revision}`).digest("hex"));
		assert.throws(() => readAnswer(JSON.stringify({ view: "terms", promptVersion: "terms/2-projection-2", courseHash: oldHash }), course, "terms", "terms/2"), /different course revision/);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
