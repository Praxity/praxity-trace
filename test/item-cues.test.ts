import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { parseCourse, courseHash } from "../src/inspect.ts";
import { binomialTail, CUES, itemCuesView, keyedChoices, parseItemCues, prepareItemCues, probeOrder, PROMPT_VERSION } from "../src/item-cues.ts";
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
	{ cue: "hedged-key", options: ["Usually red", "Blue", "Green", "Violet"] },
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
		choicesOnly: { model: "synthetic-solver", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, choice: probeOrder(item).indexOf(item.key) + 1, cue: "guessed", note: "synthetic wording cue" })) },
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
	assert.deepEqual([...Object.values(view.banks[1]!.cueCounts), ...Object.values(view.banks[1]!.writingCounts)], Array(7).fill(0));
	assert.equal(view.banks[1]!.convergenceExpected, 0.25, "A 2x2 balanced design ties all options");
	assert.deepEqual(view.banks[1]!.spreads[0]!.authoredKeyPositions, [1, 0, 0, 0]); assert.deepEqual(view.banks[1]!.spreads[0]!.keyLengthRanks, [1, 0, 0, 0]);
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

test("probe scores keep each bank and solver cue; cover text remains unjudged", () => {
	const course = load(), raw = payload();
	raw.coverTheOptions.answers[0]!.answer = " RED, SQUARE! ";
	const view = itemCuesView(course, parseItemCues(JSON.stringify(raw), course));
	assert.equal(view.banks[0]!.choicesOnly!.right, 8);
	assert.equal(view.banks[0]!.choicesOnly!.chanceExpected, 2);
	assert.equal(view.banks[0]!.choicesOnly!.p, 1 / 65536);
	assert.equal(view.banks[0]!.choicesOnly!.items[0]!.note, "synthetic wording cue");
	assert.equal(view.banks[0]!.coverTheOptions!.right, null); assert.equal(view.banks[0]!.coverTheOptions!.pending, 8);
	assert.equal(view.banks[1]!.coverTheOptions!.right, null);
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
	bad(raw => { raw.coverTheOptions.model = ""; }, /actual model/);
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
	assert.deepEqual([...choices[0].options].sort(), ["Red square", "Red circle", "Blue square", "Green dot"].sort());
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
	assert.match(html, /Item cues/); assert.match(html, /The key repeats words/); assert.match(html, /synthetic wording cue/);
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

function replaceOptions(raw: ReturnType<typeof fixture>, options: string[], key = 0) {
	const block = raw.lessons[1]!.pages[0]!.blocks[0]!;
	block.texts.filter(text => text.role === "option").forEach((text, i) => { text.value = options[i]!; });
	block.assessment.options.forEach((option, i) => { option.label = options[i]!; option.correct = i === key; });
	return raw;
}

test("pooled course scores sum lesson results with exact upper and lower tails", () => {
	const raw = fixture();
	raw.lessons[1]!.pages[0]!.blocks[0]!.texts = raw.lessons[1]!.pages[0]!.blocks[0]!.texts.filter(text => !text.ref.endsWith("/3"));
	raw.lessons[1]!.pages[0]!.blocks[0]!.assessment.options.pop();
	const course = parseCourse(JSON.stringify(raw));
	const answer = { choicesOnly: { model: "operator-recorded", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, choice: probeOrder(item).indexOf(item.key) + 1, cue: "guessed" as const, note: "Synthetic" })) }, coverTheOptions: { model: "operator-recorded", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, answer: "can't tell" })) } };
	const view = itemCuesView(course, answer);
	assert.equal(view.course.choicesOnly!.right, 9);
	assert.equal(view.course.choicesOnly!.total, 9);
	assert.equal(view.course.choicesOnly!.right, view.banks.reduce((sum, bank) => sum + bank.choicesOnly!.right, 0));
	assert.equal(view.course.choicesOnly!.chanceExpected, 2 + 1 / 3);
	assert.equal(view.course.choicesOnly!.p, 1 / (4 ** 8 * 3));
	assert.equal(view.course.choicesOnly!.pLow, 1);
	assert.equal(view.banks[1]!.choicesOnly!.p, 1 / 3);
	assert.equal(view.banks[1]!.choicesOnly!.pLow, 1);
	const html = renderItemCues(view);
	assert.match(html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)![1]!, /^<tr[^>]*><th[^>]*>Course<\/th>/);
	assert.ok(html.indexOf("Course</th>") < html.indexOf("L1 · leaking</th>"));
	assert.match(html, /Too few items to compare with guessing/);
	assert.doesNotMatch(html, /p = \d[^<]*e-/);
	for (const response of answer.choicesOnly.answers) {
		const item = keyedChoices(course).items.find(item => item.ref === response.ref)!;
		response.choice = probeOrder(item).indexOf((item.key + 1) % item.options.length) + 1;
	}
	const low = itemCuesView(course, answer);
	assert.equal(low.course.choicesOnly!.p, 1);
	assert.ok(Math.abs(low.course.choicesOnly!.pLow - (3 / 4) ** 8 * (2 / 3)) < 1e-15);
	assert.ok(Math.abs(low.banks[1]!.choicesOnly!.pLow - 2 / 3) < 1e-15);
	assert.equal(binomialTail(0, Array(32).fill(0.25), "lower"), 0.75 ** 32);
});

