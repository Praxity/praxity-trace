import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { parseCourse, courseHash } from "../src/inspect.ts";
import { binomialTail, englishEvidence, maskItem, MaskSpaceError, CUES, itemCuesView, keyedChoices, parseItemCues as readItemCues, prepareItemCues, probeOrder, PROMPT_VERSION } from "../src/item-cues.ts";
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
const HOLD_DETAIL = "Masked scoring is on hold: included lessons lack confirmed authored English language provenance in this inspect input. Add locale: en to course.yaml or lang: en per lesson. Use a Studio build with inspect language provenance and re-run praxity inspect. Stop and ask; do not compute masked tails by hand.";
const HELD = { applies: false as const, reason: "language-unconfirmed" as const, detail: HOLD_DETAIL };
function probeMetadata(course: ReturnType<typeof load>) {
	return { bundleId: "synthetic-bundle", seed: 0, optionOrder: Object.fromEntries(keyedChoices(course).items.map(item => [item.ref, probeOrder(item, 0)])),
		masked: { ...HELD, bundleId: "synthetic-bundle", probe: "masked" } };
}
function operatorFor(course: ReturnType<typeof load>) {
	return { ...probeMetadata(course), view: "item-cues", promptVersion: `${PROMPT_VERSION}-projection-2`, courseHash: courseHash(course) };
}
function parseItemCues(json: string, course: ReturnType<typeof load>, operator = operatorFor(course)) {
	return readItemCues(json, course, JSON.stringify(operator));
}
const withoutIdentity = (text: string) => JSON.stringify(JSON.parse(text), (key, value) => key === "bundleId" ? undefined : value);
function payload() {
	const course = load();
	return { ...probeMetadata(course), view: "item-cues", promptVersion: `${PROMPT_VERSION}-projection-2`, courseHash: courseHash(course),
		choicesOnly: { bundleId: "synthetic-bundle", probe: "choices-only", model: "synthetic-solver", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, choice: probeOrder(item).indexOf(item.key) + 1, cue: "guessed", note: "synthetic wording cue" })) },
		coverTheOptions: { bundleId: "synthetic-bundle", probe: "cover-the-options", model: "synthetic-stem-solver", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, answer: "can't tell" })) } };
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
	context.after(async () => { await rm(directory, { recursive: true, force: true }); await rm(`${directory}-review`, { recursive: true, force: true }); });
	await prepareItemCues(load(), directory, 0, true);
	assert.deepEqual((await readdir(directory)).sort(), ["choices-only", "cover-the-options", "manifest.json", "masked", "prompt.md"]);
	const choices = JSON.parse(await readFile(join(directory, "choices-only/items.json"), "utf8"));
	const stems = JSON.parse(await readFile(join(directory, "cover-the-options/items.json"), "utf8"));
	assert.deepEqual(Object.keys(choices[0]), ["ref", "bundleId", "probe", "options"]);
	assert.deepEqual([...choices[0].options].sort(), ["Red square", "Red circle", "Blue square", "Green dot"].sort());
	assert.deepEqual(Object.keys(stems[0]), ["ref", "bundleId", "probe", "stem"]);
	assert.equal(stems[1].stem, "Find amber violet");
	assert.ok(!JSON.stringify(choices).includes("Find amber violet"));
	assert.ok(!JSON.stringify(stems).includes("Consult the person"));
	for (const file of ["manifest.json", "prompt.md", "choices-only/items.json", "choices-only/prompt.md", "cover-the-options/items.json", "cover-the-options/prompt.md", "masked/items.json", "masked/prompt.md"]) {
		assert.doesNotMatch(await readFile(join(directory, file), "utf8"), /FEEDBACK_CANARY|KEY_CANARY|"correct"|"key"|"keyPosition"|"scoring"|Synthetic cue banks/);
	}
	await assert.rejects(prepareItemCues(load(), directory), /empty output/);
	const changed = fixture();
	for (const lesson of changed.lessons) for (const block of lesson.pages[0]!.blocks) block.assessment.options.forEach((option, i) => { option.correct = i === 1; });
	await prepareItemCues(parseCourse(JSON.stringify(changed)), join(directory, "flipped"), 0, true);
	for (const file of ["choices-only/items.json", "masked/items.json", "cover-the-options/items.json"]) assert.equal(withoutIdentity(await readFile(join(directory, file), "utf8")), withoutIdentity(await readFile(join(directory, "flipped", file), "utf8")), "Key changes cannot affect probe text or option order");
});

test("HTML exports and schema 0 use their existing keyed option projection", async () => {
	const html = await readHtmlCourse(resolve("test/fixtures/html/studio"));
	assert.ok(keyedChoices(html).items.length > 0);
	const legacy = parseCourse(JSON.stringify({ ok: true, schema: "praxity-inspect/0", studioVersion: "synthetic", course: { title: "Legacy", locale: "en" }, lessons: [{ file: "lesson.prax", title: "Legacy", sha256: "legacy", pages: [{ id: "page", number: 1, title: "Choice", blocks: [{ id: "choice", type: "assessment", line: 1, data: { question: "Which?", options: [{ text: "Red", correct: false }, { text: "Blue", correct: true }] } }] }] }] }));
	assert.deepEqual(keyedChoices(legacy).items[0]!.options, ["Red", "Blue"]);
	assert.equal(keyedChoices(legacy).items[0]!.key, 1);
});

