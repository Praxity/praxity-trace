import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { parseCourse, courseHash } from "../src/inspect.ts";
import { binomialTail, CUES, itemCuesView, keyedChoices, parseItemCues, prepareItemCues, PROMPT_VERSION } from "../src/item-cues.ts";
import { renderItemCues } from "../src/item-cues-view.ts";
import { readHtmlCourse } from "../src/html.ts";

const balanced = ["Red square", "Red circle", "Blue square", "Blue circle"];
const planted = [
	{ cue: "convergence", options: ["Red square", "Red circle", "Blue square", "Green dot"] },
	{ cue: "stem-echo", stem: "Find amber violet", options: ["Amber violet", "Blue", "Green", "Red"] },
	{ cue: "distractor-absolutes", options: ["Red", "Always blue", "Green", "Violet"] },
	{ cue: "duplicate", options: ["Red", "Blue", " blue! ", "Violet"] },
	{ cue: "near-duplicate", options: ["Water moves through copper pipe", "Water moves through steel pipe", "Orange", "Violet"] },
	{ cue: "shared-lead", options: ["Check the current report today", "Check the current report tomorrow", "Green", "Violet"] },
	{ cue: "distractor-qualifiers", options: ["Red", "Just blue", "Green", "Violet"] },
	{ cue: "hedged-key", options: ["Consult the person about their preference", "Blue", "Green", "Violet"] },
] as const;

function fixture() {
	const lesson = (title: string, rows: Array<{ options: readonly string[]; stem?: string }>) => ({ file: `${title}.prax`, title, sha256: "synthetic", narration: [], unlinkedNarration: [], unlinkedNarrationCount: 0,
		pages: [{ ref: `${title}/page`, id: null, number: 1, title, blocks: rows.map((row, i) => ({ ref: `${title}/${i}`, parentRef: null, id: null, type: "assessment", coverage: "text", location: { file: `${title}.prax`, startLine: i + 1, endLine: i + 1 },
			texts: [{ ref: `${title}/${i}/stem`, role: "prompt", format: "plain", value: row.stem ?? "Which symbol is specified?", location: null }, ...row.options.map((value, j) => ({ ref: `${title}/${i}/option/${j}`, role: "option", format: "plain", value, location: null })), { ref: `${title}/${i}/feedback`, role: "feedback", format: "plain", value: "FEEDBACK_CANARY_472", location: null }],
			assessment: { responseType: "choice", correctness: "keyed", selectionMode: "single", options: row.options.map((label, j) => ({ ref: `${title}/${i}/response/${j}`, label, correct: j === 0 })), scoring: { gradingMode: "none", scored: false, points: null, required: false, attempts: 0, feedbackMode: null }, secret: "KEY_CANARY_851" } })) }] });
	return { ok: true, schema: "praxity-inspect/1", projectionVersion: 2, studioVersion: "synthetic", revision: "a".repeat(64), course: { title: "Synthetic cue banks", locale: "en" }, lessons: [lesson("leaking", [...planted]), lesson("clean", [{ options: balanced }])] };
}
const load = () => parseCourse(JSON.stringify(fixture()));
function payload() {
	const course = load();
	return { view: "item-cues", promptVersion: `${PROMPT_VERSION}-projection-2`, courseHash: courseHash(course),
		choicesOnly: { model: "synthetic-solver", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, choice: 1, cue: "synthetic wording cue" })) },
		coverTheOptions: { model: "synthetic-stem-solver", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, answer: "can't tell" })) } };
}

test("exact one-sided binomial tails and heterogeneous chance use literal probabilities", () => {
	assert.ok(Math.abs(binomialTail(12, Array(32).fill(0.25)) - 0.080) < 0.003);
	assert.ok(Math.abs(binomialTail(13, Array(32).fill(0.25)) - 0.038) < 0.003);
	assert.equal(binomialTail(0, [0.25, 0.5]), 1);
	assert.equal(binomialTail(2, [0.25, 0.5]), 0.125);
	assert.equal(binomialTail(1, [0.25, 0.5]), 0.625);
	assert.equal(binomialTail(2, [0, 1]), 0);
	assert.equal(binomialTail(0, []), 1);
	assert.throws(() => binomialTail(2, [0.25]), /Invalid/);
	assert.throws(() => binomialTail(1, [NaN]), /Invalid/);
});

