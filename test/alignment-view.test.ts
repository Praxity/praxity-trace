import assert from "node:assert/strict";
import { test } from "node:test";
import { alignmentView, groupObjectives, renderAlignment, type AlignmentView } from "../src/alignment-view.ts";
import type { AlignmentAnswer } from "../src/alignment.ts";
import { anatomy } from "../src/anatomy.ts";
import { flowView, FLOW_STYLE, renderFlow } from "../src/flow.ts";
import { parseCourse } from "../src/inspect.ts";
import { renderTrace, traceView } from "../src/trace.ts";
import { verbLevels } from "../src/outcomes.ts";

const objectives: AlignmentView["objectives"] = ["O1", "O5", "O12", "O9"].map((id, index) => ({
	id, text: `Objective ${id}`, ref: `1.1.${index + 1}`, fink: [], parent: null,
	verb: "explain", bloom: "Understand",
}));
const overlaps: AlignmentAnswer["overlaps"] = [
	{ objectives: ["O1", "O5"], note: "Same learning" },
	{ objectives: ["O5", "O12"], note: "Same learning" },
];

test("overlap groups are connected components, with singleton objectives kept", () => {
	assert.deepEqual(groupObjectives(objectives, overlaps).map((group) => group.members.map((member) => member.id)), [
		["O1", "O5", "O12"], ["O9"],
	]);
	assert.deepEqual(groupObjectives(objectives, []).map((group) => group.members.map((member) => member.id)), [
		["O1"], ["O5"], ["O12"], ["O9"],
	]);
});

test("alignment evidence and course trace use one row per objective group", () => {
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0",
		course: { title: "Groups", locale: "en" },
		lessons: [{ file: "a.prax", title: "Lesson A", sha256: "x", pages: [{
			id: "p1", number: 1, title: "Introduction", blocks: [
				...objectives.map((objective, index) => ({ id: `b${index + 1}`, type: "text", line: index + 1, data: { content: objective.text } })),
				{ id: "b5", type: "assessment", line: 5, data: { question: "Explain it." } },
			],
		}] }],
	}));
	const answer: AlignmentAnswer = {
		model: "test", objectives: objectives.map(({ id, text, ref, fink, parent }) => ({ id, text, ref, fink, parent })),
		checks: [{ ref: "1.1.5", purpose: "knowledge", pre: false, objectives: ["O1", "O12"], support: [] }],
		overlaps, interpretation: [],
	};
	const view = alignmentView(course, answer);
	const html = renderAlignment(view);
	const matrix = html.match(/<table class="matrix" aria-hidden="true">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
	assert.deepEqual(view.objectiveGroups.map((group) => group.members.map((member) => member.id)), [["O1", "O5", "O12"], ["O9"]]);
	assert.match(matrix, /<span class="group-also">with <abbr class="defined oid-ref" title="O5 · Objective O5">O5<\/abbr>, <abbr[^>]*>O12<\/abbr><\/span>/);
	assert.doesNotMatch(html, /data-view="objectives"/);
	assert.doesNotMatch(html, /Overlapping objectives|overlaps O5/);
	assert.match(html, /<table class="blocks evidence-table" role="table">[\s\S]*Knowledge checks[\s\S]*Online activities[\s\S]*Worksheet activities/);
	assert.match(matrix, /data-page="1\.1"/);
	assert.match(html, /<th scope="col" class="check lesson-start"[^>]*>1.1<\/th>/);
	assert.doesNotMatch(matrix, /tabindex="0"/);
	assert.deepEqual(flowView(view).pairs.map((pair) => pair.objective), ["O1", "O9"]);
	const trace = traceView(course, anatomy(course).lessons, { alignment: view });
	assert.deepEqual(trace.rows.filter((row) => row.group === "Objectives").map((row) => row.label), [
		"O1, O5, O12 · Objective O1", "O9 · Objective O9",
	]);
	assert.match(renderTrace(trace), /data-page="1\.1"/);
	assert.doesNotMatch(renderTrace(trace).match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? "", /tabindex="0"/);
});

