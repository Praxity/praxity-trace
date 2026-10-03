import assert from "node:assert/strict";
import { countWords } from "../src/text.ts";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { anatomy } from "../src/anatomy.ts";
import { courseHash, parseCourse } from "../src/inspect.ts";

const fixture = readFileSync(new URL("fixtures/examples.inspect.json", import.meta.url), "utf8");

test("counts roles per lesson and keeps source lines on marks", () => {
	const [minimal, , quiz] = anatomy(parseCourse(fixture)).lessons;
	assert.deepEqual(minimal?.counts, { text: 2, media: 1, explore: 0, response: 0 });
	assert.equal(minimal?.pages, 2);
	assert.deepEqual(
		minimal?.marks.map((mark) => [mark.page, mark.role, mark.line]),
		[
			[1, "text", 12],
			[1, "media", 14],
			[2, "text", 22],
		],
	);
	assert.equal(quiz?.counts.response, 6);
});

test("charts column children in place of the columns block", () => {
	const full = anatomy(parseCourse(fixture)).lessons.find((lesson) => lesson.file === "full-featured.prax");
	assert.ok(full);
	assert.ok(!full.marks.some((mark) => mark.type === "columns"));
	assert.ok(full.marks.some((mark) => mark.type === "text" && mark.line === null));
});

test("counts visible words, not narration, alt text or URLs", () => {
	assert.equal(
		countWords({
			content: "<p>Stop <strong>work</strong> now</p>",
			alt: "a clipboard",
			src: "/assets/a.png",
			narration: { script: "spoken words here" },
		}),
		3,
	);
});

test("emphasis inventories each on-screen tag, counts nested words once, and skips credit pages", async () => {
	const { emphasisView, renderEmphasis } = await import("../src/emphasis.ts");
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0",
		course: { title: "Emphasis", locale: "en" },
		lessons: [{ file: "a.prax", title: "A", sha256: "x", pages: [
			{ id: "p1", number: 1, title: "Practice", blocks: [{ id: "b1", type: "text", line: 7, data: {
				content: '<p>Before <strong>Risk <em>planning</em></strong> use <mark>safe</mark> <u>tools</u> <span class="note praxity-doodle" data-note="a > b">Idea</span></p>',
				items: [{ text: "<strong>more</strong>." }],
				narration: "<strong>spoken</strong>", tooltip: "<em>hidden</em>",
			} }] },
			{ id: "p2", number: 2, title: "Sources", blocks: [{ id: "b2", type: "text", line: 10, data: { content: "<mark>credit</mark>" } }] },
		] }],
	}));
	const noModels = emphasisView(course);
	assert.deepEqual(noModels.spans.map(({ kind, text, ref, crossReference }) => [kind, text, ref, crossReference]), [
		["strong", "Risk planning", "1.1.1", null],
		["em", "planning", "1.1.1", null],
		["mark", "safe", "1.1.1", null],
		["u", "tools", "1.1.1", null],
		["span.praxity-doodle", "Idea", "1.1.1", null],
		["strong", "more", "1.1.1", null],
	]);
	assert.deepEqual(noModels.lessons[0]?.counts, { strong: 2, em: 1, mark: 1, u: 1, "span.praxity-doodle": 1 });
	assert.deepEqual(noModels.lessons[0]?.pages, [{ number: 1, spans: 6 }]);
	assert.equal(noModels.lessons[0]?.screenWords, 8);
	assert.equal(noModels.lessons[0]?.emphasizedWords, 6);
	assert.equal(noModels.lessons[0]?.share, 0.75);
	assert.equal(noModels.places["1.1.1"]?.line, 7);
	const concepts = { concepts: [{ name: "risk" }] } as Parameters<typeof emphasisView>[1];
	const alignment = { objectives: [{ text: "Apply safe tools in practice" }] } as Parameters<typeof emphasisView>[2];
	assert.deepEqual(emphasisView(course, concepts, alignment).spans.map((span) => span.crossReference), [
		"names a concept", "other", "in an objective", "in an objective", "other", "other",
	]);
	assert.equal(emphasisView(course, concepts).spans[2]?.crossReference, "other");
	assert.equal(emphasisView(course, undefined, alignment).spans[2]?.crossReference, "in an objective");
	const html = renderEmphasis(noModels);
	assert.match(html, /id="view-emphasis"/);
	assert.match(html, /L1.*<\/th>/);
	assert.match(html, /<span class="file">[A-Za-z]+ · <span[^>]*>1.1<\/span>/);
	assert.equal(noModels.spans.some((span) => ["credit", "spoken", "hidden"].includes(span.text)), false);
});