test("CLI prepares item-cues and always reports scripted cues; optional answers score the runnable diagnostics", async context => {
	const directory = await mkdtemp(join(tmpdir(), "trace-item-cues-cli-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const input = join(directory, "inspect.json"), answer = join(directory, "answer.json"), out = join(directory, "report");
	await writeFile(input, JSON.stringify(fixture())); await writeFile(answer, JSON.stringify(payload())); await writeFile(join(directory, "operator.json"), JSON.stringify(operatorFor(load())));
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

test("duplicate detection preserves signs, quantities and meaningful symbols", () => {
	for (const pair of [["-2", "2"], ["−2", "2"], ["+2", "2"], ["2%", "2"], ["2°", "2"], ["<2", ">2"], ["2/3", "23"], ["2.5", "25"], ["2,5", "25"]]) {
		const course = parseCourse(JSON.stringify(replaceOptions(fixture(), [...pair, "Blue!", " blue "])));
		const flags = itemCuesView(course).banks[1]!.items[0]!.flags.filter(flag => flag.cue === "duplicate");
		assert.deepEqual(flags.map(flag => flag.options), [[3, 4]], pair.join(" vs "));
	}
});

async function maskedFixture(context: { after: (cleanup: () => Promise<void>) => void }, stem: string, options: string[], html = false, seed = 17) {
	const dir = await mkdtemp(join(tmpdir(), "trace-r1-mask-")); context.after(() => rm(dir, { recursive: true, force: true }));
	const raw = replaceOptions(fixture(), options), block = raw.lessons[1]!.pages[0]!.blocks[0]!;
	block.texts[0]!.value = stem; block.texts[0]!.format = html ? "html" : "plain";
	const course = parseCourse(JSON.stringify(raw)), bundle = join(dir, "bundle");
	await prepareItemCues(course, bundle, seed);
	const operator = JSON.parse(await readFile(join(`${bundle}-review`, "operator.json"), "utf8"));
	let aligned: ReturnType<typeof maskItem> | null;
	try { aligned = maskItem(keyedChoices(course).items.find(item => item.ref === "2.1.1")!, seed); }
	catch (error) { if (!(error instanceof MaskSpaceError)) throw error; aligned = null; }
	return { course, bundle, operator, aligned, dir };
}

test("masked stem/key overlap has literal shared words", async context => {
	const result = await maskedFixture(context, "Which cell?", ["A cell", "A wall", "A pipe", "A wire"]);
	assert.deepEqual(result.aligned, { stem: "Which xepe?", options: ["A xepe", "A rori", "A vevi", "A mife"] });
});

test("masked a/an agreement preserves literal vowel initials", async context => {
	const result = await maskedFixture(context, "This is an", ["apple", "banana", "orange", "pear"]);
	assert.deepEqual(result.aligned, { stem: "This is an", options: ["arulo", "qupuwi", "amigaf", "tezo"] });
});

test("masked silent-h article sounds preserve the hour honour heir umbrella case", async context => {
	const result = await maskedFixture(context, "This rain cover is an", ["umbrella", "hour", "honour", "heir"]);
	assert.deepEqual(result.aligned, { stem: "This bogu civuc is an", options: ["iqoyuzap", "orun", "awepor", "itut"] });
});

test("masked you-sound article exception preserves unicorn against vowel-sound distractors", async context => {
	const result = await maskedFixture(context, "This magical animal is a", ["unicorn", "apple", "orange", "eagle"]);
	assert.deepEqual(result.aligned, { stem: "This gefezaw oxugoj is a", options: ["jirezip", "arulo", "amigaf", "aqine"] });
});

test("masked initialisms and university preserve an MRI and a university", async context => {
	const result = await maskedFixture(context, "Which is the correct phrase?", ["an MRI", "a university", "an honest heir", "a European user"]);
	assert.deepEqual(result.aligned, { stem: "Which is the tifacey yaqovo?", options: ["an ALI", "a vucepapafi", "an atedap itut", "a Rugomane weka"] });
});

test("generated pseudo-words also retain the requested article sound class", async context => {
	const result = await maskedFixture(context, "Which apple?", ["apple", "banana", "orange", "pear"], false, 25);
	assert.deepEqual(result.aligned, { stem: "Which ijaza?", options: ["ijaza", "kaxiyi", "uniyez", "hapu"] });
});

test("masked singular us is ss endings do not become regular plurals", async context => {
	const result = await maskedFixture(context, "Which is a singular noun?", ["virus", "radius", "analysis", "glass"]);
	assert.deepEqual(result.aligned, { stem: "Which is a tagecele nihu?", options: ["jacak", "zocati", "ahubopam", "fokoz"] });
});

// Literal review cases cover the bounded masking transform independently of eligibility.
test("bounded masking preserves the review article acronym plural and pronoun cases across seeds", () => {
	const cases = [
		{ stem: "Which is a useful utility?", options: ["utility", "useful tool", "urn", "uninsured patient"], expected: [{ stem: "Which is a gojuya mugecuc?", options: ["mugecuc", "gojuya helu", "ici", "uzegiyota lumajoh"] }, { stem: "Which is a coweqo tafarey?", options: ["tafarey", "coweqo hepu", "eza", "abedekatu buxarax"] }, { stem: "Which is a keqayu fupoqil?", options: ["fupoqil", "keqayu fano", "ogi", "amarajago gejexil"] }] },
		{"stem": "This item is an", "options": ["umbrella", "urn", "urgent referral", "urban clinic"], "expected": [{"stem": "This uvaj is an", "options": ["ihezipik", "ici", "omimut fapayaxe", "izawi doleju"]}, {"stem": "This azoy is an", "options": ["iqoyuzap", "eza", "ixiqax pemireji", "orive tukeno"]}, {"stem": "This acej is an", "options": ["ureruket", "ogi", "uxixuz qijejacu", "ipamo joteji"]}]},
		{"stem": "This item is an", "options": ["umbrella", "uninsured patient", "unintended effect", "unimportant detail"], "expected": [{"stem": "This uvaj is an", "options": ["ihezipik", "uzegiyota lumajoh", "iqatakegur ozoziv", "idiravifida gefuzu"]}, {"stem": "This azoy is an", "options": ["iqoyuzap", "abedekatu buxarax", "umeyarofey iliboc", "ejeyufezuqa jozaqi"]}, {"stem": "This acej is an", "options": ["ureruket", "amarajago gejexil", "amuhukoruw epijek", "uveluvorewe xifipu"]}]},
		{"stem": "A chest pain call is an", "options": ["urgent case", "routine check", "scheduled visit", "minor issue"], "expected": [{"stem": "A napuh hiro xena is an", "options": ["omimut rudo", "dahorep check", "livavefil vohic", "jaxer atoti"]}, {"stem": "A pubob ceco rude is an", "options": ["ixiqax luho", "zeduyam check", "foyequjic latol", "wuvoj aqude"]}, {"stem": "A dudem vafo paxe is an", "options": ["uxixuz vicu", "puvatev check", "tirefekiw lorah", "lozel ipuqo"]}]},
		{"stem": "This magical animal is a", "options": ["unicorn", "apple", "orange", "eagle"], "expected": [{"stem": "This ranewix umotul is a", "options": ["junobem", "apeqi", "uxeqoz", "ivufe"]}, {"stem": "This gefezaw oxugoj is a", "options": ["jirezip", "arulo", "amigaf", "aqine"]}, {"stem": "This dizupak oluhuj is a", "options": ["zuqaziq", "ijaza", "uniyez", "ezumi"]}]},
		{"stem": "The water company is a", "options": ["utility", "agency", "office", "insurer"], "expected": [{"stem": "The xawak vanimek is a", "options": ["mugecuc", "umopik", "uzuliw", "utileba"]}, {"stem": "The mulum zivinol is a", "options": ["tafarey", "ohavit", "awayuk", "ulexuma"]}, {"stem": "The gunaw dukoduj is a", "options": ["fupoqil", "agejoy", "ahecuv", "ucufoyi"]}]},
		{"stem":"Set a","options":["SMART goal","vague goal","loose goal","broad goal"],"expected":[{"stem":"Jaq a","options":["KEVAY linu","kocuk linu","hutiy linu","pocig linu"]},{"stem":"Ruk a","options":["BEZUX moco","bohoh moco","woqoj moco","vebaq moco"]},{"stem":"Civ a","options":["BEZIX roda","zonom roda","peyed roda","fazod roda"]}]},
		{"stem":"Upload the course as a","options":["SCORM package","PDF file","video","zip"],"expected":[{"stem":"Apuzim the tewaco as a","options":["BEFIL ruhigel","GOP hahu","gidad","yif"]},{"stem":"Eyamuy the hahaxe as a","options":["ZUTEQ cujozaf","PUH votu","meluk","jeb"]},{"stem":"Eqezik the rupuxe as a","options":["GAXEK pewalur","JIM xira","cagij","xem"]}]},
		{"stem":"Sharing the chart is a","options":["HIPAA violation","policy question","billing matter","task"],"expected":[{"stem":"Guwalil the pugix is a","options":["CEGUF potetereq","butixa noyupiri","fubulep koqudo","wada"]},{"stem":"Kuzanag the qulon is a","options":["YEYAB lenitifib","fexudi quqexetu","yaqodud dohake","dofo"]},{"stem":"Mavikad the nujix is a","options":["JAQOB pedimeriv","biziti lofejenu","ruzufir kipibe","coqa"]}]},
		{"stem":"It connects over a","options":["LAN","WAN","VPN","USB"],"expected":[{"stem":"It liqeyijs unex a","options":["ZIZ","BOZ","WIL","JOD"]},{"stem":"It lenuvins iwel a","options":["GIP","ZOG","VOV","KAC"]},{"stem":"It zumineps ajup a","options":["GUK","QOG","CIP","POX"]}]},
		{"stem":"The scan ordered was an","options":["MRI","CT scan","X-ray","ultrasound"],"expected":[{"stem":"The bavo aroloya was an","options":["ANU","YO bavo","O-buc","egoxowemog"]},{"stem":"The woxe etilehi was an","options":["ALI","BA woxe","E-mod","afamomugoy"]},{"stem":"The qole erugiga was an","options":["IPA","ZI qole","E-hey","ocirajutev"]}]},
		{"stem":"She needed an X-ray and a university consult.","options":["an hour","an HIV test","a virus","a radius"],"expected":[{"stem":"She nehipo an O-buc and a cudipogila consult.","options":["an iway","an AVA caju","a luyiq","a cuhezo"]},{"stem":"She hijoda an E-mod and a vucepapafi consult.","options":["an orun","an ODU gefe","a jacak","a zocati"]},{"stem":"She covudu an E-hey and a reyopereto consult.","options":["an uhal","an IJO cama","a fufav","a pigomu"]}]},
		{"stem":"These dashboards track two","options":["KPIs","metric","goal","target"],"expected":[{"stem":"These wenuneleks lihoh tam","options":["DAYs","coriko","linu","jaxaco"]},{"stem":"These coremabows lewac raj","options":["QACs","kohegu","moco","vufuki"]},{"stem":"These kajihomups bexay nez","options":["ZUTs","xifiwi","roda","kigaku"]}]},
		{"stem":"The app exposes several","options":["APIs","menus","button","window"],"expected":[{"stem":"The iqe uhozehs corizic","options":["OHOs","vijos","muqaqa","zibuxu"]},{"stem":"The ele iwiqejs qaxemon","options":["IPAs","qaqos","faxebu","tamita"]},{"stem":"The ixe ufunuds yijabim","options":["IFOs","yozis","cekagi","pacayo"]}]},
		{"stem": "When I log in, I see", "options": ["a menu", "an error", "a form", "a list"], "expected": [{"stem": "When I guq in, I cif", "options": ["a vijo", "an ibefo", "a meku", "a qeji"]}, {"stem": "When I tef in, I xuw", "options": ["a qaqo", "an upiwe", "a mido", "a foba"]}, {"stem": "When I piq in, I tev", "options": ["a yozi", "an ucubi", "a voqi", "a zado"]}]},
		{"stem": "Which is a singular noun?", "options": ["virus", "radius", "analysis", "glass"], "expected": [{"stem": "Which is a lukukeqi pave?", "options": ["luyiq", "cuhezo", "eyiyuhap", "wefom"]}, {"stem": "Which is a tagecele nihu?", "options": ["jacak", "zocati", "ahubopam", "fokoz"]}, {"stem": "Which is a hizufeku jiqa?", "options": ["fufav", "pigomu", "ekufukun", "gabig"]}]},
	];
	for (const { stem, options, expected } of cases) {
		const item = { ref: "2.1.1", label: "Synthetic", bank: "lesson:2", stem, options, key: 0, shuffle: false, stemDependsOnNonText: false };
		for (const [i, seed] of [0, 17, 25].entries()) {
			assert.deepEqual(maskItem(item, seed), expected[i], `${stem}: ${options.join(" / ")}, seed ${seed}`);
			assert.deepEqual(maskItem({ ...item, key: 3 }, seed), expected[i], "The key cannot change pronunciation or masking");
		}
	}
});

test("masked residual combining marks fail closed at seeds zero and three", async context => {
	const result = await maskedFixture(context, "Which is the correct symbol?", ["q\u0301", "x\u0301", "f\u0301", "j\u0301"]);
	for (const seed of [0, 3]) assert.throws(() => maskItem(keyedChoices(result.course).items.find(item => item.ref === "2.1.1")!, seed), /combining mark after NFC/);
	assert.deepEqual(result.operator.masked, HELD);
});

function courseWithStems(stems: string[]) {
	const raw = fixture(), lesson = raw.lessons[0]!, template = lesson.pages[0]!.blocks[0]!;
	raw.lessons = [lesson];
	lesson.pages[0]!.blocks = stems.map((stem, i) => {
		const block = structuredClone(template); block.ref = `choice/${i}`;
		block.texts.forEach((text, j) => { text.ref = `choice/${i}/text/${j}`; if (text.role === "prompt") text.value = stem; });
		block.assessment.options.forEach((option, j) => { option.ref = `choice/${i}/option/${j}`; });
		return block;
	});
	return raw;
}

test("producer-default en does not let French or Spanish stems run masked", async context => {
	const dir = await mkdtemp(join(tmpdir(), "trace-r2-language-")); context.after(() => rm(dir, { recursive: true, force: true }));
	const languages = JSON.parse(await readFile(resolve("test/fixtures/item-cues-language.json"), "utf8")) as Record<string, string[]>;
	for (const [language, stems] of Object.entries(languages)) {
		const raw = courseWithStems(stems), manifest: { locale?: string } = {};
		raw.course.locale = manifest.locale ?? "en";
		const course = parseCourse(JSON.stringify(raw)), bundle = join(dir, language);
		await prepareItemCues(course, bundle, 17);
		const status = JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8")).masked;
		assert.equal(status.applies, false); assert.equal(status.reason, "language-unconfirmed");
		assert.equal(status.detail, HOLD_DETAIL);
		assert.deepEqual(JSON.parse(await readFile(join(bundle, "masked/items.json"), "utf8")), []);
	}
});

test("an included lesson lang overrides nominal English even with English stems", async context => {
	const raw = fixture(); (raw.lessons[1]! as typeof raw.lessons[1] & { lang: string }).lang = "fr";
	const course = parseCourse(JSON.stringify(raw));
	assert.equal(course.lessons[1]!.lang, "fr");
	const status = itemCuesView(course).course.masked;
	assert.ok(status && !status.applies); assert.equal(status.reason, "language-unconfirmed");
	assert.match(status.detail, /lesson lang is not English at 2\.1\.1/);
});

test("all current English projection-2 fixtures remain held", async context => {
	const dir = await mkdtemp(join(tmpdir(), "trace-r2-english-")); context.after(() => rm(dir, { recursive: true, force: true }));
	for (const [i, fixture] of ["examples.projection2.inspect.json", "tasks/procedural/inspect.json", "tasks/judgment/inspect.json", "tasks/awareness/inspect.json", "lantern-marsh/inspect.json"].entries()) {
		const course = parseCourse(await readFile(resolve("test/fixtures", fixture), "utf8"));
		await prepareItemCues(course, join(dir, String(i)), 17);
		assert.equal(JSON.parse(await readFile(join(dir, String(i), "manifest.json"), "utf8")).masked.applies, false, fixture);
	}
});

test("random bundle IDs reveal no small seed through the public manifest hash", async context => {
	const result = await maskedFixture(context, "Which is the correct shape?", ["circle", "square", "triangle", "rectangle"]);
	await prepareItemCues(result.course, join(result.dir, "again"), 17);
	const first = JSON.parse(await readFile(join(result.bundle, "manifest.json"), "utf8"));
	const again = JSON.parse(await readFile(join(result.dir, "again/manifest.json"), "utf8"));
	assert.notEqual(first.bundleId, again.bundleId);
	assert.match(first.bundleId, /^[a-f0-9]{32}$/);
	assert.equal(result.operator.bundleId, first.bundleId); assert.equal(result.operator.seed, 17);
	const base = { view: first.view, promptVersion: first.promptVersion, courseHash: first.courseHash };
	const guesses = Array.from({ length: 1001 }, (_, seed) => createHash("sha256").update(JSON.stringify([base, seed])).digest("hex"));
	const scan = async (path: string): Promise<void> => { for (const entry of await readdir(path, { withFileTypes: true })) {
		const file = join(path, entry.name);
		if (entry.isDirectory()) await scan(file);
		else { const text = await readFile(file, "utf8"); assert.ok(!guesses.some(hash => text.includes(hash)), file); }
	} };
	await scan(result.bundle);
});

test("solver root prompt contains no review-folder pointer", async context => {
	const result = await maskedFixture(context, "Which is the correct shape?", ["circle", "square", "triangle", "rectangle"]);
	assert.doesNotMatch(await readFile(join(result.bundle, "prompt.md"), "utf8"), /review|operator|sibling|\.\.\//i);
});

test("item-cues skill keeps keyed course JSON outside the solver parent tree", async () => {
	const skill = await readFile(resolve("skill/SKILL.md"), "utf8");
	assert.match(skill, /Keep keyed `course\.json` in a private input folder outside the bundle's parent tree/);
	assert.match(skill, /praxity trace prepare item-cues <private-input>\/course\.json/);
	assert.match(skill, /separate workspace, or supply its files inline/);
});

test("masked singular/plural agreement keeps a shared base and trailing s", async context => {
	const result = await maskedFixture(context, "These cells are", ["cells", "cell", "walls", "wall"]);
	assert.deepEqual(result.aligned, { stem: "These xepes are", options: ["xepes", "xepe", "roris", "rori"] });
});

test("masked allow-listed HTML stem preserves literal overlap without markup", async context => {
	const result = await maskedFixture(context, "<p>Which <strong>cell</strong>?</p>", ["A cell", "A wall", "A pipe", "A wire"], true);
	assert.deepEqual(result.aligned, { stem: "Which xepe ?", options: ["A xepe", "A rori", "A vevi", "A mife"] });
});

test("masked Run Bin Map Log collision case is injective at seed 17", async context => {
	const result = await maskedFixture(context, "Which?", ["Run", "Bin", "Map", "Log"]);
	assert.deepEqual(result.aligned, { stem: "Which?", options: ["Taw", "Men", "Zuj", "Tef"] });
});

test("masked exhausted replacement space fails closed", async context => {
	const result = await maskedFixture(context, "Which?", ["BCDFGHJKLMNPQRSTVWXYZ", "B C D F G H J K L M N P Q R S T V W X Y Z", "X", "Y"]);
	assert.equal(result.aligned, null);
	assert.deepEqual(result.operator.masked, HELD);
	assert.throws(() => maskItem(keyedChoices(result.course).items.find(item => item.ref === "2.1.1")!, 17), /no unused same-length form/);
});

test("masked digits use a literal consistent per-item scrambling", async context => {
	const result = await maskedFixture(context, "Is 100 > 20?", ["100", "-20.5%", "20", "00"]);
	assert.deepEqual(result.aligned, { stem: "Is 722 > 12?", options: ["722", "-12.4%", "12", "22"] });
});

test("masked accents normalize to NFC before assigning words", async context => {
	const result = await maskedFixture(context, "Which café?", ["café", "cafe\u0301", "résumé", "wire"]);
	assert.deepEqual(result.aligned, { stem: "Which koxi?", options: ["koxi", "koxi", "lejava", "mife"] });
});

test("French and missing course.locale never produce a masked score", async context => {
	const dir = await mkdtemp(join(tmpdir(), "trace-mask-language-")); context.after(() => rm(dir, { recursive: true, force: true }));
	for (const locale of ["fr-CA", "", undefined]) {
		const raw = fixture(), metadata: { locale?: string } = raw.course;
		if (locale === undefined) delete metadata.locale; else metadata.locale = locale;
		const course = parseCourse(JSON.stringify(raw)), bundle = join(dir, locale === undefined ? "missing" : locale || "blank");
		await prepareItemCues(course, bundle, 17);
		const operator = JSON.parse(await readFile(join(`${bundle}-review`, "operator.json"), "utf8"));
		assert.deepEqual(JSON.parse(await readFile(join(bundle, "masked/items.json"), "utf8")), []);
		const answer = { ...payload(), ...operator, masked: { ...operator.masked, bundleId: operator.bundleId, probe: "masked" } };
		for (const probe of [answer.choicesOnly, answer.coverTheOptions]) probe.bundleId = operator.bundleId;
		const view = itemCuesView(course, readItemCues(JSON.stringify(answer), course, JSON.stringify(operator)));
		for (const row of [view.course, ...view.banks]) {
			assert.deepEqual(row.masked, HELD);
			assert.equal("p" in row.masked!, false); assert.equal("pLow" in row.masked!, false);
		}
		assert.match(renderItemCues(view), /lack confirmed authored English language provenance/);
		assert.equal(itemCuesView(course).course.masked?.applies, false);
	}
});

test("operator evidence stays outside every solver-readable bundle file", async context => {
	const result = await maskedFixture(context, "Which cell?", ["A cell", "A wall", "A pipe", "A wire"]);
	const scan = async (path: string): Promise<void> => { for (const entry of await readdir(path, { withFileTypes: true })) {
		const file = join(path, entry.name);
		if (entry.isDirectory()) await scan(file);
		else assert.doesNotMatch(await readFile(file, "utf8"), /\bseed\b|optionOrder|"17"|\b17\b/, file);
	} };
	await scan(result.bundle);
	assert.doesNotMatch(await readFile(join(result.bundle, "masked/prompt.md"), "utf8"), /only-true-on-its-own|textbook-wording/);
	assert.equal(result.operator.seed, 17); assert.ok(result.operator.optionOrder["2.1.1"]);
	await assert.rejects(readFile(join(result.bundle, "operator.json")), /ENOENT/);
});

test("answers reject another bundle's identity and swapped probe tags", async context => {
	const result = await maskedFixture(context, "Which cell?", ["A cell", "A wall", "A pipe", "A wire"]);
	await prepareItemCues(result.course, join(result.dir, "other"), 29);
	const other = JSON.parse(await readFile(join(result.dir, "other-review/operator.json"), "utf8"));
	const answer = { ...payload(), ...result.operator, masked: payload().masked };
	for (const probe of [answer.choicesOnly, answer.masked, answer.coverTheOptions]) probe.bundleId = result.operator.bundleId;
	assert.doesNotThrow(() => readItemCues(JSON.stringify(answer), result.course, JSON.stringify(result.operator)));
	assert.throws(() => readItemCues(JSON.stringify(answer), result.course, JSON.stringify(other)), /bundleId/);
	const crossed = { ...answer, ...other, choicesOnly: answer.choicesOnly, masked: answer.masked, coverTheOptions: answer.coverTheOptions };
	assert.throws(() => readItemCues(JSON.stringify(crossed), result.course, JSON.stringify(other)), /bundleId\/probe|unavailable probe status/);
	const swapped = { ...answer, masked: answer.choicesOnly, choicesOnly: answer.masked };
	assert.throws(() => readItemCues(JSON.stringify(swapped), result.course, JSON.stringify(result.operator)), /bundleId\/probe|unavailable probe status/);
});

for (const route of ["file", "stdin"]) test(`current-input hold survives ${route} preparation and has no English override`, async context => {
	const dir = await mkdtemp(join(tmpdir(), "trace-r3-held-")); context.after(() => rm(dir, { recursive: true, force: true }));
	const raw = fixture(), input = join(dir, "inspect.json"); await writeFile(input, JSON.stringify(raw));
	const out = join(dir, route), course = parseCourse(JSON.stringify(raw));
	const result = spawnSync(process.execPath, [resolve("src/cli.ts"), "prepare", "item-cues", route === "stdin" ? "-" : input, "--out", out], { input: route === "stdin" ? JSON.stringify(raw) : undefined, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
	assert.deepEqual(manifest.masked, HELD);
	assert.deepEqual(JSON.parse(await readFile(join(out, "masked/items.json"), "utf8")), []);
	assert.doesNotMatch(await readFile(join(out, "masked/prompt.md"), "utf8"), /Work as a fresh solver|"choice"|"answers"/);
	const operator = JSON.parse(await readFile(join(`${out}-review`, "operator.json"), "utf8"));
	const answer = { ...payload(), ...manifest, masked: { ...manifest.masked, bundleId: manifest.bundleId, probe: "masked", p: 0.00001, pLow: 1 } };
	for (const probe of [answer.choicesOnly, answer.coverTheOptions]) probe.bundleId = manifest.bundleId;
	const path = join(`${out}-review`, "answer.json"); await writeFile(path, JSON.stringify(answer));
	const report = spawnSync(process.execPath, [resolve("src/cli.ts"), "report", input, "--out", join(dir, `${route}-report`), "--item-cues", path], { encoding: "utf8" });
	assert.equal(report.status, 0, report.stderr);
	const view = JSON.parse(await readFile(join(dir, `${route}-report/report.json`), "utf8")).itemCues;
	for (const row of [view.course, ...view.banks]) assert.deepEqual(row.masked, HELD);
	assert.equal(view.course.choicesOnly.total, 9); assert.equal(view.course.coverTheOptions.total, 9);
	assert.deepEqual(readItemCues(JSON.stringify(answer), course, JSON.stringify({ ...operator, locale: "en", masked: { applies: true } })).masked, HELD);
	const override = spawnSync(process.execPath, [resolve("src/cli.ts"), "prepare", "item-cues", input, "--out", join(dir, "override"), "--masked-language", "en"], { encoding: "utf8" });
	assert.notEqual(override.status, 0); assert.match(override.stderr, /Unknown.*--masked-language/);
});

test("unavailable masked populations discard injected scores and never emit scoring fields", () => {
	const course = load(), answer = payload();
	Object.assign(answer.masked, { right: 9, total: 9, chanceExpected: 2.25, p: 0.00001, pLow: 1, tooFewItems: false, tooFewItemsLow: false, items: [{ ref: "1.1.1" }] });
	const parsed = parseItemCues(JSON.stringify(answer), course);
	assert.deepEqual(parsed.masked, HELD);
	for (const supplied of [undefined, parsed, { ...parsed, masked: { applies: true, p: 0.00001, pLow: 1, right: 9, total: 9 } } as unknown as typeof parsed]) {
		const view = itemCuesView(course, supplied);
		for (const row of [view.course, ...view.banks]) assert.deepEqual(row.masked, HELD);
		const html = renderItemCues(view);
		assert.match(html, /lack confirmed authored English language provenance/);
		assert.equal(html.split(HOLD_DETAIL).length - 1, 1, "The full hold detail appears once");
		assert.match(html, /Stop and ask; do not compute masked tails by hand/);
		assert.doesNotMatch(html, /Masked guessing-cue responses|masked solver picked/);
	}
	const view = itemCuesView(course, parsed);
	assert.equal(view.course.choicesOnly!.right, 9);
	assert.equal(view.course.coverTheOptions!.status, "not judged");
});

test("masked bundle keeps function words, digit counts, punctuation and consistent same-length content words", async context => {
	const dir = await mkdtemp(join(tmpdir(), "trace-mask-")); context.after(() => rm(dir, { recursive: true, force: true }));
	const source = ["The copper pipe is at -2.5°C, usually.", "The copper wire is at <20%, never!", "A COPPER pipe may bend; 42 > 7.", "Copper's pipe isn't blue: 123."];
	const course = parseCourse(JSON.stringify(replaceOptions(fixture(), source)));
	for (const name of ["a", "b"]) await prepareItemCues(course, join(dir, name), 17);
	const manifest = JSON.parse(await readFile(join(dir, "a-review/operator.json"), "utf8"));
	assert.equal(manifest.promptVersion, "item-cues/14-projection-2");
	assert.equal(manifest.seed, 17);
	const a = await readFile(join(dir, "a/masked/items.json"), "utf8");
	assert.equal(withoutIdentity(a), withoutIdentity(await readFile(join(dir, "b/masked/items.json"), "utf8")));
	assert.deepEqual(JSON.parse(a), []);
	const masked = maskItem(keyedChoices(course).items.find(item => item.ref === "2.1.1")!, 17).options;
	const ordered = source;
	const keep = new Set("the is at usually never a may isn't".split(" "));
	const mappings = new Map<string, string>();
	ordered.forEach((original, i) => {
		const actual = masked[i]!;
		assert.equal([...actual].length, [...original].length);
		assert.equal(actual.replace(/[A-Za-z0-9]/g, ""), original.replace(/[A-Za-z0-9]/g, ""));
		const originalWords = original.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)!;
		const actualWords = actual.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)!;
		originalWords.forEach((word, j) => {
			const fake = actualWords[j]!, lower = word.toLowerCase();
			if (keep.has(lower)) assert.equal(fake, word);
			else {
				assert.notEqual(fake.toLowerCase(), lower);
				assert.equal(fake.length, word.length);
				if (mappings.has(lower)) assert.equal(fake.toLowerCase(), mappings.get(lower));
				mappings.set(lower, fake.toLowerCase());
			}
		});
	});
	assert.doesNotMatch(a, /FEEDBACK_CANARY|KEY_CANARY/);
});

test("CLI seeds record distinct repeatable orders and plain diagnostic scores through the operator file", async context => {
	const dir = await mkdtemp(join(tmpdir(), "trace-seeds-")); context.after(() => rm(dir, { recursive: true, force: true }));
	const course = load(), input = join(dir, "course.json"); await writeFile(input, JSON.stringify(fixture()));
	const run = (...args: string[]) => spawnSync(process.execPath, [resolve("src/cli.ts"), ...args], { encoding: "utf8" });
	const manifests = [];
	for (const seed of [17, 29]) {
		const bundle = join(dir, String(seed));
		const prepared = run("prepare", "item-cues", input, "--out", bundle, "--seed", String(seed), "--diagnostics");
		assert.equal(prepared.status, 0, prepared.stderr);
		const paths = JSON.parse(prepared.stdout);
		assert.equal(paths.operator, join(`${bundle}-review`, "operator.json"));
		assert.equal(paths.answer, join(`${bundle}-review`, "answer.json"));
		const manifest = JSON.parse(await readFile(join(`${bundle}-review`, "operator.json"), "utf8")); manifests.push(manifest);
		assert.equal(manifest.seed, seed);
		const choices = JSON.parse(await readFile(join(bundle, "choices-only/items.json"), "utf8"));
		const answers = keyedChoices(course).items.map(item => ({ ref: item.ref, choice: choices.find((row: { ref: string }) => row.ref === item.ref).options.indexOf(item.options[item.key]) + 1, cue: "guessed", note: "Synthetic" }));
		const answer = { ...payload(), ...manifest, choicesOnly: { bundleId: "synthetic-bundle", probe: "choices-only", model: "plain", answers }, masked: { ...HELD, bundleId: "synthetic-bundle", probe: "masked" } };
		answer.bundleId = manifest.bundleId;
		for (const probe of [answer.choicesOnly, answer.masked, answer.coverTheOptions]) probe.bundleId = manifest.bundleId;
		const path = join(`${bundle}-review`, "answer.json"); await writeFile(path, JSON.stringify(answer));
		const reported = run("report", input, "--out", join(bundle, "report"), "--item-cues", path);
		assert.equal(reported.status, 0, reported.stderr);
		const view = JSON.parse(await readFile(join(bundle, "report/report.json"), "utf8")).itemCues;
		assert.deepEqual(view.course.masked, HELD);
		for (const probe of ["choicesOnly"]) {
			assert.equal(view.course[probe].right, 9); assert.equal(view.course[probe].p, 1 / 4 ** 9); assert.equal(view.course[probe].pLow, 1);
			assert.equal(view.banks[0][probe].right, 8); assert.equal(view.banks[1][probe].right, 1);
		}
	}
	assert.notDeepEqual(manifests[0].optionOrder, manifests[1].optionOrder);
	for (const name of ["random-a", "random-b"]) await prepareItemCues(course, join(dir, name), undefined, true);
	const randomA = JSON.parse(await readFile(join(dir, "random-a-review/operator.json"), "utf8")), randomB = JSON.parse(await readFile(join(dir, "random-b-review/operator.json"), "utf8"));
	assert.ok(Number.isSafeInteger(randomA.seed)); assert.ok(Number.isSafeInteger(randomB.seed)); assert.notEqual(randomA.seed, randomB.seed);
	await prepareItemCues(course, join(dir, "replayed"), randomA.seed, true);
	for (const file of ["manifest.json", "choices-only/items.json", "masked/items.json"]) assert.equal(withoutIdentity(await readFile(join(dir, "random-a", file), "utf8")), withoutIdentity(await readFile(join(dir, "replayed", file), "utf8")));
	for (const seed of ["bad", "1.5", "9007199254740992"]) {
		const result = run("prepare", "item-cues", input, "--out", join(dir, `bad-${seed}`), "--seed", seed);
		assert.notEqual(result.status, 0); assert.match(result.stderr, /safe integer/);
	}
});

test("held masked answers reject forged applicability and altered permutation metadata", () => {
	const course = load();
	for (const forged of [{ applies: true }, { reason: "language" }, { probe: "choices-only" }, { bundleId: "another-bundle" }]) {
		const answer = payload(); Object.assign(answer.masked, forged);
		assert.throws(() => parseItemCues(JSON.stringify(answer), course), /unavailable probe status/);
	}
	const forgedOperator = operatorFor(course); Object.assign(forgedOperator.masked, { applies: true, p: 0.0001 });
	assert.deepEqual(parseItemCues(JSON.stringify(payload()), course, forgedOperator).masked, HELD);
	const operator = operatorFor(course); operator.optionOrder["1.1.1"] = [0, 0, 0, 0];
	assert.throws(() => parseItemCues(JSON.stringify(payload()), course, operator), /permutation/);
	delete operator.optionOrder["1.1.1"];
	assert.throws(() => parseItemCues(JSON.stringify(payload()), course, operator), /every eligible/);
	const invalidSeed = operatorFor(course); invalidSeed.seed = 1.5;
	assert.throws(() => parseItemCues(JSON.stringify(payload()), course, invalidSeed), /seed/);
});

test("pooled course scores sum lesson results with exact upper and lower tails", () => {
	const raw = fixture();
	raw.lessons[1]!.pages[0]!.blocks[0]!.texts = raw.lessons[1]!.pages[0]!.blocks[0]!.texts.filter(text => !text.ref.endsWith("/3"));
	raw.lessons[1]!.pages[0]!.blocks[0]!.assessment.options.pop();
	const course = parseCourse(JSON.stringify(raw));
	const answer = { ...probeMetadata(course), choicesOnly: { bundleId: "synthetic-bundle", probe: "choices-only", model: "operator-recorded", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, choice: probeOrder(item).indexOf(item.key) + 1, cue: "guessed" as const, note: "Synthetic" })) }, coverTheOptions: { bundleId: "synthetic-bundle", probe: "cover-the-options", model: "operator-recorded", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, answer: "can't tell" })) } };
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
	assert.ok(headers.includes("Chance of this many or more"));
	assert.ok(headers.includes("Chance of this few or fewer"));
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
	const answer = { ...probeMetadata(course), choicesOnly: { bundleId: "synthetic-bundle", probe: "choices-only", model: "constant-first", answers: items.map(item => ({ ref: item.ref, choice: 1, cue: "guessed" as const, note: "Always first in the probe" })) }, coverTheOptions: { bundleId: "synthetic-bundle", probe: "cover-the-options", model: "stem-solver", answers: items.map(item => ({ ref: item.ref, answer: "can't tell" })) } };
	const right = itemCuesView(course, answer).course.choicesOnly!.right;
	assert.ok(right > 0 && right < 32);
	for (const row of answer.choicesOnly.answers) row.choice = probeOrder(items.find(item => item.ref === row.ref)!).indexOf(0) + 1;
	assert.equal(itemCuesView(course, answer).course.choicesOnly!.right, 32);
	const dir = await mkdtemp(join(tmpdir(), "trace-item-cues-order-")); context.after(() => rm(dir, { recursive: true, force: true }));
	await prepareItemCues(course, join(dir, "first"), 0, true);
	for (const block of lesson.pages[0]!.blocks) block.assessment.options.forEach((option, i) => { option.correct = i === 2; });
	await prepareItemCues(parseCourse(JSON.stringify(raw)), join(dir, "flipped"), 0, true);
	assert.equal(withoutIdentity(await readFile(join(dir, "first/choices-only/items.json"), "utf8")), withoutIdentity(await readFile(join(dir, "flipped/choices-only/items.json"), "utf8")));
	const manifest = JSON.parse(await readFile(join(dir, "first/manifest.json"), "utf8"));
	assert.deepEqual(Object.keys(manifest), ["view", "promptVersion", "courseHash", "bundleId", "masked", "maskedBanks"]);
});