test("checks on one page share a column while table mode lists every item", () => {
	const place = { lesson: 3, lessonTitle: "Lesson C", page: 9, file: "c.prax", line: 2, position: 0 };
	const view: AlignmentView = {
		model: "test", objectives: [objectives[0]!], objectiveGroups: [{ id: "O1", members: [objectives[0]!] }],
		activities: ["a", "b", "c"].map((ref, index) => ({ ref, lesson: "c.prax", page: 9, purpose: index < 2 ? "knowledge" as const : "reflection" as const, label: `Item ${index}`, objectives: ["O1"] })),
		checks: [], surveys: 0, blocks: 3, lessons: [], overlaps: [], interpretation: [],
		places: { [objectives[0]!.ref]: place, a: place, b: place, c: place },
	};
	const html = renderAlignment(view);
	const matrixHead = html.match(/<table class="matrix" aria-hidden="true">[\s\S]*?<thead>([\s\S]*?)<\/thead>/)?.[1] ?? "";
	assert.equal((matrixHead.match(/3.9/g) ?? []).length, 1);
	assert.deepEqual(view.activities.map((activity) => activity.purpose), ["knowledge", "knowledge", "reflection"]);
	assert.deepEqual(view.activities.map((activity) => view.places[activity.ref]?.page), [9, 9, 9]);
	assert.equal((html.match(/Knowledge check: <span>3.9<\/span>/g) ?? []).length, 2);
	assert.equal((html.match(/Online activity: <span>3.9<\/span>/g) ?? []).length, 1);
	assert.match(html, /1 activity \(1 online, 0 worksheet\)/);
	const evidenceTable = html.match(/<table class="blocks evidence-table" role="table">[\s\S]*?<\/table>/)?.[0] ?? "";
	assert.doesNotMatch(evidenceTable, /data-page|tabindex|title=/);
});

test("course trace has one plain-text row per page and separates response blocks from explore blocks", () => {
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0",
		course: { title: "Trace", locale: "en" },
		lessons: [{ file: "a.prax", title: "A", sha256: "x", pages: [
			{ id: "p1", number: 1, title: "Introduction", blocks: [
				{ id: "b1", type: "text", line: 1, data: { content: "Explain this" } },
				{ id: "b2", type: "accordion", line: 2, data: { items: [{ title: "More", content: "Details" }] } },
			] },
			{ id: "p2", number: 2, title: "Example", blocks: [
				{ id: "b3", type: "text", line: 3, data: { content: "Instruction" } },
				{ id: "b4", type: "assessment", line: 4, data: { question: "Choose" } },
				{ id: "b5", type: "checklist", line: 5, data: { text: "Try" } },
			] },
			{ id: "p3", number: 3, title: "Sources", blocks: [] },
		] }],
	}));
	const answer: AlignmentAnswer = {
		model: "test", objectives: [{ id: "O1", text: "Explain this", ref: "1.1.1", fink: [], parent: null }],
		checks: [
			{ ref: "1.2.2", purpose: "knowledge", pre: false, objectives: ["O1"], support: [{ ref: "1.2.1", channel: "screen" }] },
			{ ref: "1.2.3", purpose: "reflection", pre: false, objectives: ["O1"], support: [] },
		], overlaps: [], interpretation: [],
	};
	const trace = traceView(course, anatomy(course).lessons, { alignment: alignmentView(course, answer) });
	assert.deepEqual(trace.rows.find((row) => row.label === "Practice")?.marks.map((mark) => mark.column), [1]);
	assert.deepEqual(trace.columns.map((column) => [column.lesson, column.page]), [[1, 1], [1, 2], [1, 3]]);
	assert.deepEqual(trace.pageObjectives?.slice(0, 2), [
		{ stated: ["O1"], instructed: [], activities: [], checks: [] },
		{ stated: [], instructed: ["O1"], activities: ["O1"], checks: ["O1"] },
	]);
	const table = renderTrace(trace).match(/<table class="blocks trace-table" role="table">[\s\S]*?<\/table>/)?.[0] ?? "";
	assert.match(table, /<th scope="row" role="rowheader" data-label="Page">1.1<\/th>[\s\S]*data-label="Objectives stated">O1<\/td>/);
	assert.doesNotMatch(table, /Page in this row|data-page|tabindex|title=/);
});

