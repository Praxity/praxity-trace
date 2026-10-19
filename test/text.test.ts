import assert from "node:assert/strict";
import { test } from "node:test";
import { blockTexts, formattedText, narrations, narrationText, previewLines, visibleText, tooltips } from "../src/text.ts";
import { withPageNarration } from "../src/inspect.ts";
import { sentences } from "../src/language.ts";

test("typed Markdown projects glossary terms without definitions and preserves escaped literal syntax", () => {
	const value = "Use [Red square]{TOOLTIP_CANARY: the key says Red square; {nested: true}} beside \\[literal]{shown}.";
	const texts = [{ ref: "option", role: "option", format: "markdown" as const, value, location: null }, { ref: "definition", role: "glossary-definition", format: "plain" as const, value: "Definition stays separate", location: null }];
	assert.equal(formattedText(texts[0]!), "Use Red square beside [literal]{shown}.");
	assert.deepEqual(visibleText({ typedTexts: texts }), ["Use Red square beside [literal]{shown}."]);
	const block = { id: "choice", type: "assessment", line: 1, data: { typedTexts: texts } };
	assert.equal(blockTexts(block).screen, "Use Red square beside [literal]{shown}.");
	assert.deepEqual(previewLines([block], ""), [{ kind: "item", text: "Use Red square beside [literal]{shown}." }]);
	assert.equal(tooltips(block.data)[0]!.text, "Definition stays separate");
});

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

test("voice cues cannot erase a paragraph boundary in an authored narration script", () => {
	const scripts = narrations({ narration: "Keep the\npanel steady [pause]\n\nRead the ledger" });
	assert.deepEqual(sentences(narrationText(scripts[0]!)), ["Keep the panel steady", "Read the ledger"]);
	for (const script of ["Keep the\n[pause]\npanel steady", "Keep the\r\n[pause]\r\npanel steady", "Keep the\n[pause] [sincerely]\npanel steady"]) {
		assert.deepEqual(sentences(narrationText(narrations({ narration: script })[0]!)), ["Keep the panel steady"]);
	}
	for (const script of ["Keep the panel steady\n\n[pause]\nRead the ledger", "Keep the panel steady\n[pause]\n\nRead the ledger"]) {
		assert.deepEqual(sentences(narrationText(narrations({ narration: script })[0]!)), ["Keep the panel steady", "Read the ledger"]);
	}
});

test("page and block narration stay separate sentences without changing reviewer text", () => {
	const page = withPageNarration({ id: "p", number: 1, title: "Page", data: { narration: "Keep the panel steady" }, blocks: [{ id: "b", type: "text", line: 1, data: { narration: "Read the ledger" } }] });
	assert.deepEqual(sentences(narrationText(narrations(page.blocks[0]!.data)[0]!)), ["Keep the panel steady", "Read the ledger"]);
	assert.deepEqual(blockTexts(page.blocks[0]!).narration, ["Keep the panel steady Read the ledger"]);
});
