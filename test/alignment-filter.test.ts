import assert from "node:assert/strict";
import { test } from "node:test";
import { anatomy } from "../src/anatomy.ts";
import { parseCourse } from "../src/inspect.ts";
import { renderTrace, traceView } from "../src/trace.ts";
import { groupObjectives, renderAlignment, type AlignmentView } from "../src/alignment-view.ts";

const objectives: AlignmentView["objectives"] = [1, 2, 4].map((lesson) => ({
	id: `O${lesson}`, text: `Explain lesson ${lesson}`, ref: `${lesson}.1.1`, fink: [], parent: null,
	verb: "explain", bloom: "Understand",
}));
const overlaps = [{ objectives: ["O1", "O2"], note: "Shared learning" }];
const view: AlignmentView = {
	model: "test", objectives, overlaps, objectiveGroups: groupObjectives(objectives, overlaps),
	activities: [
		{ ref: "3.1.1", lesson: "3.prax", page: 1, purpose: "reflection", label: "Try it", objectives: ["O2"] },
		{ ref: "5.1.1", lesson: "5.prax", page: 1, purpose: "reflection", label: "Unlinked", objectives: [] },
	],
	checks: [], surveys: 0, blocks: 5, lessons: [], interpretation: [],
	places: Object.fromEntries([1, 2, 3, 4, 5].map((lesson) => [`${lesson}.1.1`, {
		lesson, lessonTitle: `Lesson ${lesson}`, page: 1, file: `${lesson}.prax`, line: 1, position: lesson - 1,
	}])),
};
const html = renderAlignment(view);
const rowsOf = (label: string) => {
	const table = html.split(`aria-label="${label}"`)[1]?.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
	return [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map((match) => match[0]);
};

test("all alignment table rows declare lesson membership", () => {
	const bodies = [...html.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/g)];
	assert.equal(bodies.length, 4);
	for (const body of bodies) {
		for (const row of body[1]!.matchAll(/<tr\b[^>]*>/g)) assert.match(row[0], /data-lessons?="[1-5 ]+"/);
	}
});

test("evidence and flow groups match later statements and evidence lessons", () => {
	for (const label of ["Evidence dot matrix", "Evidence by objective group", "Constructive alignment pairs"]) {
		const rows = rowsOf(label);
		assert.match(rows[0]!, /data-lessons="1 2 3"/);
		assert.match(rows[1]!, /data-lessons="4"/);
		if (label !== "Constructive alignment pairs") assert.match(rows[2]!, /data-lessons="5"/);
	}
});

test("objective level rows retain their statement lesson", () => {
 assert.deepEqual(rowsOf("Objectives with their levels").map((row) => row.match(/data-lesson="(\d+)"/)?.[1]), ["1", "2", "4"]);
});

test("trace objective rows retain full group tooltips, statement sources and parent objectives in Table mode", () => {
	const course = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "test", course: { title: "Objective groups", locale: "en" },
		lessons: [1, 2, 3, 4, 5].map((n) => ({ file: `${n}.prax`, title: `Lesson ${n}`, sha256: String(n), pages: [{ id: `p${n}`, number: 1, title: "Page", blocks: [{ id: `b${n}`, type: "text", line: 1, data: { content: "Explain the lesson." } }] }] })),
	}));
	const members = objectives.map((objective) => ({ ...objective, parent: objective.id === "O2" ? "O4" : null }));
	const trace = traceView(course, anatomy(course).lessons, { alignment: { ...view, objectives: members, objectiveGroups: groupObjectives(members, overlaps) } });
	const group = trace.rows.find((row) => row.members?.length === 2)!;
	assert.equal(group.label, "O1, O2 · Explain lesson 1");
	const markup = renderTrace(trace);
	assert.match(markup, /<title>O1 · Explain lesson 1\nO2 · Explain lesson 2\nWhat the group shares: Shared learning<\/title>/);
	const table = markup.split('aria-label="Course trace objective groups"')[1]?.split("</table>")[0] ?? "";
	for (const column of ["Objective", "Group", "Stated at", "Builds toward", "What the group shares"]) assert.ok(table.includes(`<th scope="col" role="columnheader">${column}</th>`));
	const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map((match) => match[0]);
	const second = rows.find((row) => row.includes('class="oid">O2</span>'))!;
	assert.match(second, /data-lesson="2"/);
	assert.match(second, /data-label="Group">O1, O2<\/td>/);
	assert.match(second, /data-page="2\.1" title="Lesson 2, page 1 · 2\.prax:1"/);
	assert.match(second, /data-label="Builds toward">O4 · Explain lesson 4<\/td>/);
	assert.match(second, /data-label="What the group shares">Shared learning<\/td>/);
	assert.doesNotMatch(table, /rowspan/);
	assert.match(markup, /tabindex="0" role="region" aria-label="Course trace objective groups"/);
	assert.match(markup, /Comment on a group to split it\./);
});