test("estimates unrecorded narration at the course's measured speaking rate", () => {
	const words = (count: number) => Array(count).fill("word").join(" ");
	const course = parseCourse(
		JSON.stringify({
			ok: true,
			schema: "praxity-inspect/0",
			studioVersion: "0.2.0",
			course: { title: "Pace", locale: "en" },
			lessons: [
				{
					file: "a.prax",
					title: "A",
					sha256: "x",
					pages: [
						{
							id: "p1",
							number: 1,
							title: "Recorded",
							blocks: [
								{ id: "b1", type: "text", line: 3, data: { content: words(238), narration: words(60), narrationDuration: 20 } },
							],
						},
						{
							id: "p2",
							number: 2,
							title: "Script only",
							blocks: [{ id: "b2", type: "text", line: 9, data: { content: "Hi", narration: words(90) } }],
						},
					],
				},
			],
		}),
	);
	const { speakingWpm, lessons } = anatomy(course);
	assert.equal(speakingWpm, 180);
	const [recorded, scriptOnly] = lessons[0]?.pace ?? [];
	assert.deepEqual(
		[recorded?.readingSeconds, recorded?.narrationSeconds, recorded?.estimatedNarrationSeconds],
		[60, 20, 0],
	);
	assert.deepEqual([scriptOnly?.narrationSeconds, scriptOnly?.estimatedNarrationSeconds], [30, 30]);
});

test("rejects inspect output from another schema or a failed run", () => {
	assert.throws(() => parseCourse(JSON.stringify({ ok: false })), /ok/);
	assert.throws(() => parseCourse(fixture.replace("praxity-inspect/0", "praxity-inspect/9")), /schema/);
});

test("course hash changes when a lesson changes", () => {
	const course = parseCourse(fixture);
	const changed = structuredClone(course);
	(changed.lessons[0] as { sha256: string }).sha256 = "0";
	assert.notEqual(courseHash(course), courseHash(changed));
});

test("alignment answers must match the course revision and cite real refs", async () => {
	const { parseAlignment, PROMPT_VERSION } = await import("../src/alignment.ts");
	const { locateBlocks } = await import("../src/places.ts");
	const course = parseCourse(fixture);
	const check = locateBlocks(course).find((item) => item.block.type === "assessment");
	assert.ok(check);
	const answer = (overrides: object) =>
		JSON.stringify({
			view: "alignment",
			promptVersion: PROMPT_VERSION,
			courseHash: courseHash(course),
			model: "test",
			objectives: [{ id: "O1", text: "Stop work safely", ref: check.ref }],
			checks: [{ ref: check.ref, purpose: "knowledge", objectives: ["O1"], support: [] }],
			...overrides,
		});
	assert.equal(parseAlignment(answer({}), course).checks[0]?.ref, check.ref);
	assert.throws(() => parseAlignment(answer({ courseHash: "stale" }), course), /different course revision/);
	assert.throws(
		() =>
			parseAlignment(
				answer({ checks: [{ ref: check.ref, purpose: "knowledge", objectives: [], support: [{ ref: "9.9.9", channel: "screen" }] }] }),
				course,
			),
		/not a ref/,
	);
});

test("reads glossary tooltips from rendered markup and raw card syntax, but not as on-screen words", async () => {
	const { tooltips } = await import("../src/text.ts");
	const data = {
		content: '<p><span class="inline-tooltip-trigger" data-tooltip-content="Height kept above the &quot;design&quot; level.">Freeboard</span></p>',
		items: [{ text: "[Crest]{The top of the embankment.} To read the crest" }],
	};
	assert.deepEqual(tooltips(data), [
		{ term: "Freeboard", text: 'Height kept above the "design" level.' },
		{ term: "Crest", text: "The top of the embankment." },
	]);
	assert.equal(countWords(data), 6);
});

test("concepts: a use counts as before its definition only on an earlier page, and previews never do", async () => {
	const { locateBlocks } = await import("../src/places.ts");
	const { parseConcepts, PROMPT_VERSION } = await import("../src/concepts.ts");
	const { conceptsView } = await import("../src/concepts-view.ts");
	const course = parseCourse(fixture);
	const lessonOne = locateBlocks(course).filter((item) => item.lesson === course.lessons[0]?.file);
	const [p1a, p1b] = lessonOne.filter((item) => item.page === 1);
	const p2 = lessonOne.find((item) => item.page === 2);
	assert.ok(p1a && p1b && p2);
	const answer = (occurrences: object[]) =>
		JSON.stringify({
			view: "concepts",
			promptVersion: PROMPT_VERSION,
			courseHash: courseHash(course),
			model: "test",
			concepts: [{ id: "C1", name: "Hazard", prerequisites: [], occurrences }],
		});
	const view = (occurrences: object[]) => conceptsView(course, parseConcepts(answer(occurrences), course)).concepts[0];

	assert.deepEqual(view([{ ref: p1a.ref, role: "mentioned" }, { ref: p2.ref, role: "defined" }])?.usedBeforeDefined, [p1a.ref]);
	assert.deepEqual(view([{ ref: p1a.ref, role: "mentioned" }, { ref: p1b.ref, role: "defined" }])?.usedBeforeDefined, []);
	assert.deepEqual(view([{ ref: p1a.ref, role: "preview" }, { ref: p2.ref, role: "defined" }])?.usedBeforeDefined, []);
	assert.throws(() => parseConcepts(answer([{ ref: p1a.ref, role: "defined" }, { ref: p1a.ref, role: "example" }]), course), /one role per block/);
	assert.throws(() => parseConcepts(answer([{ ref: p1a.ref, role: "taught" }]), course), /role must be one of/);
});