test("noun-led objective statements have no classified verb", () => {
	for (const text of ["The same gauge shows the level.", "A tested gauge can show the level."]) {
		assert.deepEqual(verbLevels(text), { verb: "", bloom: null, bloomCandidates: [] });
	}
});

test("course trace keeps the last page inside a 1000 px plot", () => {
	const columns = Array.from({ length: 300 }, (_, index) => ({ lesson: 1, page: index + 1, title: `Page ${index + 1}`, phase: "hold" as const, seconds: 0 }));
	const html = renderTrace({ columns, lessons: [{ title: "A", start: 0, end: 300 }], rows: [{ label: "Objective", group: "Objectives", depth: 0, marks: [{ column: 299, symbol: "check", note: "Last check" }] }] });
	const width = Number(html.match(/<svg width="([\d.]+)"/)?.[1]);
	assert.ok(width <= 312 + 1000);
	assert.match(html, /data-page="1\.300"/);
	assert.match(html, /width="5" height="5"/);
	assert.equal((html.match(/<tr data-lesson="1" role="row"><th scope="row" role="rowheader" data-label="Page">1\./g) ?? []).length, 300);
});

test("activities end in the flow evidence column", () => {
	const place = { lesson: 3, lessonTitle: "Lesson C", page: 9, file: "c.prax", line: 2, position: 0 };
	const view = flowView({
		model: "test", objectives: [objectives[0]!], activities: [
			{ ref: "a", lesson: "c.prax", page: 9, purpose: "knowledge", label: "Check", objectives: ["O1"] },
			{ ref: "b", lesson: "c.prax", page: 9, purpose: "reflection", label: "Activity", objectives: ["O1"] },
		],
		checks: [{ ref: "a", lesson: "c.prax", page: 9, position: 0, question: "Check", pre: false, objectives: ["O1"], support: [] }],
		surveys: 0, blocks: 2, lessons: [], overlaps: [], interpretation: [], places: { [objectives[0]!.ref]: place, a: place, b: place },
	});
	const html = renderFlow(view);
	assert.deepEqual(view.pairs.map((pair) => pair.status), ["untaught", "practised"]);
	assert.doesNotMatch(html, /Activities →/);
	assert.equal((html.match(/class="flow-instruction"/g) ?? []).length, 1);
	assert.match(html, /min-width:960px/);
	assert.match(FLOW_STYLE, /flow-chart text\{font-size:16px\}/);
});

test("an objective the verb list cannot place takes the generated level, marked as generated", async () => {
	const { readFileSync } = await import("node:fs");
	const { parseCourse } = await import("../src/inspect.ts");
	const { alignmentView, renderAlignment } = await import("../src/alignment-view.ts");
	const course = parseCourse(readFileSync(new URL("./fixtures/examples.inspect.json", import.meta.url), "utf8"));
	const objective = (id: string, text: string, modelBloom: "Create" | "Apply") => ({ id, text, ref: "1.1.1", fink: [], parent: null, modelBloom, levelReason: "makes a new working artefact" });
	const view = alignmentView(course, { model: "m", objectives: [objective("O1", "Teach a relief crew new gauge readings", "Create"), objective("O2", "Articulate how a gauge reads", "Apply")], checks: [], overlaps: [], interpretation: [] } as never);
	const [built, explained] = view.objectives;
	assert.equal(built?.bloom, "Create");
	assert.equal(built?.bloomSource, "generated");
	assert.equal(explained?.bloom, "Understand");
	assert.equal(explained?.bloomSource, "verb");
	const html = renderAlignment(view);
	assert.match(html, /Create <abbr class="defined level-source"[^>]*>generated<\/abbr>/);
	assert.match(html, /Understand <abbr class="defined level-source"[^>]*>or Apply<\/abbr>/);
});

