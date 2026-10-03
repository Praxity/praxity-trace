import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { conceptsView, prerequisiteLayers, renderConcepts } from "../src/concepts-view.ts";
import { parseConcepts, PROMPT_VERSION } from "../src/concepts.ts";
import { courseHash, parseCourse } from "../src/inspect.ts";
import { locateBlocks } from "../src/places.ts";

const course = parseCourse(readFileSync(new URL("fixtures/examples.inspect.json", import.meta.url), "utf8"));
const blocks = locateBlocks(course);
const first = blocks.find((block) => block.page === 1)!;
const later = blocks.find((block) => block.lesson !== first.lesson)!;

function synthetic(size = 10, prerequisites = [[], [], ["C2", "C9"], ["C1"], ["C3", "C4"], ["C5", "C7"], ["C6"], ["C7"], [], []]) {
	return conceptsView(course, parseConcepts(JSON.stringify({
		view: "concepts", promptVersion: PROMPT_VERSION, courseHash: courseHash(course), model: "test",
		concepts: Array.from({ length: size }, (_, i) => ({
			id: `C${i + 1}`,
			name: i === 7 ? "A very long concept name <with> extra detail & explanation" : `Concept ${i + 1}`,
			prerequisites: prerequisites[i] ?? [`C${i}`],
			occurrences: i === 8 ? [] : [{ ref: i === 6 ? later.ref : first.ref, role: "defined" }],
		})),
	}), course));
}

const chart = (html: string) => html.slice(html.indexOf('aria-label="Prerequisite links"')).match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? "";

test("prerequisite depth follows the deepest prerequisite and collapses cycles with incoming and outgoing links", () => {
	const view = synthetic();
	const columns = prerequisiteLayers(view);
	assert.deepEqual(columns.map((column) => column.map((concept) => concept.id)), [
		["C1", "C2", "C10", "C9"], ["C4", "C3"], ["C5"], ["C6", "C7"], ["C8"],
	]);
	const depths = new Map(columns.flatMap((column, depth) => column.map((concept) => [concept.id, depth])));
	for (const link of view.dependencies) {
		if (link.cycle) assert.equal(depths.get(link.prerequisite), depths.get(link.dependent));
		else assert.ok(depths.get(link.prerequisite)! < depths.get(link.dependent)!);
	}
	// Removing external prerequisites leaves a cycle at depth zero, with its dependents still to the right.
	const cycleOnly = { ...view, dependencies: view.dependencies.filter((link) => link.cycle || link.dependent === "C8") };
	assert.deepEqual(prerequisiteLayers(cycleOnly)[1]?.map((concept) => concept.id), ["C8"]);
	assert.deepEqual(prerequisiteLayers({ ...view, concepts: [], dependencies: [] }), []);
});

