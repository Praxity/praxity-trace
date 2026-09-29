import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { alignmentView, renderAlignment } from "../src/alignment-view.ts";
import type { AlignmentAnswer } from "../src/alignment.ts";
import { anatomy } from "../src/anatomy.ts";
import { renderAnatomy } from "../src/anatomy-view.ts";
import { availabilityView, renderAvailability } from "../src/availability.ts";
import { conceptsView, renderConcepts } from "../src/concepts-view.ts";
import { courseHash, parseCourse, type Course, type TypedText } from "../src/inspect.ts";
import { absence, renderFeedback } from "../src/modes.ts";
import { locateBlocks } from "../src/places.ts";
import { parseTasks, renderTasks, tasksView, type TasksAnswer } from "../src/tasks.ts";
import { blockTexts, feedbackText } from "../src/text.ts";

const fixture = (path: string) => readFileSync(new URL(`fixtures/${path}`, import.meta.url), "utf8");
const load = (path: string) => parseCourse(fixture(path));
const taskFixture = (name: string) => {
	const course = load(`tasks/${name}/inspect.json`);
	return { course, answer: parseTasks(fixture(`tasks/${name}/answer.json`), course) };
};
const objective = (id: string, ref: string, text = "Explain the rule"): AlignmentAnswer["objectives"][number] => ({ id, ref, text, parent: null, fink: [] });
const review = (checks: AlignmentAnswer["checks"], objectives: AlignmentAnswer["objectives"] = []): AlignmentAnswer => ({ model: "fixture-alignment", objectives, checks, overlaps: [], interpretation: [] });
const knowledge = (ref: string, support: AlignmentAnswer["checks"][number]["support"] = [], objectives: string[] = []): AlignmentAnswer["checks"][number] => ({ ref, support, objectives, purpose: "knowledge", pre: false });
const links = (course: Course, answer: AlignmentAnswer) => {
	const alignment = alignmentView(course, answer);
	return { alignment, availability: availabilityView(course, alignment, anatomy(course).lessons) };
};

test("tasks join primary and quoted refs exactly to objective evidence, with no page or instruction inference", () => {
	const { course, answer } = taskFixture("procedural");
	const alignment = review([
		knowledge("1.3.2", [{ ref: "1.2.4", channel: "screen" }], ["O1", "O2"]),
		knowledge("1.4.3", [{ ref: "1.4.2", channel: "screen" }], ["O1"]),
		{ ref: "1.5.2", purpose: "worksheet", pre: false, objectives: ["O2"], support: [] },
	], [objective("O1", "1.1.3"), objective("O2", "1.1.2")]);
	const context = links(course, alignment);
	const view = tasksView(course, answer, context);
	const at = (ref: string) => view.annotations.find(item => item.ref === ref)!;
	assert.deepEqual(at("1.3.2").alignment?.objectives.map(item => item.id), ["O1", "O2"]);
	assert.deepEqual(at("1.5.2").alignment?.objectives.map(item => item.id), ["O2"]);
	assert.deepEqual(at("1.4.2").alignment?.refs, [], "being instruction on the check page does not link its task to an objective");
	assert.deepEqual(at("1.4.3").alignment?.checks, context.availability.checks.filter(item => item.ref === "1.4.3"));
	assert.equal(at("1.4.3").alignment?.checks[0]?.available, "same-page");
	assert.match(at("1.4.3").alignment?.checks[0]?.instructionLinks[0]?.text ?? "", /below the marked safe band/);
	assert.ok(view.places["1.1.3"] && view.places["1.4.2"], "joined sources remain locatable");
	const multi = structuredClone(answer);
	multi.annotations[0]!.evidence.push(...answer.annotations.find(item => item.ref === "1.3.2")!.evidence, ...answer.annotations.find(item => item.ref === "1.4.3")!.evidence);
	const joined = tasksView(course, multi, context).annotations[0]!;
	assert.deepEqual(joined.alignment?.refs, ["1.3.2", "1.4.3"]);
	assert.deepEqual(joined.alignment?.objectives.map(item => item.id), ["O1", "O2"], "objectives are deduplicated across matching checks");
	assert.equal(joined.feedback?.length, 2);
	const html = renderTasks(view);
	assert.match(html, /Linked through the alignment review/);
	assert.match(html, /No alignment link/);
	assert.match(html, /Instruction links are recorded for knowledge checks only/);
	assert.match(html, /Objectives · <abbr[^>]*generated/);
	assert.match(html, /Instruction · <abbr[^>]*generated/);
	assert.match(html, /data-ref="1\.4\.2" data-page="1\.4"/);
	assert.doesNotMatch(renderTasks(tasksView(course, answer)), /Linked through|Objectives ·|Instruction ·/);
});