test("summary tail headers keep meaningful sort names without YAML quoting", () => {
	const tree = parseFragment(renderItemCues(itemCuesView(load())));
	const headers: string[] = [];
	const text = (node: DefaultTreeAdapterTypes.Node): string => "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(text).join("") : "";
	const walk = (node: DefaultTreeAdapterTypes.Node) => {
		if ("tagName" in node && node.tagName === "th" && node.attrs.some(attr => attr.name === "scope" && attr.value === "col")) headers.push(text(node));
		if ("childNodes" in node) node.childNodes.forEach(walk);
	};
	walk(tree);
	assert.ok(headers.includes("Upper tail (at least this many)"));
	assert.ok(headers.includes("Lower tail (at most this many)"));
	assert.ok(headers.every(header => !header.includes(": ")), "Sort names must not require quoted YAML scalars");
});

test("independent probe permutations remove an authored first-key pattern and map every response back", async context => {
	const raw = fixture(), lesson = raw.lessons[1]!;
	raw.lessons = [lesson];
	lesson.pages[0]!.blocks = Array.from({ length: 32 }, (_, i) => {
		const block = structuredClone(lesson.pages[0]!.blocks[0]!);
		block.ref = `choice-${i}`;
		block.texts.forEach((text, j) => { text.ref = `choice-${i}/text-${j}`; });
		return block;
	});
	const course = parseCourse(JSON.stringify(raw)), items = keyedChoices(course).items;
	assert.ok(items.every(item => item.key === 0));
	assert.equal(new Set(items.map(item => probeOrder(item).indexOf(0))).size, 4);
	const answer = { choicesOnly: { model: "constant-first", answers: items.map(item => ({ ref: item.ref, choice: 1, cue: "guessed" as const, note: "Always first in the probe" })) }, coverTheOptions: { model: "stem-solver", answers: items.map(item => ({ ref: item.ref, answer: "can't tell" })) } };
	const right = itemCuesView(course, answer).course.choicesOnly!.right;
	assert.ok(right > 0 && right < 32);
	for (const row of answer.choicesOnly.answers) row.choice = probeOrder(items.find(item => item.ref === row.ref)!).indexOf(0) + 1;
	assert.equal(itemCuesView(course, answer).course.choicesOnly!.right, 32);
	const dir = await mkdtemp(join(tmpdir(), "trace-item-cues-order-")); context.after(() => rm(dir, { recursive: true, force: true }));
	await prepareItemCues(course, join(dir, "first"));
	for (const block of lesson.pages[0]!.blocks) block.assessment.options.forEach((option, i) => { option.correct = i === 2; });
	await prepareItemCues(parseCourse(JSON.stringify(raw)), join(dir, "flipped"));
	assert.equal(await readFile(join(dir, "first/choices-only/items.json"), "utf8"), await readFile(join(dir, "flipped/choices-only/items.json"), "utf8"));
	const manifest = JSON.parse(await readFile(join(dir, "first/manifest.json"), "utf8"));
	assert.deepEqual(Object.keys(manifest), ["view", "promptVersion", "courseHash"]);
});

