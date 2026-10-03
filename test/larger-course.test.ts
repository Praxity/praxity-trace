import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { anatomy, isKnowledgeCheck } from "../src/anatomy.ts";
import { parseCourse } from "../src/inspect.ts";
import { buildPlaces, indexCourse } from "../src/places.ts";
import { blockTexts, countWords, narrations, narrationText, wordCount } from "../src/text.ts";

const fixture = new URL("./fixtures/lantern-marsh/", import.meta.url);
const course = parseCourse(readFileSync(new URL("inspect.json", fixture), "utf8"));
const measured = anatomy(course);
const index = indexCourse(course);

test("larger synthetic course retains manifest order and authored source pointers", () => {
	assert.equal(course.schema, "praxity-inspect/1");
	assert.equal(course.projectionVersion, 2);
	assert.deepEqual(course.lessons.map(lesson => lesson.file), [
		"01-route.prax", "02-shutters.prax", "03-ledger.prax", "04-bells.prax",
		"05-branch.prax", "06-shutter-motion.prax", "07-repair.prax", "08-handoff.prax", "09-fieldbook.prax",
	]);
	assert.equal(course.lessons.length, 9);
	assert.deepEqual(measured.lessons.map(lesson => lesson.pages), [4, 4, 4, 4, 5, 4, 4, 4, 4]);
	assert.equal(measured.lessons.reduce((total, lesson) => total + lesson.pages, 0), 37);
	for (const lesson of course.lessons) {
		const bytes = readFileSync(new URL(`source/${lesson.file}`, fixture));
		assert.equal(lesson.sha256, createHash("sha256").update(bytes).digest("hex"), lesson.file);
		assert.equal(lesson.unlinkedNarrationCount, 0, lesson.file);
	}
	const places = buildPlaces(course, index.blocks.map(item => item.ref));
	for (const item of index.blocks) {
		assert.equal(index.sourceBlock(item.block.ref!)?.ref, item.ref);
		assert.deepEqual(places[item.ref]?.location, item.block.location);
		assert.equal(places[item.ref]?.file, item.lesson);
	}
});

test("branch destinations retain authored locations and the keyed reply", () => {
	const branch = course.lessons[4]!;
	assert.equal(branch.pages.length, 5);
	const expected = [
		{ page: 3, id: "quiet-path", title: "Quiet path", line: 43 },
		{ page: 4, id: "repeat-path", title: "Repeat path", line: 56 },
		{ page: 5, id: "shared-handoff", title: "Shared handoff", line: 66 },
	];
	const source = readFileSync(new URL("source/05-branch.prax", fixture), "utf8");
	assert.match(source, /when: @route-reply\.result is "correct"\nthen: jump @quiet-path/);
	assert.match(source, /when: @route-reply\.result is "incorrect"\nthen: jump @repeat-path/);
	assert.match(source, /var: rejoin = true\n\n## Quiet path/);
	assert.match(source, /when: rejoin is true\nthen: jump @shared-handoff/);
	for (const target of expected) {
		const page = index.page(5, target.page)!;
		assert.equal(page.id, target.id);
		assert.equal(page.title, target.title);
		const heading = page.blocks.find(block => block.type === "heading")!;
		const headingRef = index.sourceBlock(heading.ref!)!.ref;
		const place = buildPlaces(course, [headingRef])[headingRef]!;
		assert.deepEqual(place.location, { file: "05-branch.prax", startLine: target.line, endLine: target.line + 1 });
		assert.equal(source.split("\n")[place.line! - 1], `## ${target.title}`);
	}
	const reply = branch.pages[1]!.blocks.find(block => block.type === "assessment")!;
	assert.equal(isKnowledgeCheck(reply), true);
	assert.equal(reply.assessment?.scoring.scored, false);
	assert.equal(blockTexts(reply).screen, "What do you tell Mira? Keep the hold until a fresh instruction arrives Send the routine reply now");
	assert.equal(countWords(reply.data), 18);
	assert.equal(reply.location?.startLine, 20);
});

test("sidecar narration counts spoken words and retains disabled evidence", () => {
	const page = course.lessons[0]!.pages[0]!;
	const scripts = narrations([page.data, page.blocks]);
	// Authored page script: 16 words. Body paragraphs: 24, 50 and 15.
	assert.equal(scripts.reduce((total, item) => total + wordCount(narrationText(item)), 0), 105);
	assert.equal(measured.lessons[0]!.pace[0]!.words, 92);
	assert.equal(measured.lessons[0]!.pace[0]!.narrationSeconds, 42);
	const override = course.lessons[0]!.narration!.find(item => item.origin === "sidecar" && item.pageRef === page.ref)!;
	assert.equal(override.value, "Read each station name before you read its instruction. Keep the route ledger in station order.");
	assert.equal(wordCount(override.value), 16);
	assert.equal(override.location?.file, "narration.yaml");
	const disabled = course.lessons[0]!.narration!.find(item => item.disabled)!;
	assert.equal(disabled.value, "This optional spoken reminder is disabled for the name check.");
	assert.equal(disabled.origin, "sidecar");
	assert.equal(index.sourceBlock(disabled.blockRef!)?.page, 3);
	const checkPage = course.lessons[0]!.pages[2]!;
	assert.ok(narrations([checkPage.data, checkPage.blocks]).every(item => !narrationText(item).includes("optional spoken reminder")));
	const silent = course.lessons[8]!;
	assert.ok(silent.narration!.length > 0);
	assert.ok(silent.narration!.every(item => item.disabled));
	for (const [p, silentPage] of silent.pages.entries()) {
		assert.deepEqual(narrations([silentPage.data, silentPage.blocks]), []);
		assert.equal(measured.lessons[8]!.pace[p]!.narrationSeconds, 0);
		assert.ok(measured.lessons[8]!.pace[p]!.words > 0);
	}
});

test("media alternatives and glossary definitions remain separate from visible prose", () => {
	const audio = course.lessons[3]!.pages[1]!.blocks.find(block => block.type === "audio")!;
	const video = course.lessons[5]!.pages[1]!.blocks.find(block => block.type === "video")!;
	assert.equal(audio.media![0]!.source?.availability, "present");
	assert.equal(audio.media![0]!.transcript?.value, "A short high tone sounds. A quiet gap follows. A second short high tone sounds. No speech is present.");
	assert.equal(video.media![0]!.source?.availability, "present");
	assert.equal(video.media![0]!.transcript?.value, "An amber panel moves from the left edge towards a white lantern disc. It stops halfway across the disc. The final state is amber. No speech is present.");
	assert.equal(video.media![0]!.captionTracks[0]!.source?.availability, "present");
	assert.equal(video.media![0]!.captionTracks[0]!.source?.uri, "/assets/shutter-motion.en.vtt");
	for (const block of [audio, video]) assert.ok(!blockTexts(block).screen.includes("No speech is present."));
	const glossary = blockTexts(course.lessons[0]!.pages[0]!.blocks[3]!);
	assert.deepEqual(glossary.tooltips, [{ term: "route ledger", text: "The shared notebook that records station visits in route order." }]);
	assert.equal(glossary.screen, "The route ledger stays at Sedge Gate. Write the station name before adding a signal.");
	assert.equal(countWords(course.lessons[0]!.pages[0]!.blocks[3]!.data), 15);
});