test("columns preserve source pointers, link colours, cycle labels, full names, legend and table", () => {
	const view = synthetic();
	const html = renderConcepts(view);
	const svg = chart(html);
	assert.equal((svg.match(/class="dep-node/g) ?? []).length, 10);
	assert.equal((svg.match(/<path /g) ?? []).length, view.dependencies.length);
	assert.equal((svg.match(/class="dep-arc late"/g) ?? []).length, view.dependencies.filter((link) => link.direction === "after" || link.direction === "undefined").length);
	assert.match(svg, /class="dep-node undefined"/);
	assert.match(svg, /data-page="1\.1"/);
	assert.match(svg, /data-lessons="2 1"/);
	assert.match(svg, /data-lessons="1 2"/);
	assert.match(svg, /Concept 6 · cycle/);
	assert.match(svg, /Concept 7 · cycle/);
	assert.match(svg, /<title>A very long concept name &#60;with&#62; extra detail &#38; explanation/);
	assert.match(svg, /A very long concept name &#60;w…<\/text>/);
	assert.match(svg, /Builds on 4 steps/);
	assert.doesNotMatch(svg, /NaN|Infinity|viewBox/);
	assert.match(html, /class="scroll" tabindex="0" role="region" aria-label="Prerequisite links"/);
	assert.match(html, /Builds on, in course order/);
	assert.match(html, /<details class="method"><summary>How this is counted/);
	assert.match(html, /class="blocks dependencies"/);
	assert.match(html, /Concept 9 \(never defined\)/);
	assert.match(html, /prerequisite links come in order/);
	const paths = [...svg.matchAll(/ d="([^"]+)"/g)];
	assert.equal(paths.length, view.dependencies.length);
	paths.forEach((path, i) => {
		const points = path[1]!.match(/-?[\d.]+/g)!.map(Number);
		if (!view.dependencies[i]!.cycle) assert.ok(points[0]! < points.at(-2)!, "ordinary links run left to right");
	});
});

test("10 and 40 concepts retain fixed node spacing and expand the scrollable chart", () => {
	for (const size of [10, 40]) {
		const view = synthetic(size);
		const svg = chart(renderConcepts(view));
		assert.equal((svg.match(/class="dep-node/g) ?? []).length, size);
		const columns = prerequisiteLayers(view);
		assert.equal(Number(svg.match(/width="(\d+)"/)?.[1]), 32 + columns.length * 320 - 88 + 16);
		assert.equal(Number(svg.match(/height="(\d+)"/)?.[1]), 52 + Math.max(...columns.map((column) => column.length)) * 40);
		const points = [...svg.matchAll(/cx="(\d+)" cy="(\d+)"/g)].map((match) => [Number(match[1]), Number(match[2])]);
		assert.equal(new Set(points.map(([x, y]) => `${x},${y}`)).size, size);
		for (const [x, y] of points) for (const [otherX, otherY] of points) {
			if (x === otherX && y !== otherY) assert.ok(Math.abs(y! - otherY!) >= 40);
		}
	}
});


test("implied links are omitted only from the chart, with every orange link retained", () => {
	for (const direction of ["same page", "after", "undefined"] as const) {
		const view = synthetic(3, [[], ["C1"], ["C2", "C1"]]);
		view.dependencies.find((link) => link.prerequisite === "C1" && link.dependent === "C3")!.direction = direction;
		const html = renderConcepts(view), svg = chart(html);
		const implied = /<path[^>]*><title>Concept 3 builds on Concept 1/;
		if (direction === "same page") {
			assert.doesNotMatch(svg, implied);
			assert.match(svg, /2 drawn prerequisite links of 3 total/);
		} else {
			assert.match(svg, /<path class="dep-arc late"[^>]*><title>Concept 3 builds on Concept 1/);
		}
		assert.match(html, /<th scope="row" role="rowheader" data-label="Concept">Concept 3<\/th><td role="cell" data-label="Defined">[\s\S]*?<td role="cell" data-label="Builds on"><span class="dep">Concept 2<\/span>, <span class="dep(?: late)?">Concept 1/);
		assert.match(html, /chart omits links implied by longer chains except orange links; the table retains every link/);
	}
});

test("long non-implied links avoid intermediate label boxes through row gaps and below the last row", () => {
	const view = synthetic(6, [[], [], ["C1"], ["C3"], ["C4", "C2"], ["C1"]]);
	const svg = chart(renderConcepts(view));
	const path = [...svg.matchAll(/<path[^>]* d="([^"]+)"><title>([^<]+)/g)]
		.find((match) => match[2]!.startsWith("Concept 5 builds on Concept 2"))![1]!;
	const boxes = [...svg.matchAll(/<rect class="dep-label" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
		.map((match) => match.slice(1).map(Number)).filter(([x]) => x! > 320 && x! < 960);
	assert.equal(boxes.length, 3);
	let x = 0, y = 0;
	const samples: number[][] = [];
	for (const segment of path.matchAll(/([MLC])([^MLC]+)/g)) {
		const values = segment[2]!.trim().split(/\s+/).map(Number);
		const endX = values.at(-2)!, endY = values.at(-1)!;
		for (let step = 0; step <= 100; step++) {
			const t = step / 100, u = 1 - t;
			samples.push(segment[1] === "C"
				? [u ** 3 * x + 3 * u ** 2 * t * values[0]! + 3 * u * t ** 2 * values[2]! + t ** 3 * endX,
					u ** 3 * y + 3 * u ** 2 * t * values[1]! + 3 * u * t ** 2 * values[3]! + t ** 3 * endY]
				: [x * u + endX * t, y * u + endY * t]);
		}
		x = endX; y = endY;
	}
	for (const [px, py] of samples) for (const [bx, by, width, height] of boxes) {
		assert.ok(px! < bx! || px! > bx! + width! || py! < by! || py! > by! + height!, `path crosses label at ${px},${py}`);
	}
	for (const [bx, , width] of boxes) assert.ok(samples.some(([px]) => px! >= bx! && px! <= bx! + width!), "path traverses each intermediate column");
});

test("links start after the displayed source label and end before the target dot, including cycles", () => {
	const view = synthetic();
	view.concepts.find((concept) => concept.id === "C1")!.name = "A";
	const svg = chart(renderConcepts(view));
	const labels = new Map([...svg.matchAll(/<g[^>]*><title>([^<]+)<\/title><rect class="dep-label" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="24"\/><circle[^>]* cx="([\d.]+)" cy="([\d.]+)"/g)]
		.map((match) => [match[1]!.split("\n")[0], match.slice(2).map(Number)]));
	for (const match of svg.matchAll(/<path[^>]* d="([^"]+)"><title>([^<]+) builds on ([^\n]+)/g)) {
		const points = match[1]!.match(/-?[\d.]+/g)!.map(Number);
		const source = labels.get(match[3]!)!, target = labels.get(match[2]!)!;
		assert.ok(Math.abs(points[0]! - (source[0]! + source[2]! + 2)) < 0.001);
		assert.equal(points[1], source[4]);
		assert.equal(points.at(-2), target[3]! - 5);
		assert.equal(points.at(-1), target[4]);
	}
	const short = labels.get("A")!;
	assert.ok(short[2]! < 30, "a short label no longer masks a full column width");
});


test("concepts interpretation follows spacing and precedes distinctions", () => {
	const view = synthetic();
	view.interpretation = [{ text: "A concept reading", refs: [first.ref] }];
	const html = renderConcepts(view, () => "Spacing callback", () => "Distinctions callback");
	assert.ok(html.indexOf("Spacing callback") < html.indexOf("A concept reading"));
	assert.ok(html.indexOf("A concept reading") < html.indexOf("Distinctions callback"));
});
