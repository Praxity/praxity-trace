import { inlineClient } from "./client.ts";
import { pageKey } from "./places.ts";
import { icon } from "./icons.ts";
/** Personal notes exported from one course revision of a Trace report. */
export interface CommentsFile {
	schema: "praxity-trace-comments/0";
	course: string;
	courseHash: string;
	comments: Comment[];
}

export interface Comment {
	id: string;
	created: string;
	updated: string;
	view: string | null;
	heading: string | null;
	target: {
		label: string | null;
		page: { lesson: number; page: number } | null;
		objectives: string[] | null;
		sentence: string | null;
		row: string | null;
	};
	source: { file: string; line: number | null } | null;
	quote: { exact: string; prefix: string; suffix: string } | null;
	note: string;
}

const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/**
 * A sentence id as the Language views print it: lesson.page, then s for on screen, n for
 * narration or t for transcript and the sentence's order, "3.9.s2". "L3.p9.s2" is the earlier
 * form, still read so comments saved before the change keep their sentence. Self-contained:
 * the browser inlines it.
 */
export function isSentenceId(value: unknown): value is string {
	return typeof value === "string" && /^(?:[1-9]\d*\.[1-9]\d*\.[snt]|L[1-9]\d*\.p[1-9]\d*\.s)[1-9]\d*$/.test(value);
}

/**
 * A comments file checked field by field, for imports and for comments the browser stored.
 * Self-contained apart from isSentenceId, because the browser inlines both.
 */
export function commentsFile(value: unknown): CommentsFile {
	const record = (item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item);
	const keys = (item: Record<string, unknown>, expected: string[]) =>
		Object.keys(item).length === expected.length && expected.every((key) => Object.hasOwn(item, key));
	const nonempty = (item: unknown): item is string => typeof item === "string" && item.trim().length > 0;
	const optionalText = (item: unknown) => item === null || nonempty(item);
	const whole = (item: unknown): item is number => Number.isSafeInteger(item) && (item as number) > 0;
	const iso = (item: unknown): item is string =>
		typeof item === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(item) && !Number.isNaN(Date.parse(item));
	if (!record(value) || !keys(value, ["schema", "course", "courseHash", "comments"]) ||
		value.schema !== "praxity-trace-comments/0" || !nonempty(value.course) || !nonempty(value.courseHash) || !Array.isArray(value.comments)) {
		throw new Error("Invalid comments file");
	}
	const ids = new Set<string>();
	for (const comment of value.comments) {
		if (!record(comment) || !keys(comment, ["id", "created", "updated", "view", "heading", "target", "source", "quote", "note"]) ||
			!nonempty(comment.id) || !iso(comment.created) || !iso(comment.updated) || Date.parse(comment.created) > Date.parse(comment.updated) ||
			!optionalText(comment.view) || !optionalText(comment.heading) || typeof comment.note !== "string" || !nonempty(comment.note) ||
			ids.has(comment.id)) throw new Error("Invalid comment");
		ids.add(comment.id);
		const target = comment.target;
		if (!record(target) || !keys(target, ["label", "page", "objectives", "sentence", "row"]) ||
			!optionalText(target.label) || !optionalText(target.row) || (target.sentence !== null && !isSentenceId(target.sentence)) ||
			(target.page !== null && (!record(target.page) || !keys(target.page, ["lesson", "page"]) || !whole(target.page.lesson) || !whole(target.page.page))) ||
			(target.objectives !== null && (!Array.isArray(target.objectives) || !target.objectives.length ||
				!target.objectives.every((id: unknown) => typeof id === "string" && /^O[1-9]\d*$/.test(id)) || new Set(target.objectives).size !== target.objectives.length))) {
			throw new Error("Invalid comment target");
		}
		const source = comment.source;
		if (source !== null && (!record(source) || !keys(source, ["file", "line"]) || !nonempty(source.file) ||
			(source.line !== null && !whole(source.line)))) throw new Error("Invalid comment source");
		const quote = comment.quote;
		if (quote !== null && (!record(quote) || !keys(quote, ["exact", "prefix", "suffix"]) || !nonempty(quote.exact) ||
			typeof quote.prefix !== "string" || typeof quote.suffix !== "string" || quote.prefix.length > 32 || quote.suffix.length > 32)) {
			throw new Error("Invalid comment quote");
		}
	}
	// Every field has been checked above; the cast only restates what the checks established.
	return value as unknown as CommentsFile;
}

/** Reject malformed or cross-version imports before an agent consumes them. */
export function parseComments(json: string): CommentsFile {
	let value: unknown;
	try { value = JSON.parse(json); } catch { throw new Error("Invalid comments JSON"); }
	return commentsFile(value);
}

