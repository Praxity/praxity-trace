import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { inlineClient } from "./client.ts";
import { icon, type IconName } from "./icons.ts";
import { GUIDES, isViewId, type Reading } from "./guides.ts";
import { esc } from "./places.ts";
import type { Feedback } from "./text.ts";

export function absence(partial: boolean | undefined, complete: string, subject: string, format: "html" | "svg" | "text" = "html"): string {
	if (!partial) return format === "text" ? complete : esc(complete);
	const text = `${subject} not found in the inspected content`;
	if (format === "text") return `${text} (see coverage note)`;
	if (format === "svg") return `${esc(text)} · <tspan>coverage note</tspan>`;
	return `${esc(text)} · <a href="#coverage">coverage note</a>`;
}

export function renderFeedback(feedback: Feedback): string {
	if (feedback.status === "not-supplied") return "Feedback not supplied by the input";
	return feedback.items.map(item => `<div>${item.text ? esc(item.text) : "Empty feedback"}<span class="file">${esc(item.source)}</span></div>`).join("");
}

type Tag = DefaultTreeAdapterTypes.Element;
type Tree = DefaultTreeAdapterTypes.Node;

const isElement = (node: Tree): node is Tag => "tagName" in node;
const attribute = (element: Tag, name: string) => element.attrs.find((attr) => attr.name === name)?.value;
const span = (element: Tag, name: "rowspan" | "colspan") => Math.max(1, Number.parseInt(attribute(element, name) ?? "1", 10) || 1);
const textOf = (node: Tree): string =>
	"value" in node && node.nodeName === "#text" ? node.value : isElement(node) && node.tagName === "br" ? " " : "childNodes" in node ? node.childNodes.map(textOf).join("") : "";

function grid(rows: Tag[]): Array<Array<{ cell: Tag; column: number; columns: number }>> {
	const held: number[] = [];
	return rows.map((row) => {
		let column = 0;
		const cells = row.childNodes.filter(isElement).filter((cell) => cell.tagName === "th" || cell.tagName === "td").map((cell) => {
			while ((held[column] ?? 0) > 0) column++;
			const columns = span(cell, "colspan");
			for (let offset = 0; offset < columns; offset++) held[column + offset] = span(cell, "rowspan");
			const placed = { cell, column, columns };
			column += columns;
			return placed;
		});
		held.forEach((rows, index) => { held[index] = Math.max(0, rows - 1); });
		return cells;
	});
}

export function reflowTables(html: string): string {
	if (!html.includes("<table")) return html;
	const inserts: Array<[number, string]> = [];
	const mark = (element: Tag, attrs: string) => {
		for (const name of ["role", "data-label"]) {
			if (attribute(element, name) !== undefined) throw new Error(`reflowTables owns ${name} on table markup; found it on <${element.tagName}>`);
		}
		const end = element.sourceCodeLocation?.startTag?.endOffset;
		if (end === undefined || html[end - 1] !== ">") throw new Error(`Table markup needs an explicit <${element.tagName}> start tag`);
		inserts.push([end - 1, ` ${attrs}`]);
	};
	const sections = (table: Tag) => table.childNodes.filter(isElement).filter((child) => ["thead", "tbody", "tfoot"].includes(child.tagName));
	const rows = (section: Tag) => section.childNodes.filter(isElement).filter((child) => child.tagName === "tr");
	const table = (element: Tag) => {
		mark(element, `role="table"`);
		const headers: Tag[][] = [];
		for (const section of sections(element)) {
			mark(section, `role="rowgroup"`);
			const head = section.tagName === "thead";
			const placed = grid(rows(section));
			rows(section).forEach((row, index) => {
				mark(row, `role="row"`);
				for (const { cell, column, columns } of placed[index] ?? []) {
					if (head) {
						for (let offset = 0; offset < columns; offset++) (headers[column + offset] ??= []).push(cell);
						mark(cell, `role="${cell.tagName === "th" ? "columnheader" : "cell"}"`);
						continue;
					}
					const over = Array.from({ length: columns }, (_, offset) => headers[column + offset] ?? []);
					const shared = (over[0] ?? []).filter((header, depth) => over.every((path) => path[depth] === header));
					const label = shared.map((header) => textOf(header).replace(/\s+/g, " ").trim()).filter(Boolean).join(" · ");
					mark(cell, `role="${cell.tagName === "th" ? "rowheader" : "cell"}"${label ? ` data-label="${esc(label)}"` : ""}`);
				}
			});
		}
	};
	const walk = (node: Tree, hidden: boolean) => {
		if (!isElement(node) && !("childNodes" in node)) return;
		const quiet = hidden || (isElement(node) && attribute(node, "aria-hidden") === "true");
		if (isElement(node) && node.tagName === "table" && !quiet) table(node);
		if ("childNodes" in node) node.childNodes.forEach((child) => walk(child, quiet));
	};
	walk(parseFragment(html, { sourceCodeLocationInfo: true }), false);
	let out = "";
	let from = 0;
	for (const [offset, text] of inserts.sort((a, b) => a[0] - b[0])) {
		out += html.slice(from, offset) + text;
		from = offset;
	}
	return out + html.slice(from);
}