test("every scripted cue fires on its planted item and none on the balanced clean bank", () => {
	const course = load(), view = itemCuesView(course);
	assert.equal(view.banks.length, 2);
	assert.equal(view.banks[0]!.count, 8, "Unscored keyed choices are included");
	for (const [i, plant] of planted.entries()) assert.ok(view.banks[0]!.items[i]!.flags.some(flag => flag.cue === plant.cue), plant.cue);
	assert.deepEqual(Object.keys(CUES).sort(), planted.map(plant => plant.cue).sort());
	assert.deepEqual(view.banks[1]!.items[0]!.flags, []);
	assert.deepEqual(Object.values(view.banks[1]!.cueCounts), Array(8).fill(0));
	assert.equal(view.banks[1]!.convergenceExpected, 0.25, "A 2x2 balanced design ties all options");
	assert.deepEqual(view.banks[1]!.spreads, [{ options: 4, count: 1, keyPositions: [1, 0, 0, 0], keyLengthRanks: [1, 0, 0, 0] }]);
	assert.equal(view.places["1.1.1"]!.location!.startLine, 1);
});

test("length ranks include ties at the lower rank; convergence splits top ties", () => {
	const raw = fixture();
	raw.lessons[1]!.pages[0]!.blocks[0]!.assessment.options.forEach((option, i) => { option.correct = i === 2; });
	const bank = itemCuesView(parseCourse(JSON.stringify(raw))).banks[1]!;
	assert.equal(bank.items[0]!.keyPosition, 3);
	assert.equal(bank.items[0]!.keyLengthRank, 3);
	assert.deepEqual(bank.items[0]!.lengths, [10, 10, 11, 11]);
	assert.equal(bank.convergenceExpected, 0.25);
});

test("shared labels fire, cues disappear when both key and distractor carry the wording", () => {
	const raw = fixture();
	const block = raw.lessons[1]!.pages[0]!.blocks[0]!;
	const options = ["Amber, round", "Amber, square", "Blue", "Green"];
	block.texts.filter(text => text.role === "option").forEach((text, i) => { text.value = options[i]!; });
	block.assessment.options.forEach((option, i) => { option.label = options[i]!; });
	assert.ok(itemCuesView(parseCourse(JSON.stringify(raw))).banks[1]!.items[0]!.flags.some(flag => flag.cue === "shared-lead" && flag.detail.includes("Label before comma")));
	for (const [key, other, absent] of [["Only red", "Only blue", "distractor-absolutes"], ["Just red", "Just blue", "distractor-qualifiers"], ["May red", "May blue", "hedged-key"]] as const) {
		block.texts.filter(text => text.role === "option").forEach((text, i) => { text.value = [key, other, "Green", "Violet"][i]!; });
		block.assessment.options.forEach((option, i) => { option.label = [key, other, "Green", "Violet"][i]!; });
		assert.ok(!itemCuesView(parseCourse(JSON.stringify(raw))).banks[1]!.items[0]!.flags.some(flag => flag.cue === absent));
	}
	block.assessment.options[0]!.label = "Mismatched key text";
	assert.throws(() => keyedChoices(parseCourse(JSON.stringify(raw))), /projection does not match/);
});

test("authored groups own their banks; multi-key, open, missing and overlapping keys are disclosed", () => {
	const raw = fixture();
	const blocks: Array<Record<string, unknown>> = raw.lessons[0]!.pages[0]!.blocks;
	blocks.push({ ref: "group", parentRef: null, id: null, type: "assessmentGroup", coverage: "container", location: null, texts: [], assessmentGroup: { memberRefs: ["leaking/0", "leaking/1"], unresolvedMemberCount: 0, mode: "all", requireAll: false, passingScore: null, pointsOverride: null, aggregation: "mean-of-scored-member-percentages" } });
	const course = parseCourse(JSON.stringify(raw));
	assert.equal(itemCuesView(course).banks.find(bank => bank.id.startsWith("group:"))!.count, 2);
	assert.ok(itemCuesView(course).places["1.1.9"]);
	const edited = fixture();
	edited.lessons[0]!.pages[0]!.blocks[0]!.assessment.options[1]!.correct = true;
	edited.lessons[0]!.pages[0]!.blocks[1]!.assessment.selectionMode = "multiple";
	edited.lessons[0]!.pages[0]!.blocks[2]!.assessment.correctness = "open";
	const result = keyedChoices(parseCourse(JSON.stringify(edited)));
	assert.equal(result.excluded.length, 3);
	assert.match(result.excluded[0]!.reason, /found 2/);
	assert.match(result.excluded[1]!.reason, /Multiple/);
	assert.match(result.excluded[2]!.reason, /open/);
	blocks.push({ ...blocks[8], ref: "overlap" });
	assert.equal(keyedChoices(parseCourse(JSON.stringify(raw))).excluded.filter(row => row.reason.includes("overlapping")).length, 2);
});

