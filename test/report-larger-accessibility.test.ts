import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { parseComments } from "../src/comments.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("larger report keeps visual tables decorative and disclosures reachable", { timeout: 60_000 }, async context => {
	if (!existsSync(chromium.executablePath())) {
		if (process.env.TRACE_SKIP_BROWSER === "1") { context.skip("Chromium executable missing; explicit TRACE_SKIP_BROWSER=1"); return; }
		assert.fail("Playwright Chromium is missing. Run pnpm exec playwright install chromium.");
	}
	const directory = await mkdtemp(join(tmpdir(), "trace-larger-accessibility-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const result = spawnSync(process.execPath, [join(root, "src/cli.ts"), "report", join(root, "test/fixtures/lantern-marsh/inspect.json"), "--out", directory], { cwd: root, encoding: "utf8", timeout: 30_000 });
	assert.equal(result.status, 0, `Report CLI failed: ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		await page.goto(pathToFileURL(join(directory, "report.html")).href);
		assert.deepEqual(errors, [], "Report client must initialise without errors");
		await context.test("hidden visual tables have no keyboard controls", async () => {
			const visual = page.locator(".emphasis-bars");
			assert.equal(await visual.count(), 1);
			assert.ok(await visual.locator("tbody tr").count() > 6, "Fixture must exercise the sort enhancement's row threshold");
			const hiddenTables = page.locator('table[aria-hidden="true"], [aria-hidden="true"] table');
			assert.ok(await hiddenTables.count(), "Fixture must contain a decorative table");
			assert.deepEqual(await hiddenTables.evaluateAll(tables => tables.flatMap(table => [...table.querySelectorAll("*")]
				.filter(element => element instanceof HTMLElement && element.tabIndex >= 0)
				.map(element => element.outerHTML))), [], "Assistive-hidden chart tables must not gain focusable descendants");
		});
		await context.test("accessible Emphasis table still sorts with the keyboard", async () => {
			await page.locator('input[name="mode-all"][value="table"]').check();
			const table = page.locator('#view-emphasis .mode-table table:has(> caption:text-is("Emphasised phrases by lesson"))');
			const head = table.locator("thead th").filter({ has: page.getByRole("button", { name: "Sort by Lesson", exact: true }) });
			const button = head.getByRole("button", { name: "Sort by Lesson", exact: true });
			const original = await table.locator("tbody tr").evaluateAll(rows => rows.map(row => ({
				text: row.textContent,
				lesson: Number((row as HTMLTableRowElement).cells[0]?.textContent?.trim().slice(1)),
			})));
			assert.ok(original.length > 6 && original.every(row => Number.isFinite(row.lesson)) && new Set(original.map(row => row.lesson)).size > 1);
			await button.focus();
			for (const [key, state, expected] of [
				["Enter", "ascending", [...original].sort((a, b) => a.lesson - b.lesson)],
				["Space", "descending", [...original].sort((a, b) => b.lesson - a.lesson)],
				["Enter", null, original],
			] as const) {
				await page.keyboard.press(key);
				assert.equal(await head.getAttribute("aria-sort"), state);
				assert.deepEqual(await table.locator("tbody tr").allTextContents(), expected.map(row => row.text));
				assert.equal(await button.evaluate(element => element === document.activeElement), true, "Sorting must retain keyboard focus");
			}
		});
		await context.test("disclosure targets meet 24 CSS px and reflow at 320 CSS px", async () => {
			const adjacent = page.locator('.sentence-structure tr[data-lesson="3"] td[colspan="7"] > .review-group > summary');
			assert.ok(await adjacent.count() >= 2, "Fixture must exercise adjacent construction disclosures");
			for (const width of [1440, 320]) {
				await page.setViewportSize({ width, height: 900 });
				for (const value of ["chart", "table"]) {
					await page.locator(`input[name="mode-all"][value="${value}"]`).check();
					const targets = await page.locator(".report-content summary").evaluateAll(elements => elements
						.filter(element => element.getClientRects().length)
						.map(element => ({ text: element.textContent, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
					assert.ok(targets.length, "Fixture must show disclosure controls");
					assert.deepEqual(targets.filter(target => target.width < 24 || target.height < 24), [], `${value} at ${width} CSS px: disclosure targets must be at least 24 by 24 CSS px`);
				}
				if (width === 320) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Disclosure sizing must preserve narrow report reflow");
			}
		});
		await context.test("the lesson filter hides rows and items from other lessons, then resets", async () => {
			await page.setViewportSize({ width: 1440, height: 900 });
			const menu = page.locator('.lesson-filter[data-filter-view="all"] > details');
			const pick = async (value: string) => {
				await menu.locator("summary").click();
				await menu.locator(`input[value="${value}"]`).check();
			};
			const rows = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".view :is(tbody tr, li)[data-lesson], .view :is(tbody tr, li)[data-lessons]")]
				.map(element => ({ lessons: (element.dataset.lessons ?? element.dataset.lesson ?? "").split(" ").filter(Boolean).map(Number), hidden: element.hidden }))
				.filter(row => row.lessons.length));
			await pick("3");
			const filtered = await rows();
			assert.ok(filtered.some(row => row.lessons.length > 1 && row.lessons.includes(3)), "Fixture must tag a row with several lessons");
			assert.ok(filtered.some(row => !row.lessons.includes(3)), "Fixture must have rows from other lessons");
			assert.deepEqual(filtered.filter(row => row.hidden === row.lessons.includes(3)), [], "Lesson 3 shows exactly the rows tagged with lesson 3");
			await pick("all");
			assert.deepEqual((await rows()).filter(row => row.hidden), [], "All lessons shows every row again");
		});
		await context.test("a sentence comment in a table row keeps its own page and source, and stored comments are validated on load", async () => {
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.locator('input[name="mode-all"][value="table"]').check();
			// A row that lists sentences from several pages: the comment must take the sentence's page, not the row's first.
			const target = await page.evaluate(() => {
				for (const row of document.querySelectorAll("tr")) {
					const first = row.querySelector<HTMLElement>("[data-page]")?.dataset.page;
					for (const item of row.querySelectorAll<HTMLElement>("li[id]")) {
						const pointer = item.querySelector<HTMLElement>("[data-page]");
						if (!pointer || pointer.dataset.page === first) continue;
						for (let parent = item.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
						if (!item.getClientRects().length) continue;
						item.scrollIntoView();
						return { id: item.id, title: pointer.getAttribute("title") ?? pointer.dataset.tip ?? "" };
					}
				}
				return null;
			});
			assert.ok(target, "Fixture must have a table row with sentences from more than one page");
			const quote = page.locator(`li[id="${target.id}"] q`);
			await quote.evaluate(element => {
				const range = document.createRange();
				range.selectNodeContents(element);
				getSelection()!.removeAllRanges();
				getSelection()!.addRange(range);
			});
			await quote.dispatchEvent("mouseup");
			await page.locator("#comments-selection").click();
			await page.locator("#comments-note").fill("Split this sentence.");
			await page.locator("#comments-save").click();
			const stored = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("praxity-trace-comments:")));
			assert.equal(stored.length, 1);
			const [comment] = parseComments(stored[0]![1]).comments;
			const [lesson, number] = target.id.split(".").map(Number);
			const source = /· (.+):(\d+)$/.exec(target.title);
			assert.ok(source, `Sentence pointer needs a file and line: ${target.title}`);
			assert.equal(comment?.target.sentence, target.id);
			assert.deepEqual(comment?.target.page, { lesson, page: number });
			assert.deepEqual(comment?.source, { file: source[1], line: Number(source[2]) });
			assert.ok(comment?.quote?.exact.trim(), "The selected words are the quote");
			await page.reload();
			assert.equal(await page.locator("#comments-open").getAttribute("aria-label"), "Comments, 1", "A saved comment reloads from storage");
			// Same course revision, one invalid field: the page must refuse it rather than load it.
			await page.evaluate(([key, value]) => {
				const file = JSON.parse(value!);
				file.comments[0].target.sentence = "3.9.t0";
				localStorage.setItem(key!, JSON.stringify(file));
			}, stored[0]!);
			await page.reload();
			assert.equal(await page.locator("#comments-status").textContent(), "Stored comments could not be read.");
			assert.equal(await page.locator("#comments-open").getAttribute("aria-label"), "Comments, 0");
			await page.evaluate(() => localStorage.clear());
		});
	} finally { await browser.close(); }
});