test("concept prerequisites validate ids and report order and cycles", async () => {
	const { locateBlocks } = await import("../src/places.ts");
	const { parseConcepts, PROMPT_VERSION } = await import("../src/concepts.ts");
	const { conceptsView, renderConcepts } = await import("../src/concepts-view.ts");
	const course = parseCourse(fixture);
	const lessonOne = locateBlocks(course).filter((item) => item.lesson === course.lessons[0]?.file);
	const [p1a, p1b] = lessonOne.filter((item) => item.page === 1);
	const p2 = lessonOne.find((item) => item.page === 2);
	assert.ok(p1a && p1b && p2);
	const concepts = [
		{ id: "C1", name: "First", prerequisites: ["C3"], occurrences: [{ ref: p1a.ref, role: "defined" }] },
		{ id: "C2", name: "Same", prerequisites: ["C1", "C5"], occurrences: [{ ref: p1b.ref, role: "defined" }] },
		{ id: "C3", name: "Later", prerequisites: ["C1"], occurrences: [{ ref: p2.ref, role: "defined" }] },
		{ id: "C5", name: "Missing", prerequisites: [], occurrences: [] },
	];
	const answer = (overrides: object = {}) => JSON.stringify({
		view: "concepts", promptVersion: PROMPT_VERSION, courseHash: courseHash(course), model: "test", concepts, ...overrides,
	});
	const view = conceptsView(course, parseConcepts(answer(), course));
	assert.deepEqual(view.dependencies.map((link) => [link.prerequisite, link.dependent, link.direction, link.cycle]), [
		["C3", "C1", "after", true],
		["C1", "C2", "same page", false],
		["C5", "C2", "undefined", false],
		["C1", "C3", "before", true],
	]);
	assert.equal(view.dependencies[2]?.prerequisiteDefined, null);
	const html = renderConcepts(view);
	assert.match(html, /<h3>Prerequisite order<\/h3>/);
	assert.match(html, /class="dep late">Missing \(never defined\)<\/span>/);
	assert.match(html, /class="dep cycle">/);
	assert.match(html, /prerequisite links come in order/);
	assert.throws(() => parseConcepts(answer({ promptVersion: "concepts/2" }), course), /promptVersion "concepts\/4"/);
	assert.throws(() => parseConcepts(answer({ concepts: [{ ...concepts[0], prerequisites: ["C9"] }] }), course), /not a concept id/);
	assert.throws(() => parseConcepts(answer({ concepts: [{ ...concepts[0], prerequisites: ["C1"] }] }), course), /cannot refer to its own concept/);
});

test("language: list items end sentences, abbreviations do not, and grades need English and a real sample", async () => {
	const { sentences, languageView } = await import("../src/language.ts");
	assert.deepEqual(sentences("<ul><li>Seepage</li><li>Overtopping</li></ul><p>It helps. See Fenwater v. Ashby today.</p>"), [
		"Seepage",
		"Overtopping",
		"It helps.",
		"See Fenwater v. Ashby today.",
	]);
	const course = parseCourse(fixture);
	const minimal = languageView(course).lessons[0]?.channels.screen;
	assert.ok(minimal && minimal.words < 100);
	assert.equal(minimal.grade, null);
	const french = languageView({ ...course, course: { ...course.course, locale: "fr" } });
	assert.ok(french.lessons.every((lesson) => lesson.channels.screen.grade === null));
});

test("citation syntax is not counted as on-screen words", () => {
	assert.equal(countWords({ content: "Levels rose.@footer{[NHA, *Gauge report*](https://example.com), 2025.} Sources @footer.insert" }), 3);
});

test("language: list items read aloud split at a bracket, colon or semicolon before a capital", async () => {
	const { sentences } = await import("../src/language.ts");
	assert.deepEqual(sentences("Relief channel: Carries flow past the town (Capacity) Lowers the gauge (Level)"), [
		"Relief channel:",
		"Carries flow past the town (Capacity)",
		"Lowers the gauge (Level)",
	]);
});

test("language: clause cues count per sentence but omit ambiguous that", async () => {
	const { sentenceStructure } = await import("../src/language.ts");
	assert.equal(sentenceStructure("If you pause when the timer rings, restart.").subordinateClauses, 2);
	assert.equal(sentenceStructure("That option works.").subordinateClauses, 0);
	assert.equal(sentenceStructure("Document where, and who is exposed.").subordinateClauses, 1);
	assert.equal(sentenceStructure("Because of rain, work stopped since 2020.").subordinateClauses, 0);
});

test("language: passive cues allow one intervening word but reject hyphenated words and punctuation", async () => {
	const { sentenceStructure } = await import("../src/language.ts");
	assert.equal(sentenceStructure("The note is carefully written.").passive, true);
	assert.equal(sentenceStructure("The note is interested.").passive, true);
	assert.equal(sentenceStructure("The note is red-coloured.").passive, false);
	assert.equal(sentenceStructure("The note is, after all, recorded.").passive, false);
});