/** The final source pointer in a location tooltip, if it has a line number. */
export function sourceFromTitle(title: string): Comment["source"] {
	const part = title.split("·").at(-1)?.trim() ?? "";
	const match = /^(.*\S):(\d+)$/.exec(part);
	return match && positive(Number(match[2])) ? { file: match[1]!, line: Number(match[2]) } : null;
}

/** Context uses the same 32-character limit as a TextQuoteSelector. */
export function quoteContext(text: string, start: number, end: number): NonNullable<Comment["quote"]> {
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > text.length || start >= end) {
		throw new Error("Invalid quote range");
	}
	return { exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32) };
}

function clipped(value: string | null | undefined, length = 90): string | null {
	return value ? (value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value) : null;
}

/** What the comment points at, most specific first, without repeating itself. */
function targetText(comment: Pick<Comment, "target">): string {
	const { objectives, page, sentence, row, label } = comment.target;
	const named = objectives?.length ? objectives.join(", ") : clipped(row);
	const parts = [named, page && `page ${pageKey(page.lesson, page.page)}`, sentence];
	// The mark's own label adds something only when the row or objectives do not already say it.
	if (label && !(row && (row.includes(label) || label.includes(row))) && !(objectives?.length && objectives.some((id) => label.startsWith(id)))) parts.push(clipped(label, 60));
	return parts.filter((part, index, all) => part && all.indexOf(part) === index).join(" · ") || "No target";
}

/** Plain text for one batch sent to a course-editing assistant. */
export function formatCommentsMarkdown(file: CommentsFile): string {
	const lines = [
		`# Comments on ${file.course} (${file.courseHash})`,
		"",
		"These are a designer's notes on a Praxity Trace report. They refer to the course through the pages and files given; page 3.9 is lesson 3, page 9.",
		"",
	];
	for (const [index, comment] of file.comments.entries()) {
		const view = comment.view ? comment.view.charAt(0).toUpperCase() + comment.view.slice(1) : null;
		const place = [view, comment.heading !== view ? comment.heading : null].filter(Boolean).join(" › ") || "Report";
		const source = comment.source ? ` · ${comment.source.file}${comment.source.line === null ? "" : `:${comment.source.line}`}` : "";
		lines.push(`${index + 1}. ${place} · ${targetText(comment)}${source}`);
		if (comment.quote) lines.push(`   Quote: “${clipped(comment.quote.exact, 200)}”`);
		lines.push(`   Note: ${comment.note.replace(/\r?\n/g, "\n   ")}`, "");
	}
	return lines.join("\n").trimEnd() + "\n";
}

/** Insert near the top of .report-content. The panel stays inside .viz-root for theme variables. */
export const COMMENTS_MARKUP = `<button type="button" id="comments-open" class="icon-button" aria-controls="comments-panel" aria-expanded="false" aria-label="Comments, 0" title="Comments">${icon("message-circle", 18)}<span class="comment-count" aria-hidden="true" hidden>0</span></button>
<aside id="comments-panel" class="comments-panel" aria-labelledby="comments-title" hidden>
<div class="comments-panel-head"><h2 id="comments-title">Comments</h2><button type="button" id="comments-close" class="icon-button" aria-label="Close comments" title="Close">${icon("x", 18)}</button></div>
<p class="comments-hint">Select text, or click a chart mark, then choose ${icon("message-circle", 14)} to comment. For a table row, focus it and choose Comment on focused item.</p>
<button type="button" id="comments-focused" class="text-button">${icon("message-circle")}Comment on focused item</button>
<p id="comments-status" role="status"></p>
<ul id="comments-list"></ul>
<template id="comments-item-actions"><button type="button" class="icon-button" data-act="jump" title="Go to it in the report">${icon("current-location", 16)}</button><button type="button" class="icon-button" data-act="edit" title="Edit">${icon("pencil", 16)}</button><button type="button" class="icon-button" data-act="delete" title="Delete">${icon("trash", 16)}</button></template>
<div class="comments-actions"><button type="button" id="comments-copy" class="text-button">${icon("copy")}Copy for assistant</button><button type="button" id="comments-clear" class="icon-button comments-clear" aria-label="Delete all comments" title="Delete all comments">${icon("trash", 18)}</button><button type="button" id="comments-download" class="icon-button" aria-label="Download comments.json" title="Download comments.json">${icon("download", 18)}</button></div>
</aside>
<button type="button" id="comments-selection" class="icon-button comment-here" aria-label="Comment on this" hidden>${icon("message-circle", 18)}</button>
<div id="comments-composer" class="comments-composer" role="dialog" aria-modal="true" aria-labelledby="comments-composer-title" hidden>
<div class="comments-panel-head"><h2 id="comments-composer-title">Comment</h2><button type="button" id="comments-composer-close" class="icon-button" aria-label="Close without saving" title="Close">${icon("x", 18)}</button></div><p id="comments-context" class="comments-context"></p><textarea id="comments-note" rows="4" aria-label="Comment"></textarea>
<div><button type="button" id="comments-save" class="text-button primary">Save</button><button type="button" id="comments-cancel" class="text-button">Cancel</button><button type="button" id="comments-delete" class="text-button comments-delete" hidden>Delete</button></div>
</div>`;