test("objectives show by lesson under Bloom or Fink, switched in the heading row", async () => {
	const { readFileSync } = await import("node:fs");
	const course = parseCourse(readFileSync(new URL("./fixtures/examples.inspect.json", import.meta.url), "utf8"));
	const objective = (id: string, text: string, fink: string[]) => ({ id, text, ref: "1.1.1", fink, parent: null, modelBloom: null, levelReason: null });
	const view = alignmentView(course, { model: "m", objectives: [objective("O1", "Explain how a sluice opens", ["Application", "Integration"]), objective("O2", "Build a gauge model", [])], checks: [], overlaps: [], interpretation: [] } as never);
	const html = renderAlignment(view);
	for (const taxonomy of ["bloom", "fink"]) assert.match(html, new RegExp(`name="taxonomy" value="${taxonomy}"`));
	assert.doesNotMatch(html, /value="solo"/);
	const fink = html.split('data-taxonomy="fink"')[1]?.split('data-taxonomy=')[0] ?? "";
	// An objective with two Fink dimensions appears in both rows, the second paler.
	assert.equal((fink.match(/class="taxo-dot/g) ?? []).length, 3);
	assert.match(fink, /class="taxo-dot second"/);
	const bloom = html.split('data-taxonomy="bloom"')[1]?.split('data-taxonomy=')[0] ?? "";
	assert.match(bloom, />Unclassified</);
});

test("objectives show Gagné capability and which parts of a performance objective they state", async () => {
	const { readFileSync } = await import("node:fs");
	const course = parseCourse(readFileSync(new URL("./fixtures/examples.inspect.json", import.meta.url), "utf8"));
	const view = alignmentView(course, { model: "m", objectives: [
		{ id: "O1", text: "Given a stuck gauge, reset three readings in under five minutes", ref: "1.1.1", fink: ["Application"], parent: null, modelBloom: "Apply", knowledge: "Procedural", gagne: "Intellectual skill", levelReason: null, performance: { action: "reset three readings", conditions: "Given a stuck gauge", standard: "in under five minutes" } },
		{ id: "O2", text: "Understand gauges", ref: "1.1.1", fink: [], parent: null, modelBloom: null, knowledge: null, gagne: null, levelReason: null, performance: { action: null, conditions: null, standard: null } },
	], checks: [], overlaps: [], interpretation: [] } as never);
	const html = renderAlignment(view);
	assert.match(html, /name="taxonomy" value="gagne"/);
	assert.match(html, /title="action: “reset three readings” · conditions: “Given a stuck gauge” · standard: “in under five minutes”">Action, conditions, standard<\/abbr>/);
	assert.match(html, />No observable action</);
	assert.match(html, /title="Using concepts, rules or procedures[^"]*">Intellectual skill<\/abbr>/);
});

test("a check's most available instruction decides where it is when the check comes", async () => {
	const { availabilityView, renderAvailability } = await import("../src/availability.ts");
	const check = (id: string, line: number) => ({ id, type: "assessment", line, data: { question: `Check ${id}`, options: [{ text: "Yes", correct: true }] } });
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0", course: { title: "Availability", locale: "en" },
		lessons: [{ file: "a.prax", title: "A", sha256: "x", pages: [
			{ id: "p1", number: 1, title: "Teach", blocks: [
				{ id: "t", type: "text", line: 1, data: { content: "Shown on screen." } },
				{ id: "acc", type: "accordion", line: 2, data: { items: [{ title: "More", content: "Hidden detail." }] } },
			] },
			{ id: "p2", number: 2, title: "Checks", blocks: [
				{ id: "n", type: "text", line: 3, data: { content: "Here.", narration: "Spoken only." } },
				check("a", 4), check("b", 5), check("c", 6), check("d", 7), check("e", 8), check("f", 9),
			] },
			{ id: "p3", number: 3, title: "Later", blocks: [{ id: "l", type: "text", line: 9, data: { content: "Taught late." } }] },
		] }],
	}));
	const answer: AlignmentAnswer = {
		model: "test", objectives: [{ id: "O1", text: "Explain", ref: "1.1.1", fink: [], parent: null }],
		checks: [
			{ ref: "1.2.2", purpose: "knowledge", pre: false, objectives: ["O1"], support: [{ ref: "1.1.2", channel: "screen" }, { ref: "1.1.1", channel: "screen" }] },
			{ ref: "1.2.3", purpose: "knowledge", pre: false, objectives: ["O1"], support: [{ ref: "1.1.2", channel: "screen" }] },
			{ ref: "1.2.4", purpose: "knowledge", pre: false, objectives: ["O1"], support: [{ ref: "1.2.1", channel: "narration" }] },
			{ ref: "1.2.5", purpose: "knowledge", pre: false, objectives: ["O1"], support: [{ ref: "1.3.1", channel: "screen" }] },
			{ ref: "1.2.6", purpose: "knowledge", pre: false, objectives: ["O1"], support: [] },
			{ ref: "1.2.7", purpose: "knowledge", pre: true, objectives: ["O1"], support: [{ ref: "1.3.1", channel: "screen" }] },
		], overlaps: [], interpretation: [],
	};
	const view = availabilityView(course, alignmentView(course, answer), anatomy(course).lessons);
	assert.deepEqual(view.checks.map((item) => item.available), ["earlier-page", "behind-click", "narration", "after", "none", "pre"]);
	assert.equal(view.checks[3]?.minutesBefore, null);
	assert.match(renderAvailability(view), /4 of 6 checks fall in the orange instruction categories; 1 is a pre-assessment/);
});