test("cover answers need semantic judgement, never literal scoring or free-response p values", () => {
	const raw = fixture(), course = parseCourse(JSON.stringify(replaceOptions(raw, ["0 degrees Celsius", "10 degrees Celsius", "20 degrees Celsius", "30 degrees Celsius"])));
	const answer = { ...probeMetadata(course), choicesOnly: { bundleId: "synthetic-bundle", probe: "choices-only", model: "choice-solver", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, choice: 1, cue: "guessed" as const, note: "" })) }, coverTheOptions: { bundleId: "synthetic-bundle", probe: "cover-the-options", model: "stem-solver", judgeModel: "separate-judge", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, answer: "Zero degrees Celsius", coverJudgement: undefined as "matches" | "differs" | "cantTell" | undefined })) } };
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
	assert.deepEqual(cover.outcomes, { matches: 1, differs: 1, cantTell: 1, alsoCorrect: 0 });
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

test("inspect JSON preserves shuffled, fixed and older unknown choice order", () => {
	for (const [setting, expected] of [
		[{ shuffle: true }, { shuffle: true, fixed: 0, shuffled: 1, unknown: 0, positions: [0, 0, 0, 0] }],
		[{ shuffle: false }, { shuffle: false, fixed: 1, shuffled: 0, unknown: 0, positions: [0, 0, 1, 0] }],
		[{}, { shuffle: null, fixed: 0, shuffled: 0, unknown: 1, positions: [0, 0, 0, 0] }],
	] as const) {
		const raw = replaceOptions(fixture(), balanced, 2);
		Object.assign(raw.lessons[1]!.pages[0]!.blocks[0]!.assessment, setting);
		const view = itemCuesView(parseCourse(JSON.stringify(raw))), row = view.banks[1]!, spread = row.spreads[0]!;
		assert.equal(row.items[0]!.shuffle, expected.shuffle);
		assert.deepEqual([spread.fixedCount, spread.shuffledCount, spread.unknownCount], [expected.fixed, expected.shuffled, expected.unknown]);
		assert.deepEqual(spread.keyPositions, expected.positions);
		assert.equal(view.course.spreads[0]!.fixedCount, expected.fixed);
		assert.match(renderItemCues(view), new RegExp(`${expected.fixed} known fixed order; ${expected.shuffled} shuffled at runtime; ${expected.unknown} shuffle unknown`));
	}
});

