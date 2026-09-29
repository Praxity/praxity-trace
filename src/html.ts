import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, posix, resolve, sep } from "node:path";
import { parse, parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";
import { type Block, type Course, type Lesson, type Page, withPageNarration } from "./inspect.ts";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type RecordValue = Record<string, unknown>;
const isElement = (node: Node): node is Element => "tagName" in node;
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const attr = (node: Element, name: string): string | undefined => node.attrs.find((item) => item.name === name)?.value;
const hasClass = (node: Element, name: string): boolean => (attr(node, "class") ?? "").split(/\s+/).includes(name);
const record = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const elements = (node: Node, test: (element: Element) => boolean): Element[] => {
	const found: Element[] = [];
	const visit = (item: Node) => {
		if (isElement(item) && test(item)) found.push(item);
		for (const child of children(item)) visit(child);
	};
	visit(node);
	return found;
};
const first = (node: Node, test: (element: Element) => boolean): Element | undefined => elements(node, test)[0];
const text = (node: Node): string => isElement(node) && node.tagName === "script"
	? children(node).map((child) => "value" in child ? child.value : "").join("")
	: "value" in node ? node.value : children(node).map(text).join("");
const plain = (node: Node): string => text(node).replace(/\s+/g, " ").trim();
const inner = (node: Element): string => serialize(node).trim();
const line = (node: Element): number | null => node.sourceCodeLocation?.startLine ?? null;
const jsonScript = (doc: Node, id: string): RecordValue | undefined => {
	const node = first(doc, (element) => element.tagName === "script" && attr(element, "id") === id);
	if (!node) return undefined;
	try { const value: unknown = JSON.parse(text(node)); return record(value) ? value : undefined; }
	catch { return undefined; }
};
const title = (doc: Node, fallback: string): string => {
	const node = first(doc, (item) => item.tagName === "title") ?? first(doc, (item) => item.tagName === "h1");
	return node ? plain(node) || fallback : fallback;
};
const htmlFile = (file: string): boolean => /\.html?$/i.test(file);
const safeFile = (root: string, file: string): string | undefined => {
	const path = resolve(root, file);
	return path.startsWith(resolve(root) + sep) ? path : undefined;
};
function stripUnseen(node: Node): void {
	if ("childNodes" in node) {
		node.childNodes = node.childNodes.filter((child) => !isElement(child) || !hidden(child) && !["inline-tooltip-fallback", "praxity-footnote-ref", "praxity-footnotes", "praxity-sr-only", "sr-only", "visually-hidden", "screen-reader-only"].some((name) => hasClass(child, name)));
		for (const child of node.childNodes) stripUnseen(child);
	}
}
function visibleData(value: unknown): unknown {
	if (typeof value === "string" && value.includes("<") && /inline-tooltip-fallback|footnote-ref|praxity-footnotes|sr-only|visually-hidden|screen-reader-only/.test(value)) {
		const fragment = parseFragment(value);
		stripUnseen(fragment);
		return serialize(fragment);
	}
	if (Array.isArray(value)) return value.map(visibleData);
	if (record(value)) return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "_inline").map(([key, item]) => [key, visibleData(item)]));
	return value;
}

async function filesIn(directory: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(path: string): Promise<void> {
		for (const entry of await readdir(join(directory, path), { withFileTypes: true })) {
			const file = posix.join(path, entry.name);
			if (entry.isDirectory()) await walk(file);
			else if (entry.isFile() && htmlFile(file)) found.push(file);
		}
	}
	await walk("");
	return found.sort((a, b) => a.localeCompare(b));
}