test("views nested in a section follow its heading in the page and in the contents rail", async () => {
	const { availabilityView } = await import("../src/availability.ts");
	const { buildReport, renderHtml } = await import("../src/report.ts");
	const { courseHash } = await import("../src/inspect.ts");
	const { languageView } = await import("../src/language.ts");
	const { emphasisView } = await import("../src/emphasis.ts");
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0", course: { title: "Order", locale: "en" },
		lessons: [{ file: "a.prax", title: "A", sha256: "x", pages: [
			{ id: "p1", number: 1, title: "Teach", blocks: [{ id: "t", type: "text", line: 1, data: { content: "Objective: explain the idea. The idea is taught here." } }] },
			{ id: "p2", number: 2, title: "Check", blocks: [{ id: "q", type: "assessment", line: 2, data: { question: "Which?", options: [{ text: "This", correct: true }] } }] },
		] }],
	}));
	const answer: AlignmentAnswer = {
		model: "test", objectives: [{ id: "O1", text: "Explain", ref: "1.1.1", fink: [], parent: null }],
		checks: [{ ref: "1.2.1", purpose: "knowledge", pre: false, objectives: ["O1"], support: [{ ref: "1.1.1", channel: "screen" }] }],
		overlaps: [], interpretation: [],
	};
	const shape = anatomy(course);
	const alignment = alignmentView(course, answer);
	const report = buildReport(course.course, { schema: course.schema, studioVersion: course.studioVersion }, courseHash(course), shape,
		traceView(course, shape.lessons, { alignment }), languageView(course), emphasisView(course),
		{ alignment, availability: availabilityView(course, alignment, shape.lessons) });
	const html = renderHtml(report);
	const nav = html.match(/<nav class="views"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
	const links = [...nav.matchAll(/href="#([^"]+)"/g)].map((match) => match[1] ?? "");
	assert.ok(links.indexOf("alignment") < links.indexOf("view-availability"));
	for (const link of links) assert.equal(html.split(`id="${link}"`).length - 1, 1, link);
	const positions = links.map((link) => html.indexOf(`id="${link}"`));
	assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});