test("language: nominalisation endings need seven letters and front-loaded clauses need a comma and eight words", async () => {
	const { sentenceStructure } = await import("../src/language.ts");
	assert.equal(sentenceStructure("Preparation and kindness matter.").nominalisations, 2);
	assert.equal(sentenceStructure("Action and tasks matter.").nominalisations, 0);
	assert.equal(sentenceStructure("1234tion and pre-paration are labels.").nominalisations, 0);
	assert.equal(sentenceStructure("Before the lesson starts students should read the page, pause.").frontLoaded, true);
	assert.equal(sentenceStructure("Before the lesson starts, pause.").frontLoaded, false);
	assert.equal(sentenceStructure("Before the lesson starts students should read the page.").frontLoaded, false);
});

test("language: sentence structure is summarised by channel, quoted with cues, and omitted outside English", async () => {
	const { languageView, renderSentences, renderWords } = await import("../src/language.ts");
	const renderLanguage = (view: Parameters<typeof renderSentences>[0]) => renderSentences(view) + renderWords(view);
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0",
		course: { title: "Language", locale: "en" },
		lessons: [{ file: "a.prax", title: "Lesson A", sha256: "x", pages: [{
			id: "p1", number: 1, title: "Page", blocks: [{ id: "b1", type: "text", line: 4, data: {
				content: "<p>If you pause when the timer rings, the answer is recorded.</p><p>When the lesson starts students should read the page, pause.</p>",
				narration: "Preparation and kindness matter.",
			} }],
		}] }],
	}));
	const view = languageView(course);
	const screen = view.lessons[0]?.channels.screen.structure;
	const narration = view.lessons[0]?.channels.narration.structure;
	assert.ok(screen && narration);
	assert.deepEqual([screen.clauseCuesPer100Sentences, screen.twoOrMoreClauseCues, screen.passive, screen.frontLoaded], [150, 1, 1, 1]);
	assert.deepEqual(view.flagged.passive.map((sentence) => sentence.id), ["1.1.s1"]);
	assert.deepEqual(view.flagged.clauses.map((sentence) => sentence.id), ["1.1.s1"]);
	assert.equal(narration.nominalisationsPer100Words, 50);
	const html = renderLanguage(view);
	assert.match(html, /<h3>Sentence structure<\/h3>/);
	assert.match(html, /<mark>If<\/mark>.*<mark>when<\/mark>/);
	assert.match(html, /<mark>is<\/mark> <mark>recorded<\/mark>/);
	assert.match(html, /<code>1\.1\.s1<\/code>/);
	const french = languageView({ ...course, course: { ...course.course, locale: "fr" } });
	assert.equal(french.lessons[0]?.channels.screen.structure, null);
	assert.deepEqual(french.flagged.passive, []);
	assert.match(renderLanguage(french), /Not measured for this language/);
});

test("course.md shows code blocks to the reviewer", async () => {
	const { blockTexts } = await import("../src/text.ts");
	assert.equal(blockTexts({ id: "c", type: "code", line: 1, data: { code: "while True:\n    break", language: "python" } }).screen, "while True: break");
});

test("language: spoken list items split, and inline tags leave no stray spaces", async () => {
	const { sentences } = await import("../src/language.ts");
	assert.deepEqual(sentences("Add five gauges. - Keep the marks the same. - Use new paint."), ["Add five gauges.", "Keep the marks the same.", "Use new paint."]);
	assert.deepEqual(sentences("<p>Ask <strong>the people</strong>, then <em>test</em>.</p>"), ["Ask the people, then test."]);
	assert.deepEqual(sentences("A well-known self - sealing valve."), ["A well-known self - sealing valve."]);
	assert.deepEqual(sentences("It needs three tools: - `mean` smooths readings - `clamp` catches spikes"), ["It needs three tools:", "`mean` smooths readings", "`clamp` catches spikes"]);
	assert.deepEqual(sentences("It expected a word. `try`/`except` catches it."), ["It expected a word.", "`try`/`except` catches it."]);
	assert.deepEqual(sentences("It expected a word. try/except catches it."), ["It expected a word.", "try/except catches it."]);
	assert.deepEqual(sentences("Use e.g. a list, i.e. brackets, etc. and more."), ["Use e.g. a list, i.e. brackets, etc. and more."]);
});

test("language: code and shouted words are neither vocabulary nor acronyms", async () => {
	const { languageView } = await import("../src/language.ts");
	const view = languageView(parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0",
		course: { title: "Code", locale: "en" },
		lessons: [{ file: "a.prax", title: "Lesson A", sha256: "x", pages: [{
			id: "p1", number: 1, title: "Page", blocks: [{ id: "b1", type: "text", line: 4, data: {
				content: '<p>Use <code>readGauge</code> so "stagee" matches, as in <code>closest("stagee")</code>. Say "STOP" or stop to the DAM. See https://example.org/dam/ for more on seepage.</p>',
			} }],
		}] }],
	})));
	assert.deepEqual(view.vocabulary?.rare.map((word) => word.word), ["seepage"]);
	assert.deepEqual(view.acronyms.map((item) => item.acronym), ["DAM"]);
});

test("language: inflections look up their base forms, but derived nouns do not", async () => {
	const { baseForms } = await import("../src/language.ts");
	assert.ok(baseForms("spillways").includes("spillway"));
	assert.ok(baseForms("levied").includes("levy"));
	assert.ok(baseForms("gauged").includes("gauge"));
	assert.ok(baseForms("stopped").includes("stop"));
	assert.equal(baseForms("planter").includes("plant"), false);
	assert.deepEqual(baseForms("class"), []);
});