test("probe scores keep each bank, solver cue and every response; cover text is compared literally", () => {
	const course = load(), raw = payload();
	raw.coverTheOptions.answers[0]!.answer = " RED, SQUARE! ";
	const view = itemCuesView(course, parseItemCues(JSON.stringify(raw), course));
	assert.equal(view.banks[0]!.choicesOnly!.right, 8);
	assert.equal(view.banks[0]!.choicesOnly!.chanceExpected, 2);
	assert.equal(view.banks[0]!.choicesOnly!.p, 1 / 65536);
	assert.equal(view.banks[0]!.choicesOnly!.items[0]!.cue, "synthetic wording cue");
	assert.equal(view.banks[0]!.coverTheOptions!.right, 1);
	assert.equal(view.banks[1]!.coverTheOptions!.right, 0);
	assert.equal(view.banks[1]!.choicesOnly!.p, 0.25);
	assert.equal(view.banks[0]!.coverTheOptions!.items.length, 8);
});

test("answers reject stale hashes, versions, refs, duplicate/missing responses and invalid choices", () => {
	const course = load();
	const bad = (edit: (raw: ReturnType<typeof payload>) => void, error: RegExp) => { const raw = payload(); edit(raw); assert.throws(() => parseItemCues(JSON.stringify(raw), course), error); };
	bad(raw => { raw.courseHash = "stale"; }, /different course/);
	bad(raw => { raw.promptVersion = "item-cues/0"; }, /promptVersion/);
	bad(raw => { raw.choicesOnly.answers[0]!.ref = "missing"; }, /unique eligible/);
	bad(raw => { raw.choicesOnly.answers[1]!.ref = raw.choicesOnly.answers[0]!.ref; }, /unique eligible/);
	bad(raw => { raw.choicesOnly.answers.pop(); }, /every eligible/);
	for (const value of [0, 5, 1.5]) bad(raw => { raw.choicesOnly.answers[0]!.choice = value; }, /one-based/);
	bad(raw => { raw.choicesOnly.answers[0]!.cue = ""; }, /cue/);
	bad(raw => { raw.coverTheOptions.answers[0]!.answer = ""; }, /answer/);
	bad(raw => { raw.coverTheOptions.model = ""; }, /solver/);
	bad(raw => { raw.coverTheOptions.answers.pop(); }, /every eligible/);
});

