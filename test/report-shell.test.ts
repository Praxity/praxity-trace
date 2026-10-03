import assert from "node:assert/strict";
import { previewText } from "../src/text.ts";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { anatomy } from "../src/anatomy.ts";
import { emphasisView, renderEmphasis } from "../src/emphasis.ts";
import { courseHash, parseCourse } from "../src/inspect.ts";
import { languageView } from "../src/language.ts";
import { lessonHeading, where } from "../src/places.ts";
import { buildReport, renderHtml } from "../src/report.ts";
import { FLOW_SCRIPT } from "../src/flow.ts";
import { MODES_SCRIPT, reflowTables } from "../src/modes.ts";
import { SCROLL_HINT_SCRIPT } from "../src/scrollhint.ts";
import { THEME_SCRIPT } from "../src/theme.ts";
import { traceView } from "../src/trace.ts";

const course = parseCourse(readFileSync(new URL("fixtures/examples.inspect.json", import.meta.url), "utf8"));
const shape = anatomy(course);
const report = buildReport(
	course.course, { schema: course.schema, studioVersion: course.studioVersion }, courseHash(course), shape,
	traceView(course, shape.lessons, {}), languageView(course), emphasisView(course),
);
const html = renderHtml(report);

test("every report table has its own nonempty caption", async () => {
	const { parse } = await import("parse5");
	type Node = import("parse5").DefaultTreeAdapterMap["node"];
	const text = (node: Node): string => "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(text).join("") : "";
	let tables = 0;
	function walk(node: Node) {
		if ("tagName" in node && node.tagName === "table") {
			tables++;
			const caption = node.childNodes.find(child => "tagName" in child && child.tagName === "caption");
			assert.ok(caption && text(caption).trim(), `Table ${tables} needs a caption`);
		}
		if ("childNodes" in node) node.childNodes.forEach(walk);
	}
	walk(parse(html));
	assert.ok(tables > 5, "Exercise the report's table views");
});

test("reflowed tables keep explicit roles and label each cell by its logical column", () => {
	const head = `<thead><tr><th scope="colgroup" colspan="2">Now</th><th scope="col" rowspan="2">Total<br>"s"</th></tr><tr><th scope="col">Lesson</th><th scope="col">Channel</th></tr></thead>`;
	const body = `<tbody><tr><th scope="rowgroup" rowspan="2">L1</th><th scope="row">On screen</th><td class="num">3</td></tr><tr><th scope="row">Narration</th><td>4</td></tr></tbody><tbody><tr><td colspan="2">Both</td><td>7</td></tr><tr><td colspan="3">A note across the row</td></tr></tbody>`;
	const chart = `<table aria-hidden="true"><tbody><tr><td>1</td></tr></tbody></table>`;
	assert.equal(
		reflowTables(`<p>Before</p><table class="t"><caption>Totals</caption>${head}${body}</table>${chart}`),
		`<p>Before</p><table class="t" role="table"><caption>Totals</caption>` +
			`<thead role="rowgroup"><tr role="row"><th scope="colgroup" colspan="2" role="columnheader">Now</th><th scope="col" rowspan="2" role="columnheader">Total<br>"s"</th></tr><tr role="row"><th scope="col" role="columnheader">Lesson</th><th scope="col" role="columnheader">Channel</th></tr></thead>` +
			`<tbody role="rowgroup"><tr role="row"><th scope="rowgroup" rowspan="2" role="rowheader" data-label="Now · Lesson">L1</th><th scope="row" role="rowheader" data-label="Now · Channel">On screen</th><td class="num" role="cell" data-label="Total &#34;s&#34;">3</td></tr>` +
			`<tr role="row"><th scope="row" role="rowheader" data-label="Now · Channel">Narration</th><td role="cell" data-label="Total &#34;s&#34;">4</td></tr></tbody>` +
			`<tbody role="rowgroup"><tr role="row"><td colspan="2" role="cell" data-label="Now">Both</td><td role="cell" data-label="Total &#34;s&#34;">7</td></tr><tr role="row"><td colspan="3" role="cell">A note across the row</td></tr></tbody></table>${chart}`,
	);
	assert.equal(reflowTables("<p>No tables</p>"), "<p>No tables</p>");
	assert.throws(() => reflowTables(`<table><tbody><tr><td data-label="Mine">1</td></tr></tbody></table>`), /reflowTables owns data-label/);
});