test("inspect rejects present shuffle values that are not booleans", () => {
	for (const shuffle of [null, "false", 0, 1, {}]) {
		const raw = fixture();
		Object.assign(raw.lessons[0]!.pages[0]!.blocks[0]!.assessment, { shuffle });
		assert.throws(() => parseCourse(JSON.stringify(raw)), /assessment.shuffle: expected a boolean/);
	}
});

test("excluded choices are counted per bank and course, including wholly excluded groups and lessons", () => {
	const raw = fixture(), blocks: Array<Record<string, unknown>> = raw.lessons[0]!.pages[0]!.blocks;
	blocks.push({ ref: "group", parentRef: null, id: null, type: "assessmentGroup", coverage: "container", location: null, texts: [], assessmentGroup: { memberRefs: ["leaking/0", "leaking/1"], unresolvedMemberCount: 0, mode: "all", requireAll: false, passingScore: null, pointsOverride: null, aggregation: "mean-of-scored-member-percentages" } });
	for (const block of [raw.lessons[0]!.pages[0]!.blocks[0]!, raw.lessons[0]!.pages[0]!.blocks[2]!, raw.lessons[1]!.pages[0]!.blocks[0]!]) {
		block.assessment.correctness = "open";
		block.assessment.options.forEach(option => { option.correct = false; });
	}
	const view = itemCuesView(parseCourse(JSON.stringify(raw)));
	assert.equal(view.excludedCount, 3);
	assert.equal(view.course.excludedCount, 3);
	assert.equal(view.course.count, 6);
	assert.deepEqual(view.banks.map(bank => [bank.id, bank.count, bank.excludedCount]), [["group:1.1.9", 1, 1], ["lesson:1", 5, 1], ["lesson:2", 0, 1]]);
	assert.deepEqual(view.excluded.map(item => item.banks), [["group:1.1.9"], ["lesson:1"], ["lesson:2"]]);
	assert.equal(view.banks[2]!.masked.applies, false);
	assert.equal(view.banks[2]!.masked.reason, "no-included-items");
	assert.match(view.banks[2]!.masked.detail, /no-key-or-poll/);
	assert.doesNotMatch(view.banks[2]!.masked.detail, /locale: en/);
	assert.match(renderItemCues(view), /L2[^<]*clean<\/h3><p>1 item left out/);
	const course = parseCourse(JSON.stringify(raw)), answer = payload();
	Object.assign(answer, probeMetadata(course), { courseHash: courseHash(course) });
	const included = new Set(keyedChoices(course).items.map(item => item.ref));
	answer.choicesOnly.answers = answer.choicesOnly.answers.filter(item => included.has(item.ref));
	answer.coverTheOptions.answers = answer.coverTheOptions.answers.filter(item => included.has(item.ref));
	const scored = itemCuesView(course, parseItemCues(JSON.stringify(answer), course));
	assert.equal(scored.banks[2]!.choicesOnly, undefined);
	assert.equal(scored.banks[2]!.coverTheOptions, undefined);
	assert.equal(scored.banks[2]!.probeStatus, "Probes not run");
	blocks[1]!.assessment = { ...raw.lessons[0]!.pages[0]!.blocks[1]!.assessment, correctness: "open" };
	const all = itemCuesView(parseCourse(JSON.stringify(raw)));
	assert.equal(all.banks.find(bank => bank.id === "group:1.1.9")!.count, 0);
	assert.equal(all.banks.find(bank => bank.id === "group:1.1.9")!.excludedCount, 2);
	assert.equal(all.course.excludedCount, 4);
});

test("overlapping excluded choices have one counting owner and retain group provenance", () => {
	const raw = fixture(), blocks: Array<Record<string, unknown>> = raw.lessons[1]!.pages[0]!.blocks;
	const group = { parentRef: null, id: null, type: "assessmentGroup", coverage: "container", location: null, texts: [], assessmentGroup: { memberRefs: ["clean/0"], unresolvedMemberCount: 0, mode: "all", requireAll: false, passingScore: null, pointsOverride: null, aggregation: "mean-of-scored-member-percentages" } };
	blocks.push({ ...group, ref: "group-a" }, { ...group, ref: "group-b" });
	const view = itemCuesView(parseCourse(JSON.stringify(raw)));
	assert.equal(view.course.excludedCount, 1);
	assert.deepEqual(view.banks.map(bank => [bank.id, bank.count, bank.excludedCount]), [["lesson:1", 8, 0], ["lesson:2", 0, 1]]);
	assert.equal(view.banks.reduce((n, bank) => n + bank.excludedCount, 0), 1);
	assert.equal(view.course.excludedByReason["overlapping-groups"], 1);
	assert.equal(view.excluded[0]!.bank, "lesson:2");
	assert.deepEqual(view.excluded[0]!.banks, ["group:2.1.2", "group:2.1.3"]);
});

test("stable exclusion codes count structural causes per bank and course", () => {
	const raw = authored(), blocks = raw.lessons[0]!.pages[0]!.blocks;
	blocks[0]!.assessment.correctness = "open";
	blocks[0]!.assessment.options.forEach(option => { option.correct = false; });
	blocks[1]!.assessment.selectionMode = "multiple";
	blocks[2]!.texts[0]!.value = "Which {unknown} symbol?";
	blocks[3]!.assessment.options[1]!.correct = true;
	blocks[4]!.assessment.options.length = 1;
	const view = itemCuesView(parseCourse(JSON.stringify(raw)));
	assert.deepEqual(view.excluded.map(item => item.code), ["no-key-or-poll", "multiple-select", "ineligible-stem", "key-count", "insufficient-options"]);
	assert.equal(view.excludedCount, 5);
	assert.equal(view.course.maskedExcludedCount, 0);
	assert.deepEqual(view.course.excludedByReason, {
		"no-key-or-poll": 1, "multiple-select": 1, "ineligible-stem": 1, "key-count": 1,
		"insufficient-options": 1, "overlapping-groups": 0, "masked-language": 0, "masked-space": 0,
	});
	assert.deepEqual(view.banks[0]!.excludedByReason, view.course.excludedByReason);
	assert.ok(Object.values(view.banks[1]!.excludedByReason).every(n => n === 0));
});

test("masked-language counts cover each withheld bank without changing structural counts", () => {
	for (const language of [{ value: "fr", source: "lesson" }, undefined]) {
		const raw = authored();
		Object.assign(raw.lessons[1]!, { language });
		const view = itemCuesView(parseCourse(JSON.stringify(raw)));
		assert.equal(view.excludedCount, 0);
		assert.equal(view.course.count, 9);
		assert.equal(view.course.maskedExcludedCount, 1);
		assert.equal(view.course.excludedByReason["masked-language"], 1);
		assert.deepEqual(view.banks.map(bank => [bank.count, bank.excludedCount, bank.maskedExcludedCount, bank.excludedByReason["masked-language"]]), [[8, 0, 0, 0], [1, 0, 1, 1]]);
		assert.equal(view.banks.reduce((n, bank) => n + bank.maskedExcludedCount, 0), 1);
		assert.ok(!view.course.masked.applies);
	}
	const raw = authored();
	raw.lessons[0]!.pages[0]!.blocks[0]!.texts[0]!.value = "Toujours which symbol?";
	const view = itemCuesView(parseCourse(JSON.stringify(raw)));
	assert.equal(view.course.maskedExcludedCount, 8, "One conflict withholds the whole bank");
	assert.equal(view.course.excludedByReason["masked-language"], 8);
	raw.lessons[0]!.pages[0]!.blocks[1]!.assessment.correctness = "open";
	const mixed = itemCuesView(parseCourse(JSON.stringify(raw)));
	assert.equal(mixed.excludedCount, 1);
	assert.equal(mixed.course.maskedExcludedCount, 7);
	assert.equal(mixed.course.count, 8);
	for (const row of [mixed.course, ...mixed.banks]) {
		assert.equal(Object.values(row.excludedByReason).reduce((sum, n) => sum + n, 0), row.excludedCount + row.maskedExcludedCount);
	}
	assert.equal(mixed.banks.reduce((sum, row) => sum + row.excludedByReason["masked-language"], 0), 7);
	assert.match(renderItemCues(mixed), /7 items withheld from the masked probe/);
});