test("bundle contains only whitelisted probe prose, no key metadata, feedback or other course context", async context => {
	const directory = await mkdtemp(join(tmpdir(), "trace-item-cues-bundle-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	await prepareItemCues(load(), directory);
	assert.deepEqual((await readdir(directory)).sort(), ["choices-only", "cover-the-options", "manifest.json", "prompt.md"]);
	const choices = JSON.parse(await readFile(join(directory, "choices-only/items.json"), "utf8"));
	const stems = JSON.parse(await readFile(join(directory, "cover-the-options/items.json"), "utf8"));
	assert.deepEqual(Object.keys(choices[0]), ["ref", "options"]);
	assert.deepEqual(choices[0].options, ["Red square", "Red circle", "Blue square", "Green dot"]);
	assert.deepEqual(Object.keys(stems[0]), ["ref", "stem"]);
	assert.equal(stems[1].stem, "Find amber violet");
	assert.ok(!JSON.stringify(choices).includes("Find amber violet"));
	assert.ok(!JSON.stringify(stems).includes("Consult the person"));
	for (const file of ["manifest.json", "prompt.md", "choices-only/items.json", "choices-only/prompt.md", "cover-the-options/items.json", "cover-the-options/prompt.md"]) {
		assert.doesNotMatch(await readFile(join(directory, file), "utf8"), /FEEDBACK_CANARY|KEY_CANARY|"correct"|"key"|"keyPosition"|"scoring"|Synthetic cue banks/);
	}
	await assert.rejects(prepareItemCues(load(), directory), /empty output/);
	const changed = fixture();
	for (const lesson of changed.lessons) for (const block of lesson.pages[0]!.blocks) block.assessment.options.forEach((option, i) => { option.correct = i === 1; });
	await prepareItemCues(parseCourse(JSON.stringify(changed)), join(directory, "flipped"));
	for (const file of ["choices-only/items.json", "cover-the-options/items.json"]) assert.equal(await readFile(join(directory, file), "utf8"), await readFile(join(directory, "flipped", file), "utf8"), "Key changes cannot affect probe text or option order");
});

test("HTML exports and schema 0 use their existing keyed option projection", async () => {
	const html = await readHtmlCourse(resolve("test/fixtures/html/studio"));
	assert.ok(keyedChoices(html).items.length > 0);
	const legacy = parseCourse(JSON.stringify({ ok: true, schema: "praxity-inspect/0", studioVersion: "synthetic", course: { title: "Legacy", locale: "en" }, lessons: [{ file: "lesson.prax", title: "Legacy", sha256: "legacy", pages: [{ id: "page", number: 1, title: "Choice", blocks: [{ id: "choice", type: "assessment", line: 1, data: { question: "Which?", options: [{ text: "Red", correct: false }, { text: "Blue", correct: true }] } }] }] }] }));
	assert.deepEqual(keyedChoices(legacy).items[0]!.options, ["Red", "Blue"]);
	assert.equal(keyedChoices(legacy).items[0]!.key, 1);
});

test("CLI prepares item-cues and always reports scripted cues; optional answers score both probes", async context => {
	const directory = await mkdtemp(join(tmpdir(), "trace-item-cues-cli-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const input = join(directory, "inspect.json"), answer = join(directory, "answer.json"), out = join(directory, "report");
	await writeFile(input, JSON.stringify(fixture())); await writeFile(answer, JSON.stringify(payload()));
	const cli = (...args: string[]) => { const result = spawnSync(process.execPath, [resolve("src/cli.ts"), ...args], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); };
	cli("prepare", "item-cues", input, "--out", join(directory, "bundle"));
	cli("report", input, "--out", out);
	assert.equal(JSON.parse(await readFile(join(out, "report.json"), "utf8")).itemCues.banks.length, 2);
	cli("report", input, "--out", out, "--item-cues", answer);
	assert.equal(JSON.parse(await readFile(join(out, "report.json"), "utf8")).itemCues.banks[0].choicesOnly.right, 8);
	const html = await readFile(join(out, "report.html"), "utf8");
	assert.match(html, /Item cues/); assert.match(html, /Stem words echoed/); assert.match(html, /synthetic wording cue/);
	const tree = parseFragment(renderItemCues(itemCuesView(load(), parseItemCues(JSON.stringify(payload()), load()))));
	const nodes: DefaultTreeAdapterTypes.Element[] = [];
	const walk = (node: DefaultTreeAdapterTypes.Node) => { if ("tagName" in node) nodes.push(node); if ("childNodes" in node) node.childNodes.forEach(walk); }; walk(tree);
	const attrs = (node: DefaultTreeAdapterTypes.Element) => Object.fromEntries(node.attrs.map(a => [a.name, a.value]));
	assert.ok(nodes.some(node => attrs(node).name === "mode-item-cues" && attrs(node).value === "table"));
	for (const node of nodes.filter(node => node.tagName === "table")) assert.equal(attrs(node).role, "table");
	for (const node of nodes.filter(node => attrs(node).role === "region")) { assert.equal(attrs(node).tabindex, "0"); assert.ok(attrs(node)["aria-label"]); }
	assert.ok(nodes.some(node => node.tagName === "td" && attrs(node)["data-label"] === "Cue used"));
	const rejected = spawnSync(process.execPath, [resolve("src/cli.ts"), "prepare", "item-cues", input, "--out", join(directory, "comments"), "--comments", answer], { encoding: "utf8" });
	assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /cannot include designer comments/);
});
