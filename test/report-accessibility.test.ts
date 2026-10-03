import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import type { Course } from "../src/inspect.ts";
import type { Located } from "../src/places.ts";

// The override runs this gate against an untouched worktree as well as the changed renderer.
const sourceRoot = resolve(process.env.TRACE_A11Y_SOURCE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const artifacts = process.env.TRACE_A11Y_ARTIFACTS;
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function cli(args: string[]): void {
	const result = spawnSync(process.execPath, [join(sourceRoot, "src/cli.ts"), ...args], { cwd: sourceRoot, encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
	assert.equal(result.status, 0, `Report fixture CLI failed: ${args.join(" ")}\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
}

async function reports(directory: string): Promise<Array<{ name: string; html: string }>> {
	const fixtures = join(sourceRoot, "test/fixtures");
	const result = [];
	for (const [name, input] of [
		["schema0", join(fixtures, "examples.inspect.json")],
		["projection2", join(fixtures, "examples.projection2.inspect.json")],
		["html-export", join(fixtures, "html/studio")],
	]) {
		const output = join(directory, name!);
		cli(["report", input!, "--out", output]);
		result.push({ name: name!, html: join(output, "report.html") });
	}
	// Read real fixture text through its owner. Every quote is accepted by the production parsers.
	const { parseCourse } = await import(pathToFileURL(join(sourceRoot, "src/inspect.ts")).href);
	const { locateBlocks } = await import(pathToFileURL(join(sourceRoot, "src/places.ts")).href);
	const { blockTexts } = await import(pathToFileURL(join(sourceRoot, "src/text.ts")).href);
	const input = join(fixtures, "examples.inspect.json");
	const course: Course = parseCourse(await readFile(input, "utf8"));
	const blocks: readonly Located[] = locateBlocks(course);
	const prose = blocks.map(item => ({ ...item, screen: blockTexts(item.block).screen as string })).filter(item => item.screen.trim().split(/\s+/).length >= 2);
	assert.ok(prose.length >= 3, "Synthetic model fixture needs three text blocks");
	const first = prose[0]!;
	const second = prose[1]!;
	const check = blocks.find(item => item.block.type === "assessment");
	assert.ok(check, "Synthetic model fixture needs a knowledge check");
	const interpretation = [{ text: "This synthetic reading cites the first page.", refs: [first.ref] }];
	const payloads: Record<string, Record<string, unknown>> = {
		alignment: {
			objectives: [first, second].map((item, i) => ({ id: `O${i + 1}`, text: item.screen, ref: item.ref, parent: null, fink: ["Foundational knowledge"] })),
			checks: [{ ref: check.ref, purpose: "knowledge", pre: false, objectives: ["O1"], support: [{ ref: first.ref, channel: "screen" }] }],
			overlaps: [{ objectives: ["O1", "O2"], note: "Synthetic overlapping objectives." }], interpretation,
		},
		concepts: {
			concepts: [
				{ id: "C1", name: "Synthetic first concept", prerequisites: [], occurrences: [{ ref: first.ref, role: "defined" }, { ref: second.ref, role: "example" }, { ref: check.ref, role: "checked" }] },
				{ id: "C2", name: "Synthetic second concept", prerequisites: ["C1"], occurrences: [{ ref: second.ref, role: "defined" }, { ref: prose[2]!.ref, role: "mentioned" }] },
			], interpretation,
		},
		terms: { flags: [{ ref: first.ref, channel: "screen", kind: "term", span: first.screen.split(/\s+/)[0], note: "Synthetic request for a definition.", explainedAt: second.ref }], interpretation },
		visuals: { opportunities: [{ ref: first.ref, channel: "screen", span: first.screen, structure: "sequence", elements: first.screen.split(/\s+/).slice(0, 2), form: "Diagram", note: "Synthetic sequence opportunity." }], interpretation },
		distinctions: { pairs: [{ a: "Synthetic first concept", b: "Synthetic second concept", why: "Synthetic similar terms.", stated: [first.ref], contrasted: [second.ref], checked: [check.ref] }], interpretation },
		tasks: { annotations: prose.slice(0, 3).map(item => ({ ref: item.ref, evidence: [{ ref: item.ref, channel: "screen", quote: item.screen }], taskTypes: ["assimilative"], explanation: "The learner reads the synthetic course text.", work: "inside", assessmentPurpose: "none" })) },
	};
	const answers: string[] = [];
	for (const [view, payload] of Object.entries(payloads)) {
		const bundle = join(directory, "answers", view);
		cli(["prepare", view, input, "--out", bundle]);
		const manifest = JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8"));
		const answer = join(bundle, "answer.json");
		await writeFile(answer, JSON.stringify({ ...manifest, model: "synthetic-accessibility-fixture", ...payload }));
		answers.push(`--${view}`, answer);
	}
	const output = join(directory, "all-model-views");
	cli(["report", input, "--out", output, ...answers]);
	const bundle = join(directory, "answers", "recommendations");
	cli(["prepare", "recommendations", input, "--report", join(output, "report.json"), "--out", bundle]);
	const manifest = JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8"));
	const recommendations = join(bundle, "answer.json");
	await writeFile(recommendations, JSON.stringify({ ...manifest, model: "synthetic-accessibility-fixture", recommendations: ["outcomes", "concepts", "tasks"].map(view => ({ focus: `Inspect synthetic ${view} evidence`, why: "The cited page supplies synthetic evidence for this view.", views: [view], refs: [first.ref] })) }));
	cli(["report", input, "--out", output, ...answers, "--recommendations", recommendations]);
	const built = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
	for (const view of [...Object.keys(payloads), "spacing", "availability", "recommendations"]) assert.ok(built[view], `Missing model fixture view ${view}`);
	result.push({ name: "all-model-views", html: join(output, "report.html") });
	return result;
}

async function open(page: Page, html: string): Promise<void> {
	await page.goto(pathToFileURL(html).href);
	await page.evaluate(() => { localStorage.clear(); });
	await page.reload();
	await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

async function mode(page: Page, value: "chart" | "table"): Promise<void> {
	await page.locator(`input[name="mode-all"][value="${value}"]`).check();
	assert.equal(await page.locator(`.seg-mode input[value="${value}"]:not(:checked)`).count(), 0, `Global ${value} control must update every view`);
}

async function axe(page: Page, label: string): Promise<void> {
	const results = await new AxeBuilder({ page }).withTags(tags).analyze();
	assert.deepEqual(results.violations.map(violation => ({
		rule: violation.id, impact: violation.impact, help: violation.help, helpUrl: violation.helpUrl,
		nodes: violation.nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary })),
	})), [], `${label}: whole-page axe violations`);
}

async function captions(page: Page): Promise<void> {
	const tables = await page.locator("table").evaluateAll(elements => elements.map((element, index) => ({
		index, view: element.closest(".view")?.getAttribute("data-view"),
		caption: element.querySelector(":scope > caption")?.textContent?.trim() ?? "",
	})));
	assert.ok(tables.length, "The fixture must exercise tables");
	assert.deepEqual(tables.filter(table => !table.caption), [], "Every table, including hidden chart variants and disclosure tables, needs a nonempty caption");
}

async function expandDisclosures(page: Page): Promise<void> {
	const summaries = page.locator("details:not(.menu) > summary");
	for (let index = 0; index < await summaries.count(); index++) {
		const summary = summaries.nth(index);
		if (!await summary.isVisible() || await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) continue;
		await summary.focus();
		await page.keyboard.press("Enter");
		assert.equal(await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open), true, "Keyboard opens all visible disclosure bodies for inspection");
	}
}

// The expectation starts with semantic controls, not tabindex >= 0. Removing a Tab stop must fail.
// Browser-native radio groups have one checked Tab stop; arrow checks below cover the other options.
async function tabOrder(page: Page): Promise<void> {
	await page.evaluate(() => {
		(document.activeElement as HTMLElement)?.blur();
		document.body.tabIndex = -1;
		document.body.focus();
		document.body.removeAttribute("tabindex");
		window.scrollTo(0, 0);
	});
	const capture = () => page.evaluate(() => {
		document.querySelectorAll<HTMLElement>("[data-trace-a11y]").forEach(element => delete element.dataset.traceA11y);
		const visible = (element: HTMLElement) => {
			if (element.closest("[hidden], [inert]") || element.matches(":disabled")) return false;
			for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
				const style = getComputedStyle(parent);
				if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
				if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(":scope > summary")?.contains(element)) return false;
			}
			return element.getClientRects().length > 0;
		};
		const all = [...document.querySelectorAll<HTMLElement>('a[href],button,input:not([type="hidden"]),select,textarea,summary,[tabindex],[contenteditable="true"]')].filter(visible);
		const selected = all.filter(element => !(element instanceof HTMLInputElement && element.type === "radio") || element.checked || !all.some(other => other instanceof HTMLInputElement && other.type === "radio" && other.name === element.name && other.checked));
		return selected.map((element, index) => {
			element.dataset.traceA11y = String(index);
			const style = getComputedStyle(element);
			const label = element.closest("label");
			const labelStyle = label ? getComputedStyle(label) : null;
			return { id: String(index), tabindex: element.getAttribute("tabindex"), description: element.outerHTML.slice(0, 300), outline: style.outline, shadow: style.boxShadow, labelOutline: labelStyle?.outline, labelShadow: labelStyle?.boxShadow };
		});
	});
	const expected = await capture();
	assert.ok(expected.length > 10, "Expected real report controls and disclosure summaries");
	assert.deepEqual(expected.filter(target => target.tabindex !== null && Number(target.tabindex) < 0), [], "Visible controls must participate in keyboard traversal, including scroll arrows");
	const reached = [];
	for (const target of expected) {
		// Focusing a far-right table cell can scroll its region and hide an edge arrow.
		// Apply the hidden-control exclusion at the time of traversal too; negative tabindex fails above.
		if (!await page.locator(`[data-trace-a11y="${target.id}"]`).isVisible()) continue;
		await page.keyboard.press("Tab");
		await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
		const active = await page.evaluate(() => ({ id: (document.activeElement as HTMLElement)?.dataset.traceA11y, html: document.activeElement?.outerHTML.slice(0, 300) }));
		reached.push(active.id);
		assert.equal(active.id, target.id, `Tab order skipped a control or trapped focus. Expected ${target.description}; reached ${active.html}`);
		await focusIndicator(page, target);
	}
	assert.equal(new Set(reached).size, reached.length, "Tab traversal must reach each visible control once");
	await page.keyboard.press("Tab");
	assert.equal(await page.evaluate(() => document.activeElement === document.body), true, "Tab must leave the report after its last control");
	// Reverse traversal also sees scroll arrows that appeared behind the forward Tab position.
	const reverse = await capture();
	assert.deepEqual(reverse.filter(target => target.tabindex !== null && Number(target.tabindex) < 0), [], "Newly visible controls must participate in keyboard traversal");
	for (const target of reverse.reverse()) {
		if (!await page.locator(`[data-trace-a11y="${target.id}"]`).isVisible()) continue;
		await page.keyboard.press("Shift+Tab");
		await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
		assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.traceA11y), target.id, `Shift+Tab must reach ${target.description}`);
		await focusIndicator(page, target);
	}
}

async function focusIndicator(page: Page, before: { outline: string; shadow: string; labelOutline?: string; labelShadow?: string; description: string }): Promise<void> {
	const result = await page.evaluate(previous => {
		const active = document.activeElement as HTMLElement;
		const parse = (value: string): number[] | null => {
			const match = value.match(/^rgba?\(([^)]+)\)$/);
			if (!match) return null;
			const numbers = match[1]!.split(/[,\s/]+/).map(Number);
			return numbers.length >= 3 ? [...numbers.slice(0, 3), numbers[3] ?? 1] : null;
		};
		const over = (top: number[], bottom: number[]) => top.slice(0, 3).map((value, i) => value * top[3]! + bottom[i]! * (1 - top[3]!)).concat(1);
		const background = (element: Element | null): number[] => {
			if (!element) return [255, 255, 255, 1];
			const color = parse(getComputedStyle(element).backgroundColor) ?? [0, 0, 0, 0];
			return color[3] === 1 ? color : over(color, background(element.parentElement));
		};
		const luminance = (color: number[]) => color.slice(0, 3).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i]!, 0);
		const contrast = (color: number[], adjacent: number[]) => { const a = luminance(over(color, adjacent)), b = luminance(adjacent); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
		const candidates = [{ element: active, outline: previous.outline, shadow: previous.shadow }];
		// Segmented inputs are transparent over their label. The label paints the actual focus ring.
		if (active instanceof HTMLInputElement && active.type === "radio" && active.closest("label")) candidates.push({ element: active.closest("label")!, outline: previous.labelOutline ?? "", shadow: previous.labelShadow ?? "" });
		return candidates.flatMap(({ element, outline, shadow }) => {
			const style = getComputedStyle(element), adjacent = background(element.parentElement);
			let opacity = 1;
			for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) opacity *= Number(getComputedStyle(ancestor).opacity);
			if (!opacity || !element.getClientRects().length) return [];
			const painted = (color: number[]) => [...color.slice(0, 3), color[3]! * opacity];
			const indicators = [];
			const color = parse(style.outlineColor);
			if (style.outline !== outline && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0 && color && color[3]! > 0) indicators.push({ kind: "outline", ratio: contrast(painted(color), parseFloat(style.outlineOffset) < 0 ? background(element) : adjacent), paintedBy: element.tagName, css: style.outline });
			if (style.boxShadow !== shadow && style.boxShadow !== "none") {
				for (const part of style.boxShadow.split(/,(?![^()]*\))/)) {
					const shadowColor = parse(part.match(/rgba?\([^)]+\)/)?.[0] ?? "");
					const dimensions = part.replace(/rgba?\([^)]+\)/, "").match(/-?\d+(?:\.\d+)?px/g)?.map(parseFloat) ?? [];
					if (shadowColor && shadowColor[3]! > 0 && dimensions.some(value => value !== 0)) indicators.push({ kind: "shadow", ratio: contrast(painted(shadowColor), part.includes("inset") ? background(element) : adjacent), paintedBy: element.tagName, css: part });
				}
			}
			return indicators;
		});
	}, before);
	assert.ok(result.some(indicator => indicator.ratio >= 3), `No visible focus outline/shadow with >=3:1 adjacent contrast for ${before.description}\n${JSON.stringify(result)}`);
}

async function focusStyle(control: Locator) {
	return control.evaluate(element => {
		const style = getComputedStyle(element);
		const label = element.closest("label");
		const labelStyle = label ? getComputedStyle(label) : null;
		return { description: element.outerHTML.slice(0, 300), outline: style.outline, shadow: style.boxShadow, labelOutline: labelStyle?.outline, labelShadow: labelStyle?.boxShadow };
	});
}

async function keyboard(page: Page): Promise<void> {
	const switches = page.locator(".view .seg-mode");
	assert.ok(await switches.count(), "Fixture needs view mode switches");
	for (let index = 0; index < await switches.count(); index++) {
		const group = switches.nth(index);
		const chart = group.locator('input[value="chart"]');
		await chart.focus();
		const table = group.locator('input[value="table"]');
		const beforeTable = await focusStyle(table);
		await page.keyboard.press("ArrowRight");
		assert.equal(await table.isChecked(), true, "ArrowRight must expose native radio checked state for Table");
		assert.match(await table.ariaSnapshot(), /radio "Table" \[checked\]/, "Table checked state must reach the accessibility tree");
		await focusIndicator(page, beforeTable);
		const view = group.locator("xpath=ancestor::div[contains(concat(' ',normalize-space(@class),' '),' view ')]");
		assert.equal(await view.locator(":scope > .mode-table").isVisible(), true, "Table radio must reveal its panel");
		assert.equal(await view.locator(":scope > .mode-chart").isVisible(), false, "Table radio must hide its chart");
		const beforeChart = await focusStyle(chart);
		await page.keyboard.press("ArrowLeft");
		assert.equal(await chart.isChecked(), true, "ArrowLeft must expose native radio checked state for Chart");
		assert.match(await chart.ariaSnapshot(), /radio "Chart" \[checked\]/, "Chart checked state must reach the accessibility tree");
		await focusIndicator(page, beforeChart);
		assert.equal(await view.locator(":scope > .mode-chart").isVisible(), true, "Chart radio must reveal its panel");
		assert.equal(await view.locator(":scope > .mode-table").isVisible(), false, "Chart radio must hide its table");
	}
	const disclosures = page.locator("details.method > summary");
	assert.ok(await disclosures.count(), "Fixture needs method and guide disclosures");
	assert.ok(await page.locator("details.method.guide > summary").count(), "Fixture needs reading guides");
	for (let index = 0; index < await disclosures.count(); index++) {
		const summary = disclosures.nth(index);
		await summary.focus();
		for (const key of ["Enter", "Space"]) {
			await page.keyboard.press(key);
			assert.equal(await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open), true, `${key} opens disclosure`);
			await page.keyboard.press(key);
			assert.equal(await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open), false, `${key} closes disclosure`);
		}
	}
	const menus = page.locator(".lesson-filter details > summary");
	assert.ok(await menus.count(), "Fixture needs a multi-lesson menu");
	for (let index = 0; index < await menus.count(); index++) {
		const summary = menus.nth(index);
		await summary.focus();
		await page.keyboard.press("Enter");
		assert.equal(await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open), true, "Enter opens lesson menu");
		await page.keyboard.press("Tab");
		assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement && document.activeElement.type === "radio"), true, "Tab reaches lesson options");
		const radios = summary.locator("xpath=..").locator('input[type="radio"]');
		const start = await radios.evaluateAll(elements => elements.findIndex(element => (element as HTMLInputElement).checked));
		const count = await radios.count();
		for (let option = 0; option < count; option++) {
			const selected = (start + option + 1) % count;
			await page.keyboard.press("ArrowRight");
			assert.equal(await radios.nth(selected).isChecked(), true, "ArrowRight reaches each lesson option");
			// Selection closes this native disclosure; reopen and Tab to the selected option.
			assert.equal(await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open), false, "Selecting a lesson closes its menu");
			await page.keyboard.press("Enter");
			const before = await focusStyle(radios.nth(selected));
			await page.keyboard.press("Tab");
			assert.equal(await radios.nth(selected).evaluate(element => element === document.activeElement), true, "Selected lesson is the radio group's single Tab stop");
			await focusIndicator(page, before);
		}
		await page.keyboard.press("Escape");
		assert.equal(await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open), false, "Escape closes lesson menu");
		assert.equal(await summary.evaluate(element => element === document.activeElement), true, "Escape returns focus to lesson menu trigger");
	}
	// Exercise each extra segmented choice as well, including theme and Pace, with native arrows.
	for (const name of await page.locator('.seg:not(.seg-mode) input:checked').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).name))) {
		const options = page.locator(`.seg input[name="${name}"]`);
		await page.locator(`.seg input[name="${name}"]:checked`).focus();
		const start = await options.evaluateAll(elements => elements.findIndex(element => (element as HTMLInputElement).checked));
		const seen = new Set<string>();
		for (let index = 0; index < await options.count(); index++) {
			const before = await focusStyle(options.nth((start + index + 1) % await options.count()));
			await page.keyboard.press("ArrowRight");
			const selected = page.locator(`.seg input[name="${name}"]:checked`);
			assert.equal(await selected.evaluate(element => element === document.activeElement), true, `${name} arrows move focus and checked state`);
			const value = await selected.inputValue();
			seen.add(value);
			await focusIndicator(page, before);
			if (name === "mode-all") {
				assert.equal(await page.locator(`.seg-mode input[value="${value}"]:not(:checked)`).count(), 0, "Global keyboard switch updates every view's checked state");
				for (let viewIndex = 0; viewIndex < await switches.count(); viewIndex++) {
					const view = switches.nth(viewIndex).locator("xpath=ancestor::div[contains(concat(' ',normalize-space(@class),' '),' view ')]");
					assert.equal(await view.locator(":scope > .mode-chart").isVisible(), value === "chart", "Global keyboard switch updates chart panels");
					assert.equal(await view.locator(":scope > .mode-table").isVisible(), value === "table", "Global keyboard switch updates table panels");
				}
			} else if (name === "theme") {
				assert.equal(await page.locator("html").getAttribute("data-theme"), value === "system" ? null : value, "Theme keyboard switch applies its chosen theme");
			} else if (name === "pace-view" || name === "availability-view") {
				const panels = page.locator(name === "pace-view" ? ".pace-mode" : ".avail-mode");
				assert.ok(await panels.count(), `${name} must have chart panels`);
				for (let panelIndex = 0; panelIndex < await panels.count(); panelIndex++) assert.equal(await panels.nth(panelIndex).isVisible(), await panels.nth(panelIndex).getAttribute("data-mode") === value, `${name} reveals only the chosen chart`);
			}
		}
		assert.equal(seen.size, await options.count(), `${name} arrows reach every choice`);
	}
}

async function scrollButtons(page: Page): Promise<void> {
	await page.setViewportSize({ width: 800, height: 900 });
	await mode(page, "chart");
	const right = page.locator(".scroll-arrow.right:visible").first();
	assert.ok(await right.count(), "A wider-than-region fixture must exercise scroll buttons");
	await right.locator("xpath=..").evaluate(element => { (element as HTMLElement).dataset.traceScrollFixture = "chosen"; });
	const frame = page.locator('[data-trace-scroll-fixture="chosen"]');
	const region = frame.locator(":scope > .scroll, :scope > .table-wrap");
	const handle = await region.elementHandle();
	assert.ok(handle);
	const dimensions = await region.evaluate(element => ({ width: element.clientWidth, maximum: element.scrollWidth - element.clientWidth }));
	assert.ok(dimensions.maximum > 2, "Scroll fixture must overflow its own region");
	const limit = Math.ceil(dimensions.maximum / (dimensions.width * .8)) + 3;
	for (const [side, key] of [["right", "Enter"], ["left", "Space"]] as const) {
		const arrow = frame.locator(`:scope > .scroll-arrow.${side}`);
		await arrow.focus();
		for (let attempt = 0; attempt < limit && await arrow.isVisible(); attempt++) {
			const before = await region.evaluate(element => element.scrollLeft);
			await page.keyboard.press(key);
			await page.waitForFunction(({ element, before, side }) => side === "right" ? element.scrollLeft > before : element.scrollLeft < before, { element: handle, before, side });
			await region.evaluate(async element => {
				let previous = element.scrollLeft, stable = 0;
				for (let tick = 0; tick < 120 && stable < 3; tick++) {
					await new Promise<void>(done => requestAnimationFrame(() => done()));
					stable = element.scrollLeft === previous ? stable + 1 : 0;
					previous = element.scrollLeft;
				}
			});
			assert.equal(await frame.evaluate(element => element.contains(document.activeElement)), true, "Keyboard scrolling must keep focus in the region or its buttons");
		}
		assert.equal(await arrow.isVisible(), false, `${key} scrolling reaches the ${side} endpoint`);
		assert.equal(await region.evaluate(element => document.activeElement === element), true, "When an endpoint hides the focused arrow, focus returns to its scroll region");
	}
	await handle.dispose();
}

async function reflow(page: Page): Promise<void> {
	await page.setViewportSize({ width: 320, height: 900 });
	await mode(page, "table");
	await expandDisclosures(page);
	await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
	const failures = await page.evaluate(() => {
		const failures: string[] = [];
		if (document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1) failures.push(`Page width ${document.documentElement.scrollWidth}/${document.body.scrollWidth} exceeds ${window.innerWidth}`);
		for (const table of document.querySelectorAll<HTMLTableElement>("table")) {
			if (!table.checkVisibility()) continue;
			const label = table.caption?.textContent?.trim() || table.getAttribute("aria-label") || table.closest(".view")?.getAttribute("data-view") || "unnamed table";
			const bounds = table.getBoundingClientRect();
			if (table.scrollWidth > table.clientWidth + 1 || bounds.width > window.innerWidth + 1) failures.push(`${label}: table needs horizontal scrolling (${table.scrollWidth}/${table.clientWidth}, bounds ${bounds.width})`);
			for (let region = table.parentElement; region && region !== document.body; region = region.parentElement) {
				if (region.scrollWidth > region.clientWidth + 1 && ["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(region).overflowX)) failures.push(`${label}: ancestor ${region.className} overflows horizontally (${region.scrollWidth}/${region.clientWidth})`);
			}
		}
		return failures;
	});
	assert.deepEqual(failures, [], "Table mode must reflow without page or table-region horizontal scrolling at 320 CSS px");
	await axe(page, "320 CSS px Table mode");
}

async function tableSemantics(page: Page): Promise<void> {
	await mode(page, "table");
	await expandDisclosures(page);
	const tables = page.locator("table:visible");
	assert.ok(await tables.count(), "Fixture must expose readable tables");
	const snapshots: string[] = [];
	for (let index = 0; index < await tables.count(); index++) {
		const table = tables.nth(index);
		const snapshot = await table.ariaSnapshot();
		const counts = await table.evaluate(element => ({
			groups: element.querySelectorAll(":scope > thead, :scope > tbody, :scope > tfoot").length,
			rows: element.querySelectorAll("tr").length,
			columns: element.querySelectorAll('thead th, th[scope="col"], th[scope="colgroup"]').length,
			rowHeaders: element.querySelectorAll('tbody th[scope="row"], tbody th[scope="rowgroup"]').length,
			cells: element.querySelectorAll("td").length,
		}));
		assert.match(snapshot, /^- ['"]?table(?: |:|$)/, "A visible table must retain its table role");
		for (const [role, count] of Object.entries({ rowgroup: counts.groups, row: counts.rows, columnheader: counts.columns, rowheader: counts.rowHeaders, cell: counts.cells })) {
			assert.equal(snapshot.match(new RegExp(`^\\s*- ['"]?${role}(?: |:|$)`, "gm"))?.length ?? 0, count, `Every ${role} must remain in the table accessibility tree\n${snapshot}`);
		}
		snapshots.push(snapshot);
	}
	await page.setViewportSize({ width: 320, height: 900 });
	assert.equal(await tables.count(), snapshots.length, "Narrow Table mode must retain every visible table");
	const labels = await page.locator("table:visible tbody :is(td,th)[data-label]").evaluateAll(cells => cells.map(cell => ({
		label: cell.getAttribute("data-label"),
		rendered: getComputedStyle(cell, "::before").content,
		visible: cell.checkVisibility(),
		value: cell.textContent,
	})));
	assert.ok(labels.length, "Narrow Table mode must expose labelled body cells");
	assert.deepEqual(labels.filter(cell => !cell.visible || cell.rendered !== `${JSON.stringify(`${cell.label}: `)} / ""`), [], "Every labelled body cell, including an empty cell, must paint its column label with empty alternative text");
	for (let index = 0; index < snapshots.length; index++) {
		assert.equal(await tables.nth(index).ariaSnapshot(), snapshots[index], "Stacked cells must retain table semantics, values and names without announcing visual labels twice");
	}
}

async function sortKeyboard(page: Page): Promise<void> {
	await page.setViewportSize({ width: 320, height: 900 });
	await mode(page, "table");
	await expandDisclosures(page);
	const tables = page.locator("table:visible");
	let numericSorts = 0;
	let exercisedSorts = 0;
	let sortButtons = 0;
	for (let index = 0; index < await tables.count(); index++) {
		const table = tables.nth(index);
		const grouped = await table.evaluate(element => !!element.querySelector('tbody [rowspan], tbody [colspan], tbody tr.group-start') || (element as HTMLTableElement).tHead?.rows.length !== 1);
		if (grouped) {
			assert.equal(await table.locator(".sort").count(), 0, "Grouped tables must retain their authored row order without sort controls");
			continue;
		}
		const buttons = table.locator("thead button.sort");
		sortButtons += await buttons.count();
		if (await table.locator("tbody tr").count() > 6) {
			const labelledHeads = await table.locator("thead th").evaluateAll(elements => elements.filter(element => {
				const copy = element.cloneNode(true) as Element;
				copy.querySelectorAll("button.sort").forEach(button => button.remove());
				return copy.textContent?.trim();
			}).length);
			assert.equal(await buttons.count(), labelledHeads, "Each labelled column in a sortable table must offer its sort button");
		}
		for (let buttonIndex = 0; buttonIndex < await buttons.count(); buttonIndex++) {
			const button = buttons.nth(buttonIndex);
			assert.equal(await button.isVisible(), true, "Every sort header button must remain visible at 320 CSS px");
			assert.match(await button.ariaSnapshot(), /^- button "Sort by .+"/, "Sort button must keep a meaningful accessible name");
		}
		const heads = table.locator("thead tr > th");
		const candidates = [];
		for (let column = 0; column < await heads.count(); column++) {
			const button = heads.nth(column).locator("button.sort");
			if (!await button.count()) continue;
			const original = await table.locator("tbody tr").evaluateAll((rows, column) => rows.map(row => ({
				text: row.textContent,
				value: (row as HTMLTableRowElement).cells[column]?.textContent?.trim() ?? "",
			})), column);
			if (!original.every(row => row.value) || new Set(original.map(row => row.value)).size < 2) continue;
			candidates.push({ column, original, numeric: original.every(row => /^\d+(?:,\d{3})*(?:\.\d+)?$/.test(row.value)) });
		}
		// Prefer numeric columns for an independent ordering expectation, including repeated values.
		const chosen = candidates.find(candidate => candidate.numeric) ?? candidates[0];
		if (chosen) {
			const { column, original, numeric } = chosen;
			const button = heads.nth(column).locator("button.sort");
			const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
			const compare = (a: { value: string }, b: { value: string }) => numeric ? Number(a.value.replaceAll(",", "")) - Number(b.value.replaceAll(",", "")) : collator.compare(a.value, b.value);
			const ascending = [...original].sort(compare);
			const descending = [...original].sort((a, b) => compare(b, a));
			await button.focus();
			for (const [key, state, expected] of [["Enter", "ascending", ascending], ["Space", "descending", descending], ["Enter", null, original]] as const) {
				await page.keyboard.press(key);
				assert.equal(await heads.nth(column).getAttribute("aria-sort"), state, `${key} updates the sorted column's ARIA state`);
				assert.equal(await table.locator("thead [aria-sort]").count(), state ? 1 : 0, "Only the current sort column may announce a sort direction");
				assert.deepEqual(await table.locator("tbody tr").allTextContents(), expected.map(row => row.text), `${key} must reorder the actual rows ${state ?? "back to course order"}`);
				assert.equal(await button.evaluate(element => element === document.activeElement), true, "Sorting must retain keyboard focus on its button");
			}
			if (numeric) numericSorts++;
			exercisedSorts++;
		}
	}
	if (sortButtons) assert.ok(exercisedSorts, "A fixture with sort controls must exercise actual sorting and course-order reset");
	if (await page.locator('table:has(> caption:text-is("Course trace by page")) tbody tr').count() > 6) assert.ok(numericSorts, "A large report must exercise numeric ordering as well as course-order reset");
	// This traverses the real keyboard order and checks every visible control's focus contrast.
	await tabOrder(page);
}

async function serverLabels(browser: Browser, html: string): Promise<void> {
	const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
	try {
		const page = await context.newPage();
		await page.goto(pathToFileURL(html).href);
		assert.equal(await page.locator("button.sort").count(), 0, "No-JavaScript fixture must not run the client sort enhancement");
		const tables = page.locator('table:has(> caption:text-is("Every block")), table:has(> caption:text-is("Pace times by page"))');
		assert.ok(await tables.count(), "Fixture must include server-rendered block and Pace tables");
		for (let index = 0; index < await tables.count(); index++) {
			const table = tables.nth(index);
			const labels = await table.evaluate(element => {
				const text = (element: Element) => {
					const copy = element.cloneNode(true) as Element;
					copy.querySelectorAll("br").forEach(br => br.replaceWith(" "));
					return copy.textContent?.replace(/\s+/g, " ").trim() ?? "";
				};
				const heads = [...element.querySelectorAll("thead th")].map(text);
				return [...element.querySelectorAll("tbody tr")].flatMap(row => [...(row as HTMLTableRowElement).cells].map((cell, column) => ({ expected: heads[column], actual: cell.getAttribute("data-label"), rendered: getComputedStyle(cell, "::before").content })));
			});
			assert.ok(labels.length, "Server label fixture needs body cells");
			assert.deepEqual(labels.filter(label => label.actual !== label.expected), [], "Every body cell must carry its server-rendered column label before client scripts run");
			assert.deepEqual(labels.filter(label => label.rendered !== `${JSON.stringify(`${label.expected}: `)} / ""`), [], "Stacked column labels must be painted without JavaScript and have empty alternative text");
			assert.equal(await table.isVisible(), true, "Narrow screens must expose Table mode without JavaScript");
			assert.match(await table.ariaSnapshot(), /^- ['"]?table /, "No-JavaScript reflow must preserve table semantics");
		}
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "Server-rendered narrow report must fit without JavaScript");
	} finally { await context.close(); }
}

// verify runs these journeys alongside CLI and package tests; allow for that contention.
test("generated reports meet browser accessibility requirements", { timeout: 360_000 }, async context => {
	if (!existsSync(chromium.executablePath())) {
		if (process.env.TRACE_SKIP_BROWSER === "1") { context.skip("Chromium executable missing; explicit TRACE_SKIP_BROWSER=1"); return; }
		assert.fail("Playwright Chromium is missing. Run pnpm exec playwright install chromium (CI: pnpm exec playwright install --with-deps chromium). Local opt-out only: TRACE_SKIP_BROWSER=1.");
	}
	const directory = await mkdtemp(join(tmpdir(), "trace-accessibility-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const browser = await chromium.launch({ headless: true });
	try {
		for (const report of await reports(directory)) {
			await context.test(report.name, async fixture => {
				const browserContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
				const page = await browserContext.newPage();
				const checks: Array<[string, () => Promise<void>]> = [
					["captions, including hidden tables", () => captions(page)],
					["Chart whole-page axe", async () => { await mode(page, "chart"); await axe(page, "Chart"); }],
					["Table whole-page axe", async () => { await mode(page, "table"); await axe(page, "Table"); }],
					["expanded Table whole-page axe", async () => { await mode(page, "table"); await expandDisclosures(page); await axe(page, "Expanded Table"); }],
					["Chart Tab order and focus contrast", async () => { await mode(page, "chart"); await tabOrder(page); }],
					["Table Tab order and focus contrast", async () => { await mode(page, "table"); await tabOrder(page); }],
					["expanded Table Tab order and focus contrast", async () => { await mode(page, "table"); await expandDisclosures(page); await tabOrder(page); }],
					["keyboard switches, disclosures and lesson menus", () => keyboard(page)],
					["keyboard scroll buttons and endpoint focus", () => scrollButtons(page)],
					["Table reflow at 320 CSS px", () => reflow(page)],
					["stacked Table accessibility semantics at 320 CSS px", () => tableSemantics(page)],
					["sort buttons, Tab traversal and row ordering at 320 CSS px", () => sortKeyboard(page)],
					["server-rendered labels without JavaScript at 320 CSS px", () => serverLabels(browser, report.html)],
				];
				try {
					for (const [name, check] of checks) await fixture.test(name, async () => {
						await page.setViewportSize({ width: 1440, height: 900 });
						await open(page, report.html);
						try { await check(); } catch (error) {
							if (artifacts) {
								await mkdir(artifacts, { recursive: true });
								const stem = join(artifacts, `${report.name}-${name.replace(/[^a-z0-9]+/gi, "-")}`);
								await writeFile(`${stem}.txt`, String(error instanceof Error ? error.stack : error));
								await page.screenshot({ path: `${stem}.png`, fullPage: true });
							}
							throw error;
						}
					});
				} finally { await browserContext.close(); }
			});
		}
	} finally { await browser.close(); }
});
