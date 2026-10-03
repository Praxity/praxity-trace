import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";

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
	} finally { await browser.close(); }
});