export interface SegmentOption {
	value: string;
	label: string;
	icon: IconName;
	checked?: boolean;
}

export function segmented(name: string, label: string, options: SegmentOption[], className = ""): string {
	return `<div class="seg ${className}" role="radiogroup" aria-label="${esc(label)}">${options
		.map(
			(option) =>
				`<label class="seg-option" title="${esc(option.label)}"><input type="radio" name="${esc(name)}" value="${esc(option.value)}" aria-label="${esc(option.label)}"${option.checked ? " checked" : ""}>${icon(option.icon)}</label>`,
		)
		.join("")}</div>`;
}

export interface ViewOptions {
	readings?: Reading[];
	id: string;
	level: 2 | 3;
	title: string;
	headingId?: string;
	question?: string;
	controls?: string;
	lead?: string;
	after?: string;
	chart?: string;
	table: string;
}

export interface OutlineEntry {
	title: string;
	level: 2 | 3;
	anchor: string;
	view?: string;
}

let drawn: OutlineEntry[] | null = null;

export function outline(draw: () => string): { html: string; entries: OutlineEntry[] } {
	const outer = drawn;
	drawn = [];
	try {
		const html = draw();
		return { html, entries: drawn };
	} finally {
		drawn = outer;
	}
}

export function viewBlock(options: ViewOptions): string {
	const { id, level, title, headingId, question, controls = "", chart } = options;
	const [lead, table, after] = [options.lead ?? "", options.table, options.after ?? ""].map(reflowTables);
	drawn?.push({ title, level, anchor: headingId ?? `view-${id}`, view: id });
	const heading = `<h${level}${headingId ? ` id="${esc(headingId)}"` : ""}>${esc(title)}</h${level}>`;
	return `<div class="view" id="view-${esc(id)}" data-view="${esc(id)}">
<div class="view-head">${heading}${question ? `<p class="view-question">${esc(question)}</p>` : ""}<div class="view-controls">${controls}${chart === undefined ? "" : segmented(`mode-${id}`, `${title}: show as`, [
		{ value: "chart", label: "Chart", icon: "chart-bar", checked: true },
		{ value: "table", label: "Table", icon: "table" },
	], "seg-mode")}<div class="lesson-filter" data-filter-view="${esc(id)}"></div></div></div>
${lead}${guide(id, options.readings)}${chart === undefined ? `<div class="mode-table only">${table}</div>` : `<p class="mode-narrow-note">Charts need a wider screen; this is the table.</p>
<div class="mode-chart">${chart}</div>
<div class="mode-table">${table}</div>`}${after}
</div>`;
}

function guide(id: string, readings: Reading[] = isViewId(id) ? GUIDES[id] : []): string {
	return readings.length
		? `<details class="method guide"><summary>What to look for</summary><dl class="readings">${readings.map((reading) => `<div${reading.mode ? ` data-guide-mode="${reading.mode}"` : ""}${reading.paceMode ? ` data-guide-pace="${reading.paceMode}"` : ""}><dt>${esc(reading.see)}</dt><dd>${esc(reading.could)}</dd></div>`).join("")}</dl></details>`
		: "";
}

export function lessonVariants(lessons: number[], render: (lesson: number | null) => string): string {
	return `<div class="lesson-variant" data-lesson="all">${render(null)}</div>${lessons.map((lesson) => `<div class="lesson-variant" data-lesson="${lesson}" hidden>${render(lesson)}</div>`).join("")}`;
}

