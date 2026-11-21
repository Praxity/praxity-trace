import { parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";
import type { Block, TypedText, TypedNarration, FormattedText } from "./inspect.ts";


const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function typedHtml(text: TypedText): string {
	if (text.format === "plain") return escapeText(text.value);
	const html = text.format === "markdown" ? markdownText(text.value).replace(/</g, "&lt;").replace(/>/g, "&gt;") : text.value.replace(/\r\n?|\n/g, " ");
	return projectedHtml(html, text.role !== "feedback");
}

function projectedHtml(html: string, screen = true): string {
	const fragment = parseFragment(html);
	const prune = (node: DefaultTreeAdapterTypes.ParentNode) => {
		node.childNodes = node.childNodes.filter(child => {
			if (!("tagName" in child)) return true;
			const attrs = Object.fromEntries(child.attrs.map(attr => [attr.name, attr.value]));
			const hidden = Object.hasOwn(attrs, "hidden") || Object.hasOwn(attrs, "inert") || attrs["aria-hidden"] === "true" || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(attrs.style ?? "");
			const postResponse = /(?:^|\s)(?:feedback|praxity-(?:choice|assessment)-feedback|inline-tooltip-fallback|praxity-sr-only|sr-only|visually-hidden|screen-reader-only)(?:\s|$)/i.test(attrs.class ?? "") || attrs["data-role"] === "feedback";
			return !["script", "style", "template"].includes(child.tagName) && !(screen && (hidden || postResponse));
		});
		for (const child of node.childNodes) if ("childNodes" in child) prune(child);
	};
	prune(fragment);
	return serialize(fragment).replace(/&nbsp;/g, " ");
}
function markdownText(value: string): string {
	return value
		.replace(RAW_TOOLTIP, "$1")
		.replace(/(?<!\\)\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/(?<!\\)\*\*(.*?)\*\*|(?<!\\)__(.*?)__/g, (_match, a: string | undefined, b: string | undefined) => a ?? b ?? "")
		.replace(/(?<!\\)\*([^*\s][^*]*?)\*/g, "$1")
		.replace(/\\([\\`*{}\[\]()#+\-.!_|~:])/g, "$1");
}
function typedTexts(value: unknown): TypedText[] | undefined {
	return typeof value === "object" && value !== null && "typedTexts" in value ? (value as { typedTexts: TypedText[] }).typedTexts : undefined;
}
const screenRoles = new Set(["heading", "body", "prompt", "option"]);

const VISIBLE_TEXT_KEYS = new Set([
	"content",
	"caption",
	"label",
	"text",
	"question",
	"description",
	"feedback",
	"left",
	"right",
	"title",
	"heading",
	"rows",
	"headers",
	"items",
	"name",
	"speaker",
	"correct",
	"incorrect",
]);

function clean(text: string, entities = true): string {
	return (entities ? decodeText : (value: string) => value)(
		text
			.replace(FOOTNOTE, " ")
			.replace(RAW_TOOLTIP, "$1")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			.replace(/\*\*|__/g, "")
			.replace(/\*([^*\s][^*]*)\*/g, "$1"),
	);
}

export function visibleStrings(value: unknown, key = ""): string[] {
	const typed = typedTexts(value);
	if (typed) return typed.filter(text => screenRoles.has(text.role)).map(typedHtml);
	if (typeof value === "string") return VISIBLE_TEXT_KEYS.has(key) ? [projectedHtml(clean(value))] : [];
	if (Array.isArray(value)) return value.flatMap((item) => visibleStrings(item, key));
	if (typeof value === "object" && value !== null) {
		return Object.entries(value).flatMap(([childKey, child]) =>
			childKey.startsWith("narration") || ["transcript", "transcripts"].includes(childKey) ? [] : visibleStrings(child, childKey),
		);
	}
	return [];
}

export function visibleText(value: unknown): string[] {
	return visibleStrings(value).map((text) => stripTags(text));
}

export function assessmentStem(data: Record<string, unknown>): string {
	return (Array.isArray(data.stem) ? data.stem : []).flatMap(item => {
		if (typeof item !== "object" || item === null || !("data" in item) || typeof item.data !== "object" || item.data === null || !("content" in item.data)) return [];
		return typeof item.data.content === "string" ? [item.data.content] : [];
	}).join(" ");
}

export const TAG = /<\/?[A-Za-z][^>]*>/g;
export const decodeAngles = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
export const stripTags = (html: string, replacement = " ") => {
	const read = (node: DefaultTreeAdapterTypes.Node): string =>
		"value" in node && !("tagName" in node) ? node.value : "childNodes" in node ? ("tagName" in node ? `${replacement}${node.childNodes.map(read).join("")}${replacement}` : node.childNodes.map(read).join("")) : "";
	return read(parseFragment(html));
};

const FOOTNOTE = /@footer(?:\{[^}]*\}|\.insert)/g;
const RAW_TOOLTIP = /(?<!\\)\[([^\]]+)\]\{((?:[^{}]|\{[^{}]*\})+)\}/g;

const ENTITIES: Record<string, string> = { "&quot;": '"', "&#39;": "'", "&amp;": "&", "&lt;": "<", "&gt;": ">" };
const decode = (text: string) => text.replace(/&(?:quot|#39|amp|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity);
const decodeText = (text: string) => text.replace(/&(?:quot|#39|amp);/g, (entity) => ENTITIES[entity] ?? entity);

export function tooltips(value: unknown): Array<{ term: string; text: string }> {
	const typed = typedTexts(value);
	if (typed) {
		let term = "";
		return typed.flatMap(text => {
			if (text.role === "glossary-term") term = text.value;
			return text.role === "glossary-definition" ? [{ term, text: stripTags(typedHtml(text)) }] : [];
		});
	}
	if (typeof value === "string") {
		const rendered = [...value.matchAll(/data-tooltip-content="([^"]*)"[^>]*>([^<]*)</g)].map((match) => ({
			term: decode(match[2] ?? ""),
			text: decode(match[1] ?? ""),
		}));
		const raw = [...value.matchAll(RAW_TOOLTIP)].map((match) => ({ term: match[1] ?? "", text: match[2] ?? "" }));
		return [...rendered, ...raw];
	}
	if (Array.isArray(value)) return value.flatMap(tooltips);
	if (typeof value === "object" && value !== null) {
		return Object.entries(value).flatMap(([key, child]) => (key.startsWith("narration") || ["transcript", "transcripts"].includes(key) ? [] : tooltips(child)));
	}
	return [];
}

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function countWords(data: Record<string, unknown>): number {
	return visibleText(data).join(" ").split(/\s+/).filter(Boolean).length;
}

export interface PreviewLine {
	kind: "heading" | "item" | "text";
	text: string;
}

const PREVIEW_HEADING_KEYS = new Set(["title", "heading", "name", "label", "question"]);
const PREVIEW_SKIP_KEYS = new Set(["feedback", "correct", "incorrect"]);

export function previewLines(blocks: Array<{ type: string; data: Record<string, unknown> }>, pageTitle: string, limit = 260): PreviewLine[] {
	const lines: PreviewLine[] = [];
	const add = (kind: PreviewLine["kind"], html: string) => {
		for (const part of html.split(/<br\s*\/?>|(?=<(?:h[1-6]|p|li|tr|div|blockquote)\b)/i)) {
			const text = stripTags(part).replace(/\s+/g, " ").trim();
			if (text) lines.push({ kind: /^\s*<li\b/i.test(part) ? "item" : /^\s*<h[1-6]\b/i.test(part) ? "heading" : kind, text });
		}
	};
	const walk = (value: unknown, key: string, heading: boolean, option = false) => {
		if (typeof value === "string") {
			if (VISIBLE_TEXT_KEYS.has(key) && !PREVIEW_SKIP_KEYS.has(key)) add(heading || PREVIEW_HEADING_KEYS.has(key) ? "heading" : option ? "item" : "text", clean(value));
		} else if (Array.isArray(value)) {
			if ((key === "rows" || key === "headers") && value.every((cell) => typeof cell === "string")) add("text", value.map(value => clean(value)).join(" · "));
			else for (const item of value) walk(item, key, heading, option || key === "options");
		} else if (typeof value === "object" && value !== null) {
			for (const [childKey, child] of Object.entries(value)) if (!childKey.startsWith("narration") && !["transcript", "transcripts"].includes(childKey) && !PREVIEW_SKIP_KEYS.has(childKey)) walk(child, childKey, heading, option);
		}
	};
	for (const block of blocks) {
		const typed = typedTexts(block.data);
		if (typed) for (const text of typed.filter(text => screenRoles.has(text.role))) add(text.role === "heading" ? "heading" : text.role === "option" ? "item" : "text", typedHtml(text));
		else walk(block.data, "", block.type === "heading");
	}
	if (lines[0]?.text.toLowerCase() === pageTitle.trim().toLowerCase()) lines.shift();
	const kept: PreviewLine[] = [];
	let used = 0;
	for (const line of lines) {
		if (used >= limit) break;
		kept.push({ ...line, text: previewText(line.text, Math.max(40, limit - used)) });
		used += line.text.length;
	}
	if (kept.length < lines.length && !kept.at(-1)?.text.endsWith("…")) kept.push({ kind: "text", text: "…" });
	return kept;
}

export function previewText(text: string, limit = 200): string {
	const clean = text.replace(/\s+/g, " ").trim();
	if (clean.length <= limit) return clean;
	const boundary = clean[limit - 1] === " " ? limit - 1 : clean.lastIndexOf(" ", limit - 1);
	return boundary > 0 ? `${clean.slice(0, boundary)}…` : "…";
}

const VOICE_CUE = /(?<![\w\]])\[[a-z][a-z ]*\][ \t]*/g;

export const spoken = (script: string) =>
	script
		.replace(RAW_TOOLTIP, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/\*\*|__/g, "")
		.split(/\r\n?|\n/)
		.flatMap(line => {
			const prose = line.replace(VOICE_CUE, "");
			return line.trim() && !prose.trim() ? [] : [prose];
		})
		.join("\n")
		.replace(/[ \t]+/g, " ")
		.trim();

export interface Narration {
	script: string;
	resolved?: boolean;
	seconds: number | null;
}

export function narrations(value: unknown): Narration[] {
	if (Array.isArray(value)) return value.flatMap(narrations);
	if (typeof value !== "object" || value === null) return [];
	const record = value as Record<string, unknown>;
	if (Array.isArray(record.typedNarrations)) return (record.typedNarrations as TypedNarration[]).filter(item => !item.disabled && item.value.trim()).map(item => ({ script: item.value, seconds: null, resolved: true }));
	const own =
		typeof record.narration === "string" && record.narration.trim()
			? [{ script: record.narration, seconds: typeof record.narrationDuration === "number" ? record.narrationDuration : null }]
			: [];
	return [...own, ...Object.values(record).flatMap(narrations)];
}

export const narrationText = (item: Narration) => item.resolved ? item.script : spoken(item.script);

export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
export const formattedText = (value: FormattedText) => oneLine(stripTags(typedHtml({ ...value, ref: "", role: "body", location: null })));

export interface Transcript {
	text: string;
	origin: "authored" | "caption-track";
	kind: string;
}

export function transcriptStrings(block: Block): Transcript[] {
	const authored = (block.media ?? []).flatMap(media => media.transcript ? [{ text: typedHtml({ ...media.transcript, ref: "", role: "body", location: null }), origin: "authored" as const, kind: media.kind }] : []);
	if (!block.media && typeof block.data.transcript === "string") authored.push({ text: clean(block.data.transcript), origin: "authored", kind: block.type });
	const tracks = (block.data.transcripts as Transcript[] | undefined) ?? [];
	return [...authored, ...tracks.map(item => ({ ...item, text: escapeText(item.text) }))];
}

export function transcripts(block: Block): Transcript[] {
	return transcriptStrings(block).map(item => ({ ...item, text: oneLine(stripTags(item.text)) })).filter(item => item.text);
}

export interface Feedback {
	status: "present" | "empty" | "not-supplied";
	items: Array<{ source: string; text: string }>;
}

export function feedbackText(block: Block): Feedback {
	const typed = typedTexts(block.data);
	const items: Feedback["items"] = [];
	if (typed) {
		for (const text of typed.filter(text => text.role === "feedback")) items.push({ source: text.ref, text: formattedText(text) });
	} else {
		const add = (value: unknown, source: string) => {
			if (typeof value === "string" || value === null) items.push({ source, text: typeof value === "string" ? oneLine(stripTags(clean(value))) : "" });
			else if (typeof value === "object" && value !== null) {
				const fields = Object.entries(value);
				if (!fields.length) items.push({ source, text: "" });
				for (const [key, child] of fields) add(child, `${source}.${key}`);
			}
		};
		for (const key of ["incorrect", "correct", "feedback"]) {
			const value = block.data[key];
			if (Object.hasOwn(block.data, key) && (key === "feedback" || typeof value === "string" || value === null)) add(value, key);
		}
		if (Array.isArray(block.data.options)) block.data.options.forEach((option, i) => {
			if (option && typeof option === "object" && Object.hasOwn(option, "feedback")) add(option.feedback, `options[${i}].feedback`);
		});
	}
	return { status: items.some(item => item.text) ? "present" : items.length ? "empty" : "not-supplied", items };
}

function checkText(block: Block): string {
	const options = Array.isArray(block.data.options) ? block.data.options : [];
	const pairs = Array.isArray(block.data.pairs) ? block.data.pairs : [];
	const lines: string[] = [];
	if (typeof block.data.description === "string") lines.push(`Scenario: ${oneLine(block.data.description)}`);
	lines.push(`Question: ${oneLine(String(block.data.question ?? ""))}`);
	for (const option of options as Array<Record<string, unknown>>) {
		lines.push(`- ${option.correct === true ? "[correct] " : ""}${oneLine(String(option.text ?? ""))}`);
	}
	for (const pair of pairs as Array<Record<string, unknown>>) {
		lines.push(`- ${oneLine(String(pair.left ?? ""))} → [correct] ${oneLine(String(pair.right ?? ""))}`);
	}
	if (typeof block.data.incorrect === "string") lines.push(`Feedback when incorrect: ${oneLine(block.data.incorrect)}`);
	return lines.join("\n");
}


export function blockTexts(block: Block): { screen: string; tooltips: Array<{ term: string; text: string }>; narration: string[]; transcript: string[] } {
	return {
		screen: typedTexts(block.data) ? oneLine(visibleText(block.data).join(" ")) : block.type === "assessment" ? checkText(block) : block.type === "code" && typeof block.data.code === "string" ? oneLine(block.data.code) : oneLine(visibleText(block.data).join(" ")),
		tooltips: tooltips(block.data).map((tip) => ({ term: oneLine(tip.term), text: oneLine(tip.text) })),
		narration: narrations(block.data).map((item) => oneLine(narrationText(item))),
		transcript: transcripts(block).map(item => item.text),
	};
}

export const STOP_WORDS = new Set(
	"a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those there their they them we you your our can may will would should could not no do does did has have had which who whom what when where why how than then so such also into about over under more most other some any each all both very just only".split(
		" ",
	),
);