test("language: rare words come from TUBELEX, skip names and acronyms, and note glossary tooltips", async () => {
	const { languageView } = await import("../src/language.ts");
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0",
		course: { title: "Words", locale: "en" },
		lessons: [{ file: "a.prax", title: "Lesson A", sha256: "x", pages: [{
			id: "p1", number: 1, title: "Page", blocks: [{ id: "b1", type: "text", line: 4, data: {
				content: '<p>The gauge hut in Ravensmoor follows seepage rules the RCWA cannot ignore.</p><p>Crews fear <span data-tooltip-content="Water over the crest">flooding</span> and turbidity.</p>',
			} }],
		}] }],
	}));
	const vocabulary = languageView(course).vocabulary;
	assert.ok(vocabulary);
	assert.deepEqual(vocabulary.rare.map((word) => [word.word, word.firstUse]), [["seepage", "1.1.s1"], ["turbidity", "1.1.s2"]]);
	assert.equal(vocabulary.rare.some((word) => word.word === "cannot" || word.word === "ravensmoor"), false);
	const glossed = languageView({ ...course, lessons: course.lessons.map((lesson) => ({ ...lesson, pages: lesson.pages.map((page) => ({ ...page, blocks: page.blocks.map((block) => ({ ...block, data: { content: '<p>Fear <span data-tooltip-content="Cloudy water">turbidity</span>.</p>' } })) })) })) }).vocabulary;
	assert.equal(glossed?.rare.find((word) => word.word === "turbidity")?.glossed, true);
	assert.equal(languageView({ ...course, course: { ...course.course, locale: "fr" } }).vocabulary, null);
});

test("a verb listed at one Bloom level gives it; a verb listed at several is ambiguous; an unlisted verb has none", async () => {
	const { verbLevels } = await import("../src/outcomes.ts");
	const articulate = verbLevels("Articulate the difference between a weir and a sluice.");
	assert.equal(articulate.bloom, "Understand");
	const explain = verbLevels("Explain what the relief channel gauge means.");
	assert.equal(explain.bloom, null);
	assert.ok((explain.bloomCandidates ?? []).length > 1 && explain.bloomCandidates?.includes("Understand"));
	assert.equal(verbLevels("Build a gauge model.").bloom, "Create");
	assert.deepEqual(verbLevels("Teach my crew to read a gauge.").bloomCandidates, []);
});

test("acronyms count as spelled out by name, initials or a list, and not by any parenthesis", async () => {
	const { spelledOut } = await import("../src/language.ts");
	assert.ok(spelledOut("RSG", "a River Stage Gauge (RSG) reading"));
	assert.ok(spelledOut("RCWA", "The Upper Relief Channel Works Authority sets rules. The RCWA gauges flow."));
	assert.ok(spelledOut("FLOOD", "the FLOOD stages: Forecast, Levee check, Open sluices and gates, Observe, and Drain."));
	assert.ok(!spelledOut("PDF", "Download the reflection worksheet (PDF)"));
	assert.ok(!spelledOut("RCWA", "A gauge reader in an RCWA hut"));
});

test("terms: a flag must quote words that are in its block's own channel", async () => {
	const { locateBlocks } = await import("../src/places.ts");
	const { parseTerms, PROMPT_VERSION } = await import("../src/terms.ts");
	const course = parseCourse(fixture);
	const block = locateBlocks(course).find((item) => item.block.type === "text");
	assert.ok(block);
	const answer = (span: string, channel = "screen") =>
		JSON.stringify({
			view: "terms",
			promptVersion: PROMPT_VERSION,
			courseHash: courseHash(course),
			model: "test",
			flags: [{ ref: block.ref, channel, kind: "term", span, note: "n", explainedAt: null }],
		});
	const word = String(block.block.data.content).replace(/<[^>]*>/g, " ").trim().split(/\s+/)[1] as string;
	assert.equal(parseTerms(answer(word), course).flags[0]?.span, word);
	assert.throws(() => parseTerms(answer("words that are not there"), course), /is not in the screen text/);
	assert.throws(() => parseTerms(answer(word, "narration"), course), /is not in the narration text/);
});

test("visuals: quoted spans and 2 to 8 copied elements are required", async () => {
	const { parseVisuals, PROMPT_VERSION } = await import("../src/visuals.ts");
	const course = parseCourse(fixture);
	const item = {
		ref: "1.2.2", channel: "screen", span: "emergency exits are clear and protective gear is available.",
		structure: "comparison", elements: ["emergency exits", "protective gear"], form: "two-column comparison", note: "Shows both checks together.",
	};
	const answer = (opportunity: object) => JSON.stringify({
		view: "visuals", promptVersion: PROMPT_VERSION, courseHash: courseHash(course), model: "test",
		opportunities: [opportunity], interpretation: [],
	});
	assert.equal(parseVisuals(answer(item), course).opportunities[0]?.span, item.span);
	assert.throws(() => parseVisuals(answer({ ...item, span: "not in the block" }), course), /is not in the screen text/);
	assert.throws(() => parseVisuals(answer({ ...item, channel: "narration" }), course), /is not in the narration text/);
	assert.throws(() => parseVisuals(answer({ ...item, elements: ["emergency exits"] }), course), /2 to 8 labels/);
	assert.throws(() => parseVisuals(answer({ ...item, elements: Array(9).fill("emergency exits") }), course), /2 to 8 labels/);
	assert.throws(() => parseVisuals(answer({ ...item, elements: ["emergency exits", "invented"] }), course), /copied from span/);
});