test("cover answers need semantic judgement, never literal scoring or free-response p values", () => {
	const raw = fixture(), course = parseCourse(JSON.stringify(replaceOptions(raw, ["0 degrees Celsius", "10 degrees Celsius", "20 degrees Celsius", "30 degrees Celsius"])));
	const answer = { choicesOnly: { model: "choice-solver", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, choice: 1, cue: "guessed" as const, note: "" })) }, coverTheOptions: { model: "stem-solver", judgeModel: "separate-judge", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, answer: "Zero degrees Celsius", coverJudgement: undefined as "matches" | "differs" | "cantTell" | undefined })) } };
	let view = itemCuesView(course, answer), cover = view.course.coverTheOptions!;
	assert.equal(cover.right, null); assert.equal(cover.pending, 9); assert.equal(cover.status, "not judged");
	assert.ok(!Object.hasOwn(cover, "p"));
	assert.ok(cover.items.every(item => item.judgement === null));
	assert.match(renderItemCues(view), /Needs judgement · not judged/);
	assert.match(renderItemCues(view), /0 degrees Celsius/);
	assert.match(renderItemCues(view), /Zero degrees Celsius/);
	answer.coverTheOptions.answers[8]!.coverJudgement = "matches";
	answer.coverTheOptions.answers[0]!.coverJudgement = "differs";
	answer.coverTheOptions.answers[1]!.coverJudgement = "cantTell";
	const parsed = parseItemCues(JSON.stringify({ view: "item-cues", promptVersion: `${PROMPT_VERSION}-projection-2`, courseHash: courseHash(course), ...answer }), course);
	view = itemCuesView(course, parsed); cover = view.course.coverTheOptions!;
	assert.equal(cover.right, 1); assert.equal(cover.judged, 3); assert.equal(cover.pending, 6);
	assert.equal(cover.status, "partly judged");
	assert.deepEqual(cover.outcomes, { matches: 1, differs: 1, cantTell: 1 });
	assert.equal(view.banks[1]!.coverTheOptions!.right, 1);
	assert.match(renderItemCues(view), /separate-judge/);
	assert.throws(() => parseItemCues(JSON.stringify({ view: "item-cues", promptVersion: `${PROMPT_VERSION}-projection-2`, courseHash: courseHash(course), ...answer, coverTheOptions: { ...answer.coverTheOptions, answers: answer.coverTheOptions.answers.map(row => ({ ...row, coverJudgement: "wrong" })) } }), course), /coverJudgement/);
});

test("balanced unequal-length 2x2 options never get an item convergence flag", () => {
	const options = ["Enlarge figures and add written status labels", "Enlarge figures and use a different palette", "Increase contrast and add written status labels", "Increase contrast and use a different palette"];
	for (let key = 0; key < 4; key++) {
		const course = parseCourse(JSON.stringify(replaceOptions(fixture(), options, key)));
		const row = itemCuesView(course).banks[1]!;
		assert.ok(!row.items[0]!.flags.some(flag => flag.cue === "convergence"));
		assert.ok(!Object.hasOwn(row.cueCounts, "convergence"));
		assert.equal(row.convergence!.chanceExpected, 0.25);
		assert.ok([0, 0.5].includes(row.convergence!.expected));
		assert.equal(row.convergence!.expected ? row.convergence!.p : row.convergence!.pLow, 0.5);
	}
	const balancedRow = itemCuesView(load()).banks[1]!;
	assert.equal(balancedRow.convergence!.p, 1); assert.equal(balancedRow.convergence!.pLow, 1);
});

test("French and unknown locales explicitly skip English rules while checking duplicate text", async context => {
	const directory = await mkdtemp(join(tmpdir(), "trace-item-cues-locales-")); context.after(() => rm(directory, { recursive: true, force: true }));
	for (const locale of ["fr-CA", "und", ""]) {
		const raw = replaceOptions(fixture(), ["Bleu", "Toujours rouge", "Vert", "Vert"]); raw.course.locale = locale;
		const view = itemCuesView(parseCourse(JSON.stringify(raw))), row = view.banks[1]!;
		assert.equal(row.cueCounts["distractor-absolutes"], null);
		assert.equal(row.cueCounts["stem-echo"], null); assert.equal(row.convergence, null); assert.equal(row.consultation, null);
		assert.equal(row.applicability["hedged-key"], "Not checked: English-only rule");
		assert.equal(row.cueCounts.duplicate, 1); assert.equal(row.applicability.duplicate, "Checked");
		assert.ok(!row.items[0]!.flags.some(flag => flag.cue === "distractor-absolutes"));
		const html = renderItemCues(view);
		for (const mode of ["mode-chart", "mode-table"]) assert.match(html.slice(html.indexOf(`class="${mode}"`)), /Not checked: English-only rule/);
		const input = join(directory, "input.json"), out = join(directory, `report-${locale || "unknown"}`);
		await writeFile(input, JSON.stringify(raw));
		const cli = spawnSync(process.execPath, [resolve("src/cli.ts"), "report", input, "--out", out], { encoding: "utf8" });
		assert.equal(cli.status, 0, cli.stderr);
		assert.equal(JSON.parse(await readFile(join(out, "report.json"), "utf8")).itemCues.course.cueCounts["stem-echo"], null);
		assert.match(await readFile(join(out, "report.html"), "utf8"), /Not checked: English-only rule/);
	}
});