test("task instruction retains all availability categories, passages and channels", () => {
	const blocks = [
		{ type: "text", data: { content: "Earlier instruction" } },
		{ type: "accordion", data: { content: "Reveal instruction" } },
		{ type: "text", data: { content: "Term", narration: "Spoken instruction", tooltip: "[term]{Tooltip instruction}" } },
	];
	const course = parseCourse(JSON.stringify({ ok: true, schema: "praxity-inspect/0", studioVersion: "test", course: { title: "Channels", locale: "en" }, lessons: [{ file: "channels.prax", title: "Channels", sha256: "test", pages: [
		{ id: "p1", number: 1, title: "Instruction", blocks: blocks.map((block, i) => ({ ...block, id: `b${i}`, line: i + 1 })) },
		{ id: "p2", number: 2, title: "Checks", blocks: [{ id: "same", line: 5, type: "text", data: { content: "Same page instruction" } }, ...Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, line: i + 6, type: "assessment", data: { question: `Question ${i}`, options: [{ text: "Yes", correct: true }] } }))] },
		{ id: "p3", number: 3, title: "Later", blocks: [{ id: "later", line: 20, type: "text", data: { content: "Later instruction" } }] },
	] }] }));
	const support: AlignmentAnswer["checks"][number]["support"][] = [
		[{ ref: "1.2.1", channel: "screen" }], [{ ref: "1.1.1", channel: "screen" }], [{ ref: "1.1.2", channel: "screen" }], [{ ref: "1.1.3", channel: "tooltip" }], [{ ref: "1.1.3", channel: "narration" }], [{ ref: "1.3.1", channel: "screen" }], [{ ref: "1.3.1", channel: "screen" }], [],
	];
	const context = links(course, review(support.map((items, i) => ({ ...knowledge(`1.2.${i + 2}`, items), pre: i === 5 }))));
	const answer: TasksAnswer = { model: "fixture-task", annotations: context.alignment.checks.map(check => ({ ref: check.ref, evidence: [{ ref: check.ref, channel: "screen", quote: check.question }], taskTypes: ["experiential"], explanation: "Choose an answer", assessmentPurpose: "practice", work: "inside" })) };
	const view = tasksView(course, answer, context);
	assert.deepEqual(view.annotations.map(item => item.alignment?.checks[0]?.available), ["same-page", "earlier-page", "behind-click", "tooltip", "narration", "pre", "after", "none"]);
	const html = renderTasks(view);
	for (const passage of ["Earlier instruction", "Reveal instruction", "Tooltip instruction", "Spoken instruction", "Same page instruction", "Later instruction"]) assert.ok(html.includes(passage), passage);
	assert.match(html, /Pre-assessment, taught after/);
	assert.match(html, /Only after the check/);
	assert.match(html, /No instruction found/);
	assert.equal(view.annotations[5]?.alignment?.checks[0]?.instructionLinks[0]?.after, true);
});

