import assert from "node:assert/strict";
import { test } from "node:test";
import { blockTexts, narrations } from "../src/text.ts";

test("narration is read once for every view: page and block scripts, audio length, blanks left out", () => {
	const page = { narration: "Welcome to the page.", narrationDuration: 2.5 };
	const blocks = [{ data: { content: "<p>Hi</p>", narration: "  " } }, { data: { items: [{ narration: "Step one, then step two." }] } }];
	assert.deepEqual(narrations([page, blocks]), [
		{ script: "Welcome to the page.", seconds: 2.5 },
		{ script: "Step one, then step two.", seconds: null },
	]);
	assert.deepEqual(blockTexts({ id: "b", type: "text", line: 1, data: { content: "<p>Shown</p>", narration: "Said\n aloud" } }), {
		screen: "Shown", tooltips: [], narration: ["Said aloud"], transcript: [],
	});
});

test("spoken narration reads glossary and link syntax as words and leaves out voice cues", async () => {
	const { spoken } = await import("../src/text.ts");
	assert.equal(spoken("[sincerely]Use a [hydrograph]{A plot of level against time} to read the [trend](https://x.test). [pause] **Then** report."), "Use a hydrograph to read the trend. Then report.");
});

test("glossary definitions may hold braces, and brackets in code are not voice cues", async () => {
	const { spoken, tooltips } = await import("../src/text.ts");
	const script = 'Keep a [lookup]{Maps a gauge name to its readings, like `{"weir": [1.2]}`.} and call `latest(readings[gauge])`.';
	assert.equal(spoken(script), "Keep a lookup and call `latest(readings[gauge])`.");
	assert.deepEqual(tooltips({ content: script }), [{ term: "lookup", text: 'Maps a gauge name to its readings, like `{"weir": [1.2]}`.' }]);
});