export const COMMENTS_STYLE = `
.comments-panel[hidden],.comments-composer[hidden],#comments-selection[hidden],.comment-count[hidden],.comments-context[hidden]{display:none}
#comments-open{position:relative}
.comment-count{position:absolute;top:-4px;right:-6px;min-width:1.1rem;height:1.1rem;padding:0 .25rem;border-radius:.55rem;background:var(--accent);color:var(--on-accent);font-size:.7rem;font-weight:600;line-height:1.1rem;text-align:center;font-variant-numeric:tabular-nums}
.comments-panel{position:fixed;z-index:30;right:0;top:0;width:min(26rem,100vw);height:100dvh;overflow:auto;background:var(--surface);color:var(--ink);border-left:1px solid var(--axis);box-shadow:-8px 0 24px rgb(0 0 0 / .08);padding:1rem 1.25rem;overflow-wrap:anywhere}
.comments-panel-head{display:flex;justify-content:space-between;align-items:center;gap:1rem}.comments-panel-head h2{margin:0;font-size:1.1rem;line-height:1.25;font-weight:650;letter-spacing:-.01em}
.comments-hint{color:var(--ink-2);font-size:.85rem}.comments-hint .icon{vertical-align:-2px}
#comments-status:empty{display:none}#comments-status{font-size:.85rem;color:var(--ink-2)}
.comments-panel ul{list-style:none;padding:0;margin:1rem 0}
.comments-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem}.comments-item-head strong{padding-top:.3rem}.comments-panel li{margin:0 0 .9rem;padding-bottom:.9rem;border-bottom:1px solid var(--grid)}.comments-panel li:last-child{border-bottom:0;margin-bottom:0}
.comments-panel li strong{font-size:.85rem}.comments-panel li p{margin:.2rem 0}.comments-panel li p:first-of-type{font-size:.8rem;color:var(--ink-2)}
.comments-panel li q{display:block;color:var(--ink-2);font-size:.85rem;margin:.2rem 0}.comments-panel li .comments-missing{color:var(--ink-2);font-style:italic}
.comments-item-actions{display:flex;flex:none;gap:.1rem}.comments-item-actions .icon-button{width:1.9rem;height:1.9rem}
.comments-actions,.comments-composer>div{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}
.comments-actions .comments-clear{order:1;margin-left:auto}.comments-composer .comments-delete{margin-left:auto}
.comments-actions{position:sticky;bottom:0;background:var(--surface);padding:.75rem 0 .25rem;border-top:1px solid var(--grid)}
#comments-selection{position:fixed;z-index:40;box-shadow:0 2px 8px rgb(0 0 0 / .18)}
.comments-composer{position:fixed;z-index:50;width:min(22rem,calc(100vw - 1rem));background:var(--surface);color:var(--ink);border:1px solid var(--axis);box-shadow:0 8px 28px rgb(0 0 0 / .18);border-radius:8px;padding:.9rem}
.comments-composer .comments-panel-head{margin:-.35rem -.35rem .35rem 0}.comments-composer h2{font-size:.95rem;margin:0}.comments-context{font-size:.8rem;color:var(--ink-2);margin:0 0 .5rem}
.comments-composer textarea{display:block;box-sizing:border-box;width:100%;min-height:5.5rem;margin:.25rem 0;padding:.4rem .5rem;font:inherit;color:var(--ink);background:var(--plane);border:1px solid var(--axis);border-radius:6px}
.comments-composer textarea:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.trace-commented{background:var(--note);box-shadow:inset 0 -2px 0 var(--note-ring);border-radius:2px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
/* Commented marks: text gets a highlighter halo; shapes a gold ring drawn over their fill, so blue and orange data marks stay readable as data. */
svg text.trace-commented{paint-order:stroke;stroke:var(--note);stroke-width:6px;stroke-linejoin:round}
svg .trace-commented:not(text){outline:2px solid var(--note-ring);outline-offset:1.5px}
.report-content{position:relative}
.comment-gutter{position:absolute;left:0;top:0;width:0;z-index:5}
.comment-pin{position:absolute;left:.45rem;width:1.5rem;height:1.5rem;display:grid;place-items:center;padding:0;border:1px solid var(--note-ring);border-radius:50%;background:var(--note);color:var(--ink);cursor:pointer}
.comment-pin svg{width:.9rem;height:.9rem}
.comment-pin:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pin-note{display:none;position:absolute;left:calc(100% + .45rem);top:-.25rem;width:max-content;max-width:20rem;padding:.45rem .6rem;background:var(--surface);color:var(--ink);border:1px solid var(--axis);border-radius:6px;box-shadow:0 6px 20px rgb(0 0 0 / .15);font-size:.85rem;line-height:1.4;text-align:left;white-space:pre-line;z-index:20}
.comment-pin:hover .pin-note,.comment-pin:focus-visible .pin-note{display:block}
@media(max-width:50rem){.comment-pin{left:-.15rem;width:1.15rem;height:1.15rem}}
.trace-comment-current{outline:3px solid var(--note-ring)!important;outline-offset:3px}
.trace-comment-current:not(svg *){background:var(--note-strong)}svg text.trace-comment-current{stroke:var(--note-strong)}
.comment-pin.current{background:var(--note-ring);color:var(--surface)}
`;