test("feedback distinguishes supplied prose, empty fields and absent fields in both input schemas", () => {
	for (const file of ["examples.inspect.json", "examples.projection2.inspect.json"]) {
		const course = load(file);
		const checks = locateBlocks(course).filter(item => item.block.type === "assessment").slice(0, 3);
		assert.match(feedbackText(checks[0]!.block).items.map(item => item.text).join(" "), /eliminate the ignition source/);
		for (const [i, { block }] of checks.entries()) {
			if (course.projectionVersion === 2) {
				block.data.typedTexts = (block.data.typedTexts as TypedText[]).filter(text => text.role !== "feedback");
				if (i < 2) (block.data.typedTexts as TypedText[]).push({ ref: `feedback-${i}`, role: "feedback", value: i === 0 ? "<p>Reason &amp; explanation</p>" : " ", format: "html", location: null });
			} else {
				block.data = { question: "Which?", options: [{ text: "Yes", correct: true }], ...(i === 0 ? { incorrect: "<p>Reason &amp; explanation</p>", correct: "", feedback: "General feedback", options: [{ text: "Yes", correct: true, feedback: "Option feedback" }] } : i === 1 ? { feedback: " " } : {}) };
			}
		}
		assert.deepEqual(checks.map(item => feedbackText(item.block).status), ["present", "empty", "not-supplied"]);
		const context = links(course, review(checks.map(item => knowledge(item.ref))));
		const answer: TasksAnswer = { model: "fixture", annotations: checks.map(item => ({ ref: item.ref, evidence: [{ ref: item.ref, channel: "screen", quote: blockTexts(item.block).screen }], taskTypes: ["experiential"], explanation: "Choose", assessmentPurpose: "practice", work: "inside" })) };
		for (const html of [renderAvailability(context.availability), renderTasks(tasksView(course, answer, context)), renderTasks(tasksView(course, answer))]) {
			assert.match(html, /Reason &#38; explanation/);
			assert.match(html, /Empty feedback/);
			assert.match(html, /Feedback not supplied by the input/);
			assert.doesNotMatch(html, /<p>Reason/);
		}
		if (course.schema === "praxity-inspect/0") assert.deepEqual(feedbackText(checks[0]!.block).items.map(item => item.source), ["incorrect", "correct", "feedback", "options[0].feedback"]);
	}
	assert.equal(renderFeedback({ status: "empty", items: [{ source: "feedback", text: "" }] }).includes("not supplied"), false);
	const block = locateBlocks(load("smoke.projection2.inspect.json")).find(item => item.block.assessment)!.block;
	assert.equal(feedbackText(block).status, "not-supplied", "an answer key or scoring feedbackMode is not feedback text");
});

test("partial absence claims point to coverage while complete inputs retain their wording", () => {
	for (const file of ["examples.inspect.json", "examples.schema1.inspect.json", "examples.projection2.inspect.json"]) {
		const course = load(file), partial = course.schema === "praxity-inspect/1";
		const blocks = locateBlocks(course), check = blocks.find(item => item.block.type === "assessment")!;
		const context = links(course, review([knowledge(check.ref)], [objective("O1", blocks[0]!.ref)]));
		const html = renderAlignment(context.alignment, positions => renderAvailability(context.availability, positions));
		if (partial) {
			assert.match(html, /Instruction not found in the inspected content/);
			assert.match(html, /A check or activity was not found in the inspected content/);
			assert.match(html, /href="#coverage"/);
			assert.doesNotMatch(html, />No instruction found<|>no instruction found<|Not taught in this course/);
		} else {
			assert.match(html, /No check or activity/);
			assert.match(html, /No instruction found/);
			assert.doesNotMatch(html, /href="#coverage"/);
		}
		const concepts = conceptsView(course, { model: "fixture", concepts: [{ id: "C1", name: "Rule", prerequisites: ["C2"], occurrences: [{ ref: blocks[0]!.ref, role: "defined" }] }, { id: "C2", name: "Term", prerequisites: [], occurrences: [{ ref: blocks[1]!.ref, role: "mentioned" }] }], interpretation: [] });
		const conceptHtml = renderConcepts(concepts);
		assert.match(conceptHtml, partial ? /a knowledge check was not found in the inspected content/ : /1 defined concept has no knowledge check/);
		assert.match(conceptHtml, partial ? /definition was not found in the inspected content/ : /Never defined/);
		const taskHtml = renderTasks(tasksView(course, { model: "fixture", annotations: [] }));
		assert.match(taskHtml, partial ? /A supported task type for this page was not found in the inspected content/ : /No supported task type was assigned to this page/);
		const shape = anatomy(course);
		const anatomyHtml = renderAnatomy({ anatomy: shape.lessons, rhythm: { withoutAction: [], textOnly: [], generatedBy: null }, speakingWpm: shape.speakingWpm });
		if (partial && shape.lessons.some(lesson => lesson.marks.some(mark => mark.knowledgeCheck === null))) assert.match(anatomyHtml, /Correctness not found in the inspected content · <a href="#coverage">/);
	}
	const { course } = taskFixture("awareness");
	assert.match(renderTasks(tasksView(course, { model: "fixture", annotations: [] })), /not found in the inspected content/);
	assert.equal(absence(false, "None", "Instruction"), "None");
});

test("CLI derives task links using saved prompt versions and leaves them out without --tasks", () => {
	const { course } = taskFixture("judgment");
	const directory = mkdtempSync(join(tmpdir(), "trace-phase2-"));
	const input = join(directory, "inspect.json"), alignment = join(directory, "alignment.json"), tasks = join(directory, "tasks.json");
	writeFileSync(input, fixture("tasks/judgment/inspect.json"));
	writeFileSync(tasks, fixture("tasks/judgment/answer.json"));
	writeFileSync(alignment, JSON.stringify({ view: "alignment", promptVersion: "alignment/13-projection-2", courseHash: courseHash(course), ...review([knowledge("1.1.2"), knowledge("1.2.3", [{ ref: "1.2.2", channel: "screen" }], ["O1"])], [objective("O1", "1.2.2")]) }));
	for (const withTasks of [false, true]) {
		const output = join(directory, withTasks ? "with-tasks" : "without-tasks");
		const run = spawnSync(process.execPath, ["src/cli.ts", "report", input, "--alignment", alignment, ...(withTasks ? ["--tasks", tasks] : []), "--out", output], { encoding: "utf8" });
		assert.equal(run.status, 0, run.stderr);
		const report = JSON.parse(readFileSync(join(output, "report.json"), "utf8"));
		const html = readFileSync(join(output, "report.html"), "utf8");
		assert.equal((html.match(/id="coverage"/g) ?? []).length, 1);
		assert.match(html, /href="#coverage"/);
		assert.equal(report.availability.checks[0].feedback.status, "not-supplied");
		assert.equal(report.availability.checks[1].instructionLinks[0].channel, "screen");
		if (withTasks) {
			assert.equal(report.tasks.alignmentModel, "fixture-alignment");
			assert.deepEqual(report.tasks.annotations.find((item: { ref: string }) => item.ref === "1.2.3").alignment.objectives.map((item: { id: string }) => item.id), ["O1"]);
		} else assert.equal(report.tasks, undefined);
	}
});

test("instruction nested inside an accordion counts as behind a click in schema 1", async () => {
	const { availabilityView } = await import("../src/availability.ts");
	const { alignmentView } = await import("../src/alignment-view.ts");
	const { anatomy } = await import("../src/anatomy.ts");
	const { parseCourse } = await import("../src/inspect.ts");
	const location = { file: "a.prax", startLine: 1, endLine: 1 };
	const text = (ref: string, role: string, value: string) => ({ ref, role, value, format: "plain", location });
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/1", studioVersion: "0.2.0", revision: "a".repeat(64), course: { title: "Nested", locale: "en" },
		lessons: [{ file: "a.prax", id: null, title: "A", sha256: "x", unlinkedNarrationCount: 0, narration: [], pages: [
			{ ref: "p1", id: null, number: 1, title: "Teach", blocks: [
				{ ref: "acc", parentRef: null, id: null, type: "accordion", coverage: "container", location, texts: [text("acc/label", "heading", "More")] },
				{ ref: "inner", parentRef: "acc", id: null, type: "text", coverage: "text", location, texts: [text("inner/body", "body", "Hidden detail.")] },
			] },
			{ ref: "p2", id: null, number: 2, title: "Check", blocks: [
				{ ref: "q", parentRef: null, id: null, type: "assessment", coverage: "text", location, texts: [text("q/prompt", "prompt", "Which?")] },
			] },
		] }],
	}));
	const answer = { model: "t", objectives: [{ id: "O1", text: "Explain", ref: "1.1.1", fink: [], parent: null }], checks: [{ ref: "1.2.1", purpose: "knowledge" as const, pre: false, objectives: ["O1"], support: [{ ref: "1.1.2", channel: "screen" as const }] }], overlaps: [], interpretation: [] };
	const view = availabilityView(course, alignmentView(course, answer), anatomy(course).lessons);
	assert.equal(view.checks[0]?.available, "behind-click");
});