test("position spreads use known fixed order and longest counts include ties with guessing expectations", () => {
	const raw = replaceOptions(fixture(), balanced, 2), course = parseCourse(JSON.stringify(raw));
	const block = course.lessons[1]!.pages[0]!.blocks[0]!;
	for (const shuffle of [undefined, true, false]) {
		block.assessment!.shuffle = shuffle;
		const row = itemCuesView(course).banks[1]!, spread = row.spreads[0]!;
		assert.equal(row.items[0]!.keyLengthRank, 3); assert.equal(row.items[0]!.keyLongest, true);
		assert.equal(spread.keyLongest, 1); assert.equal(spread.longestExpected, 0.5);
		assert.deepEqual(spread.authoredKeyPositions, [0, 0, 1, 0]);
		assert.deepEqual(spread.keyPositions, shuffle === false ? [0, 0, 1, 0] : [0, 0, 0, 0]);
		assert.equal(spread.positionExpected, shuffle === false ? 0.25 : 0);
		assert.deepEqual(spread.rankExpected, [0.5, 0, 0.5, 0]);
		assert.equal(spread.evenRankReference, 0.25);
		assert.equal(spread.rankBand, null);
		assert.match(renderItemCues(itemCuesView(course)), shuffle === undefined ? /Shuffle unknown/ : shuffle ? /Shuffled at runtime/ : /Position 3/);
	}
	const twenty = fixture();
	twenty.lessons[1]!.pages[0]!.blocks = Array.from({ length: 20 }, (_, i) => { const b = structuredClone(twenty.lessons[1]!.pages[0]!.blocks[0]!); b.ref = `rank-${i}`; b.texts.forEach((t, j) => { t.ref = `rank-${i}/text-${j}`; }); return b; });
	assert.deepEqual(itemCuesView(parseCourse(JSON.stringify(twenty))).banks[1]!.spreads[0]!.rankBand, ["above", "below", "below", "below"]);
});

test("hedges exclude May, ability and negation; consultation stays a bank share", () => {
	for (const key of ["May", "People who could not use a mouse", "The person may not enter", "The person might not enter", "Consult the person"]) {
		const raw = replaceOptions(fixture(), [key, "June", "July", "August"]), row = itemCuesView(parseCourse(JSON.stringify(raw))).banks[1]!;
		assert.ok(!row.items[0]!.flags.some(flag => flag.cue === "hedged-key"), key);
		assert.equal(row.consultation!.count, key.startsWith("Consult") ? 1 : 0);
	}
	for (const key of ["Usually a different response", "Often a different response", "This may improve access", "This might improve access", "It can depend on context"]) {
		const row = itemCuesView(parseCourse(JSON.stringify(replaceOptions(fixture(), [key, "June", "July", "August"])))).banks[1]!;
		assert.ok(row.items[0]!.flags.some(flag => flag.cue === "hedged-key"), key);
	}
});

test("English stem echoes include simple plural and verb inflections", () => {
	const raw = replaceOptions(fixture(), ["Disabilities supported", "Red", "Blue", "Green"]);
	raw.lessons[1]!.pages[0]!.blocks[0]!.texts[0]!.value = "Disability supports";
	assert.equal(itemCuesView(parseCourse(JSON.stringify(raw))).banks[1]!.cueCounts["stem-echo"], 1);
});