function studioBlock(node: Element, authored: Map<string, RecordValue>, segments: Map<string, string[]>): Block {
	const id = attr(node, "data-block-id") ?? `block-${node.sourceCodeLocation?.startOffset ?? 0}`;
	const type = attr(node, "data-block-type") ?? "text";
	const saved = authored.get(id);
	let data: RecordValue = record(saved?.data) ? { ...saved.data } : {};
	const raw = attr(node, "data-block-json");
	if (raw) {
		try { const parsed: unknown = JSON.parse(raw); data = record(parsed) && record(parsed.data) ? { ...parsed.data } : record(parsed) ? parsed : data; }
		catch { throw new Error(`Invalid data-block-json on ${id}.`); }
	} else if (type === "text" || type === "heading") data.content = inner(node);
	if (type === "chart" && record(data.data) && Array.isArray(data.data.labels) && Array.isArray(data.data.series)) {
		const series = data.data.series.filter(record);
		data.rows = [[data.xAxisLabel ?? "", ...series.map((item) => item.name ?? "")], ...data.data.labels.map((label, index) => [label, ...series.map((item) => String(Array.isArray(item.values) ? item.values[index] ?? "" : ""))])];
		data.xLabel = data.xAxisLabel;
		data.yLabel = data.yAxisLabel;
		delete data.data;
		delete data.xAxisLabel;
		delete data.yAxisLabel;
	}
	if (type === "assessment" && Array.isArray(data.stem)) {
		data.question = data.stem.filter(record).map((item) => record(item.data) ? item.data.content : "").filter((item) => typeof item === "string").join(" ");
		delete data.stem;
		if (record(data.response)) {
			const response = data.response;
			if (Array.isArray(response.options)) data.options = response.options.filter(record).map((item) => ({ text: item.label, correct: item.isCorrect }));
			if (Array.isArray(response.pairs)) data.pairs = response.pairs.filter(record).map((item) => ({ left: item.prompt, right: item.correctMatch }));
			for (const key of ["statements", "scalePoints", "placeholder"]) if (response[key] !== undefined) data[key] = response[key];
			delete data.response;
		}
		if (record(data.feedback)) {
			for (const key of ["correct", "incorrect"]) {
				const blocks = data.feedback[key];
				if (Array.isArray(blocks)) data[key] = blocks.filter(record).map((item) => record(item.data) ? item.data.content : "").filter((item) => typeof item === "string").join(" ");
			}
			delete data.feedback;
		}
	}
	if (type === "columns") {
		const descendants = elements(node, (child) => child !== node && attr(child, "data-block-type") !== undefined);
		const direct = descendants.filter((child) => {
			let parent = child.parentNode;
			while (parent && parent !== node) {
				if (isElement(parent) && attr(parent, "data-block-type")) return false;
				parent = "parentNode" in parent ? parent.parentNode : null;
			}
			return true;
		});
		// locateBlocks reads columns through data.items[].children.
		data.items = [{ children: direct.map((child) => studioBlock(child, authored, segments)) }];
	}
	const script = segments.get(id);
	// Studio also generates spoken headings. Its embedded block data identifies authored narration.
	if (script?.length && (!saved || typeof (saved.data as RecordValue | undefined)?.narration === "string")) {
		data.narration = saved && typeof (saved.data as RecordValue).narration === "string"
			? (saved.data as RecordValue).narration : script.join(" ");
	}
	return { id, type, line: line(node), data: visibleData(data) as RecordValue };
}

function authoredBlocks(config: RecordValue | undefined): Map<string, RecordValue> {
	const authored = new Map<string, RecordValue>();
	const save = (value: unknown): void => {
		if (Array.isArray(value)) { value.forEach(save); return; }
		if (!record(value)) return;
		if (typeof value.id === "string" && record(value.data)) authored.set(value.id, value);
		for (const child of Object.values(value)) if (record(child) || Array.isArray(child)) save(child);
	};
	save(config?.blocks);
	return authored;
}

/** Blocks directly inside root; nested blocks belong to their container. */
function topBlocks(root: Element, authored: Map<string, RecordValue>, segments: Map<string, string[]>): Block[] {
	return elements(root, (node) => attr(node, "data-block-type") !== undefined).filter((node) => {
		let parent = node.parentNode;
		while (parent && parent !== root) {
			if (isElement(parent) && attr(parent, "data-block-type")) return false;
			parent = "parentNode" in parent ? parent.parentNode : null;
		}
		return true;
	}).map((node) => studioBlock(node, authored, segments));
}