export function legend(items: Array<[string, string]>, extra = ""): string {
	return `<p class="legend">${items.map(([key, label]) => `<span class="legend-item"><span class="key ${esc(key)}"></span>${label}</span>`).join("")}${extra}</p>`;
}

export const MODES_ALL = segmented("mode-all", "Show every view as", [
	{ value: "chart", label: "Show every view as a chart", icon: "chart-bar", checked: true },
	{ value: "table", label: "Show every view as a table", icon: "table" },
]);

export const FILTER_ALL = `<div class="lesson-filter" data-filter-view="all"></div>`;

export function modesClient(filterIcon: string) {
  const all = (value: string) => document.querySelectorAll<HTMLInputElement>('.view .seg-mode input[value="' + value + '"]').forEach((input) => { input.checked = true; });
  const saved = (() => { try { return localStorage.getItem('trace-mode'); } catch { return null; } })();
  if (saved === 'table') { all('table'); const global = document.querySelector<HTMLInputElement>('input[name="mode-all"][value="table"]'); if (global) global.checked = true; }
  document.querySelectorAll<HTMLInputElement>('input[name="mode-all"]').forEach((input) => input.addEventListener('change', () => {
    all(input.value);
    try { localStorage.setItem('trace-mode', input.value); } catch {}
  }));

  const meta = JSON.parse(document.getElementById('report-meta')?.textContent || '{"lessons":[]}');
  const lessons: Array<{ number: number; title: string }> = meta.lessons || [];
  if (lessons.length < 2) return;
  const tagged = (element: HTMLElement | SVGElement): number[] => {
    if (element.dataset.lessons) return element.dataset.lessons.split(' ').map(Number);
    if (element.dataset.lesson) return [Number(element.dataset.lesson)];
    if (element.dataset.page) return [Number(element.dataset.page.split('.')[0])];
    return [];
  };
  const lessonsOf = (element: HTMLElement): number[] => {
    const own = tagged(element);
    if (own.length) return own;
    const page = element.querySelector<HTMLElement>('[data-page]')?.dataset.page;
    if (page) return [Number(page.split('.')[0])];
    const first = element.querySelector('th,td');
    const match = first && /^(?:L(\d+)\b|(\d+)\.\d+\b)/.exec(first.textContent.trim());
    return match ? [Number(match[1] ?? match[2])] : [];
  };
  const apply = (scope: Element | null, lesson: number | null) => {
    if (!scope) return;
    scope.querySelectorAll<HTMLElement>('tbody tr, li[data-lesson], li[data-lessons], .review-lesson[data-lesson]').forEach((row) => {
      const own = row.closest('.mode-chart') ? tagged(row) : lessonsOf(row);
      row.hidden = lesson !== null && own.length > 0 && !own.includes(lesson);
    });
    scope.querySelectorAll<HTMLElement>('.lesson-variant').forEach((variant) => {
      variant.hidden = variant.dataset.lesson !== (lesson === null ? 'all' : String(lesson));
    });
    scope.querySelectorAll<HTMLElement | SVGElement>('.mode-chart :is([data-page],[data-lesson],[data-lessons]):not(tr)').forEach((mark) => {
      if (mark.closest('.lesson-variant, th')) return;
      mark.classList.toggle('filtered-out', lesson !== null && !tagged(mark).includes(lesson));
    });
    const button = scope.querySelector(':scope > .view-head .lesson-filter summary');
    if (button) button.classList.toggle('active', lesson !== null);
  };
  const build = (holder: HTMLElement) => {
    const id = holder.dataset.filterView;
    const name = 'lesson-' + id;
    const menu = document.createElement('details');
    menu.className = 'menu';
    const option = (value: string | number, label: string, title = '') => '<label' + (title ? ' title="' + title.replace(/"/g, '&quot;') + '"' : '') + '><input type="radio" name="' + name + '" value="' + value + '"' + (value === 'all' ? ' checked' : '') + '> ' + label + '</label>';
    menu.innerHTML = '<summary class="icon-button" aria-label="Show lessons" title="Show lessons">' + filterIcon + '</summary>' +
      '<fieldset class="menu-panel"><legend>Show</legend>' + option('all', 'All lessons') +
      lessons.map((lesson) => option(lesson.number, 'L' + lesson.number + ' <span class="menu-note">' + lesson.title.replace(/</g, '&lt;') + '</span>')).join('') + '</fieldset>';
    holder.append(menu);
    menu.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach((input) => input.addEventListener('change', () => {
      const lesson = input.value === 'all' ? null : Number(input.value);
      if (id === 'all') {
        document.querySelectorAll<HTMLInputElement>('.view .lesson-filter input[value="' + input.value + '"]').forEach((other) => { other.checked = true; });
        document.querySelectorAll('.view').forEach((scope) => apply(scope, lesson));
      } else apply(holder.closest('.view'), lesson);
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }));
    menu.addEventListener('keydown', (event) => { if (event.key === 'Escape') { menu.open = false; menu.querySelector('summary')?.focus(); } });
  };
  document.querySelectorAll<HTMLElement>('.lesson-filter').forEach(build);
  document.addEventListener('click', (event) => {
    document.querySelectorAll<HTMLDetailsElement>('.lesson-filter details[open]').forEach((menu) => { if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false; });
  });
}
export const MODES_SCRIPT = inlineClient(modesClient, [icon("filter")]);

export const MODES_STYLE = `
.report-content .view-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-1) var(--space-4)}
.report-content .view-head>h2,.report-content .view-head>h3{grid-column:1;grid-row:1}
.report-content .view-question{margin:0;color:var(--ink-2);max-width:44rem}
.report-content .view-head>.view-question{grid-column:1;grid-row:2}
.report-content .view-controls{grid-column:2;grid-row:1 / span 2;align-self:start;display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1);padding:0;transform:translateY(-.25rem)}
@media(max-width:600px){.report-content .view-head{grid-template-columns:minmax(0,1fr)}.report-content .view-controls{grid-column:1;grid-row:3;transform:none}}
.seg{display:inline-flex;border:1px solid var(--axis);border-radius:8px;padding:2px;gap:2px;background:var(--surface)}
.seg-option{position:relative;display:inline-flex;align-items:center;justify-content:center;width:2rem;height:1.75rem;border-radius:6px;color:var(--ink-2);cursor:pointer}
.seg-option input{position:absolute;inset:0;margin:0;opacity:0;cursor:pointer}
.seg-option:hover{color:var(--ink);background:var(--plane)}
.seg-option:has(input:checked){color:var(--ink);background:var(--grid)}
.seg-option:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:1px}
.view:has(>.view-head .seg-mode input[value=chart]:checked)>.mode-table{display:none}
.view:has(>.view-head .seg-mode input[value=table]:checked)>.mode-chart{display:none}
.view:has(>.view-head .seg-mode input[value=chart]:checked) [data-guide-mode=table],.view:has(input[name=pace-view][value=page]:checked) [data-guide-pace=cumulative],.view:has(>.view-head .seg-mode input[value=table]:checked) [data-guide-pace=cumulative]{display:none}
.legend-item{white-space:nowrap;display:inline-flex;align-items:center}
.mode-narrow-note{display:none;color:var(--ink-2);font-size:.85rem}
@media (max-width:600px){.view>.mode-chart{display:none!important}.view>.mode-table{display:block!important}.view-head .seg-mode{display:none}.mode-narrow-note{display:block}.view [data-guide-mode=table]{display:block!important}.view [data-guide-pace=cumulative]{display:none!important}}
/* Table reflow (reflowTables). Tables stack at the width where charts give way to tables: below it
   most tables' columns no longer fit, and WCAG 1.4.10 asks for no sideways scrolling at 320 CSS px.
   Wider screens keep columns and scroll wide tables sideways. Each row becomes "column: value"
   lines; the header row stays, wrapping, for its sort buttons. Bars repeat a printed number. */
@media (max-width:600px){
table[role=table],table[role=table] :is(thead,tbody,tfoot,tr,th,td){display:block;width:auto!important;min-width:0!important;max-width:none!important;white-space:normal!important;text-align:left;overflow-wrap:anywhere}
table[role=table] tr[hidden]{display:none}
table[role=table] caption{display:block}
.table-wrap:has(>table[role=table]){overflow:visible;max-height:none}
table[role=table] thead tr{display:flex;flex-wrap:wrap;column-gap:1rem;border-bottom:1px solid var(--axis)}
table[role=table] thead :is(th,td){position:static;border:0;box-shadow:none;padding:.2rem 0}
table[role=table] tbody tr{padding:.5rem 0;border-bottom:1px solid var(--grid)}
table[role=table] tbody :is(th,td){border-bottom:0;padding:.15rem 0}
/* A row group (tr.group-start) starts with a rule across the stacked row, not over each line. */
table[role=table] tbody tr.group-start{border-top:1px solid var(--axis)}table[role=table] tbody tr.group-start>*{border-top:0}
table[role=table] [data-label]::before{content:attr(data-label) ": " / "";font-weight:600}
table[role=table] .bar{display:none}
}
.icon-button{display:inline-flex;align-items:center;justify-content:center;width:2.1rem;height:2.1rem;border:1px solid var(--axis);border-radius:8px;background:var(--surface);color:var(--ink-2);cursor:pointer;padding:0;font:inherit}
.icon-button:hover{color:var(--ink);background:var(--plane)}
.icon-button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
/* A display value on a button class would otherwise override the hidden attribute. */
.text-button[hidden],.icon-button[hidden]{display:none}
.text-button{display:inline-flex;align-items:center;gap:.4rem;height:2.1rem;padding:0 .75rem;border:1px solid var(--axis);border-radius:8px;background:var(--surface);color:var(--ink);cursor:pointer;font:inherit;font-size:.875rem}
.text-button:hover{background:var(--plane)}.text-button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.text-button.primary{background:var(--ink);border-color:var(--ink);color:var(--surface)}
.text-button:disabled{opacity:.5;cursor:default}
.lesson-filter:empty{display:none}
.menu{position:relative}
.menu>summary{list-style:none;width:2rem;height:1.95rem}.menu>summary::-webkit-details-marker{display:none}
.menu>summary.active{color:var(--accent);border-color:var(--accent)}
.menu-panel{position:absolute;z-index:20;right:0;top:calc(100% + 4px);min-width:16rem;max-width:min(24rem,calc(100vw - 2rem));margin:0;padding:.5rem .75rem;display:grid;gap:.15rem;background:var(--surface);border:1px solid var(--axis);border-radius:8px;box-shadow:0 8px 24px rgb(0 0 0 / .12)}
.menu-panel legend{float:left;width:100%;font-size:.8rem;color:var(--ink-2);margin-bottom:.25rem}
.menu-panel label{display:flex;align-items:baseline;gap:.45rem;font-size:.875rem;cursor:pointer;padding:.15rem .25rem;border-radius:4px}
.menu-panel label:hover{background:var(--plane)}.menu-note{color:var(--ink-2)}
.lesson-variant[hidden]{display:none}
.readings{margin:.4rem 0 0;max-width:46rem;font-size:.875rem;line-height:1.5}.readings>div{margin:0 0 .45rem}.readings dt{font-weight:600}.readings dd{margin:0;color:var(--ink-2)}
.mode-chart .filtered-out{opacity:.12}
`;

export const generated = (model: string, word = "Interpretation") =>
	`<abbr class="defined generated" tabindex="0" title="${esc(`Model: ${model}`)}">${word}</abbr>`;

export function generatedSummary(model: string, items: string, about: string): string {
	if (!items) return "";
	const base = `${drawn?.findLast((entry) => entry.level === 2)?.anchor ?? "report"}-summary`;
	const earlier = drawn?.filter((entry) => entry.anchor === base || entry.anchor.startsWith(`${base}-`)).length ?? 0;
	const anchor = earlier ? `${base}-${earlier + 1}` : base;
	drawn?.push({ title: `Interpretation of ${about}`, level: 3, anchor });
	return `<div class="generated-summary" id="${esc(anchor)}"><h3>${generated(model)} of ${esc(about)}</h3><ul class="interpretation">${items}</ul></div>`;
}

export const method = (body: string, summary = "How this is counted") =>
	`<details class="method"><summary>${summary}</summary>${body}</details>`;

export const sectionHead = (id: string, title: string, question: string, note = "") =>
	(drawn?.push({ title, level: 2, anchor: id }),
	`<div class="section-head"><h2 id="${esc(id)}">${esc(title)}</h2><p class="view-question">${esc(question)}</p>${note}</div>`);