test("writing checks, general qualifiers and structured solver causes have separate actionable counts", () => {
	const view = itemCuesView(load(), parseItemCues(JSON.stringify(payload()), load()));
	assert.ok(!Object.hasOwn(view.course.cueCounts, "near-duplicate"));
	assert.ok(!Object.hasOwn(view.course.cueCounts, "shared-lead"));
	assert.ok(view.course.writingCounts["near-duplicate"]! > 0); assert.ok(view.course.writingCounts["shared-lead"]! > 0);
	assert.equal(view.course.choicesOnly!.cueCounts.guessed, 9);
	assert.equal(view.banks[0]!.choicesOnly!.cueCounts.guessed, 8);
	const bad = payload(); bad.choicesOnly.answers[0]!.cue = "invented";
	assert.throws(() => parseItemCues(JSON.stringify(bad), load()), /supported cue code/);
	bad.choicesOnly.answers[0]!.cue = "other"; bad.choicesOnly.answers[0]!.note = "";
	assert.throws(() => parseItemCues(JSON.stringify(bad), load()), /explain other/);
	for (const word of ["Only", "Just", "Merely"]) {
		const row = itemCuesView(parseCourse(JSON.stringify(replaceOptions(fixture(), ["Red", `${word} blue`, "Green", "Violet"])))).banks[1]!;
		assert.equal(row.cueCounts["distractor-qualifiers"], 1); assert.equal(row.cueCounts["distractor-absolutes"], 0);
	}
	for (const word of ["None", "Every", "Completely", "Absolutely", "Entirely"]) assert.equal(itemCuesView(parseCourse(JSON.stringify(replaceOptions(fixture(), ["Red", `${word} blue`, "Green", "Violet"])))).banks[1]!.cueCounts["distractor-absolutes"], 1);
	for (const cue of Object.values(CUES)) assert.ok(cue.fix.length > 15);
	const html = renderItemCues(view);
	assert.match(html, /Spread key length ranks across the bank/); assert.doesNotMatch(html, /make the key shorter/i);
	assert.match(html, /Item-writing checks, not evidence/); assert.match(html, /<ul><li[^>]*>/);
	assert.match(html, /Chosen option/); assert.match(html, /Red square/);
	assert.match(renderItemCues(itemCuesView(load())), /Probes not run/);
	assert.match(renderItemCues(itemCuesView(load())), /A bank can pass them all and still give away its keys/);
});