function studioPages(doc: Node, config: RecordValue | undefined): Page[] {
	const authored = authoredBlocks(config);
	const deckPages = Array.isArray(config?.deckPages) ? config.deckPages.filter(record) : [];
	const pageData = new Map(deckPages.filter((page) => typeof page.id === "string").map((page) => [page.id as string, page]));
	return elements(doc, (node) => node.tagName === "article" && hasClass(node, "deck-slide")).map((slide, index) => {
		const id = attr(slide, "data-deck-slide") ?? attr(slide, "id") ?? `page-${index + 1}`;
		const segments = new Map<string, string[]>();
		for (const item of Array.isArray(pageData.get(id)?.segments) ? pageData.get(id)?.segments as unknown[] : []) {
			if (record(item) && typeof item.blockId === "string" && typeof item.script === "string" && item.script.trim())
				segments.set(item.blockId, [...(segments.get(item.blockId) ?? []), item.script]);
		}
		return { id, number: index + 1, title: attr(slide, "aria-label") ?? `Page ${index + 1}`, data: {}, blocks: topBlocks(slide, authored, segments) };
	});
}

const OMIT = new Set(["nav", "header", "footer", "script", "style", "template", "noscript"]);
const CONTENT = new Set(["p", "ul", "ol", "table", "img", "figure", "video", "audio", "details", "form", "fieldset"]);
const heading = (tag: string): boolean => /^h[1-6]$/.test(tag);
const hidden = (node: Element): boolean => attr(node, "hidden") !== undefined || attr(node, "aria-hidden") === "true" || attr(node, "inert") !== undefined || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(attr(node, "style") ?? "");
function contentElements(root: Element): Element[] {
	const found: Element[] = [];
	function visit(node: Node): void {
		if (!isElement(node)) return;
		if (OMIT.has(node.tagName) || hidden(node)) return;
		if ((CONTENT.has(node.tagName) && !(["form", "fieldset"].includes(node.tagName) && !elements(node, (child) => child.tagName === "input" && /^(radio|checkbox)$/i.test(attr(child, "type") ?? "")).length)) || heading(node.tagName)) { found.push(node); return; }
		for (const child of children(node)) visit(child);
	}
	for (const child of children(root)) visit(child);
	return found;
}
async function ordinaryBlock(node: Element, directory: string, file: string): Promise<Block | undefined> {
	const tag = node.tagName;
	if ((tag === "form" || tag === "fieldset") && !elements(node, (child) => child.tagName === "input" && /^(radio|checkbox)$/i.test(attr(child, "type") ?? "")).length) return undefined;
	const type = heading(tag) ? "heading" : ["p", "ul", "ol"].includes(tag) ? "text" : tag === "figure" || tag === "img" ? "image" : tag === "details" ? "accordion" : tag === "form" || tag === "fieldset" ? "assessment" : tag;
	const data: RecordValue = { content: tag === "img" ? (attr(node, "alt") ?? "") : inner(node) };
	if (type === "video" || type === "audio") {
		const track = first(node, (child) => child.tagName === "track" && /^(captions|subtitles)$/i.test(attr(child, "kind") ?? ""));
		const src = track && attr(track, "src");
		const path = src && safeFile(directory, join(dirname(file), decodeURIComponent(src.split(/[?#]/)[0] ?? "")));
		if (path) {
			try {
				const vtt = await readFile(path, "utf8");
				data.narration = vtt.split(/\r?\n/).filter((row) => row.trim() && !/^(WEBVTT|\d+|.*-->.*|NOTE\b)/.test(row.trim())).join(" ");
			} catch { /* A missing caption file is not a readable transcript. */ }
		}
	}
	return { id: attr(node, "id") ?? `block-${node.sourceCodeLocation?.startOffset ?? 0}`, type, line: line(node), data };
}
async function ordinaryPages(doc: Node, directory: string, file: string): Promise<Page[]> {
	const root = first(doc, (node) => node.tagName === "main") ?? first(doc, (node) => node.tagName === "body");
	if (!root) return [];
	const sections = elements(root, (node) => (node.tagName === "section" || node.tagName === "article") && !hidden(node)).filter((node) => {
		let parent = node.parentNode;
		while (parent && parent !== root) {
			if (isElement(parent) && (parent.tagName === "section" || parent.tagName === "article")) return false;
			parent = "parentNode" in parent ? parent.parentNode : null;
		}
		return true;
	});
	const groups = sections.length ? sections.map((section) => contentElements(section)) : [contentElements(root)];
	const split = sections.length ? groups : groups.flatMap((group) => {
		const pages: Element[][] = [];
		for (const node of group) {
			if ((node.tagName === "h1" || node.tagName === "h2") && pages.at(-1)?.length) pages.push([]);
			if (!pages.length) pages.push([]);
			pages.at(-1)?.push(node);
		}
		return pages;
	});
	const pages: Page[] = [];
	for (const [index, group] of split.entries()) {
		const blocks = (await Promise.all(group.map((node) => ordinaryBlock(node, directory, file)))).filter((block): block is Block => !!block);
		if (!blocks.length) continue;
		const section = sections[index];
		const head = group.find((node) => heading(node.tagName));
		pages.push({ id: section && attr(section, "id") || `page-${pages.length + 1}`, number: pages.length + 1, title: section && attr(section, "aria-label") || head && plain(head) || `Page ${pages.length + 1}`, data: {}, blocks });
	}
	return pages;
}

function ordered(files: string[], parsed: Map<string, { doc: Node; config?: RecordValue }>, manifest?: string): string[] {
	if (manifest) {
		const xml = parse(manifest);
		const organization = first(xml, (node) => node.tagName === "organization");
		const resources = new Map(elements(xml, (node) => node.tagName === "resource").map((node) => [attr(node, "identifier"), attr(node, "href") ?? (first(node, (child) => child.tagName === "file") && attr(first(node, (child) => child.tagName === "file") as Element, "href"))]));
		const fromManifest = organization ? elements(organization, (node) => node.tagName === "item").map((node) => resources.get(attr(node, "identifierref"))).filter((file): file is string => !!file).map((file) => posix.normalize(decodeURIComponent(file.split(/[?#]/)[0] ?? ""))) : [];
		return [...new Set(fromManifest.filter((file) => files.includes(file)))];
	}
	const studio = files.filter((file) => parsed.get(file)?.config);
	if (studio.length) {
		const deckPages = (parsed.get(studio[0] as string)?.config?.deckPages ?? []) as RecordValue[];
		const index = new Map(deckPages.map((page, number) => [page.id, number]));
		return [...studio].sort((a, b) => {
			const start = (file: string) => {
				const slide = first(parsed.get(file)?.doc as Node, (node) => node.tagName === "article" && hasClass(node, "deck-slide"));
				return slide ? index.get(attr(slide, "data-deck-slide")) ?? Infinity : Infinity;
			};
			return start(a) - start(b) || a.localeCompare(b);
		});
	}
	const index = files.find((file) => /^index\.html?$/i.test(file));
	const links = index ? elements(parsed.get(index)?.doc as Node, (node) => node.tagName === "a").map((node) => attr(node, "href") ?? "").map((href) => decodeURIComponent(href.split(/[?#]/)[0] ?? "")).map((href) => posix.normalize(posix.join(dirname(index), href))).filter((file) => files.includes(file)) : [];
	return [...new Set([...(index ? [index] : []), ...links, ...files])];
}

function pagedCourse(files: Array<[string, { doc: Node; config?: RecordValue; bytes: Buffer }]>): Course {
	const lessons = new Map<string, { files: string[]; hash: ReturnType<typeof createHash>; title: string; pages: Page[] }>();
	const position = (config?: RecordValue) => Number(config?.currentPage ?? Infinity);
	for (const [file, { doc, config, bytes }] of [...files].sort((a, b) => position(a[1].config) - position(b[1].config))) {
		const root = first(doc, (node) => node.tagName === "main");
		if (!root || !config) continue;
		const lessonId = config.lessonId as string;
		const lesson = lessons.get(lessonId) ?? { files: [], hash: createHash("sha256"), title: typeof config.lessonTitle === "string" ? config.lessonTitle : lessonId, pages: [] };
		lesson.files.push(file);
		lesson.hash.update(bytes);
		const entry = Array.isArray(config.pages) ? config.pages.filter(record).find((page) => page.id === config.pageId) : undefined;
		const data = record(entry?.data) && typeof entry.data.narration === "string" ? { narration: entry.data.narration } : {};
		lesson.pages.push(withPageNarration({ id: config.pageId as string, number: lesson.pages.length + 1, title: typeof config.pageTitle === "string" ? config.pageTitle : file, data, blocks: topBlocks(root, authoredBlocks(config), new Map()) }));
		lessons.set(lessonId, lesson);
	}
	const config = files[0]?.[1].config;
	const html = files[0] && first(files[0][1].doc, (node) => node.tagName === "html");
	return {
		schema: "praxity-html/0",
		studioVersion: "",
		course: { title: typeof config?.courseTitle === "string" ? config.courseTitle : "HTML course", locale: (html && attr(html, "lang")) || (typeof config?.sourceLocale === "string" ? config.sourceLocale : "und") },
		// A lesson's pages span several files: its first page's file names the lesson, and block lines point into each page's own file.
		lessons: [...lessons.values()].map((lesson) => ({ file: lesson.files[0] as string, title: lesson.title, sha256: lesson.hash.digest("hex"), pages: lesson.pages })),
	};
}

/** Read static HTML into the same Course model used by inspect JSON. */
export async function readHtmlCourse(directory: string): Promise<Course> {
	const files = await filesIn(directory);
	const parsed = new Map<string, { doc: Node; config?: RecordValue; bytes: Buffer }>();
	for (const file of files) {
		const bytes = await readFile(join(directory, file));
		const doc = parse(bytes.toString("utf8"), { sourceCodeLocationInfo: true });
		const shell = jsonScript(doc, "praxity-shell-config");
		const refresh = first(doc, (node) => node.tagName === "meta" && (attr(node, "http-equiv") ?? "").toLowerCase() === "refresh" && /^\s*0\s*(?:;|$)/.test(attr(node, "content") ?? ""));
		if (shell?.kind === "redirect" || refresh) continue;
		stripUnseen(doc);
		parsed.set(file, { doc, config: jsonScript(doc, "praxity-config"), bytes });
	}
	const manifest = await readFile(join(directory, "imsmanifest.xml"), "utf8").catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return undefined;
		throw error;
	});
	// Studio's page layout writes one file per page; its config names the page's lesson and position.
	const paged = [...parsed].filter(([, item]) => typeof item.config?.pageId === "string" && typeof item.config.lessonId === "string" && !first(item.doc, (node) => node.tagName === "article" && hasClass(node, "deck-slide")));
	if (paged.length && !manifest) return pagedCourse(paged);
	const lessons: Lesson[] = [];
	let courseTitle = "";
	let locale = "";
	for (const file of ordered([...parsed.keys()], parsed, manifest)) {
		const item = parsed.get(file);
		if (!item) continue;
		const { doc, config, bytes } = item;
		const studio = !!first(doc, (node) => node.tagName === "article" && hasClass(node, "deck-slide")) || !!first(doc, (node) => attr(node, "data-block-type") !== undefined);
		const pages = studio ? studioPages(doc, config) : await ordinaryPages(doc, directory, file);
		if (!pages.some((page) => page.blocks.length)) continue;
		const heading = typeof config?.lessonTitle === "string" ? config.lessonTitle : title(doc, basename(file, extname(file)));
		courseTitle ||= typeof config?.courseTitle === "string" ? config.courseTitle : "";
		const html = first(doc, (node) => node.tagName === "html");
		locale ||= (html && attr(html, "lang")) || (typeof config?.sourceLocale === "string" ? config.sourceLocale : "");
		lessons.push({ file, title: heading, sha256: createHash("sha256").update(bytes).digest("hex"), pages });
	}
	if (!lessons.length) throw new Error("No readable course content found in HTML directory. Scripted players that render lessons with JavaScript (such as Rise, Storyline, or Captivate) are unsupported.");
	return { schema: "praxity-html/0", studioVersion: "", course: { title: courseTitle || lessons[0]?.title || "HTML course", locale: locale || "und" }, lessons };
}