test("visuals: opportunities sort into course order and mark pages that already have media", async () => {
	const { parseVisuals, visualsView, renderVisuals, PROMPT_VERSION } = await import("../src/visuals.ts");
	const course = parseCourse(fixture);
	const opportunities = [
		{ ref: "1.2.2", span: "emergency exits are clear and protective gear is available.", elements: ["emergency exits", "protective gear"] },
		{ ref: "1.1.2", span: "a simple safety routine you can run before starting work.", elements: ["safety routine", "starting work"] },
	].map((item) => ({ ...item, channel: "screen", structure: "sequence", form: "flow", note: "Shows the stated relationship." }));
	const answer = JSON.stringify({ view: "visuals", promptVersion: PROMPT_VERSION, courseHash: courseHash(course), model: "test", opportunities, interpretation: [] });
	const view = visualsView(course, parseVisuals(answer, course), anatomy(course).lessons);
	assert.deepEqual(view.opportunities.map((item) => [item.ref, item.hasMedia]), [["1.1.2", true], ["1.2.2", false]]);
	const html = renderVisuals(view);
	assert.match(html, /id="view-visuals"/);
	assert.match(html, /<details class="visual-source">/);
	assert.equal(view.opportunities[0]?.hasMedia, true);
});

test("trace: a lesson opens with set, marks review, and includes source pages", async () => {
	const { traceView } = await import("../src/trace.ts");
	const page = (number: number, title: string, blocks: object[] = []) => ({ id: `p${number}`, number, title, blocks });
	const course = parseCourse(
		JSON.stringify({
			ok: true,
			schema: "praxity-inspect/0",
			studioVersion: "0.2.0",
			course: { title: "Arch", locale: "en" },
			lessons: [
				{
					file: "a.prax",
					title: "A",
					sha256: "x",
					pages: [
						page(1, "Review and build momentum"),
						page(2, "The idea", [{ id: "b", type: "assessment", line: 4, data: { question: "Q?" } }]),
						page(3, "Reflect on your work"),
						page(4, "Sources"),
					],
				},
			],
		}),
	);
	const view = traceView(course, anatomy(course).lessons, {});
	assert.deepEqual(
		view.columns.map((column) => [column.page, column.phase]),
		[
			[1, "set"],
			[2, "hold"],
			[3, "land"],
			[4, "hold"],
		],
	);
	assert.deepEqual(view.rows.find((row) => row.label === "Practice")?.marks.map((mark) => mark.column), [1]);
	assert.equal(view.rows.some((row) => row.label === "Knowledge check"), false);
});

test("flow: objectives without evidence get their own flow, and checks sort by where their teaching sits", async () => {
	const { flowView } = await import("../src/flow.ts");
	const place = (lesson: number) => ({ lesson, lessonTitle: "", page: 1, file: "", line: null, position: 0 });
	const check = (ref: string, support: Array<{ ref: string; channel: "screen" | "narration"; after: boolean }>) => ({
		ref,
		lesson: "",
		page: 1,
		position: 0,
		question: "",
		pre: false,
		objectives: ["O2"],
		support: support.map((item) => ({ ...item, position: 0 })),
	});
	const view = flowView({
		model: "test",
		objectives: [
			{ id: "O1", text: "Top", ref: "1.1.1", fink: [], parent: null, verb: "explain", bloom: null },
			{ id: "O2", text: "Sub", ref: "1.1.2", fink: [], parent: "O1", verb: "explain", bloom: null },
		],
		activities: ["2.1.1", "2.1.2", "2.1.3", "2.1.4"].map((ref) => ({ ref, lesson: "", page: 1, purpose: "knowledge" as const, label: "", objectives: ["O2"] })),
		checks: [
			check("2.1.1", [{ ref: "2.1.0", channel: "screen", after: false }]),
			check("2.1.2", [{ ref: "1.1.0", channel: "screen", after: false }]),
			check("2.1.3", [{ ref: "2.1.0", channel: "narration", after: false }]),
			check("2.1.4", []),
		],
		surveys: 0,
		blocks: 0,
		lessons: [],
		overlaps: [],
		interpretation: [],
		places: { "1.1.0": place(1), "2.1.0": place(2), "2.1.1": place(2), "2.1.2": place(2), "2.1.3": place(2), "2.1.4": place(2) },
	});
	assert.deepEqual(
		view.pairs.map((pair) => [pair.objective, pair.status]),
		[
			["O1", "no-evidence"],
			["O2", "before"],
			["O2", "earlier-lesson"],
			["O2", "narration"],
			["O2", "untaught"],
		],
	);
});