test("bundle CLI strips attribute, hidden and post-response canaries for exported HTML and both inspect formats", async context => {
	const dir = await mkdtemp(join(tmpdir(), "trace-item-cues-leaks-")); context.after(() => rm(dir, { recursive: true, force: true }));
	const prose = `<span data-correct="ATTRIBUTE_CANARY" data-feedback="ATTRIBUTE_FEEDBACK_CANARY">Red</span><span hidden>HIDDEN_CANARY</span><span aria-hidden="true">ARIA_CANARY</span><span style="display:none">STYLE_CANARY</span><span class="praxity-assessment-feedback">POST_RESPONSE_CANARY</span><script>SCRIPT_CANARY</script>`;
	const data = { question: prose, options: [{ text: prose, correct: true, feedback: "FEEDBACK_FIELD_CANARY" }, { text: "Blue", correct: false }], selectionMode: "single" };
	const legacy = { ok: true, schema: "praxity-inspect/0", studioVersion: "synthetic", course: { title: "Synthetic", locale: "en" }, lessons: [{ file: "lesson.prax", title: "Synthetic", sha256: "synthetic", pages: [{ id: "page", number: 1, title: "Question", blocks: [{ id: "choice", type: "assessment", line: 1, data }] }] }] };
	const raw = fixture(), b = raw.lessons[1]!.pages[0]!.blocks[0]!;
	b.texts.filter(text => text.role === "option").forEach((text, i) => { if (i === 0) { text.value = prose; text.format = "html"; } }); b.assessment.options[0]!.label = prose;
	b.texts[0]!.value = prose; b.texts[0]!.format = "html";
	await writeFile(join(dir, "legacy.json"), JSON.stringify(legacy)); await writeFile(join(dir, "typed.json"), JSON.stringify(raw));
	const exported = join(dir, "export"); await mkdir(exported);
	const native = { stem: [{ type: "text", data: { content: prose, feedback: "NESTED_FEEDBACK_CANARY" } }], response: { type: "choice", selectionMode: "single", options: [{ label: prose, isCorrect: true }, { label: "Blue", isCorrect: false }] } };
	const legacyNative = structuredClone(legacy); Object.assign(legacyNative.lessons[0]!.pages[0]!.blocks[0]!.data, native); delete (legacyNative.lessons[0]!.pages[0]!.blocks[0]!.data as { question?: string }).question;
	await writeFile(join(dir, "legacy-native.json"), JSON.stringify(legacyNative));
	const attr = JSON.stringify({ type: "assessment", data: native }).replace(/&/g, "&amp;").replace(/'/g, "&#39;");
	await writeFile(join(exported, "lesson.html"), `<html lang="en"><head><title>Synthetic</title></head><body><article class="deck-slide" data-deck-slide="p"><div data-block-id="choice" data-block-type="assessment" data-block-json='${attr}'><form>Red Blue</form></div></article></body></html>`);
	const scan = async (path: string): Promise<void> => { for (const entry of await readdir(path, { withFileTypes: true })) { const file = join(path, entry.name); if (entry.isDirectory()) await scan(file); else assert.doesNotMatch(await readFile(file, "utf8"), /\w+_CANARY|data-correct|data-feedback|<span|"correct"/, file); } };
	for (const [name, input] of [["legacy", join(dir, "legacy.json")], ["legacy-native", join(dir, "legacy-native.json")], ["typed", join(dir, "typed.json")], ["export", exported]]) {
		const out = join(dir, `bundle-${name}`), cli = spawnSync(process.execPath, [resolve("src/cli.ts"), "prepare", "item-cues", input!, "--out", out], { encoding: "utf8" });
		assert.equal(cli.status, 0, cli.stderr); await scan(out);
		const rows = JSON.parse(await readFile(join(out, "choices-only/items.json"), "utf8"));
		assert.ok(rows.some((row: { options: string[] }) => row.options.includes("Red")));
		assert.ok(JSON.parse(await readFile(join(out, "cover-the-options/items.json"), "utf8")).some((row: { stem: string }) => row.stem === "Red"));
	}
	const out = join(dir, "bundle-typed");
	assert.doesNotMatch(await readFile(join(out, "cover-the-options/prompt.md"), "utf8"), /literal|paraphrases remain/);
	assert.match(await readFile(join(out, "prompt.md"), "utf8"), /operator records the actual model names/);
	assert.match(await readFile(join(out, "prompt.md"), "utf8"), /separate fresh judge agent/);
	assert.match(await readFile(join(out, "choices-only/prompt.md"), "utf8"), /only-true-on-its-own/);
});

test("exported and inspect multiple-selection choices with one true key stay excluded", async context => {
	const dir = await mkdtemp(join(tmpdir(), "trace-item-cues-multiple-")); context.after(() => rm(dir, { recursive: true, force: true }));
	const response = { type: "choice", selectionMode: "multiple", options: [{ label: "Red", isCorrect: true }, { label: "Blue", isCorrect: false }] };
	const native = { stem: [{ type: "text", data: { content: "Choose all" } }], response };
	await writeFile(join(dir, "lesson.html"), `<html lang="en"><body><article class="deck-slide" data-deck-slide="p"><div data-block-id="choice" data-block-type="assessment" data-block-json='${JSON.stringify({ data: native })}'><input type="checkbox">Red Blue</div></article></body></html>`);
	const html = await readHtmlCourse(dir);
	assert.equal(html.lessons[0]!.pages[0]!.blocks[0]!.data.selectionMode, "multiple");
	assert.equal(keyedChoices(html).items.length, 0); assert.match(keyedChoices(html).excluded[0]!.reason, /Multiple selection/);
	const legacy = parseCourse(JSON.stringify({ ok: true, schema: "praxity-inspect/0", studioVersion: "synthetic", course: { title: "Synthetic", locale: "en" }, lessons: [{ file: "lesson.prax", title: "Synthetic", sha256: "synthetic", pages: [{ id: "p", number: 1, title: "Choose", blocks: [{ type: "assessment", id: "choice", line: 1, data: { ...native, options: [{ text: "Red", correct: true }, { text: "Blue", correct: false }] } }] }] }] }));
	assert.equal(keyedChoices(legacy).items.length, 0); assert.match(keyedChoices(legacy).excluded[0]!.reason, /Multiple selection/);
});

test("empty courses omit the view, and stems missing media or code carry a visible qualification", async context => {
	const raw = fixture(); raw.lessons = [];
	assert.equal(renderItemCues(itemCuesView(parseCourse(JSON.stringify(raw)))), "");
	const course = load(), page = course.lessons[1]!.pages[0]!;
	page.blocks.push({ id: "code", type: "code", line: 10, data: { code: "example()" } });
	const dir = await mkdtemp(join(tmpdir(), "trace-item-cues-media-")); context.after(() => rm(dir, { recursive: true, force: true }));
	await prepareItemCues(course, dir);
	assert.match(await readFile(join(dir, "cover-the-options/items.json"), "utf8"), /Stem depends on non-text content/);
	const answer = { choicesOnly: { model: "solver", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, choice: 1, cue: "guessed" as const, note: "" })) }, coverTheOptions: { model: "stem", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, answer: "can't tell" })) } };
	assert.match(renderItemCues(itemCuesView(course, answer)), /Stem depends on non-text content/);
});