test("schema 0 sequence instruction follows page position unless horizontal and scrollable", () => {
	for (const settings of [{}, { orientation: "vertical", scrollable: true }, { orientation: "horizontal", scrollable: false }, { orientation: "horizontal", scrollable: true }]) {
		const sequence = { id: "seq", type: "sequence", line: 1, data: { ...settings, items: [{ label: "Read the gauge", children: [{ id: "inner", type: "text", data: { content: "Read the flood gauge against the safe band." } }] }] } };
		const course = parseCourse(JSON.stringify({
			ok: true, schema: "praxity-inspect/0", studioVersion: "test", course: { title: "Flood gauge", locale: "en" },
			lessons: [{ file: "gauge.prax", title: "Flood gauge", sha256: "x", pages: [
				{ id: "p1", number: 1, title: "Earlier instruction", blocks: [sequence] },
				{ id: "p2", number: 2, title: "Checks", blocks: [sequence, ...[1, 2, 3].map(i => ({ id: `q${i}`, type: "assessment", line: 5 + i, data: { question: "Is the flood gauge below the safe band?", options: [{ text: "Yes", correct: true }] } }))] },
				{ id: "p3", number: 3, title: "Later instruction", blocks: [sequence] },
			] }],
		}));
		const view = links(course, review(["1.2.1", "1.1.1", "1.3.1"].map((ref, i) => knowledge(`1.2.${i + 2}`, [{ ref, channel: "screen" }])))).availability;
		const hides = settings.orientation === "horizontal" && settings.scrollable === true;
		assert.deepEqual(view.checks.map(check => check.available), hides ? ["behind-click", "behind-click", "after"] : ["same-page", "earlier-page", "after"]);
		assert.deepEqual(view.checks.map(check => check.instructionLinks[0]?.available), view.checks.map(check => check.available));
	}
});