test("spacing: encounters sit at their page's start minute, and mentions do not count", async () => {
	const { spacingView } = await import("../src/spacing.ts");
	const place = (page: number) => ({ lesson: 1, lessonTitle: "A", page, file: "a.prax", line: 1, position: page });
	const pace = (number: number, seconds: number) => ({ number, title: "", words: 0, readingSeconds: seconds, narrationSeconds: 0, estimatedNarrationSeconds: 0 });
	const view = spacingView(
		{
			model: "test",
			blocks: 3,
			dependencies: [],
			lessons: [],
			interpretation: [],
			places: { a: place(1), b: place(2), c: place(3) },
			concepts: [
				{
					id: "C1",
					name: "Hazard",
					firstDefined: "a",
					usedBeforeDefined: [],
					checks: 1,
					lessonCount: 1,
					occurrences: [
						{ ref: "a", role: "defined", position: 1 },
						{ ref: "b", role: "mentioned", position: 2 },
						{ ref: "c", role: "checked", position: 3 },
					],
				},
			],
		},
		[{ file: "a.prax", title: "A", pages: 3, words: 0, counts: { text: 0, media: 0, explore: 0, response: 0 }, marks: [], pace: [pace(1, 60), pace(2, 120), pace(3, 60)] }],
	);
	assert.equal(view.totalMinutes, 4);
	assert.deepEqual(view.rows[0]?.encounters.map((encounter) => encounter.minute), [0, 3]);
	assert.equal(view.rows[0]?.toFirstCheck, 3);
	assert.equal(view.rows[0]?.afterLast, 1);
});

test("distinctions: a check that separates a pair must be an assessment block", async () => {
	const { locateBlocks } = await import("../src/places.ts");
	const { parseDistinctions, PROMPT_VERSION } = await import("../src/distinctions.ts");
	const course = parseCourse(fixture);
	const located = locateBlocks(course);
	const check = located.find((item) => item.block.type === "assessment");
	const text = located.find((item) => item.block.type === "text");
	assert.ok(check && text);
	const answer = (checked: string[]) =>
		JSON.stringify({
			view: "distinctions",
			promptVersion: PROMPT_VERSION,
			courseHash: courseHash(course),
			model: "test",
			pairs: [{ a: "Hazard", b: "Risk", why: "Used interchangeably.", stated: [text.ref], contrasted: [], checked }],
		});
	assert.deepEqual(parseDistinctions(answer([check.ref]), course).pairs[0]?.checked, [check.ref]);
	assert.throws(() => parseDistinctions(answer([text.ref]), course), /is not an assessment block/);
});

test("the report stylesheet's braces balance, so no view's styles swallow the next", async () => {
	const { buildReport, renderHtml } = await import("../src/report.ts");
	const { languageView } = await import("../src/language.ts");
	const { traceView } = await import("../src/trace.ts");
	const { emphasisView } = await import("../src/emphasis.ts");
	const course = parseCourse(fixture);
	const shape = anatomy(course);
	const html = renderHtml(
		buildReport(course.course, { schema: course.schema, studioVersion: course.studioVersion }, courseHash(course), shape, traceView(course, shape.lessons, {}), languageView(course), emphasisView(course)),
	);
	const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
	let depth = 0;
	for (const character of css) {
		if (character === "{") depth += 1;
		if (character === "}") depth -= 1;
		assert.ok(depth >= 0, "a closing brace comes before its opening brace");
	}
	assert.equal(depth, 0);
});

test("an escaped < in text is text, not the start of a tag", async () => {
	const { visibleText, previewLines } = await import("../src/text.ts");
	const { sentences } = await import("../src/language.ts");
	const html = "<ul><li>If reading &lt; -0.3, open the sluice.</li><li>If reading &gt; 0.3, close it.</li><li>Write &lt;div&gt; tags.</li></ul>";
	assert.equal(visibleText({ content: html })[0]?.replace(/\s+/g, " ").trim(), "If reading < -0.3, open the sluice. If reading > 0.3, close it. Write <div> tags.");
	assert.deepEqual(previewLines([{ type: "text", data: { content: html } }], "Page").map((line) => line.text), ["If reading < -0.3, open the sluice.", "If reading > 0.3, close it.", "Write <div> tags."]);
	assert.deepEqual(sentences(html), ["If reading < -0.3, open the sluice.", "If reading > 0.3, close it.", "Write <div> tags."]);
});

test("rhythm says when a model's activities decided its stretches", async () => {
	const { rhythm } = await import("../src/anatomy.ts");
	const { renderAnatomy } = await import("../src/anatomy-view.ts");
	const page = (number: number) => ({ number, title: `Page ${number}`, words: 50, readingSeconds: 60, narrationSeconds: 0, estimatedNarrationSeconds: 0 });
	const lesson = { file: "a.prax", title: "A", pages: 4, words: 200, counts: { text: 4, media: 0, explore: 0, response: 0 }, marks: [1, 2, 3, 4].map((n, i) => ({ lesson: "a.prax", page: n, order: i, type: "text", role: "text" as const, words: 50, line: n })), pace: [1, 2, 3, 4].map(page) };
	const measured = rhythm([lesson]);
	assert.equal(measured.withoutAction[0]?.pages, 4);
	assert.equal(measured.generatedBy, null);
	const withModel = rhythm([lesson], { model: "gpt-test", pages: new Set(["1.2"]) });
	assert.deepEqual(withModel.withoutAction, []);
	assert.equal(withModel.generatedBy, "gpt-test");
	const html = renderAnatomy({ anatomy: [lesson], rhythm: withModel, speakingWpm: 150 });
	assert.match(html, /class="defined generated"[^>]*title="[^"]*gpt-test/);
	assert.doesNotMatch(renderAnatomy({ anatomy: [lesson], rhythm: measured, speakingWpm: 150 }), /class="rhythm"[\s\S]*class="defined generated"/);
});