test("every Table-mode cell carries its column label and one shared rule stacks them", async () => {
	const { parse } = await import("parse5");
	type Node = import("parse5").DefaultTreeAdapterMap["node"];
	type Element = import("parse5").DefaultTreeAdapterMap["element"];
	const attr = (node: Element, name: string) => node.attrs.find((item) => item.name === name)?.value;
	const tables: Element[] = [];
	(function walk(node: Node, chart: boolean) {
		const element = "tagName" in node ? node : null;
		const inChart = chart || (element !== null && (attr(element, "class") === "mode-chart" || attr(element, "aria-hidden") === "true"));
		if (element?.tagName === "table" && !inChart) tables.push(element);
		if ("childNodes" in node) node.childNodes.forEach((child) => walk(child, inChart));
	})(parse(html), false);
	assert.ok(tables.length > 5, "Exercise the report's table views");
	for (const table of tables) {
		assert.equal(attr(table, "role"), "table");
		const cells = table.childNodes.filter((node): node is Element => "tagName" in node && node.tagName === "tbody")
			.flatMap((body) => body.childNodes.filter((node): node is Element => "tagName" in node))
			.flatMap((row) => row.childNodes.filter((node): node is Element => "tagName" in node && (node.tagName === "td" || node.tagName === "th")));
		for (const cell of cells) {
			assert.equal(attr(cell, "role"), cell.tagName === "th" ? "rowheader" : "cell");
			if (!attr(cell, "colspan")) assert.ok(attr(cell, "data-label"), `${attr(table, "class")} body cell needs a column label`);
		}
	}
	// One owner for the narrow layout: renderers no longer hide header rows or write their own labels.
	assert.equal(html.split(`content:attr(data-label) ": " / ""`).length - 1, 1);
	assert.doesNotMatch(html, /thead\{position:absolute/);
});

test("each inlined browser script parses", () => {
	for (const script of [FLOW_SCRIPT, MODES_SCRIPT, SCROLL_HINT_SCRIPT, THEME_SCRIPT]) {
		assert.doesNotThrow(() => new Function(script));
	}
	const pageScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
	for (const script of pageScripts) assert.doesNotThrow(() => new Function(script));
});

test("page previews use lesson.page keys and include the page's text and activity counts", () => {
	const json = html.match(/<script type="application\/json" id="page-previews">([^<]*)<\/script>/)?.[1];
	assert.ok(json);
	const previews = JSON.parse(json);
	assert.equal(previews["1.1"].title, course.lessons[0]?.pages[0]?.title);
	const lines = shape.lessons[0]?.pace[0]?.preview?.lines.map((line) => line.text).join(" ") ?? "";
	assert.equal(lines.includes("This short course introduces"), true);
	assert.equal(shape.lessons[2]?.pace[0]?.preview?.checks, 3);
	assert.equal((shape.lessons[1]?.pace[0]?.preview?.activities ?? 0) > 0, true);
	assert.ok(lines.length <= 320);
	assert.equal(previewText("one two three", 8), "one two…");
	assert.equal(previewText("verylongword", 6), "…");
	assert.match(html, /tip\.addEventListener\('pointerenter'/);
	assert.match(html, /event\.key === 'Escape'/);
	const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
	assert.ok(scripts.length >= 2);
	for (const script of scripts) assert.doesNotThrow(() => new Function(script));
	const headingExpression = scripts.join("\n").match(/heading\.textContent = ([^;]+);/)?.[1];
	assert.ok(headingExpression);
	const heading = new Function("page", `return ${headingExpression};`);
	assert.equal(heading({ lesson: 1, number: 2, title: "A new page" }), "1.2  A new page");
});

test("where labels are plain text with a pointer preview and source", () => {
	const label = where({ ref: { lesson: 3, lessonTitle: "Lesson", page: 9, file: "lesson.prax", line: 14, position: 0 } }, "ref");
	assert.match(label, /data-page="3\.9"/);
	assert.doesNotMatch(label, /tabindex/);
	assert.match(label, /title="Lesson, page 9 · lesson\.prax:14"/);
	assert.match(label, />3.9<\/span>/);
	assert.doesNotMatch(html, /else if \(!el\.hasAttribute\('tabindex'\)/);
});

test("contents rail lists every section and view drawn, each linking to one element, with longer view ticks and a two-column mobile layout", async () => {
	const { presentViews } = await import("../src/sections.ts");
	const nav = html.match(/<nav class="views"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
	const links = [...nav.matchAll(/href="#([^"]+)"/g)].map((match) => match[1] ?? "");
	for (const link of links) assert.equal(html.split(`id="${link}"`).length - 1, 1, link);
	const positions = links.map((link) => html.indexOf(`id="${link}"`));
	assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "the rail follows page order");
	const viewAnchors = presentViews(report).map((id) => html.match(new RegExp(`id="view-${id}"[^>]*>\\s*<div class="view-head"><h[23](?: id="([^"]+)")?`))?.[1] ?? `view-${id}`);
	assert.deepEqual(links.filter((link) => viewAnchors.includes(link)), viewAnchors);
	assert.equal(links[0], "trace");
	assert.doesNotMatch(nav, /Comments|Comment|comments-title/);
	assert.match(html, /<nav class="views" aria-label="Contents">/);
	assert.match(nav, /<a class="sub"/);
	assert.match(nav, /aria-label="Anatomy"/);
	assert.match(html, /aria-current', 'location'/);
	assert.match(html, /\.views a\[aria-current\]::after/);
	assert.match(html, /\.views:hover \.toc-label/);
	assert.match(html, /@media\(max-width:50rem\)/);
	assert.match(html, /\.views li:has\(a\.sub\)\{display:none\}/);
	assert.match(html, /\.views a\.sub::after\{width:\.55rem/);
	assert.match(html, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
	assert.match(html, /\.sticky-table thead th,\.long-table thead th\{position:sticky/);
	assert.match(html, /wrap\.scrollHeight > window\.innerHeight \* 1\.5/);
	assert.match(html, /Scroll within this table for more rows/);
	assert.match(html, /requestAnimationFrame\(sizeTables\)/);
	const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
	let depth = 0;
	for (const char of css) {
		if (char === "{") depth++;
		if (char === "}") depth--;
		assert.ok(depth >= 0);
	}
	assert.equal(depth, 0);
});

test("pace has one course-wide cumulative chart and running totals in its table", () => {
	const first = shape.lessons[0]?.pace[0];
	const second = shape.lessons[0]?.pace[1];
	assert.ok(first && second);
	const totalReading = Math.round(first.readingSeconds + second.readingSeconds);
	const totalNarration = Math.round(first.narrationSeconds + second.narrationSeconds);
	assert.match(html, /data-mode="page"/);
	assert.match(html, /name="pace-view" value="cumulative"/);
	const cumulative = html.split('data-mode="cumulative"')[1]?.split('<div class="mode-table">')[0] ?? "";
	// One course-wide chart, plus an expanded copy per lesson for the lesson filter.
	const wholeCourse = cumulative.split('data-lesson="all">')[1]?.split('<div class="lesson-variant"')[0] ?? "";
	assert.equal((wholeCourse.match(/<svg /g) ?? []).length, 1);
	assert.match(cumulative, /class="lesson-variant" data-lesson="2" hidden/);
	assert.match(cumulative, /class="axis-label"[^>]*>minutes<\/text>/);
	assert.match(cumulative, /L2<\/text>/);
	const narrated = renderHtml({ ...report, anatomy: report.anatomy.map((lesson, lessonIndex) => ({ ...lesson, pace: lesson.pace.map((page, pageIndex) => ({
		...page,
		narrationSeconds: lessonIndex === 0 && pageIndex === 0 ? 60 : lessonIndex === 0 && pageIndex === 1 ? 30 : 0,
		estimatedNarrationSeconds: lessonIndex === 0 && pageIndex === 1 ? 30 : 0,
	})) })) });
	const narratedCumulative = narrated.split('data-mode="cumulative"')[1]?.split('<div class="mode-table">')[0] ?? "";
	assert.match(narratedCumulative, /class="cumulative-narration estimated"/);
	assert.match(narratedCumulative, /class="cumulative-narration"/);
	assert.match(cumulative, /Narration \(dashed where estimated from a script\)/);
	assert.doesNotMatch(cumulative, /Narration audio/);
	assert.match(html, /svg \.cumulative-narration\.estimated\{stroke-dasharray:4 3\}/);
	const perPage = html.split('data-mode="page"')[1]?.split('data-mode="cumulative"')[0] ?? "";
	assert.match(perPage, /<text class="page-label"[^>]*>L2<\/text>/);
	assert.match(html, /data-view="pace"/);
	assert.match(html, /data-view="anatomy"/);
	assert.match(html, /Cumulative<br>reading s/);
	assert.match(html, /Cumulative<br>narration s/);
	assert.match(html, new RegExp(`<td class="num" role="cell" data-label="Cumulative reading s">${totalReading}</td><td class="num" role="cell" data-label="Cumulative narration s">${totalNarration}</td></tr>`));
	const nextLesson = shape.lessons[1];
	assert.ok(nextLesson?.pace[0]);
	const paceTable = html.split('aria-label="Pace times by page"')[1] ?? "";
	const nextRow = paceTable.split(`data-page="2.${nextLesson.pace[0].number}"`)[1]?.split("</tr>")[0] ?? "";
	const courseReading = Math.round(shape.lessons[0]!.pace.reduce((sum, page) => sum + page.readingSeconds, nextLesson.pace[0].readingSeconds));
	const courseNarration = Math.round(shape.lessons[0]!.pace.reduce((sum, page) => sum + page.narrationSeconds, nextLesson.pace[0].narrationSeconds));
	assert.match(nextRow, new RegExp(`<td class="num" role="cell" data-label="Cumulative reading s">${courseReading}</td><td class="num" role="cell" data-label="Cumulative narration s">${courseNarration}</td>`));
});

test("anatomy summary stays in both modes and explore blocks are not activities", () => {
	const anatomyStart = html.indexOf('<div class="view" id="view-anatomy"');
	// The summary sits before both panels, so it shows in Chart and Table mode alike.
	const summary = html.indexOf('aria-label="Blocks, words and time by lesson"', anatomyStart);
	const chartAt = html.indexOf('<div class="mode-chart">', anatomyStart);
	assert.ok(summary > anatomyStart && summary < chartAt);
	assert.match(html.slice(anatomyStart, chartAt), /Blocks, words and time by lesson/);
	assert.match(html.slice(anatomyStart, chartAt), /<th scope="col" class="num" role="columnheader"><abbr class="defined" tabindex="0" title="Content the learner opens[^"]*">Explore<\/abbr><\/th>/);
	assert.match(html.slice(chartAt), /<text class="lane"[^>]*>Explore<title>/);
	const sample = parseCourse(JSON.stringify({
		ok: true, schema: "praxity-inspect/0", studioVersion: "0.2.0", course: { title: "Roles", locale: "en" },
		lessons: [{ file: "roles.prax", title: "Roles", sha256: "x", pages: [{ id: "p1", number: 1, title: "Roles", blocks: [
			{ id: "a", type: "accordion", line: 1, data: { items: [{ title: "Open", content: "Read" }] } },
			{ id: "b", type: "assessment", line: 2, data: { question: "What do you think?" } },
			{ id: "c", type: "assessment", line: 3, data: { question: "Choose", options: [{ text: "Yes", correct: true }] } },
		] }] }],
	}));
	const page = anatomy(sample).lessons[0];
	assert.deepEqual(page?.marks.map((mark) => [mark.role, mark.knowledgeCheck]), [["explore", undefined], ["response", false], ["response", true]]);
	assert.deepEqual([page?.pace[0]?.preview?.activities, page?.pace[0]?.preview?.checks], [1, 1]);
});

test("lesson headings remove a repeated lesson prefix", () => {
	assert.equal(lessonHeading(1, "Lesson 1: Reading the Gauge"), "L1 · Reading the Gauge");
	assert.equal(lessonHeading(2, "Reading the Gauge"), "L2 · Reading the Gauge");
});

test("anatomy draws one course-wide grid with activity and knowledge-check rows", () => {
	const chart = html.split('data-view="anatomy"')[1]?.split('<div class="mode-table">')[0] ?? "";
	assert.match(chart, /class="bg activity l\d"/);
	assert.match(chart, /class="bg check l\d"/);
	const wholeCourse = chart.split('data-lesson="all">')[1]?.split('<div class="lesson-variant"')[0] ?? "";
	assert.equal((wholeCourse.match(/<svg [^>]*role="img"/g) ?? []).length, 1);
	assert.doesNotMatch(chart, /<rect class="bg [^>]*tabindex=/);
});

test("a view renders its heading row, an icon switch and both representations", async () => {
	const { viewBlock } = await import("../src/modes.ts");
	const html = viewBlock({ id: "pace", level: 2, headingId: "pace", title: "Pace", question: "How long?", chart: "<svg></svg>", table: "<table></table>" });
	assert.match(html, /<h2 id="pace">Pace<\/h2><p class="view-question">How long\?<\/p>/);
	assert.match(html, /name="mode-pace" value="chart" aria-label="Chart" checked/);
	assert.match(html, /<div class="mode-chart"><svg><\/svg><\/div>/);
	assert.match(html, /<div class="mode-table"><table role="table"><\/table><\/div>/);
	assert.doesNotMatch(viewBlock({ id: "t", level: 3, title: "T", table: "<table></table>" }), /seg-mode/);
});

test("heading rows keep title, question and controls as direct siblings, with the guide before the data", async () => {
	const { parseFragment } = await import("parse5");
	const { viewBlock } = await import("../src/modes.ts");
	const markup = viewBlock({ id: "anatomy", level: 3, title: "A title long enough to wrap", question: "What is here?", chart: "<svg></svg>", table: "<table></table>", after: '<div class="rhythm"></div>' });
	const root = parseFragment(markup).childNodes[0]!;
	assert.ok("childNodes" in root);
	const head = root.childNodes.find((node) => "tagName" in node && node.tagName === "div");
	assert.ok(head && "childNodes" in head);
	const children = head.childNodes.filter((node) => "tagName" in node);
	assert.deepEqual(children.map((node) => node.tagName), ["h3", "p", "div"]);
	assert.equal(children[2]?.attrs.find(({ name }) => name === "class")?.value, "view-controls");
	assert.doesNotMatch(markup, /view-title/);
	assert.ok(markup.indexOf('class="method guide"') < markup.indexOf('class="mode-chart"'), "a view's guide opens with its introduction, before the data");
	assert.match(html, /\.report-content \.view-head\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
});

test("legend items keep symbol and label together", async () => {
	const { legend } = await import("../src/modes.ts");
	assert.equal(legend([["t-check", "Knowledge check"]]), '<p class="legend"><span class="legend-item"><span class="key t-check"></span>Knowledge check</span></p>');
});

test("an open question counts as an activity, not a knowledge check", async () => {
	const { isKnowledgeCheck } = await import("../src/anatomy.ts");
	const block = (data: Record<string, unknown>) => ({ id: "q", type: "assessment", line: 1, data });
	assert.equal(isKnowledgeCheck(block({ options: [{ text: "A", correct: true }, { text: "B" }] })), true);
	assert.equal(isKnowledgeCheck(block({ options: [{ text: "Agree" }, { text: "Disagree" }] })), false);
	assert.equal(isKnowledgeCheck(block({ placeholder: "Your reflection" })), false);
});

test("dark styles apply for the Dark choice, or System on a dark system, never for Light", async () => {
	const { THEME_STYLE, THEME_SWITCH, themeable } = await import("../src/theme.ts");
	assert.match(THEME_SWITCH, /role="radiogroup" aria-label="Theme"/);
	assert.match(THEME_SWITCH, /value="system" aria-label="Match the system theme" checked/);
	assert.match(THEME_STYLE, /:root\[data-theme=dark\]\{color-scheme:dark\}/);
	const css = themeable(".a{color:black}@media (prefers-color-scheme:dark){.a,.b svg{color:white}.c{fill:red}}.d{x:1}");
	assert.equal(css, ".a{color:black}@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .a,:root:not([data-theme=light]) .b svg{color:white}:root:not([data-theme=light]) .c{fill:red}}:root[data-theme=dark] .a,:root[data-theme=dark] .b svg{color:white}:root[data-theme=dark] .c{fill:red}.d{x:1}");
});

test("recommendations are tied to the report they were written from and link to its views", async () => {
	const { parseRecommendations, reportHash, PROMPT_VERSION } = await import("../src/recommendations.ts");
	assert.equal(PROMPT_VERSION, "recommendations/2");
	assert.equal(reportHash(JSON.parse(JSON.stringify(report))), reportHash(report));
	assert.equal(reportHash({ ...report, guides: { ...report.guides, pace: [] } }), reportHash(report), "editing a guide keeps answers valid");
	assert.notEqual(reportHash({ ...report, speakingWpm: report.speakingWpm + 1 }), reportHash(report));
	const item = (views: string[]) => ({ focus: "Look at pace", why: "Some pages run long.", views, refs: ["1.1.1"] });
	const answer = (hash: string, views = ["pace"]) => JSON.stringify({
		view: "recommendations", promptVersion: PROMPT_VERSION, courseHash: courseHash(course), reportHash: hash, model: "test",
		recommendations: [item(views), item(["anatomy"]), item(["trace"])],
	});
	assert.throws(() => parseRecommendations(answer("stale"), course, report), /different report/);
	// Alignment views are not in a report built without an alignment answer.
	assert.throws(() => parseRecommendations(answer(reportHash(report), ["evidence"]), course, report), /not a view in this report/);
	assert.throws(() => parseRecommendations(answer(reportHash(report), ["objectives"]), course, report), /not a view in this report/);
	for (const id of ["review", "longest"]) assert.throws(() => parseRecommendations(answer(reportHash(report), [id]), course, report), /not a view in this report/);
	const recommendations = parseRecommendations(answer(reportHash(report)), course, report);
	const page = renderHtml({ ...report, recommendations });
	assert.match(page, /<h2 id="recommendations">Recommendations<\/h2>/);
	assert.match(page, /<a href="#view-pace">Pace<\/a>/);
	assert.match(page, /href="#recommendations"/);
});

test("the section list names every view once, and the report draws exactly the views it says are present", async () => {
	const { SECTIONS, presentViews } = await import("../src/sections.ts");
	const { VIEW_IDS } = await import("../src/guides.ts");
	const listed = SECTIONS.flatMap((section) => section.views.map((view) => view.id));
	assert.deepEqual([...listed].sort(), [...VIEW_IDS].sort());
	assert.equal(new Set(listed).size, listed.length);
	const drawn = [...html.matchAll(/<div class="view" id="view-([a-z-]+)"/g)].map((match) => match[1]);
	assert.deepEqual(drawn, presentViews(report));
});

test("course trace rows name their lessons, so the lesson filter can hide them", () => {
	const trace = html.match(/<table class="blocks trace-table" role="table">[\s\S]*?<\/table>/)?.[0] ?? "";
	const traceRows = [...trace.matchAll(/<tr( [^>]*)?><th scope="row"[^>]*>/g)].map((match) => match[1] ?? "");
	assert.ok(traceRows.length > 3);
	for (const attributes of traceRows) assert.match(attributes, /data-lesson="[1-9]\d*"/);
});

test("every chart responds to the lesson filter: a per-lesson version or marks tagged with their lessons", () => {
	const views = html.split('<div class="view" id="view-').slice(1);
	let charts = 0;
	for (const view of views) {
		const id = view.slice(0, view.indexOf('"'));
		const chart = view.split('<div class="mode-chart">')[1]?.split('<div class="mode-table">')[0];
		if (!chart) continue;
		charts += 1;
		assert.match(chart, /class="lesson-variant"|data-page="\d+\.\d+"|data-lessons?="\d/, id);
	}
	assert.ok(charts >= 5);
});

test("emphasis colours do not share the segmented-control class, including either dark theme", () => {
	const synthetic = structuredClone(course);
	synthetic.lessons[0]!.pages[0]!.blocks.push({ id: "emphasis-test", type: "text", line: 1, data: { content: '<strong>Bold</strong> <em>Italic</em> <mark>Highlight</mark> <span class="praxity-doodle">Doodle</span>' } });
	const bars = renderEmphasis(emphasisView(synthetic)).match(/<table class="emphasis-bars"[\s\S]*?<\/table>/)?.[0] ?? "";
	assert.match(bars, /class="emphasis-segment k-/);
	assert.doesNotMatch(bars, /class="seg\b/);
	assert.match(html, /\.seg\{display:inline-flex;border:1px solid var\(--axis\)/);
	for (const [kind, light, dark] of [["strong", "52514e", "c3c2b7"], ["em", "4a3aa7", "9085e9"], ["mark", "008300", "0ca30c"], ["spanpraxitydoodle", "b0306a", "d55181"]]) {
		assert.ok(html.includes(`.k-${kind}{background:#${light}}`));
		assert.ok(html.includes(`:root[data-theme=dark] .k-${kind}{background:#${dark}}`));
		assert.ok(html.includes(`:root:not([data-theme=light]) .k-${kind}{background:#${dark}}`));
	}
});

test("shared table sizing fits content, preserves prose and mobile reflow, and styles report links", () => {
	assert.match(html, /:where\(\.viz-root\) table\{width:auto;max-width:100%/);
	assert.match(html, /:is\(\.objectives,\.objective-groups,\.evidence-table,\.terms,\.visuals\)\{width:100%\}/);
	assert.doesNotMatch(html, /thead th.num\{[^}]*width:1%/);
	assert.match(html, /\.table-wrap,\.scroll\{overflow-x:auto/);
	assert.match(html, /@media \(max-width:600px\)\{\ntable\[role=table\],table\[role=table\] :is\(thead,tbody,tfoot,tr,th,td\)\{display:block/);
	assert.match(html, /\.viz-root a\{color:inherit;text-decoration:none\}/);
	assert.match(html, /\.viz-root a:focus-visible\{outline:2px solid var\(--accent\)/);
});

test("every view's data rows and list items carry explicit lesson information", async () => {
	const { parse } = await import("parse5");
	const { alignmentView } = await import("../src/alignment-view.ts");
	const { conceptsView } = await import("../src/concepts-view.ts");
	const { termsView } = await import("../src/terms.ts");
	const { visualsView } = await import("../src/visuals.ts");
	const { spacingView } = await import("../src/spacing.ts");
	const { availabilityView } = await import("../src/availability.ts");
	const { locateBlocks } = await import("../src/places.ts");
	const { presentViews } = await import("../src/sections.ts");
	const refs = [1, 2, 3].map((lesson) => locateBlocks(course).find((block) => block.lessonNumber === lesson)!.ref);
	const alignment = alignmentView(course, {
		model: "synthetic", objectives: refs.map((ref, i) => ({ id: `O${i}`, text: `Explain idea ${i}`, ref, parent: null, fink: [] })),
		checks: [{ ref: refs[2]!, purpose: "knowledge", pre: false, objectives: ["O0"], support: [] }],
		overlaps: [{ objectives: ["O0", "O1"], note: "Same idea" }], interpretation: [],
	});
	const concepts = conceptsView(course, { model: "synthetic", concepts: refs.map((ref, i) => ({ id: `C${i}`, name: `Idea ${i}`, prerequisites: i ? ["C0"] : [], occurrences: [{ ref, role: "defined" }] })), interpretation: [] });
	const terms = termsView(course, { model: "synthetic", flags: refs.map((ref) => ({ ref, channel: "screen", kind: "term", span: "Idea", note: "Needs a definition", explainedAt: null })), interpretation: [] });
	const visuals = visualsView(course, { model: "synthetic", opportunities: [{ ref: refs[0]!, channel: "screen", span: "Step one then step two", structure: "sequence", elements: ["One", "Two"], form: "Diagram", note: "Keep the order" }], interpretation: [] }, shape.lessons);
	const allViews = { ...report, alignment, concepts, terms, visuals, spacing: spacingView(concepts, shape.lessons), availability: availabilityView(course, alignment, shape.lessons), distinctions: { model: "synthetic", pairs: [{ a: "One", b: "Two", why: "Similar words", stated: [refs[0]!], contrasted: [refs[2]!], checked: [] }], places: terms.places, interpretation: [] } };
	const seen = new Set<string>();
	let rows = 0;
	type Node = import("parse5").DefaultTreeAdapterMap["node"];
	function walk(node: Node, view = "", method = false, body = false) {
		const attrs = "attrs" in node ? Object.fromEntries(node.attrs.map(({ name, value }) => [name, value])) : {};
		const tag = "tagName" in node ? node.tagName : "";
		view = attrs["data-view"] ?? view;
		method ||= (attrs.class ?? "").split(" ").includes("method");
		body ||= tag === "tbody";
		if (view && !method && ((tag === "tr" && body) || tag === "li")) {
			rows++;
			seen.add(view);
			const lessons = attrs["data-lesson"] ?? attrs["data-lessons"];
			// Empty kind rows retain the matrix categories, even when no lesson has that kind.
			if (!(view === "terms" && lessons === "")) assert.match(lessons ?? "", /^[1-9]\d*(?: [1-9]\d*)*$/, `${view}: ${tag} lacks lessons`);
		}
		// Method lists explain course-wide counting rules and template exclusions, not lesson data.
		if ("childNodes" in node) for (const child of node.childNodes) walk(child, view, method, body);
	}
	walk(parse(renderHtml(allViews)));
	assert.ok(rows > 100);
	for (const id of presentViews(allViews)) assert.ok(seen.has(id), `${id} was not exercised`);
});

test("the shared lesson filter hides tagged lists and rows, matches any lesson, and resets", () => {
	// Exercise the actual inlined filter without a browser; these nodes expose only its DOM operations.
	const source = MODES_SCRIPT.slice(MODES_SCRIPT.indexOf("const tagged ="), MODES_SCRIPT.indexOf("const build ="));
	const apply = new Function(`${source}; return apply;`)();
	const rows = [{ lesson: "1" }, { lesson: "3" }, { lessons: "1 3" }, { lessons: "2 4" }].map((dataset) => ({ dataset, hidden: false, closest: () => null }));
	const scope = {
		querySelector: () => null,
		querySelectorAll: (selector: string) => {
			if (selector.startsWith("tbody tr")) {
				assert.match(selector, /li\[data-lesson\]/);
				assert.match(selector, /li\[data-lessons\]/);
				return rows;
			}
			return [];
		},
	};
	apply(scope, 3);
	assert.deepEqual(rows.map((row) => row.hidden), [true, false, false, true]);
	apply(scope, null);
	assert.deepEqual(rows.map((row) => row.hidden), [false, false, false, false]);
});