test("instruction nested inside a schema 1 sequence follows page position", () => {
	const location = { file: "gauge.prax", startLine: 1, endLine: 1 };
	const text = (ref: string, role: string, value: string) => ({ ref, role, value, format: "plain", location });
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/1", studioVersion: "test", revision: "a".repeat(64), course: { title: "Flood gauge", locale: "en" },
		lessons: [{ file: "gauge.prax", id: null, title: "Flood gauge", sha256: "x", unlinkedNarrationCount: 0, narration: [], pages: [
			{ ref: "p1", id: null, number: 1, title: "Teach and check", blocks: [
				{ ref: "seq", parentRef: null, id: null, type: "sequence", coverage: "container", location, texts: [text("seq/label", "heading", "Read the gauge")] },
				{ ref: "inner", parentRef: "seq", id: null, type: "text", coverage: "text", location, texts: [text("inner/body", "body", "Read the flood gauge against the safe band.")] },
				{ ref: "q1", parentRef: null, id: null, type: "assessment", coverage: "text", location, texts: [text("q1/prompt", "prompt", "Is the flood gauge below the safe band?")] },
			] },
			{ ref: "p2", id: null, number: 2, title: "Later check", blocks: [
				{ ref: "q2", parentRef: null, id: null, type: "assessment", coverage: "text", location, texts: [text("q2/prompt", "prompt", "Is the flood gauge below the safe band?")] },
			] },
		] }],
	}));
	const view = links(course, review(["1.1.3", "1.2.1"].map(ref => knowledge(ref, [{ ref: "1.1.2", channel: "screen" }])))).availability;
	assert.deepEqual(view.checks.map(check => check.available), ["same-page", "earlier-page"]);
	assert.deepEqual(view.checks.map(check => check.instructionLinks[0]?.available), ["same-page", "earlier-page"]);
	assert.deepEqual(view.checks.map(check => check.source?.ref), ["1.1.2", "1.1.2"]);
});