test("legacy non-choice assessments do not count as excluded choice candidates", () => {
	const raw = { ok: true, schema: "praxity-inspect/0", studioVersion: "synthetic", course: { title: "Legacy", locale: "en" }, lessons: [{ file: "lesson.prax", title: "Lesson", sha256: "synthetic", pages: [{ id: "page", number: 1, title: "Checks", blocks: [
		{ id: "match", type: "assessment", line: 1, data: { assessmentType: "matching", response: { type: "matching", pairs: [] } } },
		{ id: "order", type: "assessment", line: 2, data: { response: { type: "sequence", items: [] } } },
	] }] }] };
	assert.equal(itemCuesView(parseCourse(JSON.stringify(raw))).excludedCount, 0);
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
	for (const key of ["May", "Submit in May each year", "People who could not use a mouse", "The person may not enter", "The person might not enter", "Consult the person"]) {
		const raw = replaceOptions(fixture(), [key, "June", "July", "August"]), row = itemCuesView(parseCourse(JSON.stringify(raw))).banks[1]!;
		assert.ok(!row.items[0]!.flags.some(flag => flag.cue === "hedged-key"), key);
		assert.equal(row.consultation!.count, key.startsWith("Consult") ? 1 : 0);
	}
	for (const key of ["Usually a different response", "Often a different response", "This may improve access", "May improve access", "This might improve access", "It can depend on context"]) {
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

test("bundle CLI strips canaries from typed inspect inputs and refuses unsupported probe sources", async context => {
	const dir = await mkdtemp(join(tmpdir(), "trace-item-cues-leaks-")); context.after(() => rm(dir, { recursive: true, force: true }));
	const prose = `<span data-correct="ATTRIBUTE_CANARY" data-feedback="ATTRIBUTE_FEEDBACK_CANARY">Red</span><span hidden>HIDDEN_CANARY</span><span aria-hidden="true">ARIA_CANARY</span><span style="display:none">STYLE_CANARY</span><span class="praxity-assessment-feedback">POST_RESPONSE_CANARY</span><script>SCRIPT_CANARY</script>`;
	const data = { question: prose, options: [{ text: prose, correct: true, feedback: "FEEDBACK_FIELD_CANARY" }, { text: "Blue", correct: false }], selectionMode: "single" };
	const legacy = { ok: true, schema: "praxity-inspect/0", studioVersion: "synthetic", course: { title: "Synthetic", locale: "en" }, lessons: [{ file: "lesson.prax", title: "Synthetic", sha256: "synthetic", pages: [{ id: "page", number: 1, title: "Question", blocks: [{ id: "choice", type: "assessment", line: 1, data }] }] }] };
	const raw = fixture(), b = raw.lessons[1]!.pages[0]!.blocks[0]!;
	b.texts.filter(text => text.role === "option").forEach((text, i) => { if (i === 0) { text.value = prose; text.format = "html"; } }); b.assessment.options[0]!.label = prose;
	b.texts[0]!.value = prose; b.texts[0]!.format = "html";
	await writeFile(join(dir, "legacy.json"), JSON.stringify(legacy)); await writeFile(join(dir, "typed.json"), JSON.stringify(raw));
	const markdown = structuredClone(raw), markdownBlock = markdown.lessons[1]!.pages[0]!.blocks[0]!;
	const tooltip = "[Red]{TOOLTIP_CANARY: the correct option is Red; {nested: true}}";
	markdownBlock.texts[0]!.value = tooltip; markdownBlock.texts[0]!.format = "markdown";
	markdownBlock.texts.filter(text => text.role === "option")[0]!.value = tooltip;
	markdownBlock.texts.filter(text => text.role === "option")[0]!.format = "markdown";
	markdownBlock.assessment.options[0]!.label = tooltip;
	await writeFile(join(dir, "typed-markdown.json"), JSON.stringify(markdown));
	const exported = join(dir, "export"); await mkdir(exported);
	const native = { stem: [{ type: "text", data: { content: prose, feedback: "NESTED_FEEDBACK_CANARY" } }], response: { type: "choice", selectionMode: "single", options: [{ label: prose, isCorrect: true }, { label: "Blue", isCorrect: false }] } };
	const legacyNative = structuredClone(legacy); Object.assign(legacyNative.lessons[0]!.pages[0]!.blocks[0]!.data, native); delete (legacyNative.lessons[0]!.pages[0]!.blocks[0]!.data as { question?: string }).question;
	await writeFile(join(dir, "legacy-native.json"), JSON.stringify(legacyNative));
	const attr = JSON.stringify({ type: "assessment", data: native }).replace(/&/g, "&amp;").replace(/'/g, "&#39;");
	await writeFile(join(exported, "lesson.html"), `<html lang="en"><head><title>Synthetic</title></head><body><article class="deck-slide" data-deck-slide="p"><div data-block-id="choice" data-block-type="assessment" data-block-json='${attr}'><form>Red Blue</form></div></article></body></html>`);
	const scan = async (path: string): Promise<void> => { for (const entry of await readdir(path, { withFileTypes: true })) { const file = join(path, entry.name); if (entry.isDirectory()) await scan(file); else assert.doesNotMatch(await readFile(file, "utf8"), /\w+_CANARY|data-correct|data-feedback|<span|"correct"/, file); } };
	for (const [name, input] of [["legacy", join(dir, "legacy.json")], ["legacy-native", join(dir, "legacy-native.json")], ["typed", join(dir, "typed.json")], ["typed-markdown", join(dir, "typed-markdown.json")], ["export", exported]]) {
		const out = join(dir, `bundle-${name}`), cli = spawnSync(process.execPath, [resolve("src/cli.ts"), "prepare", "item-cues", input!, "--out", out, "--diagnostics"], { encoding: "utf8" });
		if (!["typed", "typed-markdown"].includes(name!)) {
			assert.notEqual(cli.status, 0); assert.ok(cli.stderr.includes(name === "export" ? "`report` still runs on HTML exports." : "This inspect file has no answer keys."));
			await assert.rejects(readdir(out), { code: "ENOENT" });
			continue;
		}
		assert.equal(cli.status, 0, cli.stderr); await scan(out);
		const rows = JSON.parse(await readFile(join(out, "choices-only/items.json"), "utf8"));
		assert.ok(rows.some((row: { options: string[] }) => row.options.includes("Red")));
		if (name === "typed") assert.equal(rows.length, 8, "Unlisted HTML markup is excluded as a whole item");
		else assert.ok(JSON.parse(await readFile(join(out, "cover-the-options/items.json"), "utf8")).some((row: { stem: string }) => row.stem === "Red"));
	}
	const out = join(dir, "bundle-typed");
	assert.doesNotMatch(await readFile(join(out, "cover-the-options/prompt.md"), "utf8"), /literal|paraphrases remain/);
	assert.match(await readFile(join(`${out}-review`, "prompt.md"), "utf8"), /operator records the actual model names/);
	assert.match(await readFile(join(`${out}-review`, "prompt.md"), "utf8"), /separate fresh judge agent/);
	assert.match(await readFile(join(out, "choices-only/prompt.md"), "utf8"), /only-true-on-its-own/);
});

test("tiny probabilities below the exponent boundary render as escaped readable text", () => {
	const raw = fixture(), lesson = raw.lessons[1]!;
	raw.lessons = [lesson];
	lesson.pages[0]!.blocks = Array.from({ length: 32 }, (_, i) => {
		const block = structuredClone(lesson.pages[0]!.blocks[0]!); block.ref = `tiny-${i}`;
		block.texts.forEach((text, j) => { text.ref = `tiny-${i}/text-${j}`; }); return block;
	});
	const course = parseCourse(JSON.stringify(raw)), items = keyedChoices(course).items;
	const answer = { ...probeMetadata(course), choicesOnly: { bundleId: "synthetic-bundle", probe: "choices-only", model: "synthetic", answers: items.map(item => ({ ref: item.ref, choice: probeOrder(item).indexOf(item.key) + 1, cue: "guessed" as const, note: "" })) }, coverTheOptions: { bundleId: "synthetic-bundle", probe: "cover-the-options", model: "synthetic", answers: items.map(item => ({ ref: item.ref, answer: "can't tell" })) } };
	const view = itemCuesView(course, answer), html = renderItemCues(view);
	assert.equal(view.course.choicesOnly!.p, 1 / 4 ** 32);
	assert.match(view.course.choicesOnly!.p.toPrecision(4), /e-/);
	assert.match(html, /p (?:&lt;|&#60;) 0\.001/);
	assert.doesNotMatch(html, /p <|p = \d+(?:\.\d+)?e-/);
});

test("questions on one page have distinct visible labels and source lines in every item table", () => {
	const course = load(), view = itemCuesView(course, parseItemCues(JSON.stringify(payload()), course));
	const labels = view.course.items.map(item => (item as unknown as { label?: string }).label);
	assert.ok(labels.every(label => typeof label === "string" && label.length > 3));
	assert.equal(new Set(labels).size, 9);
	assert.ok(view.course.choicesOnly!.items.every(item => Object.hasOwn(item, "label")));
	assert.ok(view.course.coverTheOptions!.items.every(item => Object.hasOwn(item, "label")));
	const html = renderItemCues(view);
	assert.match(html, /1\.1\.1/); assert.match(html, /1\.1\.2/);
	const text = (node: DefaultTreeAdapterTypes.Node): string => "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(text).join(" ") : "";
	const walk = (node: DefaultTreeAdapterTypes.Node) => {
		if ("tagName" in node && node.tagName === "table") {
			const caption = node.childNodes.find(child => "tagName" in child && child.tagName === "caption");
			if (caption && /item measurements|choices-only responses|stem answers and judgements/.test(text(caption))) {
				const rows = "childNodes" in node ? node.childNodes.flatMap(child => "tagName" in child && child.tagName === "tbody" ? child.childNodes : []) : [];
				for (const row of rows) if ("childNodes" in row) {
					const head = row.childNodes.find(child => "tagName" in child && child.tagName === "th");
					assert.ok(head); assert.match(text(head), /\d+\.\d+\.\d+/); assert.match(text(head), /\.prax:\d+/);
					assert.doesNotMatch(text(head), /^\s*\d+\.\d+\s+\d+\.\d+\.\d+/);
				}
			}
		}
		if ("childNodes" in node) node.childNodes.forEach(walk);
	}; walk(parseFragment(html));
});

test("alsoCorrect means another valid free answer, separately counted without claiming the offered key is not unique", () => {
	const course = load(), raw = payload();
	const judgement = { ...raw.coverTheOptions.answers[0]!, answer: "A different defensible answer", coverJudgement: "alsoCorrect" };
	const answer = parseItemCues(JSON.stringify({ ...raw, coverTheOptions: { ...raw.coverTheOptions, judgeModel: "fresh-judge", answers: [judgement, ...raw.coverTheOptions.answers.slice(1)] } }), course);
	const view = itemCuesView(course, answer), cover = view.course.coverTheOptions!;
	assert.equal(cover.outcomes.alsoCorrect, 1); assert.equal(cover.outcomes.matches, 0);
	assert.equal(cover.outcomes.differs, 0); assert.equal(cover.outcomes.cantTell, 0);
	assert.equal(cover.right, 1); assert.equal(cover.pending, 8); assert.equal(cover.judged, 1);
	assert.equal(view.banks[0]!.coverTheOptions!.outcomes.alsoCorrect, 1);
	assert.equal(view.banks[0]!.coverTheOptions!.right, 1);
	assert.equal(view.banks[1]!.coverTheOptions!.right, null);
	const html = renderItemCues(view);
	assert.match(html, /Another valid answer/);
	assert.match(html, /Tighten the stem so only the key fits, or make the options settle which answer is best/);
	assert.doesNotMatch(html, /non-unique key|key not unique/);
	assert.match(html, /1 stem answerable: 0 match the key, 1 gives another valid answer/);
});

test("small-bank limits are evaluated separately for high and low tails", () => {
	const course = load(), view = itemCuesView(course, parseItemCues(JSON.stringify(payload()), course));
	assert.equal(view.banks[0]!.choicesOnly!.tooFewItems, false);
	assert.equal(view.banks[0]!.choicesOnly!.tooFewItemsLow, true);
	assert.equal(view.banks[1]!.choicesOnly!.tooFewItems, true);
	assert.equal(view.banks[1]!.choicesOnly!.tooFewItemsLow, true);
	const html = renderItemCues(view);
	assert.match(html, /Chance of this few or fewer: Too few items to compare with guessing/);
	assert.match(html, /Any unavailable bank also withholds pooled gate scores/);
});

test("absent bank patterns do not prescribe changes and spreads use separate tables", async () => {
	const raw = fixture(); raw.lessons = [raw.lessons[1]!];
	const row = raw.lessons[0]!.pages[0]!.blocks[0]!; row.assessment.options.forEach((option, i) => { option.correct = i === 2; });
	const html = renderItemCues(itemCuesView(parseCourse(JSON.stringify(raw))));
	assert.match(html, /No convergence pattern above guessing/);
	assert.match(html, /No consultation pattern to inspect/);
	assert.doesNotMatch(html, /Vary two elements|Write distractors that also consult/);
	assert.match(html, /1 key longest/); assert.doesNotMatch(html, /\b1 items\b|\b1 keys\b|\?\./);
	assert.doesNotMatch(html, /Not a length rank/);
	assert.match(html, /<caption>Course: 4-option items \(1\), key position<\/caption>/);
	assert.match(html, /<caption>Course: 4-option items \(1\), key length rank<\/caption>/);
	for (const file of ["src/item-cues.ts", "src/item-cues-view.ts"]) assert.notEqual((await readFile(resolve(file), "utf8"))[0], "\uFEFF");
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
	await prepareItemCues(course, join(dir, "bundle"), undefined, true);
	assert.doesNotMatch(await readFile(join(dir, "bundle/cover-the-options/items.json"), "utf8"), /Stem depends on non-text content/);
	const answer = { ...probeMetadata(course), choicesOnly: { bundleId: "synthetic-bundle", probe: "choices-only", model: "solver", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, choice: 1, cue: "guessed" as const, note: "" })) }, coverTheOptions: { bundleId: "synthetic-bundle", probe: "cover-the-options", model: "stem", answers: keyedChoices(course).items.map(item => ({ ref: item.ref, answer: "can't tell" })) } };
	assert.match(renderItemCues(itemCuesView(course, answer)), /Stem depends on non-text content/);
});


test("blind bundles fail closed on unconsumed markup in either stems or options, including unknown constructs", async context => {
	const dir = await mkdtemp(join(tmpdir(), "trace-item-cues-unparsed-")); context.after(() => rm(dir, { recursive: true, force: true }));
	const shapes = [
		"[Red [square]]{NESTED_CANARY: Red square is the key}",
		String.raw`[Red \] square]{ESCAPED_CANARY: Red square is the key}`,
		"[Red]{DEFINITION_CANARY: Red square is the key ]{nested {deeper}}}",
		"[[UNPARSED_CANARY: future syntax]]",
	];
	const raw = fixture(), template = raw.lessons[1]!.pages[0]!.blocks[0]!;
	raw.lessons = [raw.lessons[1]!];
	raw.lessons[0]!.pages[0]!.blocks = [...shapes.flatMap((shape, i) => ["prompt", "option"].map(role => {
		const block = structuredClone(template); block.ref = `edge-${i}-${role}`;
		block.texts.forEach((text, j) => {
			text.ref = `${block.ref}/text-${j}`;
			if (text.role === role && (role === "prompt" || j === 1)) { text.format = "markdown"; text.value = shape; }
		});
		if (role === "option") block.assessment.options[0]!.label = shape;
		return block;
	})), template];
	const input = join(dir, "inspect.json"), out = join(dir, "bundle");
	await writeFile(input, JSON.stringify(raw));
	const prepared = spawnSync(process.execPath, [resolve("src/cli.ts"), "prepare", "item-cues", input, "--out", out, "--diagnostics"], { encoding: "utf8" });
	assert.equal(prepared.status, 0, prepared.stderr);
	let files = 0;
	const scan = async (path: string): Promise<void> => { for (const entry of await readdir(path, { withFileTypes: true })) {
		const file = join(path, entry.name); if (entry.isDirectory()) await scan(file); else { files++; assert.doesNotMatch(await readFile(file, "utf8"), /[A-Z_]+_CANARY|Red square is the key|future syntax/, file); }
	} };
	await scan(out); assert.equal(files, 8);
	for (const probe of ["choices-only", "masked", "cover-the-options"]) {
		const rows = JSON.parse(await readFile(join(out, probe, "items.json"), "utf8"));
		assert.deepEqual(rows.map((row: { ref: string }) => row.ref), probe === "masked" ? [] : ["1.1.9"]);
	}
	const report = join(dir, "report"), reported = spawnSync(process.execPath, [resolve("src/cli.ts"), "report", input, "--out", report], { encoding: "utf8" });
	assert.equal(reported.status, 0, reported.stderr);
	const view = JSON.parse(await readFile(join(report, "report.json"), "utf8")).itemCues;
	assert.equal(view.excludedCount, 8); assert.equal(view.course.count, 1);
	assert.ok(view.excluded.every((row: { reason: string; label: string }) => /(The question|Option 1) still contains/.test(row.reason) && /Remove the brackets or check this item by hand/.test(row.reason) && /Red|UNPARSED|Which symbol is specified/.test(row.label)));
	const html = await readFile(join(report, "report.html"), "utf8");
	assert.match(html, /8 items left out; see Excluded items/);
	assert.match(html, /move a glossary term out of another term/);
	assert.match(html, /Otherwise check the item by hand/);
	assert.match(await readFile(join(report, "report.html"), "utf8"), /Excluded items \(8\)/);
	const excludedOnly = structuredClone(raw); excludedOnly.lessons[0]!.pages[0]!.blocks.pop();
	const only = itemCuesView(parseCourse(JSON.stringify(excludedOnly)));
	assert.equal(only.course.count, 0); assert.match(renderItemCues(only), /Excluded items \(8\)/);
	assert.match(renderItemCues(only), /Trace left out all 8 items\. The reasons are below/);
	assert.deepEqual(only.course.masked, { applies: false, reason: "no-included-items", detail: "No included single-key choices in this scope. Review excluded items: ineligible-stem." });
	assert.doesNotMatch(renderItemCues(only), /locale: en/);
	assert.doesNotMatch(renderItemCues(only), /If keys are unavailable, export/);
});

test("cover answers sort by action needed and show solver names in visible text", () => {
	const course = load(), raw = payload();
	const judgements = ["matches", "alsoCorrect", "cantTell", "differs", undefined, "matches", "matches", "matches", "matches"];
	const answer = parseItemCues(JSON.stringify({ ...raw, coverTheOptions: { ...raw.coverTheOptions, judgeModel: "fresh-judge", answers: raw.coverTheOptions.answers.map((row, i) => ({ ...row, coverJudgement: judgements[i] })) } }), course);
	const html = renderItemCues(itemCuesView(course, answer));
	const tables: string[][] = [];
	const text = (node: DefaultTreeAdapterTypes.Node): string => "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(text).join("") : "";
	const walk = (node: DefaultTreeAdapterTypes.Node) => {
		if ("tagName" in node && node.tagName === "table") {
			const caption = node.childNodes.find(child => "tagName" in child && child.tagName === "caption");
			if (caption && text(caption) === "Course: stem answers and judgements") {
				const body = node.childNodes.find(child => "tagName" in child && child.tagName === "tbody");
				assert.ok(body && "childNodes" in body);
				tables.push(body.childNodes.filter(child => "tagName" in child && child.tagName === "tr").map(row => text(row).match(/1\.1\.\d|2\.1\.\d/)![0]));
			}
		}
		if ("childNodes" in node) node.childNodes.forEach(walk);
	}; walk(parseFragment(html));
	assert.deepEqual(tables, [["1.1.5", "1.1.4", "1.1.3", "1.1.2", "1.1.1", "1.1.6", "1.1.7", "1.1.8", "2.1.1"]]);
	const visible = text(parseFragment(html));
	assert.match(visible, /Stem solver: synthetic-stem-solver\./);
	assert.match(visible, /Choices-only solver: synthetic-solver\./);
	assert.match(visible, /6 stems answerable/);
	assert.doesNotMatch(visible, /stem solver responses\.|solver responses/);
});


test("probe preparation requires projection-2 schema-1 inspect JSON, including stdin, while HTML scripted reports still work", async context => {
	const dir = await mkdtemp(join(tmpdir(), "trace-item-cues-inspect-only-")); context.after(() => rm(dir, { recursive: true, force: true }));
	const setup = "Blind probes need Studio's inspect JSON. Run `praxity inspect <course-folder> --schema 1 > course.json`, then `praxity-trace prepare item-cues course.json --out <new-empty-folder>`.";
	const refusal = setup + " `report` still runs on HTML exports.";
	const exported = join(dir, "html"); await mkdir(exported);
	const data = { question: String.raw`Which colour?<span style="display:/*c*/none">COMMENT_CANARY</span><span style="display:n\6f ne">ESCAPED_CANARY</span>`, options: [{ text: "Red", correct: true }, { text: "Blue", correct: false }] };
	const native = JSON.stringify({ type: "assessment", data }).replace(/&/g, "&amp;").replace(/'/g, "&#39;");
	await writeFile(join(exported, "lesson.html"), `<html lang="en"><body><article class="deck-slide" data-deck-slide="p"><div data-block-type="assessment" data-block-json='${native}'>Red Blue</div></article></body></html>`);
	const schema0 = { ok: true, schema: "praxity-inspect/0", studioVersion: "synthetic", course: { title: "Synthetic", locale: "en" }, lessons: [] };
	const missingProjection = { ...fixture(), projectionVersion: undefined };
	const expectedJson = setup;
	const expectedKeys = "This inspect file has no answer keys. Update Studio, run the same inspect command again, and prepare from the new file.";
	const inputs = [["<html>not inspect</html>", expectedJson], ["plain prose", expectedJson], ["{}", expectedJson], [JSON.stringify(schema0), expectedKeys], [JSON.stringify(missingProjection), expectedKeys], [JSON.stringify({ ...fixture(), projectionVersion: 1 }), expectedKeys], [JSON.stringify({ ...fixture(), projectionVersion: 3 }), "This inspect file is newer than this Trace. Update Trace."]];
	for (const [i, [input, expected]] of inputs.entries()) {
		const out = join(dir, `stdin-${i}`), cli = spawnSync(process.execPath, [resolve("src/cli.ts"), "prepare", "item-cues", "-", "--out", out], { input, encoding: "utf8" });
		assert.notEqual(cli.status, 0); assert.ok(cli.stderr.includes(expected!), cli.stderr); assert.doesNotMatch(cli.stderr, /Error:|at readCourse|node:internal/);
		await assert.rejects(readdir(out), { code: "ENOENT" });
	}
	const out = join(dir, "html-bundle"), cli = spawnSync(process.execPath, [resolve("src/cli.ts"), "prepare", "item-cues", exported, "--out", out], { encoding: "utf8" });
	assert.notEqual(cli.status, 0); assert.ok(cli.stderr.includes(refusal), cli.stderr); assert.doesNotMatch(cli.stderr, /Error:|at readCourse|node:internal/); await assert.rejects(readdir(out), { code: "ENOENT" });
	await assert.rejects(prepareItemCues(await readHtmlCourse(exported), out), error => error instanceof Error && error.message === refusal);
	await assert.rejects(prepareItemCues(parseCourse(JSON.stringify(schema0)), out), error => error instanceof Error && error.message === expectedKeys);
	const report = join(dir, "report"), reported = spawnSync(process.execPath, [resolve("src/cli.ts"), "report", exported, "--out", report], { encoding: "utf8" });
	assert.equal(reported.status, 0, reported.stderr);
	assert.deepEqual((await readdir(report)).sort(), ["report.html", "report.json"]);
	assert.equal(JSON.parse(await readFile(join(report, "report.json"), "utf8")).itemCues.course.count, 1);
	const accepted = spawnSync(process.execPath, [resolve("src/cli.ts"), "prepare", "item-cues", "-", "--out", join(dir, "accepted")], { input: JSON.stringify(fixture()), encoding: "utf8" });
	assert.equal(accepted.status, 0, accepted.stderr);
});

test("exclusions name curly brackets and singular and plural cover summaries agree", () => {
	const course = load(), raw = payload();
	const judgements = ["matches", "alsoCorrect", "differs", "differs", "cantTell", "matches", "matches", "matches", "matches"];
	const answer = parseItemCues(JSON.stringify({ ...raw, coverTheOptions: { ...raw.coverTheOptions, answers: raw.coverTheOptions.answers.map((row, i) => ({ ...row, coverJudgement: judgements[i] })) } }), course);
	const html = renderItemCues(itemCuesView(course, answer));
	assert.match(html, /1 gives another valid answer; 2 differ/);
	assert.match(html, /1 matches the key/);
	assert.doesNotMatch(html, /1 give another|2 differs/);
	const edited = fixture(); edited.lessons[1]!.pages[0]!.blocks[0]!.texts[0]!.value = "Which set {2, 4}?";
	const view = itemCuesView(parseCourse(JSON.stringify(edited)));
	assert.match(view.excluded[0]!.reason, /The question still contains '\{'/);
	assert.match(view.excluded[0]!.reason, /Remove the brackets or check this item by hand/);
});


test("HTML probe eligibility allows only inventoried paragraphs and tooltips across file, stdin and owning preparation", async context => {
	const dir = await mkdtemp(join(tmpdir(), "trace-item-cues-html-inventory-")); context.after(() => rm(dir, { recursive: true, force: true }));
	const shapes = [
		'<p>Red square<span style="display:/* c */none">COMMENT_CANARY: Red square is the key</span></p>',
		String.raw`<p>Red square<span style="display:n\6f ne">CSS_ESCAPE_CANARY: Red square is the key</span></p>`,
		'<p>Red square<span class="unlisted-secret">CLASS_CANARY: Red square is the key</span></p>',
		'<p>Visible <span class="inline-tooltip-trigger&#160;" data-tooltip-content="definition">UNICODE_CANARY: Red square is the key</span></p>',
		'<p>Visible <span class="&#160;inline-tooltip-trigger" data-tooltip-content="definition">PREFIX_CANARY: Red square is the key</span></p>',
		'<p>Visible <span class="inline-tooltip-trigger\u200b" data-tooltip-content="definition">ZERO_WIDTH_CANARY: Red square is the key</span></p>',
		'<p>Visible <span class="inline-tooltip-trigger\ufeff" data-tooltip-content="definition">BOM_CANARY: Red square is the key</span></p>',
	];
	const raw = fixture(), template = raw.lessons[1]!.pages[0]!.blocks[0]!;
	raw.lessons = [raw.lessons[1]!];
	const blocks = shapes.flatMap((shape, i) => ["prompt", "option"].map(role => {
		const block = structuredClone(template); block.ref = `html-${i}-${role}`;
		block.texts.forEach((text, j) => { text.ref = `${block.ref}/text-${j}`; if (text.role === role && (role === "prompt" || j === 1)) { text.format = "html"; text.value = shape; } });
		if (role === "option") block.assessment.options[0]!.label = shape;
		return block;
	}));
	const markdown = structuredClone(template); markdown.ref = "visible-markdown";
	markdown.texts.forEach((text, i) => { text.ref = `${markdown.ref}/text-${i}`; text.format = "markdown"; });
	const tooltip = structuredClone(template); tooltip.ref = "visible-tooltip";
	const term = '<p><span class=" \tinline-tooltip-trigger\n\f\r " data-tooltip-content="TOOLTIP_CANARY: Red square is the key">Red square</span></p>';
	tooltip.texts.forEach((text, i) => { text.ref = `${tooltip.ref}/text-${i}`; if (text.role === "prompt" || (text.role === "option" && i === 1)) { text.format = "html"; text.value = term; } });
	tooltip.assessment.options[0]!.label = term;
	raw.lessons[0]!.pages[0]!.blocks = [...blocks, markdown, tooltip];
	const json = JSON.stringify(raw), course = parseCourse(json), input = join(dir, "inspect.json"); await writeFile(input, json);
	for (const route of ["file", "stdin", "owner"]) {
		const out = join(dir, route);
		if (route === "owner") await prepareItemCues(course, out, undefined, true);
		else {
			const cli = spawnSync(process.execPath, [resolve("src/cli.ts"), "prepare", "item-cues", route === "stdin" ? "-" : input, "--out", out, "--diagnostics"], { input: route === "stdin" ? json : undefined, encoding: "utf8" });
			assert.equal(cli.status, 0, cli.stderr);
		}
		let files = 0;
		const scan = async (path: string): Promise<void> => { for (const entry of await readdir(path, { withFileTypes: true })) {
			const file = join(path, entry.name); if (entry.isDirectory()) await scan(file); else { files++; assert.doesNotMatch(await readFile(file, "utf8"), /[A-Z_]+_CANARY|Red square is the key|data-tooltip-content/, file); }
		} }; await scan(out); assert.equal(files, 8);
		for (const probe of ["choices-only", "masked", "cover-the-options"]) {
			const rows = JSON.parse(await readFile(join(out, probe, "items.json"), "utf8")); assert.deepEqual(rows.map((row: { ref: string }) => row.ref), probe === "masked" ? [] : ["1.1.15", "1.1.16"]);
		}
		assert.ok(JSON.parse(await readFile(join(out, "choices-only/items.json"), "utf8")).every((row: { options: string[] }) => row.options.includes("Red square")));
		assert.equal(JSON.parse(await readFile(join(out, "cover-the-options/items.json"), "utf8"))[1].stem, "Red square");
	}
	const view = itemCuesView(course);
	assert.equal(view.excludedCount, 14); assert.equal(view.course.count, 2);
	assert.ok(view.excluded.every(item => /attribute.*<span>|class.*<span>/.test(item.reason) && /Check this item by hand/.test(item.reason)));
	assert.match(renderItemCues(view), /14 items left out/);
});

test("HTML allow-list refuses hiding, unfamiliar markup and malformed attributes even when visible text looks safe", () => {
	for (const html of [
		'<p style="color:red">Red</p>', '<p hidden>Red</p>', '<p aria-hidden="false">Red</p>',
		'<template>Red</template>', '<script>Red</script>', '<noscript>Red</noscript>', '<widget>Red</widget>',
		'<span class="inline-tooltip-trigger other" data-tooltip-content="hidden">Red</span>',
		'<span class="inline-tooltip-trigger" data-tooltip-content="hidden" title="extra">Red</span>',
		'<p class="inline-tooltip-trigger">Red</p>', '<p STYLE="display:none">Red</p>', '<p title="one" title="two">Red</p>',
		'<html style="display:none">Red</html>', '<body hidden>Red</body>', '<head><p>Red</p></head>', '<!doctype html><p>Red</p>',
	]) {
		const raw = fixture(), block = raw.lessons[1]!.pages[0]!.blocks[0]!;
		block.texts[0]!.format = "html"; block.texts[0]!.value = html;
		const view = itemCuesView(parseCourse(JSON.stringify(raw)));
		assert.deepEqual(view.banks.map(bank => [bank.count, bank.excludedCount]), [[8, 0], [0, 1]], html);
		assert.equal(view.excludedCount, 1, html);
		assert.match(view.excluded[0]!.reason, /Trace can't safely check/, html);
	}
});


test("ordinary Studio inline formatting stays eligible without attributes that can hide it", () => {
	const forms = [
		["strong", "<strong>not</strong>"], ["em", "<em>not</em>"], ["code", "<code>len(x)</code>"],
		["del", "<del>old</del>"], ["mark", "<mark>marked</mark>"], ["a", '<a href="https://example.com">manual</a>'],
		["span", '<span class="praxity-doodle" data-doodle="circle" data-doodle-mods="">a doodle</span>'],
	];
	for (const [tag, html] of forms) {
		for (const role of ["prompt", "option"]) {
			const raw = fixture(), block = raw.lessons[1]!.pages[0]!.blocks[0]!;
			const text = block.texts.find(text => text.role === role)!; text.value = `<p>Which ${html} fits?</p>`; text.format = "html";
			if (role === "option") block.assessment.options[0]!.label = text.value;
			const view = itemCuesView(parseCourse(JSON.stringify(raw)));
			assert.equal(view.excludedCount, 0, `${role} ${tag}`);
			assert.ok(view.banks[1]!.items.length, tag);
		}
		for (const attribute of ['style="display:none"', 'class="unknown"']) {
			const raw = fixture(), block = raw.lessons[1]!.pages[0]!.blocks[0]!;
			block.texts[0]!.value = html!.replace(`<${tag}`, `<${tag} ${attribute}`); block.texts[0]!.format = "html";
			const view = itemCuesView(parseCourse(JSON.stringify(raw)));
			assert.equal(view.excludedCount, 1, `${tag} ${attribute}`);
			assert.match(view.excluded[0]!.reason, new RegExp(tag!));
			assert.doesNotMatch(view.excluded[0]!.reason, /re-export/);
		}
	}
	for (const html of ['<sup>Red</sup>', '<span data-mention="variable:name"></span>', '<span class="praxity-inline-icon" aria-hidden="true"></span>']) {
		const raw = fixture(), block = raw.lessons[1]!.pages[0]!.blocks[0]!; block.texts[0]!.format = "html"; block.texts[0]!.value = html;
		const view = itemCuesView(parseCourse(JSON.stringify(raw))); assert.equal(view.excludedCount, 1); assert.match(view.excluded[0]!.reason, /<sup>|<span>/);
	}
});

test("report setup commands appear only on course rows and the skill reads the manifest version", async () => {
	const html = renderItemCues(itemCuesView(load()));
	assert.doesNotMatch(html, /0 items left out|with schema 1 inspect JSON, projection 2/);
	assert.equal((html.match(/praxity-trace prepare item-cues course.json/g) ?? []).length, 2, "One course instruction per display mode, never repeated per bank");
	assert.match(html, /praxity inspect.*course-folder.*--schema 1.*course.json/);
	const skill = await readFile(resolve("skill/SKILL.md"), "utf8");
	assert.match(skill, /Copy `view`, `promptVersion`, `courseHash` and `bundleId` from the bundle manifest/);
	assert.match(skill, /Keep `seed` and `optionOrder` exclusively in the sibling `operator.json`/);
	assert.doesNotMatch(skill, /Use `item-cues\/\d/);
});


function authored() {
	const raw = fixture();
	return { ...raw, course: { ...raw.course, language: { declared: "en-CA", source: "manifest", workspaceContext: "unavailable" } },
		lessons: raw.lessons.map(lesson => ({ ...lesson, language: { value: "EN-ca", source: "course" } })) };
}

async function activated(context: { after: (cleanup: () => Promise<void>) => void }, raw = authored(), seed = 17, diagnostics = false) {
	const dir = await mkdtemp(join(tmpdir(), "trace-activation-")); context.after(() => rm(dir, { recursive: true, force: true }));
	const course = parseCourse(JSON.stringify(raw)), bundle = join(dir, "bundle");
	await prepareItemCues(course, bundle, seed, diagnostics);
	const operator = JSON.parse(await readFile(join(`${bundle}-review`, "operator.json"), "utf8"));
	const rows = JSON.parse(await readFile(join(bundle, "masked/items.json"), "utf8")) as Array<{ ref: string; stem: string; options: string[] }>;
	const items = keyedChoices(course).items;
	const choice = (ref: string) => operator.optionOrder[ref].indexOf(items.find(item => item.ref === ref)!.key) + 1;
	const answer = { ...operator,
		masked: rows.length ? { bundleId: operator.bundleId, probe: "masked", applies: true, model: "masked-solver", answers: rows.map(row => ({ ref: row.ref, choice: choice(row.ref), cue: "guessed", note: "" })) } : { ...operator.masked, bundleId: operator.bundleId, probe: "masked" },
		choicesOnly: { bundleId: operator.bundleId, probe: "choices-only", model: "plain-solver", answers: items.map(item => ({ ref: item.ref, choice: choice(item.ref), cue: "guessed", note: "" })) },
		coverTheOptions: { bundleId: operator.bundleId, probe: "cover-the-options", model: "stem-solver", answers: items.map(item => ({ ref: item.ref, answer: "can't tell" })) } };
	const parsed = readItemCues(JSON.stringify(answer), course, JSON.stringify(operator));
	return { dir, bundle, rows, course, operator, answer, parsed, view: itemCuesView(course, parsed) };
}

test("CLI defaults to masked only and optional diagnostics never change its results across seeds", async context => {
	for (const seed of [0, 17, 29]) {
		const result = await activated(context, authored(), seed);
		const input = join(result.dir, "input.json"), bundle = join(result.dir, "default");
		await writeFile(input, JSON.stringify(authored()));
		const run = (...args: string[]) => {
			const cli = spawnSync(process.execPath, [resolve("src/cli.ts"), ...args], { encoding: "utf8" });
			assert.equal(cli.status, 0, cli.stderr);
		};
		run("prepare", "item-cues", input, "--out", bundle, "--seed", String(seed));
		assert.deepEqual((await readdir(bundle)).sort(), ["manifest.json", "masked", "prompt.md"]);
		assert.equal(withoutIdentity(await readFile(join(bundle, "masked/items.json"), "utf8")), withoutIdentity(await readFile(join(result.bundle, "masked/items.json"), "utf8")));
		assert.match(await readFile(join(`${bundle}-review`, "prompt.md"), "utf8"), /"choicesOnly": "not run"/);
		const answerPath = join(`${result.bundle}-review`, "answer.json"), report = join(result.dir, "report");
		const { choicesOnly, coverTheOptions, ...maskedOnly } = result.answer;
		const answers = [result.answer, maskedOnly, { ...maskedOnly, choicesOnly: "not run", coverTheOptions: "not run" }, { ...maskedOnly, choicesOnly: "not run", coverTheOptions }, { ...maskedOnly, choicesOnly, coverTheOptions: "not run" }];
		for (const answer of answers) {
			await writeFile(answerPath, JSON.stringify(answer));
			run("report", input, "--out", report, "--item-cues", answerPath);
			const reported = JSON.parse(await readFile(join(report, "report.json"), "utf8")), view = reported.itemCues;
			const html = await readFile(join(report, "report.html"), "utf8");
			assert.match(html, /<caption>Course: Masked guessing-cue probe responses<\/caption>/);
			assert.doesNotMatch(html, /<strong>Probes not run\.<\/strong>/);
			for (const [ran, caption, guide] of [
				[Boolean(view.course.choicesOnly), "Does the stem matter? Plain choices-only diagnostic responses", "Plain choices-only above guessing"],
				[Boolean(view.course.coverTheOptions), "stem answers and judgements", "Cover-the-options answers need judgement"],
			] as const) {
				assert.equal(html.includes(`<caption>Course: ${caption}</caption>`), ran);
				assert.equal(html.includes(`<dt>${guide}</dt>`), ran);
				assert.equal(reported.guides["item-cues"].some((reading: { see: string }) => reading.see === guide), ran);
			}
			for (const [i, row] of [view.course, ...view.banks].entries()) {
				const expected = [result.view.course, ...result.view.banks][i]!;
				assert.deepEqual(row.masked, expected.masked);
				assert.equal(row.probeStatus, "Probes scored");
				assert.equal(row.count, expected.count);
				assert.equal(Boolean(row.choicesOnly), "choicesOnly" in answer && answer.choicesOnly !== "not run");
				assert.equal(Boolean(row.coverTheOptions), "coverTheOptions" in answer && answer.coverTheOptions !== "not run");
			}
		}
	}
});

test("unavailable masked answers without diagnostics keep probes unscored", () => {
	const { choicesOnly, coverTheOptions, ...held } = payload();
	for (const [plain, cover] of [[undefined, undefined], [choicesOnly, undefined], [undefined, coverTheOptions]] as const) {
		const view = itemCuesView(load(), parseItemCues(JSON.stringify({ ...held, choicesOnly: plain, coverTheOptions: cover }), load()));
		for (const row of [view.course, ...view.banks]) assert.equal(row.probeStatus, plain || cover ? "Probes scored" : "Probes not run");
		const html = renderItemCues(view);
		assert.equal(html.includes("<strong>Probes not run.</strong>"), !plain && !cover);
		assert.equal(html.includes("<caption>Course: Does the stem matter? Plain choices-only diagnostic responses</caption>"), Boolean(plain));
		assert.equal(html.includes("<caption>Course: stem answers and judgements</caption>"), Boolean(cover));
	}
});

function noMaskedScore(value: unknown) {
	assert.ok(value && typeof value === "object");
	assert.equal((value as { applies: boolean }).applies, false);
	for (const field of ["p", "pLow", "pMin", "pLowMin", "right", "total", "chanceExpected", "tooFewItems", "tooFewItemsLow", "items", "cueCounts"]) assert.equal(field in value, false, field);
}

test("authored English lesson provenance activates preparation parsing and reports for file and stdin", async context => {
	const raw = authored(); raw.lessons[0]!.language = { value: "eN", source: "lesson" };
	const result = await activated(context, raw);
	assert.equal(result.rows.length, 9);
	assert.deepEqual(result.operator.masked, { applies: true, status: "not run" });
	assert.deepEqual(itemCuesView(result.course).course.masked, { applies: true, status: "not run" });
	for (const row of [result.view.course, ...result.view.banks]) {
		assert.ok(row.masked.applies && row.masked.status === "scored");
		assert.equal(row.masked.total, row.count); assert.equal(row.masked.right, row.count);
	}
	const input = join(result.dir, "input.json"), answer = join(`${result.bundle}-review`, "answer.json");
	await writeFile(input, JSON.stringify(raw)); await writeFile(answer, JSON.stringify(result.answer));
	for (const route of ["file", "stdin"]) {
		const prepared = join(result.dir, route), out = join(result.dir, `${route}-report`);
		const run = (args: string[]) => { const cli = spawnSync(process.execPath, [resolve("src/cli.ts"), ...args], { input: JSON.stringify(raw), encoding: "utf8" }); assert.equal(cli.status, 0, cli.stderr); };
		run(["prepare", "item-cues", route === "file" ? input : "-", "--out", prepared, "--seed", "17"]);
		assert.equal(JSON.parse(await readFile(join(prepared, "masked/items.json"), "utf8")).length, 9);
		run(["report", route === "file" ? input : "-", "--out", out, "--item-cues", answer]);
		assert.equal(JSON.parse(await readFile(join(out, "report.json"), "utf8")).itemCues.course.masked.total, 9);
		assert.match(await readFile(join(out, "report.html"), "utf8"), /Masked guessing-cue probe: 9 of 9 right/);
	}
	assert.match(renderItemCues(result.view), /Masked stem and response/);
	const missing = structuredClone(result.answer); missing.masked.answers.pop();
	assert.throws(() => readItemCues(JSON.stringify(missing), result.course, JSON.stringify(result.operator)), /every eligible item/);
	const crossed = structuredClone(result.answer); crossed.masked.probe = "choices-only";
	assert.throws(() => readItemCues(JSON.stringify(crossed), result.course, JSON.stringify(result.operator)), /bundleId\/probe/);
});

test("missing malformed default and foreign lesson evidence fail closed without borrowing another lesson", async context => {
	for (const [language, reason] of [[undefined, "language-unconfirmed"], [null, "language-unconfirmed"], [{ value: "en" }, "language-unconfirmed"], [{ value: 42, source: "lesson" }, "language-unconfirmed"], [{ value: "en", source: "workspace" }, "language-unconfirmed"], [{ source: "default" }, "language-unconfirmed"], [{ value: "fr" }, "language-unconfirmed"], [{ value: "en", source: "default" }, "language-unconfirmed"], [{ value: "", source: "lesson" }, "language"], [{ value: "eng", source: "lesson" }, "language"], [{ value: "fr-CA", source: "lesson" }, "language"]] as const) {
		const raw = authored(); Object.assign(raw.lessons[1]!, { language });
		const result = await activated(context, raw);
		assert.equal(result.rows.length, 8, JSON.stringify(language));
		assert.equal(result.view.course.count, 9); assert.equal(result.view.banks[1]!.count, 1);
		for (const row of [result.view.course, result.view.banks[1]!]) { noMaskedScore(row.masked); assert.ok(!row.masked.applies); assert.equal(row.masked.reason, reason); }
		assert.ok(result.view.banks[0]!.masked.applies && result.view.banks[0]!.masked.status === "scored");
		if (reason === "language") { assert.ok(!result.view.course.masked.applies); assert.match(result.view.course.masked.detail, /2\.1\.1/); }
		const forged = structuredClone(result.answer); forged.masked.answers.push({ ref: "2.1.1", choice: 1, cue: "guessed", note: "" });
		assert.throws(() => readItemCues(JSON.stringify(forged), result.course, JSON.stringify(result.operator)), /unique eligible/);
	}
	const raw = authored(); raw.lessons[1]!.language = { value: "fr", source: "lesson" };
	raw.lessons[1]!.pages[0]!.blocks[0]!.assessment.selectionMode = "multiple";
	const result = await activated(context, raw);
	assert.equal(result.view.excludedCount, 1); assert.equal(result.rows.length, 8);
	assert.ok(result.view.course.masked.applies && result.view.course.masked.status === "scored");
	assert.equal(result.view.course.masked.total, 8);
	const detached = authored(); Reflect.deleteProperty(detached.lessons[1]!, "language");
	Object.assign(detached.lessons[0]!, { language: { value: "en", source: "lesson" }, otherLesson: "clean.prax" });
	assert.equal((await activated(context, detached)).view.banks[1]!.masked.applies, false);
});

test("producer revision binds manifest-only and lesson-language-only changes and rejects replayed operator evidence", async context => {
	const result = await activated(context);
	for (const kind of ["manifest", "lesson"]) {
		const raw = authored(); raw.revision = (kind === "manifest" ? "b" : "c").repeat(64);
		if (kind === "manifest") raw.course.language.declared = "en-US"; else raw.lessons[1]!.language.value = "en-US";
		const changed = parseCourse(JSON.stringify(raw));
		assert.notEqual(courseHash(changed), courseHash(result.course));
		assert.deepEqual(changed.lessons.map(lesson => lesson.sha256), result.course.lessons.map(lesson => lesson.sha256));
		assert.throws(() => readItemCues(JSON.stringify(result.answer), changed, JSON.stringify(result.operator)), /different course/);
		assert.throws(() => readItemCues(JSON.stringify({ ...result.answer, courseHash: courseHash(changed) }), changed, JSON.stringify(result.operator)), /different course/);
	}
});

test("English discriminating evidence excludes frozen homographs independently of masking", () => {
	const homographs = "a an in no on or as do so was will also is has had he but for here I";
	assert.deepEqual(englishEvidence(homographs), { words: 20, evidence: 0, conflicts: [] });
	assert.deepEqual(englishEvidence("Which of these would you choose?"), { words: 6, evidence: 5, conflicts: [] });
	assert.deepEqual(englishEvidence("THE 42 isn't on [it]?"), { words: 4, evidence: 3, conflicts: [] });
	const item = { ref: "1.1.1", label: "Synthetic", bank: "lesson:1", stem: homographs, options: ["the copper", "the wire"], key: 0, shuffle: false, stemDependsOnNonText: false };
	assert.equal(maskItem(item, 17).stem, homographs);
});

test("deny-only text conflicts screen every stem with options despite an erroneous English declaration", async context => {
	const french = ["Toujours appeler le responsable", "Ne jamais appeler le responsable", "Appeler seulement le responsable", "Appeler parfois le responsable"];
	const cases = [
		["Which action should you take?", french],
		["On doit toujours appeler", french],
		["Quel choix?", french],
		["Which of these is the one that you would choose?", french],
		["Was machen Sie in einem Brandfall?", ["Immer melden", "Nie melden", "Nur warten", "Sie müssen gehen"]],
		["Was tun Sie bei Rauch in einem Büro?", ["Immer melden", "Nie melden", "Nur warten", "Sie müssen gehen"]],
		["Qual é a função do plano no local?", ["Sempre chamar", "Nunca chamar", "Chamar depois", "Não chamar"]],
		["A quién se llama si no funciona?", ["Siempre llamar", "Nunca llamar", "Llamar después", "No llamar"]],
		["Qui a reçu le message?", ["Le but principal", "On appelle", "Avec le responsable", "Vrai ou faux"]],
	] as const;
	for (const [stem, options] of cases) {
		const raw = authored(); replaceOptions(raw, [...options]); raw.lessons[1]!.pages[0]!.blocks[0]!.texts[0]!.value = stem;
		const result = await activated(context, raw);
		assert.equal(result.rows.length, 8, stem); noMaskedScore(result.view.course.masked); noMaskedScore(result.view.banks[1]!.masked);
		assert.ok(!result.view.banks[1]!.masked.applies); assert.equal(result.view.banks[1]!.masked.reason, "language");
		assert.match(result.view.banks[1]!.masked.detail, /2\.1\.1.*text conflict/);
		assert.equal(result.view.course.count, 9); assert.equal(result.view.banks[1]!.count, 1);
		assert.ok(result.view.banks[0]!.masked.applies);
		assert.match(renderItemCues(result.view), /Unavailable: language/);
	}
	// Four English and five French items cannot dilute one another inside a bank.
	const raw = authored(); raw.lessons = [raw.lessons[0]!];
	const template = structuredClone(raw.lessons[0]!.pages[0]!.blocks[0]!);
	raw.lessons[0]!.pages[0]!.blocks = Array.from({ length: 9 }, (_, i) => {
		const block = structuredClone(template); block.ref = `mixed/${i}`;
		block.texts.forEach((text, j) => { text.ref = `${block.ref}/text/${j}`; if (text.role === "prompt") text.value = i < 4 ? "Which action should you take?" : ["Qui a reçu", "Le but principal", "Que fait-on", "Vrai ou faux?", "Quel choix?"][i - 4]!; });
		return block;
	});
	const result = await activated(context, raw); assert.equal(result.rows.length, 0); assert.equal(result.view.course.count, 9);
	noMaskedScore(result.view.course.masked); noMaskedScore(result.view.banks[0]!.masked);
});

test("terse English noun phrases and content-only banks keep their complete denominators", async context => {
	const raw = authored();
	for (const lesson of raw.lessons) for (const block of lesson.pages[0]!.blocks) block.texts[0]!.value = "Correct hand hygiene duration";
	replaceOptions(raw, ["Twenty seconds", "Ten seconds", "Fifteen seconds", "Thirty seconds"]);
	const result = await activated(context, raw); assert.equal(result.rows.length, 9);
	assert.ok(result.view.course.masked.applies && result.view.course.masked.status === "scored"); assert.equal(result.view.course.masked.total, 9);
	const short = authored(); short.lessons[1]!.pages[0]!.blocks[0]!.texts[0]!.value = "Identify correct hand hygiene";
	assert.equal((await activated(context, short)).rows.length, 9);
	for (const stem of ["Which SQL transaction isolation level prevents phantom reads?", "Which copper pipes carry clean water?"]) {
		const positive = authored(); positive.lessons[1]!.pages[0]!.blocks[0]!.texts[0]!.value = stem;
		assert.equal((await activated(context, positive)).rows.length, 9);
	}
});

test("attainable minimum tails expose the consumer threshold gap per bank and course", async context => {
	for (const n of [11, 12]) {
		const raw = authored(), template = structuredClone(raw.lessons[1]!.pages[0]!.blocks[0]!);
		raw.lessons = [raw.lessons[1]!]; raw.lessons[0]!.pages[0]!.blocks = Array.from({ length: n }, (_, i) => {
			const block = structuredClone(template); block.ref = `tail/${i}`;
			block.texts.forEach((text, j) => { text.ref = `${block.ref}/text/${j}`; }); return block;
		});
		const result = await activated(context, raw);
		for (const row of [result.view.course, ...result.view.banks]) for (const score of [row.masked, row.choicesOnly!]) {
			assert.ok(score.applies && "pMin" in score);
			assert.equal(score.pMin, n === 11 ? 0.0000002384185791015625 : 0.000000059604644775390625);
			assert.equal(score.pLowMin, n === 11 ? 0.04223513603210449 : 0.03167635202407837);
			assert.equal(score.tooFewItemsLow, false); assert.ok(score.pLowMin > 0.025);
		}
	}
	const result = await activated(context);
	assert.ok(result.view.course.masked.applies && "pMin" in result.view.course.masked);
	assert.equal(result.view.course.masked.pMin, 0.000003814697265625);
	assert.equal(result.view.course.masked.pLowMin, 0.07508468627929688);
});

test("you-sound inflections and masked capitals preserve article class with literal alphabets", () => {
	const item = { ref: "1.1.1", label: "Synthetic", bank: "lesson:1", stem: "We chose a", options: ["used needle", "usable tool", "unified approach", "Eurozone office", "usage guide", "usability study", "utilize", "utilization", "euros"], key: 0, shuffle: false, stemDependsOnNonText: false };
	for (let seed = 0; seed < 64; seed++) {
		const form = maskItem(item, seed); assert.ok(form.options.every(option => /^[b-df-hj-np-tv-z]/i.test(option)), `seed ${seed}`);
		assert.deepEqual(maskItem({ ...item, key: 3 }, seed), form);
		for (const [word, alphabet] of [["LAN", "bcdgjkpqtvwyz"], ["SMART", "bcdgjkpqtvwyz"], ["HIPAA", "bcdgjkpqtvwyz"], ["SCORM", "bcdgjkpqtvwyz"], ["MRI", "aeio"], ["HIV", "aeio"], ["X-ray", "aeio"]]) {
			const output = maskItem({ ...item, options: [word!, "plain", "simple", "routine"] }, seed).options[0]!;
			assert.ok(alphabet!.includes(output[0]!.toLowerCase()), `${word} -> ${output}, seed ${seed}`);
		}
	}
});


test("mask-space blocks only its complete bank and never reports partial tails", async context => {
	const raw = authored(); replaceOptions(raw, ["q\u0301", "x\u0301", "f\u0301", "j\u0301"]);
	const result = await activated(context, raw);
	assert.equal(result.rows.length, 8); assert.equal(result.view.course.count, 9);
	assert.equal(result.view.course.maskedExcludedCount, 1);
	assert.equal(result.view.course.excludedByReason["masked-space"], 1);
	assert.equal(result.view.banks[1]!.excludedByReason["masked-space"], 1);
	for (const row of [result.view.course, result.view.banks[1]!]) { noMaskedScore(row.masked); assert.ok(!row.masked.applies); assert.equal(row.masked.reason, "mask-space"); assert.match(row.masked.detail, /2\.1\.1/); }
	assert.ok(result.view.banks[0]!.masked.applies && result.view.banks[0]!.masked.status === "scored");
});

test("heterogeneous option counts have literal attainable minima", async context => {
	const raw = authored(); raw.lessons[0]!.pages[0]!.blocks = [raw.lessons[0]!.pages[0]!.blocks[0]!];
	const first = raw.lessons[0]!.pages[0]!.blocks[0]!;
	first.assessment.options = first.assessment.options.slice(0, 2);
	let options = 0; first.texts = first.texts.filter(text => text.role !== "option" || options++ < 2);
	const result = await activated(context, raw);
	const pooled = result.view.course.masked;
	assert.ok(pooled.applies && pooled.status === "scored"); assert.equal(pooled.pMin, 0.125); assert.equal(pooled.pLowMin, 0.375);
	const bank = result.view.banks[0]!.masked;
	assert.ok(bank.applies && bank.status === "scored"); assert.equal(bank.pMin, 0.5); assert.equal(bank.pLowMin, 0.5);
});

test("lesson overrides can confirm English independently of missing workspace or default course context", async context => {
	const raw = authored(); raw.course.language = { declared: "", source: "default", workspaceContext: "unavailable" };
	Reflect.deleteProperty(raw.course.language, "workspaceContext");
	for (const lesson of raw.lessons) lesson.language = { value: " en_US ", source: "lesson" };
	const result = await activated(context, raw); assert.equal(result.rows.length, 9);
	assert.ok(result.view.course.masked.applies);
});


test("German banks on both sides of the former pooled floor remain unavailable", async context => {
	const german = [
		"Was sollte ein Mitarbeiter in einem Notfall zuerst tun?",
		"Was ist die beste Antwort an einen unzufriedenen Kunden?",
		"Was tun Sie, wenn ein Kollege die Daten an Dritte senden will?",
		"Was passiert, wenn ein Patient die Medikamente nicht einnimmt?",
		"Wie oft muss die Anlage in einem Jahr geprüft werden?",
		"Was ist in diesem Fall die richtige Meldung?",
		"Was gilt für Besucher in der Produktionshalle?",
		"Was sagen Sie einem Kunden, der eine Rückerstattung will?",
		"Wer ist richtig?", "Was ist ein Beinahe-Unfall?",
	];
	for (const stems of [german, [...german, "Was machen Sie in einem Brandfall?"]]) {
		const raw = authored(); raw.lessons = [{ ...raw.lessons[0]!, pages: courseWithStems(stems).lessons[0]!.pages }];
		const result = await activated(context, raw);
		assert.equal(result.rows.length, 0); assert.equal(result.view.course.count, stems.length);
		noMaskedScore(result.view.course.masked); noMaskedScore(result.view.banks[0]!.masked);
		assert.ok(!result.view.course.masked.applies); assert.equal(result.view.course.masked.reason, "language");
	}
});

test("the three review populations cannot launder French options or a separate French bank", async context => {
	const french = ["Toujours appeler le responsable", "Ne jamais appeler le responsable", "Appeler seulement le responsable", "Appeler parfois le responsable"];
	for (const scenario of ["english-stems", "french-stems", "separate-bank"]) {
		const raw = authored(), template = structuredClone(raw.lessons[1]!.pages[0]!.blocks[0]!);
		replaceOptions(raw, french);
		const bank = raw.lessons[1]!;
		bank.pages[0]!.blocks = Array.from({ length: 16 }, (_, i) => {
			const block = structuredClone(template); block.ref = `foreign/${i}`;
			block.texts.forEach((text, j) => { text.ref = `${block.ref}/text/${j}`; if (text.role === "prompt") text.value = scenario === "english-stems" ? "Which action should you take?" : scenario === "french-stems" ? "On doit toujours appeler" : "Quel choix?"; if (text.role === "option") text.value = french[Number(text.ref.split("/").at(-1)) - 1]!; });
			block.assessment.options.forEach((option, j) => { option.ref = `${block.ref}/option/${j}`; option.label = french[j]!; });
			return block;
		});
		if (scenario === "separate-bank") {
			raw.lessons[0]!.pages[0]!.blocks = [raw.lessons[0]!.pages[0]!.blocks[0]!];
			raw.lessons[0]!.pages[0]!.blocks[0]!.texts[0]!.value = "Which of these is the one that you would choose?";
		} else raw.lessons = [bank];
		const result = await activated(context, raw);
		assert.equal(result.rows.length, scenario === "separate-bank" ? 1 : 0);
		assert.equal(result.view.course.count, scenario === "separate-bank" ? 17 : 16);
		noMaskedScore(result.view.course.masked);
		const foreignBank = result.view.banks.at(-1)!; assert.equal(foreignBank.count, 16); noMaskedScore(foreignBank.masked);
		if (scenario === "separate-bank") { const good = result.view.banks[0]!.masked; assert.ok(good.applies && good.status === "scored"); assert.equal(good.total, 1); }
	}
});

test("English training items retain single homographs in stems and options", async context => {
	const cases = ["Who may file a qui tam lawsuit?", "The dos and don'ts of email security", "According to Le Chatelier's principle", "A cultural faux pas", "Why was DES replaced by AES?", "Lists files in DOS", "The AUX cable", "Gravida 3, para 2", "La Niña", "Offered à la carte", "Des Moines", "A QUAL-quan design", "UNE standards"];
	for (const text of cases) for (const field of ["stem", "option"]) {
		const raw = authored();
		replaceOptions(raw, field === "option" ? [text, "The patient", "The auditor", "The visitor"] : ["The employee", "The patient", "The auditor", "The visitor"]);
		raw.lessons[1]!.pages[0]!.blocks[0]!.texts[0]!.value = field === "stem" ? text : "Which response is appropriate?";
		const result = await activated(context, raw);
		assert.equal(result.rows.length, 9, `${field}: ${text}`);
		for (const row of [result.view.course, ...result.view.banks]) { assert.ok(row.masked.applies && row.masked.status === "scored"); assert.equal(row.masked.total, row.count); }
	}
});

test("homographs need a distinct second marker or no English evidence within the same item", async context => {
	assert.deepEqual(englishEvidence("Which dos dos?"), { words: 3, evidence: 1, conflicts: [] });
	assert.deepEqual(englishEvidence("Which dos para?"), { words: 3, evidence: 1, conflicts: ["dos", "para"] });
	assert.deepEqual(englishEvidence("dos"), { words: 1, evidence: 0, conflicts: ["dos"] });
	assert.deepEqual(englishEvidence("Which brandfall appeler responsable machen llamar choisir?"), { words: 7, evidence: 1, conflicts: [] });
	for (const [stem, options] of [["Which dos?", ["Para", "Blue", "Green", "Red"]], ["Le but principal", balanced]] as const) {
		const raw = authored(); replaceOptions(raw, [...options]); raw.lessons[1]!.pages[0]!.blocks[0]!.texts[0]!.value = stem;
		const result = await activated(context, raw);
		assert.equal(result.rows.length, 8); noMaskedScore(result.view.course.masked); noMaskedScore(result.view.banks[1]!.masked);
	}
	const raw = authored(); raw.lessons[0]!.pages[0]!.blocks[0]!.texts[0]!.value = "Which para?";
	raw.lessons[1]!.pages[0]!.blocks[0]!.texts[0]!.value = "Which dos?";
	assert.equal((await activated(context, raw)).rows.length, 9, "Markers in different items do not reinforce each other");
});

test("undeclared course language and malformed provenance stay unconfirmed with an actionable remedy", async context => {
	for (const language of [{ value: "en", source: "default" }, { value: "fr", source: "default" }, { value: "fr" }]) {
		const raw = authored(); Object.assign(raw.course.language, { declared: null, source: "default" });
		for (const lesson of raw.lessons) Object.assign(lesson, { language });
		const result = await activated(context, raw);
		assert.equal(result.rows.length, 0);
		for (const row of [result.view.course, ...result.view.banks]) {
			noMaskedScore(row.masked); assert.ok(!row.masked.applies); assert.equal(row.masked.reason, "language-unconfirmed");
			assert.match(row.masked.detail, /locale: en.*course\.yaml/); assert.match(row.masked.detail, /lang: en.*lesson/);
			assert.match(row.masked.detail, /Studio build.*inspect language provenance/); assert.doesNotMatch(row.masked.detail, /conflict/i);
		}
	}
});

test("accented listed markers are exercised as complete Unicode tokens", () => {
	for (const word of ["müssen", "não", "você", "são", "reçu"]) {
		assert.deepEqual(englishEvidence(word), { words: 1, evidence: 0, conflicts: [word] });
		assert.deepEqual(englishEvidence(`Which ${word}?`), { words: 2, evidence: 1, conflicts: [word] });
	}
});

test("item-cue fixtures are UTF-8 and contain no lossy question marks inside words", async () => {
	const source = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(resolve("test/item-cues.test.ts")));
	assert.doesNotMatch(source, /[A-Za-z]\?+[a-z]/);
	for (const word of ["müssen", "não", "você", "são", "reçu"]) assert.ok(source.includes(word), word);
});

test("activated masked probes omit and reject subject-knowledge cue codes", async context => {
	const result = await activated(context, authored(), 17, true);
	assert.equal(result.rows.length, 9);
	const masked = await readFile(join(result.bundle, "masked/prompt.md"), "utf8"), plain = await readFile(join(result.bundle, "choices-only/prompt.md"), "utf8");
	for (const cue of ["only-true-on-its-own", "textbook-wording"]) {
		assert.ok(!masked.includes(cue), cue); assert.ok(plain.includes(cue), cue);
		const answer = structuredClone(result.answer); answer.masked.answers[0]!.cue = cue;
		assert.throws(() => readItemCues(JSON.stringify(answer), result.course, JSON.stringify(result.operator)), /masked.*cue/);
		const plainAnswer = structuredClone(result.answer); plainAnswer.choicesOnly.answers[0]!.cue = cue;
		assert.doesNotThrow(() => readItemCues(JSON.stringify(plainAnswer), result.course, JSON.stringify(result.operator)));
	}
	const tables: Array<{ caption: string; text: string }> = [];
	const text = (node: DefaultTreeAdapterTypes.Node): string => "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(text).join("") : "";
	const walk = (node: DefaultTreeAdapterTypes.Node) => {
		if ("tagName" in node && node.tagName === "table") { const caption = node.childNodes.find(child => "tagName" in child && child.tagName === "caption"); if (caption) tables.push({ caption: text(caption), text: text(node) }); }
		if ("childNodes" in node) node.childNodes.forEach(walk);
	}; walk(parseFragment(renderItemCues(result.view)));
	const maskedTables = tables.filter(row => row.caption.includes("Masked guessing-cue probe"));
	assert.ok(maskedTables.length > 0);
	for (const table of maskedTables) assert.doesNotMatch(table.text, /Only option true on its own|Textbook wording/);
});