test("the text profile counts shared words between adjacent sentences and causal and contrastive connectives", async () => {
	const { languageView, cohesionOf } = await import("../src/language.ts");
	assert.deepEqual(cohesionOf(["Gauges log levels each hour.", "The levels rise every spring, so gauges alarm.", "However, rainfall stays flat.", "Birds sing."]), {
		adjacentPairs: 3, overlapping: 1, causal: 1, contrastive: 1,
	});
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0", course: { title: "Profile", locale: "en" },
		lessons: [{ file: "a.prax", title: "A", sha256: "x", pages: [
			{ id: "p1", number: 1, title: "One", blocks: [{ id: "b1", type: "text", line: 1, data: { content: "<p>Freeboard is a margin. The margin of freeboard is kept because engineers agreed.</p>" } }] },
			{ id: "p2", number: 2, title: "Two", blocks: [{ id: "b2", type: "text", line: 2, data: { content: "<p>Maps show cities. Rivers flow.</p>" } }] },
		] }],
	}));
	// Pairs stay within a page: two on-screen pages give two adjacent pairs, one sharing "margin".
	assert.deepEqual(languageView(course).lessons[0]?.channels.screen.cohesion, { adjacentPairs: 2, overlapping: 1, causal: 1, contrastive: 0 });
	const french = parseCourse(JSON.stringify({ ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0", course: { title: "F", locale: "fr" }, lessons: [{ file: "a.prax", title: "A", sha256: "x", pages: [{ id: "p1", number: 1, title: "Un", blocks: [{ id: "b1", type: "text", line: 1, data: { content: "<p>Un. Deux.</p>" } }] }] }] }));
	assert.equal(languageView(french).lessons[0]?.channels.screen.cohesion, null);
});

test("cards hide content only as flip cards or a carousel", async () => {
	const { roleOf } = await import("../src/anatomy.ts");
	const card = (data: Record<string, unknown>) => roleOf({ type: "card", data });
	assert.equal(card({ layout: "grid", items: [{ front: "A", back: "" }, { front: "B", back: "" }] }), "text");
	assert.equal(card({ layout: "masonry", items: [{ front: "A" }] }), "text");
	assert.equal(card({ layout: "grid", items: [{ front: "Term", back: "Definition" }] }), "explore");
	assert.equal(card({ layout: "slides", items: [{ front: "A", back: "" }] }), "explore");
	assert.equal(roleOf({ type: "accordion" }), "explore");
});

test("sequences count as explore only when horizontal and scrollable", async () => {
	const { roleOf } = await import("../src/anatomy.ts");
	const sequence = (data: Record<string, unknown>) => roleOf({ type: "sequence", data });
	assert.equal(roleOf({ type: "sequence" }), "text");
	assert.equal(sequence({ scrollable: true }), "text", "default orientation is vertical");
	assert.equal(sequence({ orientation: "horizontal" }), "text", "default scrollable is false");
	assert.equal(sequence({ orientation: "horizontal", scrollable: "true" }), "text", "requires a boolean");
	for (const variant of ["numbered", "timeline", "plain"]) {
		for (const distribution of ["uniform", "scaled"]) {
			for (const alignment of ["left", "center", "right"]) {
				const settings = { variant, distribution, alignment };
				assert.equal(sequence({ ...settings, orientation: "vertical", scrollable: true }), "text");
				assert.equal(sequence({ ...settings, orientation: "horizontal", scrollable: false }), "text");
				assert.equal(sequence({ ...settings, orientation: "horizontal", scrollable: true }), "explore");
			}
		}
	}
});

test("Anatomy marks sequences as text in both inspect schemas", () => {
	for (const file of ["examples.inspect.json", "examples.schema1.inspect.json"]) {
		const course = parseCourse(readFileSync(new URL(`fixtures/${file}`, import.meta.url), "utf8"));
		const sequence = course.lessons.flatMap(lesson => lesson.pages).flatMap(page => page.blocks).find(block => block.type === "sequence");
		assert.ok(sequence);
		assert.equal(sequence.data.orientation, undefined);
		assert.equal(sequence.data.scrollable, undefined);
		const mark = anatomy(course).lessons.flatMap(lesson => lesson.marks).find(mark => mark.type === "sequence");
		assert.equal(mark?.role, "text");
		assert.equal(mark?.line, sequence.line, "source pointer is preserved");
		if (course.schema === "praxity-inspect/1") {
			assert.equal(sequence.data.variant, undefined, "schema 1 omits sequence settings");
		}
	}
});