/** Append after the report's own script, which copies title text to data-tip. */
export function commentsClient() {
  const metaElement = document.getElementById('report-meta');
  const root = document.querySelector<HTMLElement>('.viz-root');
  const open = document.getElementById('comments-open') as HTMLButtonElement | null;
  const panel = document.getElementById('comments-panel') as HTMLElement | null;
  if (!metaElement || !root || !open || !panel) return;
  const meta = JSON.parse(metaElement.textContent || '{}') as { course: string | { title: string }; courseHash: string; lessons?: Array<{ number: number; file: string }> };
  const course = typeof meta.course === 'string' ? meta.course : meta.course.title;
  const hash = meta.courseHash;
  const storageKey = 'praxity-trace-comments:' + hash;
  const list = document.getElementById('comments-list');
  const status = document.getElementById('comments-status');
  const selectionButton = document.getElementById('comments-selection') as HTMLButtonElement | null;
  const composer = document.getElementById('comments-composer') as HTMLElement | null;
  const noteInput = document.getElementById('comments-note') as HTMLTextAreaElement | null;
  const focusedButton = document.getElementById('comments-focused') as HTMLButtonElement | null;
  const content = document.querySelector<HTMLElement>('.report-content');
  const closeButton = document.getElementById('comments-close');
  const saveButton = document.getElementById('comments-save');
  const cancelButton = document.getElementById('comments-cancel');
  const deleteButton = document.getElementById('comments-delete') as HTMLButtonElement | null;
  const clearButton = document.getElementById('comments-clear') as HTMLButtonElement | null;
  const copyButton = document.getElementById('comments-copy');
  const downloadButton = document.getElementById('comments-download');
  const context = document.getElementById('comments-context');
  const composerTitle = document.getElementById('comments-composer-title');
  if (!list || !status || !selectionButton || !composer || !noteInput || !focusedButton || !content || !closeButton || !saveButton || !cancelButton || !copyButton || !downloadButton || !context || !composerTitle) return;
  type Anchor = { element: Element; data: Omit<Comment, 'id' | 'created' | 'updated' | 'note'> };
  let comments: Comment[] = [];
  let lastFocused: Element | null = null;
  let pending: Anchor | null = null;
  let editing: Comment | null = null;
  let returnFocus: Element | null = null;
  const say = (message: string) => { status.textContent = message; };
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  // Adjacent elements (an objective id and its text) read as separate words, not run together.
  const spaced = (element: Element) => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent || '');
    return parts.join(' ').replace(/\s+/g, ' ');
  };
  const label = (element: Element) => text(element.getAttribute('aria-label') || (element as HTMLElement | SVGElement).dataset.tip || element.getAttribute('title') || element.querySelector(':scope > title')?.textContent || spaced(element));
  const source = (value: string | null | undefined) => {
    const part = (value || '').split('·').at(-1)?.trim() || '';
    const match = /^(.*\S):(\d+)$/.exec(part);
    return match && Number.isSafeInteger(Number(match[2])) && Number(match[2]) > 0 ? { file: match[1]!, line: Number(match[2]) } : null;
  };
  const pageOf = (value: string | null | undefined) => {
    const match = /^(\d+)\.(\d+)$/.exec(value || '');
    return match && Number.isSafeInteger(Number(match[1])) && Number.isSafeInteger(Number(match[2])) &&
      Number(match[1]) > 0 && Number(match[2]) > 0 ? { lesson: Number(match[1]), page: Number(match[2]) } : null;
  };
  const pageKey = (page: Comment['target']['page']) => page && page.lesson + '.' + page.page;
  const sentenceId = (value: string | null | undefined) => (isSentenceId(value) ? value : null);
  const rowText = (row: Element | null) => {
    const head = row?.querySelector('th[scope="row"]');
    if (!head) return null;
    const copy = head.cloneNode(true) as Element;
    copy.querySelectorAll('.file,[data-page]').forEach(element => element.remove());
    // Separate the text of adjacent elements, which textContent runs together.
    copy.querySelectorAll('*').forEach(element => element.append(' '));
    return text(copy.textContent) || null;
  };
  const sectionOf = (element: Element) => element.closest('section[aria-labelledby]');
  const headingOf = (element: Element) => {
    const section = sectionOf(element);
    const headings = [...(section || root).querySelectorAll('h2,h3')];
    return text(headings.filter(heading => heading === element || heading.contains(element) ||
      (heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1)?.textContent) || null;
  };
  const anchorOf = (element: Element, quote: Comment["quote"]): Anchor["data"] => {
    const section = sectionOf(element);
    const row = element.closest('li[id],tr');
    const location = element.closest<HTMLElement>('[data-page]') || row?.querySelector<HTMLElement>('[data-page]');
    const sentence = sentenceId(element.closest<HTMLElement>('li[id]')?.id) || sentenceId(element.closest('code')?.textContent) ||
      sentenceId(row?.querySelector('code')?.textContent);
    const page = pageOf(location?.dataset.page) || (sentence ? pageOf(sentence.replace(/^(\d+)\.(\d+)\.[snt]\d+$/, '$1.$2')) : null);
    const lane = element.closest('g')?.querySelector<SVGElement>('text.lane');
    const rowLabel = rowText(row) || (lane && label(lane)) || null;
    const ownLabel = label(element) || rowLabel;
    const objectives = [...new Set((rowLabel || ownLabel || '').match(/\bO[1-9]\d*\b/g) || [])];
    const titled = location?.getAttribute('title') || location?.dataset.tip || element.getAttribute('title') || (element as HTMLElement | SVGElement).dataset.tip;
    const pointed = source(titled) || source(row?.querySelector<HTMLElement>('[data-page]')?.dataset.tip);
    const lesson = meta.lessons?.find(item => item.number === page?.lesson);
    return {
      view: section?.getAttribute('aria-labelledby') || null,
      heading: headingOf(element),
      target: { label: ownLabel || null, page: page || null, objectives: objectives.length ? objectives : null,
        sentence: sentence || null, row: rowLabel },
      source: pointed && pointed.file ? pointed : (lesson ? { file: lesson.file, line: null } : null),
      quote: quote || null
    };
  };
  const quoteFor = (range: Range, section: Element) => {
    const before = document.createRange();
    before.selectNodeContents(section);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(section);
    after.setStart(range.endContainer, range.endOffset);
    return { exact: range.toString(), prefix: before.toString().slice(-32), suffix: after.toString().slice(0, 32) };
  };
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      let stored: CommentsFile | null = null;
      try { stored = commentsFile(JSON.parse(saved)); } catch { stored = null; }
      if (stored && stored.courseHash === hash) comments = stored.comments;
      else say('Stored comments could not be read.');
    }
  } catch { say('Browser storage is unavailable. Download comments.json to keep these notes.'); }
  const file = (): CommentsFile => ({ schema: 'praxity-trace-comments/0', course, courseHash: hash, comments });
  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(file())); }
    catch { say('Browser storage is unavailable. Download comments.json to keep these notes.'); }
  };
  const findQuote = (scope: Element, quote: Comment["quote"]) => {
    if (!quote) return null;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement?.closest('script,style,.comments-panel,.comments-composer,#comments-selection,#comments-open,#report-tip') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes: Array<[Node, number]> = [];
    let full = '';
    while (walker.nextNode()) { nodes.push([walker.currentNode, full.length]); full += walker.currentNode.textContent || ''; }
    let at = -1;
    let from = 0;
    while ((at = full.indexOf(quote.exact, from)) >= 0) {
      if ((!quote.prefix || full.slice(Math.max(0, at - quote.prefix.length), at) === quote.prefix) &&
        (!quote.suffix || full.slice(at + quote.exact.length, at + quote.exact.length + quote.suffix.length) === quote.suffix)) break;
      from = at + 1;
    }
    return at < 0 ? null : nodes.find(([node, start]) => start <= at && at < start + (node.textContent?.length || 0))?.[0].parentElement || null;
  };
  const findAnchors = (comment: Comment): Element[] => {
    const heading = comment.view ? document.getElementById(comment.view) : null;
    const scope = heading?.closest('section[aria-labelledby]') || root;
    if (comment.view && !heading) return [];
    const matches: Element[] = [];
    if (comment.target.sentence) {
      const sentence = document.getElementById(comment.target.sentence);
      if (sentence && scope.contains(sentence)) matches.push(sentence);
    }
    const quoted = findQuote(scope, comment.quote);
    if (quoted) matches.push(quoted);
    const target = comment.target;
    let candidates: Element[] = [];
    if (target.page) candidates = [...scope.querySelectorAll<HTMLElement>('[data-page]')].filter(element => element.dataset.page === pageKey(target.page));
    else if (target.row || target.label) candidates = [...scope.querySelectorAll('th[scope="row"]')].filter(element =>
      text(element.textContent).includes(target.row || target.label || ''));
    if (candidates.length) {
      const score = (element: Element) => Number(label(element) === target.label) * 4 +
        Number(rowText(element.closest('tr')) === target.row) * 3 +
        Number(!!target.sentence && element.closest('li')?.id === target.sentence) * 6;
      const groups = new Map<Element, Element>();
      for (const element of candidates) {
        const group = element.closest('.mode-chart,.mode-table,.pace-mode') || scope;
        if (!groups.has(group) || score(element) > score(groups.get(group)!)) groups.set(group, element);
      }
      matches.push(...groups.values());
    }
    if (target.row) {
      const row = [...scope.querySelectorAll('th[scope="row"]')].find(element => rowText(element.closest('tr')) === target.row);
      if (row) matches.push(row);
    }
    return [...new Set(matches)];
  };
  const place = (comment: Comment) => {
    const view = comment.view ? comment.view.charAt(0).toUpperCase() + comment.view.slice(1) : null;
    return [view, comment.heading !== view ? comment.heading : null].filter(Boolean).join(' › ') || 'Report';
  };
  const markdown = () => formatCommentsMarkdown({ ...file(), comments: inOrder().ordered });
  const make = (tag: string, value: string, className = "") => {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
  };
  // Short visible text; the accessible name says which comment.
  // Icon buttons come from a template, since the icons are drawn when the report is built.
  const actions = document.getElementById('comments-item-actions') as HTMLTemplateElement | null;
  const action = (container: Element, act: 'jump' | 'edit' | 'delete', name: string, callback: () => void) => {
    const button = actions?.content.querySelector('[data-act="' + act + '"]')?.cloneNode(true) as HTMLButtonElement | undefined;
    if (!button) return;
    button.setAttribute('aria-label', name);
    button.addEventListener('click', callback);
    container.append(button);
  };
  // Page order where the anchor is found, then creation order; the panel and the copied list share it.
  const inOrder = () => {
    const positions = new Map(comments.map(comment => [comment.id, findAnchors(comment)] as const));
    return { positions, ordered: [...comments].sort((a, b) => {
      const left = positions.get(a.id)?.[0], right = positions.get(b.id)?.[0];
      if (left && right && left !== right) return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      if (left || right) return left ? -1 : 1;
      return a.created.localeCompare(b.created);
    }) };
  };
  // A pin in the left gutter beside each visible commented item, so comments are findable at a glance.
  // Hover or focus shows the note; click edits it, or opens the panel when one pin holds several.
  const gutter = document.createElement('div');
  gutter.className = 'comment-gutter';
  content.prepend(gutter);
  let placed: Array<{ comment: Comment; anchors: Element[] }> = [];
  // The comment just reached with Go to stays marked, with its pin, until the next click or key press.
  let current: { id: string; anchor: Element } | null = null;
  const clearCurrent = () => {
    current?.anchor.classList.remove('trace-comment-current');
    current = null;
    gutter.querySelectorAll('.comment-pin.current').forEach(button => button.classList.remove('current'));
  };
  const markCurrent = (id: string, anchor: Element) => {
    clearCurrent();
    current = { id, anchor };
    anchor.classList.add('trace-comment-current');
    pin();
    setTimeout(() => {
      document.addEventListener('pointerdown', clearCurrent, { once: true });
      document.addEventListener('keydown', clearCurrent, { once: true });
    });
  };
  const pin = () => {
    gutter.replaceChildren();
    const top = content.getBoundingClientRect().top;
    const rows = new Map<number, Comment[]>();
    for (const { comment, anchors } of placed) {
      const anchor = anchors.find(element => element.getClientRects().length);
      if (!anchor) continue;
      const y = Math.round((anchor.getBoundingClientRect().top - top) / 24) * 24;
      rows.set(y, [...(rows.get(y) || []), comment]);
    }
    rows.forEach((group, y) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'comment-pin';
      button.style.top = y + 'px';
      if (current && group.some(comment => comment.id === current?.id)) button.classList.add('current');
      const notes = group.map(comment => comment.note).join('\n\n');
      button.setAttribute('aria-label', (group.length === 1 ? 'Comment: ' : group.length + ' comments: ') + notes);
      const glyph = selectionButton.querySelector('svg')?.cloneNode(true);
      if (glyph) button.append(glyph);
      const note = make('span', notes, 'pin-note');
      note.setAttribute('aria-hidden', 'true');
      button.append(note);
      button.addEventListener('click', () => { if (group.length === 1 && group[0]) showComposer(null, group[0]); else setPanel(true); });
      gutter.append(button);
    });
  };
  new ResizeObserver(() => pin()).observe(content);
  const render = () => {
    document.querySelectorAll('.trace-commented').forEach(element => element.classList.remove('trace-commented'));
    const { positions, ordered } = inOrder();
    list.replaceChildren();
    ordered.forEach(comment => {
      const anchors = positions.get(comment.id) || [];
      anchors.forEach(element => element.classList.add('trace-commented'));
      const item = document.createElement('li');
      const head = make('div', '', 'comments-item-head');
      const controls = make('div', '', 'comments-item-actions');
      head.append(make('strong', place(comment)), controls);
      item.append(head);
      item.append(make('p', targetText(comment) + (comment.source ? ' · ' + comment.source.file + (comment.source.line === null ? '' : ':' + comment.source.line) : '')));
      if (comment.quote) item.append(make('q', comment.quote.exact));
      item.append(make('p', comment.note));
      if (!anchors.length) item.append(make('p', 'not found on this page', 'comments-missing'));
      if (anchors.length) action(controls, 'jump', 'Go to the comment on ' + place(comment), () => {
        const anchor = anchors.find(element => element.getClientRects().length) || anchors.find(element => {
          const mode = element.closest('.mode-chart,.mode-table,.pace-mode');
          return !mode || getComputedStyle(mode).display !== 'none';
        }) || anchors[0];
        if (!anchor) return;
        panel.hidden = true;
        open.setAttribute('aria-expanded', 'false');
        for (let details = anchor.closest<HTMLDetailsElement>('details'); details; details = details.parentElement?.closest('details') as HTMLDetailsElement | null) details.open = true;
        anchor.scrollIntoView({ block: 'center', behavior: 'smooth' });
        markCurrent(comment.id, anchor);
        if (!anchor.hasAttribute('tabindex')) anchor.setAttribute('tabindex', '-1');
        (anchor as HTMLElement).focus({ preventScroll: true });
      });
      action(controls, 'edit', 'Edit the comment on ' + place(comment), () => showComposer(null, comment));
      action(controls, 'delete', 'Delete the comment on ' + place(comment), () => {
        comments = comments.filter(item => item.id !== comment.id);
        save(); render(); say('Comment deleted.');
      });
      list.append(item);
    });
    placed = ordered.map(comment => ({ comment, anchors: positions.get(comment.id) || [] }));
    pin();
    const count = open.querySelector<HTMLElement>('.comment-count');
    if (!count) return;
    count.textContent = String(comments.length);
    count.hidden = comments.length === 0;
    if (clearButton) clearButton.disabled = comments.length === 0;
    open.setAttribute('aria-label', 'Comments, ' + comments.length);
  };
  const hideSelection = () => { selectionButton.hidden = true; pending = null; };
  const placePopover = (element: HTMLElement, rect: Pick<DOMRect, "left" | "bottom">) => {
    element.hidden = false;
    const width = element.offsetWidth, height = element.offsetHeight;
    element.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + 'px';
    element.style.top = Math.max(8, Math.min(rect.bottom + 6, innerHeight - height - 8)) + 'px';
  };
  const closeComposer = () => {
    composer.hidden = true;
    editing = null;
    pending = null;
    (returnFocus as HTMLElement | null)?.focus();
    returnFocus = null;
  };
  const showComposer = (anchor: Anchor | null, existing: Comment | null = null) => {
    if (!existing && !anchor) return;
    returnFocus = (existing || document.activeElement === focusedButton ? document.activeElement : anchor?.element || document.activeElement) as Element | null;
    if (returnFocus === anchor?.element && !returnFocus.hasAttribute('tabindex')) returnFocus.setAttribute('tabindex', '-1');
    editing = existing || null;
    hideSelection();
    pending = anchor || null;
    noteInput.value = existing?.note || '';
    // Show what the comment will attach to, so the designer can confirm it before saving.
    const subject = existing || anchor?.data;
    context.textContent = subject ? (subject.quote ? '“' + clipped(subject.quote.exact, 140) + '” · ' : '') + targetText(subject) : '';
    context.hidden = !context.textContent;
    composerTitle.textContent = existing ? 'Edit comment' : 'Comment';
    if (deleteButton) deleteButton.hidden = !existing;
    const rect = anchor?.element.getBoundingClientRect() || returnFocus?.getBoundingClientRect();
    if (rect) placePopover(composer, rect);
    document.getElementById('report-tip')?.setAttribute('hidden', '');
    noteInput.focus();
  };
  saveButton.addEventListener('click', () => {
    const note = noteInput.value.trim();
    if (!note) { noteInput.focus(); say('Write a note before saving.'); return; }
    const now = new Date().toISOString();
    if (editing) { editing.note = note; editing.updated = Date.parse(now) < Date.parse(editing.created) ? editing.created : now; }
    else comments.push({ id: crypto.randomUUID(), created: now, updated: now, ...pending!.data, note });
    save(); closeComposer(); render(); say('Comment saved.');
  });
  cancelButton.addEventListener('click', closeComposer);
  deleteButton?.addEventListener('click', () => {
    if (!editing) return;
    const id = editing.id;
    comments = comments.filter(item => item.id !== id);
    save(); closeComposer(); render(); say('Comment deleted.');
  });
  clearButton?.addEventListener('click', () => {
    if (!comments.length || !window.confirm(`Delete all ${comments.length} comments? This cannot be undone.`)) return;
    comments = [];
    save(); render(); say('All comments deleted.');
  });
  // Escape closes the composer wherever focus went, not only inside it.
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !composer.hidden) { event.preventDefault(); closeComposer(); } });
  composer.addEventListener('keydown', event => {
    if (event.key === 'Tab') {
      const controls = [noteInput, saveButton, cancelButton, ...(deleteButton && !deleteButton.hidden ? [deleteButton] : [])];
      const next = (controls.findIndex(control => control === document.activeElement) + (event instanceof KeyboardEvent && event.shiftKey ? controls.length - 1 : 1)) % controls.length;
      event.preventDefault(); controls[next]?.focus();
    }
  });
  const setPanel = (visible: boolean) => {
    panel.hidden = !visible;
    open.setAttribute('aria-expanded', String(visible));
    (visible ? closeButton : open).focus();
  };
  open.addEventListener('click', () => setPanel(Boolean(panel.hidden)));
  closeButton.addEventListener('click', () => setPanel(false));
  document.getElementById('comments-composer-close')?.addEventListener('click', () => closeComposer());
  panel.addEventListener('keydown', event => { if (event.key === 'Escape' && composer.hidden) setPanel(false); });
  content.addEventListener('focusin', event => {
    if (event.target instanceof Element && event.target.closest('[data-page],tr,li[id],section[aria-labelledby]')) {
      lastFocused = event.target;
      focusedButton.disabled = false;
    }
  });
  focusedButton.disabled = true;
  focusedButton.addEventListener('click', () => {
    if (lastFocused?.isConnected) showComposer({ element: lastFocused, data: anchorOf(lastFocused, null) });
  });
  // Clicking a chart mark offers the comment icon beside it; Option-click opens the composer at once.
  content.addEventListener('click', event => {
    const mark = event.target instanceof Element ? event.target.closest('svg [data-page],.mode-chart [data-page]') : null;
    if (!mark) return;
    const anchor = { element: mark, data: anchorOf(mark, null) };
    if (event instanceof MouseEvent && event.altKey) { event.preventDefault(); showComposer(anchor); return; }
    pending = anchor;
    const rect = mark.getBoundingClientRect();
    // Above the mark: the page preview opens below it.
    placePopover(selectionButton, { left: rect.left - 6, bottom: rect.top - 44 });
  });
  const selected = () => {
    if (!composer.hidden) return;
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) return hideSelection();
    const range = selection.getRangeAt(0);
    const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
    if (!element) return hideSelection();
    const section = sectionOf(element) || root;
    if (!root.contains(element) || element.closest('#comments-panel,#comments-composer,#comments-selection,#comments-open') ||
      !section.contains(range.endContainer)) return hideSelection();
    pending = { element, data: anchorOf(element, quoteFor(range, section)) };
    placePopover(selectionButton, range.getBoundingClientRect());
  };
  document.addEventListener('mouseup', event => {
    if (event.target instanceof Element && root.contains(event.target) && !event.target.closest('#comments-panel,#comments-composer,#comments-selection,#comments-open')) selected();
  });
  document.addEventListener('keyup', event => {
    if (event.key === 'Escape' || !(event.target instanceof Element) || !root.contains(event.target) ||
      event.target.closest('#comments-panel,#comments-composer,#comments-selection,#comments-open')) return;
    selected();
    if (event.key === 'Shift' && !selectionButton.hidden) selectionButton.focus({ preventScroll: true });
  });
  selectionButton.addEventListener('click', () => {
    const anchor = pending;
    if (anchor) showComposer(anchor);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !selectionButton.hidden) hideSelection(); });
  copyButton.addEventListener('click', async () => {
    const value = markdown();
    try { await navigator.clipboard.writeText(value); say('Comments copied for assistant.'); }
    catch {
      const temp = document.createElement('textarea');
      temp.value = value; document.body.append(temp); temp.select();
      const copied = document.execCommand('copy'); temp.remove();
      say(copied ? 'Comments copied for assistant.' : 'Could not copy comments. Download comments.json instead.');
    }
  });
  downloadButton.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(file(), null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'comments.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  render();
}
export const COMMENTS_SCRIPT = inlineClient(commentsClient, [], [pageKey, clipped, targetText, formatCommentsMarkdown, isSentenceId, commentsFile]);
