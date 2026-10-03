import { readFileSync } from "node:fs";
import { blockTexts, narrations, narrationText, STOP_WORDS, stripTags, tooltips, transcriptStrings, transcripts, visibleStrings } from "./text.ts";
import { gunzipSync } from "node:zlib";

import type { Course } from "./inspect.ts";
import { buildPlaces, esc, locateBlocks, pageKey, type Places, where } from "./places.ts";
import { legend, method, sectionHead, viewBlock } from "./modes.ts";
import { renderTerms, type TermsView } from "./terms.ts";

export type Channel = "screen" | "narration" | "transcript";

/** Transcript figures exist only when the course supplies transcript text, so courses without media prose keep their report as it was. */
export type Channels<T> = Record<"screen" | "narration", T> & { transcript?: T };

/** A lesson's channels in display order, transcript only when present. */
const present = <T>(channels: Channels<T>) =>
	(["screen", "narration", "transcript"] as const).flatMap((channel) => {
		const data = channels[channel];
		return data ? [[channel, data] as const] : [];
	});

export interface Sentence {
	/** Stable within a course revision: lesson, page, then s (on screen), n (narration) or t (transcript) and the sentence's order on that page, e.g. 3.9.s2. */
	id: string;
	lesson: number;
	page: number;
	ref: string;
	channel: Channel;
	text: string;
	words: number;
	syllables: number;
	structure: SentenceStructure | null;
}

export interface SentenceStructure {
	subordinateClauses: number;
	passive: boolean;
	nominalisations: number;
	frontLoaded: boolean;
	/** Character offsets into the exact sentence text. */
	triggers: Array<{ start: number; end: number }>;
}

/** Counts of sentences, so a designer sees how many to revise; shares are derived from them. */
export interface StructureSummary {
	clauseCuesPer100Sentences: number;
	twoOrMoreClauseCues: number;
	passive: number;
	nominalisationsPer100Words: number;
	frontLoaded: number;
}

export type Construction = "passive" | "clauses" | "frontLoaded" | "nominal";

/**
 * How sentences hold together, after Coh-Metrix's referential and deep cohesion (Graesser,
 * McNamara and Kulikowich 2011): adjacent sentences on a page that share a content word, and
 * connectives that state a cause or a contrast. Counts; the report derives shares and rates.
 */
export interface Cohesion {
	adjacentPairs: number;
	overlapping: number;
	causal: number;
	contrastive: number;
}

// Unambiguous connectives only: "since" and "while" also mark time, so they are left out.
const CAUSAL = /\b(?:because|therefore|thus|hence|consequently|as a result|due to|so that|in order to|that's why|that is why|which means)\b|(?:^|[,;:]\s*)so\b/gi;
const CONTRASTIVE = /\b(?:but|however|although|though|whereas|yet|instead|nevertheless|nonetheless|despite|in contrast|on the other hand|unlike|rather than)\b/gi;

const contentWords = (sentence: string) =>
	new Set((sentence.toLowerCase().match(WORD) ?? []).filter((word) => word.length >= 4 && !STOP_WORDS.has(word)).map((word) => (word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word)));

/** Cohesion of one run of sentences in order, such as one page's on-screen text. */
export function cohesionOf(sentences: string[]): Cohesion {
	let overlapping = 0;
	for (let i = 1; i < sentences.length; i += 1) {
		const before = contentWords(sentences[i - 1] ?? "");
		if ([...contentWords(sentences[i] ?? "")].some((word) => before.has(word))) overlapping += 1;
	}
	const count = (pattern: RegExp) => sentences.reduce((sum, sentence) => sum + (sentence.match(pattern)?.length ?? 0), 0);
	return { adjacentPairs: Math.max(0, sentences.length - 1), overlapping, causal: count(CAUSAL), contrastive: count(CONTRASTIVE) };
}

/** Sentences worth a look, by construction, in course order; the same lists an agent can revise from. */
export type Flagged = Record<Construction, Sentence[]>;

export interface LessonLanguage {
	file: string;
	title: string;
	channels: Channels<ChannelLanguage>;
}

export interface ChannelLanguage {
	sentences: number;
	words: number;
	medianLength: number | null;
	p90Length: number | null;
	/** Share of words with three or more syllables. */
	longWordShare: number | null;
	/** Flesch–Kincaid grade level; null outside English or below the sample size. */
	grade: number | null;
	lengths: number[];
	structure: StructureSummary | null;
	/** English only; null for other languages. */
	cohesion: Cohesion | null;
}

export interface LanguageView {
	locale: string;
	lessons: LessonLanguage[];
	longest: Sentence[];
	flagged: Flagged;
	acronyms: Acronym[];
	/** English only; null for other languages. */
	vocabulary: Vocabulary | null;
	places: Places;
}

/** Word familiarity from TUBELEX subtitle frequencies, as Zipf values: log10 of uses per billion words. */
export interface Vocabulary {
	lessons: Array<Channels<{ words: number; lessCommon: number; rare: number }>>;
	/** Words below Zipf 3, fewer than one use per million, in order of first use. */
	rare: RareWord[];
}

export interface RareWord {
	word: string;
	/** Every form counted under this word, when a plural joined its singular. */
	forms?: string[];
	/** null when the word is below Zipf 2 or not in the list. */
	zipf: number | null;
	uses: number;
	/** Sentence id and block of the first use. */
	firstUse: string;
	ref: string;
	lessons: number[];
	/** A glossary tooltip's term contains the word. */
	glossed: boolean;
}

export interface Acronym {
	acronym: string;
	uses: number;
	firstUse: string;
	/** First block that spells it out, as "Full Name (ACR)" or a glossary tooltip; null when none does. */
	expandedAt: string | null;
	usedBeforeExpansion: boolean;
}

const ACRONYM = /\b([A-Z][A-Z0-9]{1,5})s?\b/g;

const CONNECTOR = new Set(["and", "of", "the", "for", "on", "to", "in", "at", "de", "du", "des", "la", "le", "et"]);

/**
 * True when a capitalised name is followed by "(ACR)", a name's initials spell the acronym,
 * or the acronym introduces a list whose items spell it ("FLOOD: Forecast, Levee check, …").
 */
export function spelledOut(acronym: string, text: string): boolean {
	if (new RegExp(`\\b\\p{Lu}[\\p{L}'’-]*\\s+\\(\\s*${acronym}\\s*\\)`, "u").test(text)) return true;
	const list = new RegExp(`\\b${acronym}\\b[^:.]{0,30}:\\s*([^.]+)`, "u").exec(text)?.[1];
	if (list) {
		const initials = list
			.split(/,\s*/)
			.map((item) => item.replace(/^and\s+/i, "").trim()[0] ?? "")
			.join("")
			.toUpperCase();
		if (initials.startsWith(acronym)) return true;
	}
	const words = text.split(/[^\p{L}'’-]+/u).filter(Boolean);
	for (let start = 0; start < words.length; start += 1) {
		let initials = "";
		for (let index = start; index < words.length; index += 1) {
			const word = words[index] as string;
			if (/^\p{Lu}/u.test(word)) initials += word[0];
			else if (!CONNECTOR.has(word) || initials === "") break;
			if (initials === acronym && initials.length >= 2) return true;
			if (!acronym.startsWith(initials)) break;
		}
	}
	return false;
}

/** Every string in block data, so code can be found in any field. */
const strings = (value: unknown): string[] =>
	typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : typeof value === "object" && value !== null ? Object.values(value).flatMap(strings) : [];

/** Words inside inline code or backticks anywhere in the course: identifiers and sample input, not vocabulary. */
function codeWords(course: Course): Set<string> {
	const code = locateBlocks(course)
		.flatMap((item) => [...strings(item.block.data), ...transcriptStrings(item.block).map((transcript) => transcript.text)])
		.flatMap((text) => [...text.matchAll(/<code[^>]*>([\s\S]*?)<\/code>|`([^`]+)`/g)].map((match) => match[1] ?? match[2] ?? ""));
	return new Set(code.flatMap((text) => text.match(/[\p{L}\p{N}_]+/gu) ?? []));
}

/** Every acronym, where it first appears and where, if anywhere, it is spelled out. */
function acronyms(course: Course): Acronym[] {
	const code = codeWords(course);
	const lowercase = new Set(locateBlocks(course).flatMap((item) => {
		const texts = blockTexts(item.block);
		return [texts.screen, ...texts.narration, ...texts.transcript].join(" ").replace(/\S*[/.@]\S*/g, " ").match(/\b\p{Ll}+\b/gu) ?? [];
	}));
	const found = new Map<string, { uses: number; firstUse: string; expandedAt: string | null; firstPosition: number; expandedPosition: number }>();
	locateBlocks(course).forEach((item, position) => {
		if (item.credit) return;
		const texts = blockTexts(item.block);
		const all = [texts.screen, ...texts.tooltips.map((tip) => tip.text), ...texts.narration, ...texts.transcript].join(" ");
		for (const match of all.matchAll(ACRONYM)) {
			const acronym = match[1] as string;
			// Capitals in code, or a word the course also writes in lower case ("STOP", "IS"), are not acronyms.
			if (code.has(acronym) || lowercase.has(acronym.toLowerCase())) continue;
			const entry = found.get(acronym) ?? { uses: 0, firstUse: item.ref, expandedAt: null, firstPosition: position, expandedPosition: Infinity };
			entry.uses += 1;
			const expanded =
				spelledOut(acronym, all) || texts.tooltips.some((tip) => tip.term === acronym || tip.term.startsWith(`${acronym} `));
			if (expanded && entry.expandedAt === null) {
				entry.expandedAt = item.ref;
				entry.expandedPosition = position;
			}
			found.set(acronym, entry);
		}
	});
	// A capitalised plural such as "SOPS" is the same acronym as "SOP".
	for (const [acronym, entry] of [...found]) {
		const singular = found.get(acronym.slice(0, -1));
		if (!acronym.endsWith("S") || !singular) continue;
		singular.uses += entry.uses;
		if (entry.firstPosition < singular.firstPosition) Object.assign(singular, { firstUse: entry.firstUse, firstPosition: entry.firstPosition });
		if (entry.expandedPosition < singular.expandedPosition) Object.assign(singular, { expandedAt: entry.expandedAt, expandedPosition: entry.expandedPosition });
		found.delete(acronym);
	}
	return [...found]
		.map(([acronym, entry]) => ({
			acronym,
			uses: entry.uses,
			firstUse: entry.firstUse,
			expandedAt: entry.expandedAt,
			usedBeforeExpansion: entry.firstPosition < entry.expandedPosition,
		}))
		.sort((a, b) => a.acronym.localeCompare(b.acronym));
}

/** Headings, checks, controls and data displays are not prose; source and credit pages are citations. */
const SKIPPED_TYPES = new Set([
	"heading",
	"assessment",
	"assessmentGroup",
	"button",
	"chart",
	"stats",
	"table",
	"code",
	"equation",
	"divider",
	"blockBreak",
	"pageBreak",
	"variable",
	"logic",
]);
/** A full stop after these does not end a sentence. */
const ABBREVIATION = /\b(?:v|vs|e\.g|i\.e|etc|Dr|Mr|Mrs|Ms|St|No|Inc|Ltd|[A-Z])\.(?=\s)/g;
/** Below this many words a readability grade is noise. */
const MIN_GRADE_WORDS = 100;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const SUBORDINATOR = new Set(["because", "although", "though", "while", "whereas", "if", "unless", "since", "when", "whenever", "where", "which", "who", "whom", "whose"]);
const PREPOSITION = new Set(["after", "before", "during", "in", "on", "at", "by", "with", "without", "for", "from", "under", "over", "between", "among", "through", "across", "beyond", "despite", "until", "into", "upon"]);
const BE = new Set(["am", "is", "are", "was", "were", "be", "been", "being"]);
const IRREGULAR_PARTICIPLE = new Set(["known", "given", "made", "seen", "done", "taken", "written", "built", "shown", "found", "told", "sent", "held", "read", "taught", "bought", "brought", "chosen"]);
const NOMINALISATION = /(?:tion|sion|ment|ness|ity|ance|ence)$/;

// ponytail: lexical English cues miss clauses and include some non-passives; use a parser only if course checks show the extra accuracy is needed.
export function sentenceStructure(text: string): SentenceStructure {
	const tokens = [...text.matchAll(WORD)].map((match) => ({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length }));
	let subordinateClauses = 0;
	let passive = false;
	let nominalisations = 0;
	const triggers: SentenceStructure["triggers"] = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i] as (typeof tokens)[number];
		const next = tokens[i + 1];
		if (SUBORDINATOR.has(token.word) && next && !/[\p{P}–—]/u.test(text.slice(token.end, next.start)) && !(token.word === "because" && next.word === "of") && !(token.word === "since" && /^\d/.test(next.word))) {
			subordinateClauses += 1;
			triggers.push({ start: token.start, end: token.end });
		}
		if (/^\p{L}{7,}$/u.test(token.word) && NOMINALISATION.test(token.word)) nominalisations += 1;
		if (!BE.has(token.word)) continue;
		for (const next of tokens.slice(i + 1, i + 3)) {
			if (/[\p{P}–—]/u.test(text.slice(token.end, next.start))) break;
			if (/^\p{L}+(?:ed|en)$/u.test(next.word) || IRREGULAR_PARTICIPLE.has(next.word)) {
				passive = true;
				triggers.push({ start: token.start, end: token.end }, { start: next.start, end: next.end });
				break;
			}
		}
	}
	const comma = text.indexOf(",");
	const firstClauseWords = comma < 0 ? 0 : tokens.filter((token) => token.start < comma).length;
	return {
		subordinateClauses,
		passive,
		nominalisations,
		frontLoaded: firstClauseWords >= 8 && (SUBORDINATOR.has(tokens[0]?.word ?? "") || PREPOSITION.has(tokens[0]?.word ?? "")),
		triggers,
	};
}

// ponytail: English vowel-group heuristic, the usual basis for Flesch–Kincaid; swap for a
// dictionary (CMUdict) if grades need to match a specific tool exactly.
export function syllables(word: string): number {
	const w = word.toLowerCase().replace(/[^a-z]/g, "");
	if (!w) return 0;
	if (w.length <= 3) return 1;
	const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
	return Math.max(1, trimmed.match(/[aeiouy]{1,2}/g)?.length ?? 1);
}

/**
 * Splits prose into sentences. Paragraphs and list items end a sentence even without punctuation,
 * and so does a closing bracket, colon or semicolon followed by a capital: that is how a list read
 * aloud separates its items.
 */
export function sentences(text: string): string[] {
	return text
		.split(/<\/(?:p|li|h\d|dd|dt|td)>|<br\s*\/?>/i)
		// Inline tags sit inside words and before punctuation; other tags separate text.
		.map((segment) => stripTags(segment.replace(/<\/?(?:a|abbr|b|code|em|i|kbd|mark|q|s|small|span|strong|sub|sup|u)\b[^>]*>/gi, "")).replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.flatMap((segment) =>
			segment
				.replace(ABBREVIATION, (match) => match.replaceAll(".", "\u0000"))
				// A spaced hyphen before a capital is a list item read aloud: "…gauge. - Keep the marks…".
				// A sentence can open with code, and a lowercase one only after a full word (abbreviations are masked above).
				// A spaced hyphen before a capital or code is a list item read aloud: "…gauge. - Keep the marks…".
				.split(/(?<=[.!?][”"’)]?|[):;])\s+(?=[\p{Lu}\p{N}“"‘(`])|(?<=\p{Ll}{3}[.!?])\s+(?=\p{Ll}+[/_(.]|\p{Ll}+\s)|\s+-\s+(?=[\p{Lu}`])/u),
		)
		.map((sentence) => sentence.replaceAll("\u0000", ".").trim())
		.filter((sentence) => (sentence.match(WORD)?.length ?? 0) > 0);
}


function measure(id: string, lesson: number, page: number, ref: string, channel: Channel, text: string, english: boolean): Sentence {
	const words = text.match(WORD) ?? [];
	return { id, lesson, page, ref, channel, text, words: words.length, syllables: words.reduce((sum, word) => sum + syllables(word), 0), structure: english ? sentenceStructure(text) : null };
}

/** A sentence with this many nominalisations is listed for review. */
const NOMINAL_HEAVY = 3;

function quantile(sorted: number[], q: number): number | null {
	if (!sorted.length) return null;
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
}

export function languageView(course: Course): LanguageView {
	const english = course.course.locale.toLowerCase().startsWith("en");
	const all: Sentence[] = [];
	const counters = new Map<string, number>();
	const next = (key: string) => {
		const value = (counters.get(key) ?? 0) + 1;
		counters.set(key, value);
		return value;
	};
	let hasTranscripts = false;
	for (const item of locateBlocks(course)) {
		if (item.credit) continue;
		const lesson = item.lessonNumber;
		const at = pageKey(lesson, item.page);
		// Headings, checks and data displays are not prose on screen; narration attached to them is still spoken prose.
		for (const text of SKIPPED_TYPES.has(item.block.type) ? [] : visibleStrings(item.block.data)) {
			for (const sentence of sentences(text)) all.push(measure(`${at}.s${next(`${at}.s`)}`, lesson, item.page, item.ref, "screen", sentence, english));
		}
		for (const script of narrations(item.block.data).map((item) => narrationText(item))) {
			for (const sentence of sentences(script)) all.push(measure(`${at}.n${next(`${at}.n`)}`, lesson, item.page, item.ref, "narration", sentence, english));
		}
		// Supplied media prose gets its own channel so it cannot inflate on-screen or narration figures.
		// It is never timed: Trace has no playback length for the media.
		// Any nonblank transcript adds the channel, even with no sentence; sentences split the markup, so
		// paragraph ends still end a sentence and escaped plain angle brackets stay text.
		if (transcripts(item.block).length) hasTranscripts = true;
		for (const transcript of transcriptStrings(item.block)) {
			for (const sentence of sentences(transcript.text)) all.push(measure(`${at}.t${next(`${at}.t`)}`, lesson, item.page, item.ref, "transcript", sentence, english));
		}
	}
	const refLesson = new Map(locateBlocks(course).map((item) => [item.ref, item.lesson]));
	const lessons = course.lessons.map((lesson) => {
		const summarize = (channel: Channel): ChannelLanguage => {
			const mine = all.filter((sentence) => sentence.channel === channel && refLesson.get(sentence.ref) === lesson.file);
			const lengths = mine.map((sentence) => sentence.words).sort((a, b) => a - b);
			const words = lengths.reduce((sum, n) => sum + n, 0);
			const syllableCount = mine.reduce((sum, sentence) => sum + sentence.syllables, 0);
			const long = mine.reduce(
				(sum, sentence) => sum + (sentence.text.match(WORD) ?? []).filter((word) => syllables(word) >= 3).length,
				0,
			);
			const structures = mine.flatMap((sentence) => sentence.structure ? [sentence.structure] : []);
			return {
				sentences: mine.length,
				words,
				medianLength: quantile(lengths, 0.5),
				p90Length: quantile(lengths, 0.9),
				longWordShare: words ? long / words : null,
				grade:
					english && words >= MIN_GRADE_WORDS
						? 0.39 * (words / mine.length) + 11.8 * (syllableCount / words) - 15.59
						: null,
				lengths,
				// Adjacent pairs stay within a page: a new page is a new screen of text.
				cohesion: english
					? [...Map.groupBy(mine, (sentence) => sentence.page).values()]
							.map((page) => cohesionOf(page.map((sentence) => sentence.text)))
							.reduce((sum, part) => ({ adjacentPairs: sum.adjacentPairs + part.adjacentPairs, overlapping: sum.overlapping + part.overlapping, causal: sum.causal + part.causal, contrastive: sum.contrastive + part.contrastive }), { adjacentPairs: 0, overlapping: 0, causal: 0, contrastive: 0 })
					: null,
				structure: structures.length
					? {
							clauseCuesPer100Sentences: Math.round((100 * structures.reduce((sum, item) => sum + item.subordinateClauses, 0)) / structures.length),
							twoOrMoreClauseCues: structures.filter((item) => item.subordinateClauses >= 2).length,
							passive: structures.filter((item) => item.passive).length,
							nominalisationsPer100Words: Math.round((100 * structures.reduce((sum, item) => sum + item.nominalisations, 0)) / Math.max(words, 1)),
							frontLoaded: structures.filter((item) => item.frontLoaded).length,
						}
					: null,
			};
		};
		return { file: lesson.file, title: lesson.title, channels: { screen: summarize("screen"), narration: summarize("narration"), ...(hasTranscripts ? { transcript: summarize("transcript") } : {}) } };
	});
	// A sentence repeated in two channels on the same page, such as on screen and read aloud, is listed once.
	const longest = [...all]
		.sort((a, b) => b.words - a.words)
		.filter((sentence, index, sorted) => sorted.findIndex((other) => other.ref.split(".").slice(0, 2).join(".") === sentence.ref.split(".").slice(0, 2).join(".") && other.lesson === sentence.lesson && other.text.replace(/`/g, "") === sentence.text.replace(/`/g, "")) === index)
		.slice(0, 12);
	const flagged: Flagged = {
		passive: all.filter((sentence) => sentence.structure?.passive),
		clauses: all.filter((sentence) => (sentence.structure?.subordinateClauses ?? 0) >= 2),
		frontLoaded: all.filter((sentence) => sentence.structure?.frontLoaded),
		nominal: all.filter((sentence) => (sentence.structure?.nominalisations ?? 0) >= NOMINAL_HEAVY),
	};
	const found = acronyms(course);
	const vocabulary = english ? vocabularyOf(course, all, hasTranscripts) : null;
	return {
		locale: course.course.locale,
		lessons,
		longest,
		flagged,
		acronyms: found,
		vocabulary,
		places: buildPlaces(course, [
			...(vocabulary?.rare.map((word) => word.ref) ?? []),
			...longest.map((sentence) => sentence.ref),
			...Object.values(flagged).flatMap((list) => list.map((sentence) => sentence.ref)),
			...found.flatMap((item) => [item.firstUse, ...(item.expandedAt ? [item.expandedAt] : [])]),
		]),
	};
}

const LESS_COMMON = 4;
const RARE = 3;
let lexicon: Map<string, number> | undefined;
export const zipfOf = (word: string) => {
	lexicon ??= new Map(
		gunzipSync(readFileSync(new URL("../data/tubelex-en.tsv.gz", import.meta.url)))
			.toString("utf8")
			.trim()
			.split("\n")
			.map((line) => {
				const [entry, zipf] = line.split("\t");
				return [entry as string, Number(zipf)];
			}),
	);
	const found = [word, ...baseForms(word)].flatMap((form) => lexicon?.get(form) ?? []);
	return found.length ? Math.max(...found) : null;
};

/**
 * Base forms an English inflection could come from: spillways → spillway, levied → levy, gauged → gauge.
 * Only forms in the lexicon count, and a word takes its family's frequency, as psycholinguistic norms do.
 * Comparatives are left out because -er also makes nouns: planter is not a form of plant.
 */
export function baseForms(word: string): string[] {
	if (word.length < 4) return [];
	const forms: string[] = [];
	const add = (stem: string) => {
		if (stem.length < 2) return;
		forms.push(stem, `${stem}e`);
		// Doubled final consonant: stopped → stop.
		if (/([b-df-hj-np-tv-z])\1$/.test(stem)) forms.push(stem.slice(0, -1));
	};
	for (const suffix of ["ies", "ied"]) if (word.endsWith(suffix)) forms.push(`${word.slice(0, -3)}y`);
	for (const suffix of ["ing", "ed", "es"]) if (word.endsWith(suffix)) add(word.slice(0, -suffix.length));
	if (word.endsWith("s") && !word.endsWith("ss")) forms.push(word.slice(0, -1));
	return forms;
}

/** Tokens as TUBELEX counts them: lowercased, NFKC, split at hyphens, with clitics such as 's and n't apart. */
function tokens(text: string): Array<{ word: string; capital: boolean; index: number }> {
	const found = text
		.normalize("NFKC")
		.replace(/\bcannot\b/gi, "can not")
		.replace(/n['’]t\b/gi, " not")
		.replace(/['’](?:s|re|ve|ll|d|m)\b/gi, "")
		.matchAll(/[\p{L}\p{N}]+/gu);
	return [...found]
		// Acronyms have their own table, and numbers are not vocabulary.
		.filter((match) => !/\p{N}/u.test(match[0]) && !/^\p{Lu}{2,}$/u.test(match[0]))
		.map((match, index) => ({ word: match[0].toLowerCase(), capital: /^\p{Lu}/u.test(match[0]), index }));
}

function vocabularyOf(course: Course, all: Sentence[], hasTranscripts: boolean): Vocabulary {
	const code = new Set([...codeWords(course)].map((word) => word.toLowerCase()));
	const glossary = new Set(
		locateBlocks(course).flatMap((item) => tooltips(item.block.data).flatMap((tip) => tokens(tip.term).map((token) => token.word))),
	);
	const seen = new Map<string, { uses: number; first: Sentence; lessons: Set<number>; lowercase: boolean; midSentenceCapital: boolean }>();
	const perSentence = all.map((sentence) => {
		const words = tokens(sentence.text);
		for (const token of words) {
			const entry = seen.get(token.word) ?? { uses: 0, first: sentence, lessons: new Set<number>(), lowercase: false, midSentenceCapital: false };
			entry.uses += 1;
			entry.lessons.add(sentence.lesson);
			if (!token.capital) entry.lowercase = true;
			else if (token.index > 0) entry.midSentenceCapital = true;
			seen.set(token.word, entry);
		}
		return words;
	});
	// A word never written in lower case and capitalised mid-sentence is a name; names are not vocabulary to teach.
	const isName = (word: string) => {
		const entry = seen.get(word);
		return (!!entry && !entry.lowercase && entry.midSentenceCapital) || code.has(word);
	};
	const lessons = course.lessons.map((_, index) => {
		const tally = (channel: Channel) => {
			const counts = { words: 0, lessCommon: 0, rare: 0 };
			all.forEach((sentence, i) => {
				if (sentence.lesson !== index + 1 || sentence.channel !== channel) return;
				for (const { word } of perSentence[i] ?? []) {
					if (isName(word)) continue;
					const zipf = zipfOf(word) ?? 0;
					counts.words += 1;
					if (zipf < RARE) counts.rare += 1;
					else if (zipf < LESS_COMMON) counts.lessCommon += 1;
				}
			});
			return counts;
		};
		return { screen: tally("screen"), narration: tally("narration"), ...(hasTranscripts ? { transcript: tally("transcript") } : {}) };
	});
	const rareWords = new Map([...seen].filter(([word]) => !isName(word) && (zipfOf(word) ?? 0) < RARE));
	// A plural whose singular is also rare is one word to the reader: weir and weirs share an entry.
	// ponytail: English plural suffixes only (-s, -es, -ies); irregular plurals stay separate.
	const singular = (word: string) => {
		const base = word.endsWith("ies") ? `${word.slice(0, -3)}y` : /(s|x|z|ch|sh)es$/.test(word) ? word.slice(0, -2) : /[^s]s$/.test(word) ? word.slice(0, -1) : "";
		return base && rareWords.has(base) ? base : word;
	};
	const groups = new Map<string, string[]>();
	for (const word of rareWords.keys()) groups.set(singular(word), [...(groups.get(singular(word)) ?? []), word]);
	const rare = [...groups].map(([word, forms]) => {
		const entries = forms.map((form) => rareWords.get(form)!);
		const first = entries.reduce((a, b) => (all.indexOf(b.first) < all.indexOf(a.first) ? b : a)).first;
		return {
			word,
			...(forms.length > 1 ? { forms: forms.sort() } : {}),
			zipf: zipfOf(word),
			uses: entries.reduce((sum, entry) => sum + entry.uses, 0),
			firstUse: first.id,
			ref: first.ref,
			lessons: [...new Set(entries.flatMap((entry) => [...entry.lessons]))].sort((a, b) => a - b),
			glossed: forms.some((form) => glossary.has(form)),
		};
	});
	return { lessons, rare };
}

const CHANNEL_LABEL: Record<Channel, string> = { screen: "On screen", narration: "Narration", transcript: "Transcript" };
/** True when the course supplies transcript text; every transcript row, legend entry and rule follows it. */
const transcribed = (view: LanguageView) => view.lessons.some((lesson) => lesson.channels.transcript);
const LABEL = 260;
const PLOT = 560;
/** Shared scale extends beyond the reference; longer sentences sit at the edge. */
const lengthCap = (view: LanguageView) => Math.max(30, (Math.floor((lengthReference(view) ?? 0) / 5) + 1) * 5);

/** The course's mean sentence length plus two standard deviations: a reference line, not a threshold. */
export function lengthReference(view: LanguageView): number | null {
	const all = view.lessons.flatMap((lesson) => present(lesson.channels).flatMap(([, data]) => data.lengths));
	if (!all.length) return null;
	const mean = all.reduce((sum, n) => sum + n, 0) / all.length;
	const sd = Math.sqrt(all.reduce((sum, n) => sum + (n - mean) ** 2, 0) / all.length);
	return Math.round(mean + 2 * sd);
}
const ROW = 20;
/** Mark area is proportional to the number of sentences of that length. */
const radius = (count: number) => Math.min(9, 2.2 * Math.sqrt(count));
/** A transcript square has the area of the circle drawn for the same count. */
const side = (count: number) => Math.sqrt(Math.PI) * radius(count);

function strip(view: LanguageView): string {
	const cap = lengthCap(view);
	const x = (words: number) => LABEL + (Math.min(words, cap) / cap) * PLOT;
	const reference = lengthReference(view);
	const rows = view.lessons.flatMap((lesson) => present(lesson.channels).map(([channel, data]) => ({ lesson, channel, data })));
	const top = 20;
	const height = top + rows.length * ROW + 8;
	let axis = "";
	for (let tick = 0; tick <= cap; tick += 5) {
		axis += `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top - 4}" y2="${height - 6}"/><text class="page-label" x="${x(tick)}" y="12" text-anchor="middle">${tick === cap ? `${cap}+` : tick}</text>`;
	}
	if (reference !== null) {
		const at = x(reference);
		axis += `<line class="reference" x1="${at}" x2="${at}" y1="${top - 4}" y2="${height - 6}"/><text class="page-label" x="${at - 3}" y="${height - 2}" text-anchor="end">mean + 2 SD</text>`;
	}
	const body = rows
		.map((row, index) => {
			const y = top + index * ROW + ROW / 2;
			const label =
				row.channel === "screen"
					? `<text class="lane" x="0" y="${y + 4}">${esc(`L${view.lessons.indexOf(row.lesson) + 1} · ${row.lesson.title.length > 26 ? `${row.lesson.title.slice(0, 25)}…` : row.lesson.title}`)}<title>${esc(row.lesson.title)}</title></text>`
					: "";
			const counts = new Map<number, number>();
			for (const length of row.data.lengths) counts.set(Math.min(length, cap), (counts.get(Math.min(length, cap)) ?? 0) + 1);
			const dots = [...counts]
				.map(([length, count]) => {
					const title = `<title>${count} ${count === 1 ? "sentence" : "sentences"} of ${length === cap ? `${cap} or more` : length} words</title>`;
					if (row.channel !== "transcript") return `<circle class="sentence ${row.channel}" cx="${x(length)}" cy="${y}" r="${radius(count).toFixed(1)}">${title}</circle>`;
					const size = side(count);
					return `<rect class="sentence transcript" x="${(x(length) - size / 2).toFixed(1)}" y="${(y - size / 2).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}">${title}</rect>`;
				})
				.join("");
			const median =
				row.data.medianLength === null
					? ""
					: `<line class="median-halo" x1="${x(row.data.medianLength)}" x2="${x(row.data.medianLength)}" y1="${y - 10}" y2="${y + 10}"/><line class="median" x1="${x(row.data.medianLength)}" x2="${x(row.data.medianLength)}" y1="${y - 10}" y2="${y + 10}"><title>Median ${row.data.medianLength} words</title></line>`;
			// Transcript squares go above the median: the 6px halo would hide a 3.9px square at the median length, and the line still shows past the square's ends.
			const marks = row.channel === "transcript" ? `${median}${dots}` : `${dots}${median}`;
			return `<g data-lesson="${view.lessons.indexOf(row.lesson) + 1}">${label}<text class="page-label" x="${LABEL - 8}" y="${y + 4}" text-anchor="end">${CHANNEL_LABEL[row.channel]}</text>${marks}</g>`;
		})
		.join("");
	return `<div class="scroll" tabindex="0" role="region" aria-label="Sentence lengths by lesson">
<svg width="${LABEL + PLOT + 20}" height="${height}" role="img" aria-label="Sentence lengths in words for each lesson, ${transcribed(view) ? "on screen, in narration and in transcripts" : "on screen and in narration"}.">${axis}${body}</svg></div>`;
}

const BANDS: Array<[number, number, string]> = [[1, 10, "1–10"], [11, 20, "11–20"], [21, 30, "21–30"], [31, Infinity, "31+"]];

/** Sentence counts by length band, per lesson and channel: the table form of the sentence-length chart. */
function lengthTable(view: LanguageView): string {
	const rows = view.lessons
		.flatMap((lesson, index) =>
			present(lesson.channels).map(([channel, data], _, channels) => {
				const bands = BANDS.map(([low, high]) => data.lengths.filter((n) => n >= low && n <= high).length);
				return `<tr data-lesson="${index + 1}">${channel === "screen" ? lessonCell(index, lesson.title, channels.length) : ""}<th scope="row">${CHANNEL_LABEL[channel]}</th><td class="num">${data.sentences}</td>${bands.map((count) => `<td class="num">${count}</td>`).join("")}<td class="num">${fixed(data.medianLength, 0)}</td><td class="num">${data.lengths.length ? Math.max(...data.lengths) : "–"}</td></tr>`;
			}),
		)
		.join("");
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Sentences by length"><table class="blocks"><caption class="sr">Sentences by length</caption><thead><tr><th scope="col">Lesson</th><th scope="col">Channel</th><th scope="col" class="num">Sentences</th>${BANDS.map(([, , label]) => `<th scope="col" class="num">${label} words</th>`).join("")}<th scope="col" class="num">Median</th><th scope="col" class="num">Longest</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

const fixed = (value: number | null, digits: number) => (value === null ? "–" : value.toFixed(digits));

/** Per 1,000 words, or a dash when there is too little text to say. */
const perThousand = (count: number, words: number) => (words >= 100 ? String(Math.round((1000 * count) / words)) : "–");

function profileTable(view: LanguageView): string {
	const rows = view.lessons
		.flatMap((lesson, index) =>
			present(lesson.channels).map(([channel, data], _, channels) => {
				const cohesion = data.cohesion;
				const rare = view.vocabulary?.lessons[index]?.[channel]?.rare;
				return `<tr data-lesson="${index + 1}">${channel === "screen" ? lessonCell(index, lesson.title, channels.length) : ""}<td>${CHANNEL_LABEL[channel]}</td><td class="num">${data.words}</td><td class="num">${fixed(data.medianLength, 0)}</td><td class="num">${data.structure ? data.structure.clauseCuesPer100Sentences : "–"}</td><td class="num">${rare === undefined ? "–" : perThousand(rare, data.words)}</td><td class="num">${cohesion && cohesion.adjacentPairs >= 5 ? `${Math.round((100 * cohesion.overlapping) / cohesion.adjacentPairs)}%` : "–"}</td><td class="num">${cohesion ? perThousand(cohesion.causal, data.words) : "–"}</td><td class="num">${cohesion ? perThousand(cohesion.contrastive, data.words) : "–"}</td><td class="num">${fixed(data.grade, 1)}</td></tr>`;
			}),
		)
		.join("");
	const head = (label: string, help: string) => `<th scope="col" class="num two-line"><abbr class="defined" tabindex="0" title="${esc(help)}">${label}</abbr></th>`;
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Text profile by lesson"><table class="blocks"><caption class="sr">Text profile by lesson</caption><thead><tr><th scope="col">Lesson</th><th scope="col">Channel</th><th scope="col" class="num">Words</th>${[
		head("Median<br>sentence", "Median words per sentence."),
		head("Clause cues<br>per 100", "Subordinating words such as because, although, which and who, per 100 sentences."),
		head("Rare words<br>per 1,000", "Words rarely encountered in everyday language."),
		head("Shared<br>words", "Share of adjacent sentences on a page that repeat a content word, a sign that each sentence picks up the one before."),
		head("Causal<br>per 1,000", "Connectives that state a cause or result: because, therefore, so, as a result."),
		head("Contrast<br>per 1,000", "Connectives that state a contrast: but, however, although, instead."),
		head("Flesch–<br>Kincaid", "A school-grade formula from words per sentence and syllables per word only."),
	].join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function longestList(view: LanguageView): string {
	return `<ol class="longest">${view.longest
		.map(
			(sentence) =>
				`<li data-lesson="${sentence.lesson}"><q>${esc(sentence.text)}</q> <span class="file">${sentence.words} words · ${CHANNEL_LABEL[sentence.channel].toLowerCase()} · ${where(view.places, sentence.ref)}</span></li>`,
		)
		.join("")}</ol>`;
}

/** "L3" with the full title on hover; the report's lesson key explains it. */
const lessonCell = (index: number, title: string, rows = 2) =>
	`<th scope="rowgroup" rowspan="${rows}"><span title="${esc(title)}">L${index + 1}</span></th>`;

const count = (value: number, of: number) => (value && of ? `${value}<span class="share"> · ${Math.round((100 * value) / of)}%</span>` : `${value}`);

const STRUCTURE_COLUMNS = [
	["Clause cues per 100 sentences", "Subordinating words such as because, although, which and who, per 100 sentences."],
	["2+ clause cues", "Sentences with two or more subordinate clause cues, and their share of the lesson's sentences."],
	["Possible passive patterns", "Sentences with a form of be followed by a possible past participle, such as \u201cis given\u201d. The pattern can also match adjectives."],
	["Nominalisations per 100 words", "Words of seven or more letters ending in -tion, -sion, -ment, -ness, -ity, -ance or -ence."],
	["Front-loaded", "Sentences opening with eight or more words, starting with a clause cue or preposition, before the first comma."],
] as const;

function structureTable(view: LanguageView): string {
	const rows = view.lessons.map((lesson, index) => {
		const examples = view.locale.toLowerCase().startsWith("en") ? reviewLists(view, index + 1) : "";
		const channels = present(lesson.channels);
		const counts = channels.map(([channel, { structure: data, sentences: total }]) => {
			const values = data
				? [data.clauseCuesPer100Sentences, count(data.twoOrMoreClauseCues, total), count(data.passive, total), data.nominalisationsPer100Words, count(data.frontLoaded, total)]
					.map((value) => `<td class="num">${value}</td>`).join("")
				: `<td colspan="5">${view.locale.toLowerCase().startsWith("en") ? "No sentences" : "Not measured for this language"}</td>`;
			return `<tr data-lesson="${index + 1}">${channel === "screen" ? lessonCell(index, lesson.title, channels.length + (examples ? 1 : 0)) : ""}<th scope="row">${CHANNEL_LABEL[channel]}</th><td class="num">${total}</td>${values}</tr>`;
		}).join("");
		return `<tbody>${counts}${examples ? `<tr data-lesson="${index + 1}"><td colspan="7">${examples}</td></tr>` : ""}</tbody>`;
	}).join("");
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Sentence structure by lesson"><table class="blocks sentence-structure"><caption class="sr">Sentence structure by lesson</caption><thead><tr><th scope="col">Lesson</th><th scope="col">Channel</th><th scope="col" class="num">Sentences</th>${STRUCTURE_COLUMNS.map(([label, help]) => `<th scope="col" class="num"><abbr class="defined" tabindex="0" title="${esc(help)}">${label}</abbr></th>`).join("")}</tr></thead>${rows}</table></div>`;
}

function markedSentence(sentence: Sentence): string {
	let from = 0;
	let html = "";
	for (const span of [...(sentence.structure?.triggers ?? [])].sort((a, b) => a.start - b.start)) {
		if (span.start < from) continue;
		html += esc(sentence.text.slice(from, span.start)) + `<mark>${esc(sentence.text.slice(span.start, span.end))}</mark>`;
		from = span.end;
	}
	return html + esc(sentence.text.slice(from));
}

const CONSTRUCTION_LABEL: Record<Construction, string> = {
	passive: "Possible passive patterns",
	clauses: "Sentences with two or more clause cues",
	frontLoaded: "Front-loaded sentences",
	nominal: `Sentences with ${NOMINAL_HEAVY} or more nominalisations`,
};

/** Closed construction lists directly below one lesson's counts, with sentence ids and sources. */
function reviewLists(view: LanguageView, lesson: number): string {
	return (Object.keys(CONSTRUCTION_LABEL) as Construction[])
		.map((construction) => {
			const list = view.flagged[construction].filter((sentence) => sentence.lesson === lesson);
			if (!list.length) return "";
			return `<details class="review-group"><summary>${CONSTRUCTION_LABEL[construction]} · ${list.length}</summary><ol class="review">${list
				.map((sentence) => `<li id="${esc(sentence.id)}" data-lesson="${sentence.lesson}"><q>${markedSentence(sentence)}</q> <span class="file"><code>${esc(sentence.id)}</code> · ${CHANNEL_LABEL[sentence.channel].toLowerCase()} · ${where(view.places, sentence.ref)}</span></li>`)
				.join("")}</ol></details>`;
		})
		.join("");
}

const per1000 = (value: number, of: number) => (of ? (1000 * value) / of : 0);

function vocabularyTable(view: LanguageView, vocabulary: Vocabulary): string {
	const max = Math.max(1, ...vocabulary.lessons.flatMap((lesson) => present(lesson).map(([, data]) => per1000(data.rare, data.words))));
	const rows = vocabulary.lessons
		.flatMap((lesson, index) =>
			present(lesson).map(([channel, data], _, channels) => {
				const rare = per1000(data.rare, data.words);
				const distinct = vocabulary.rare.filter((word) => word.lessons.includes(index + 1)).length;
				return `<tr data-lesson="${index + 1}">${channel === "screen" ? lessonCell(index, view.lessons[index]?.title ?? "", channels.length) : ""}<th scope="row">${CHANNEL_LABEL[channel]}</th><td class="num">${data.words}</td><td class="num">${Math.round(per1000(data.lessCommon, data.words))}</td><td class="bar-cell"><span class="rare-bar" style="width:${((160 * rare) / max).toFixed(1)}px"></span><span class="bar-total">${Math.round(rare)}</span></td>${channel === "screen" ? `<td class="num" rowspan="${channels.length}">${distinct}</td>` : ""}</tr>`;
			}),
		)
		.join("");
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Word familiarity by lesson"><table class="blocks vocabulary"><caption class="sr">Word familiarity by lesson</caption><thead><tr><th scope="col">Lesson</th><th scope="col">Channel</th><th scope="col" class="num">Words</th><th scope="col" class="num"><abbr class="defined" tabindex="0" title="Words encountered infrequently in everyday language">Uncommon per 1,000 words</abbr></th><th scope="col"><abbr class="defined" tabindex="0" title="Words rarely encountered in everyday language">Rare per 1,000 words</abbr></th><th scope="col" class="num">Distinct rare words</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** One table of rare words, first use first, inside a single accordion; its columns sort. */
function rareLists(view: LanguageView, vocabulary: Vocabulary): string {
	const rows = [...vocabulary.rare]
		.sort((a, b) => (view.places[a.ref]?.position ?? 0) - (view.places[b.ref]?.position ?? 0))
		.map((word) => `<tr data-lessons="${word.lessons.join(" ")}"><th scope="row">${esc(word.forms ? word.forms.join(", ") : word.word)}</th><td class="num">${word.uses}</td><td>${where(view.places, word.ref)} <code>${esc(word.firstUse)}</code></td><td>${word.glossed ? "Glossary tooltip" : ""}</td></tr>`)
		.join("");
	return `<details class="review-group"><summary>Rare words · ${vocabulary.rare.length}</summary><div class="table-wrap" tabindex="0" role="region" aria-label="Rare words"><table class="blocks"><caption class="sr">Rare words</caption><thead><tr><th scope="col">Word</th><th scope="col" class="num">Uses</th><th scope="col">First used</th><th scope="col">Explained by</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function acronymTable(view: LanguageView): string {
	const rows = view.acronyms
		.map(
			(item) =>
				`<tr data-lessons="${[...new Set([item.firstUse, item.expandedAt].flatMap((ref) => ref && view.places[ref] ? [view.places[ref]!.lesson] : []))].join(" ")}"><th scope="row">${esc(item.acronym)}</th><td class="num">${item.uses}</td><td>${where(view.places, item.firstUse)}</td><td>${item.expandedAt ? where(view.places, item.expandedAt) : "Not spelled out"}</td><td>${item.expandedAt && item.usedBeforeExpansion ? "Used before it is spelled out" : ""}</td></tr>`,
		)
		.join("");
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="Acronyms"><table class="blocks"><caption class="sr">Acronyms</caption><thead><tr><th scope="col">Acronym</th><th scope="col" class="num">Uses</th><th scope="col">First used</th><th scope="col">Spelled out</th><th scope="col">Note</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** Sentences: length, readability, structure, and the sentences to look at. */
export function renderSentences(view: LanguageView): string {
	const english = view.locale.toLowerCase().startsWith("en");
	const withTranscripts = transcribed(view);
	const reference = lengthReference(view), cap = lengthCap(view);
	const medians = view.lessons.flatMap((lesson, index) => lesson.channels.screen.medianLength === null ? [] : [{ lesson: index + 1, words: lesson.channels.screen.medianLength }]).sort((a, b) => a.words - b.words);
	const first = medians[0], last = medians.at(-1);
	const profileLead = first && last && first.words !== last.words ? `<p class="rule">Median on-screen sentence length ranges from ${first.words} words in L${first.lesson} to ${last.words} in L${last.lesson}.</p>` : "";
	return `<section aria-labelledby="sentences">
${sectionHead("sentences", "Sentences", "How demanding are the sentences to read, and to follow when spoken?", `<p class="rule">${withTranscripts ? "On-screen text, narration and transcripts are measured separately." : "On-screen text and narration are measured separately."}</p>${method(`<p class="rule">Prose only: on-screen headings, checks, buttons and data displays are left out, though narration attached to them counts, and source pages are left out entirely. A sentence ends at a full stop, question or exclamation mark, at the end of a paragraph or list item, or where a closing bracket, colon or semicolon is followed by a capital letter, as list items read aloud are.</p>${withTranscripts ? `<p class="rule">Transcripts are the transcripts written for audio and video in the course and, in exported HTML, the text of caption track files. They follow the same counting rules as narration and stay a separate channel. Trace does not time them, because it has no playback length for the media. Studio's inspect output does not include caption track contents, so a course read from inspect JSON contributes no caption text.</p>` : ""}`, "What counts as a sentence")}`)}
${viewBlock({ id: "sentence-length", level: 3, title: "Sentence length", question: `How long are the sentences, ${withTranscripts ? "on screen, in narration and in transcripts" : "on screen and in narration"}?`, lead: `<p class="rule">${reference === null ? "There are no sentences to plot." : `The dashed reference is ${reference} words. Sentences of ${cap} words or more sit at ${cap}+.`}</p>${method(`<p class="rule">The reference is the mean sentence length plus two standard deviations, rounded to the nearest word. ${withTranscripts ? "It includes on-screen, narration and transcript sentences. The examples list up to 12 longest sentences across the course; identical text in two channels on the same page appears once." : "It includes on-screen and narration sentences. The examples list up to 12 longest sentences across the course; identical on-screen and narration text on the same page appears once."} The lesson filter shows matching examples from that list.</p>`)}`, chart: `${legend([["sentence-screen", "On screen"], ["sentence-narration", "Narration"], ...(withTranscripts ? [["sentence-transcript", "Transcript"] as [string, string]] : []), ["median-key", "Median"]], ` <span class="legend-item"><svg width="132" height="20" aria-hidden="true">${[1, 5, 10]
		.map((count, index) => `<circle class="sentence screen" cx="${10 + index * 40}" cy="10" r="${radius(count).toFixed(1)}"/><text class="page-label" x="${22 + index * 40}" y="14">${count}</text>`)
		.join("")}</svg> sentences (${withTranscripts ? "mark" : "dot"} area)</span>`)}${strip(view)}`, table: lengthTable(view), after: `<h4>Longest sentences</h4>${longestList(view)}` })}
${viewBlock({ id: "readability", level: 3, title: "Text profile by lesson", question: "What makes each lesson's text easier or harder to read?", lead: english
		? `${profileLead}${method(`<p class="rule">Sentence length and clause cues describe syntax, rare words describe vocabulary, and shared words and connectives describe how sentences hold together, after Coh-Metrix. These measures support comparisons between lessons. Flesch–Kincaid counts only sentence and word length.</p><p class="rule">Shared words: adjacent sentences on the same page, ${withTranscripts ? "on screen, in narration or in a transcript" : "on screen or in narration"}, that share a content word of four or more letters outside a short list of common words, with a plural s ignored; shown when a lesson has at least five such pairs. Causal connectives: because, therefore, thus, hence, consequently, as a result, due to, so that, in order to, that's why, which means, and so after a comma or at the start. Contrast connectives: but, however, although, though, whereas, yet, instead, nevertheless, nonetheless, despite, in contrast, on the other hand, unlike, rather than. Since and while are left out because they also mark time. Rates are per 1,000 words and shown for at least 100 words. Flesch–Kincaid grade = 0.39 × words per sentence + 11.8 × syllables per word − 15.59, with syllables estimated from English spelling; it was calibrated on school texts and rises with academic-style prose.</p>`)}`
		: `<p class="rule">These measures use English word lists, so only sentence length and word counts are shown for this course's language.</p>`, table: profileTable(view) })}
${viewBlock({ id: "structure", level: 3, title: "Sentence structure", question: "Which sentence patterns occur in each lesson?", lead: `<p class="rule">${english ? "Open a pattern below a lesson's counts to read its sentences." : "Sentence examples need English; sentence counts are shown for this course."}</p>
${method(`<p class="rule">${english ? `${withTranscripts ? "An id such as 3.9.s2 means the second on-screen sentence on page 3.9; n means narration and t a transcript. Lists combine on-screen, narration and transcript sentences, so their counts sum all three channels." : "An id such as 3.9.s2 means the second on-screen sentence on page 3.9; n means narration. Lists combine on-screen and narration sentences, so their counts sum both channels."} Nominalisation examples have at least ${NOMINAL_HEAVY} matching words. The rules use English word patterns without a parser: they miss unlisted constructions and can count words used in other ways, such as \u201cis interested\u201d as a possible passive pattern. Clause cues are because, although, though, while, whereas, if, unless, since, when, whenever, where, which, who, whom and whose, when another word follows before punctuation, except \u201cbecause of\u201d and \u201csince\u201d before a number; \u201cthat\u201d is left out. A possible passive pattern is am, is, are, was, were, be, been or being followed within two words by a word ending in -ed or -en or one of: ${[...IRREGULAR_PARTICIPLE].join(", ")}. Front-loaded sentences start with a clause cue or one of after, before, during, in, on, at, by, with, without, for, from, under, over, between, among, through, across, beyond, despite, until, into, upon, and have eight or more words before the first comma.` : "Not measured for this language. These word-pattern rules are for English."}</p>`)}`, table: structureTable(view) })}
</section>`;
}

/** Words and terms: how familiar the vocabulary is, acronyms, and where a newcomer may get stuck. */
export function renderWords(view: LanguageView, terms?: TermsView): string {
	const rates = (view.vocabulary?.lessons ?? []).flatMap((lesson, index) => lesson.screen.words ? [{ lesson: index + 1, rate: Math.round(per1000(lesson.screen.rare, lesson.screen.words)) }] : []).sort((a, b) => a.rate - b.rate);
	const first = rates[0], last = rates.at(-1);
	const vocabularyLead = first && last && first.rate !== last.rate ? `<p class="rule">On-screen rare-word counts range from ${first.rate} per 1,000 words in L${first.lesson} to ${last.rate} in L${last.lesson}.</p>` : "";
	return `<section aria-labelledby="words">
${sectionHead("words", "Words and terms", "Which words and terms might learners not know?")}
${view.vocabulary ? `${viewBlock({ id: "vocabulary", level: 3, title: "Word frequency", question: "How many words would be rare for a general audience?", lead: `${vocabularyLead}
${method(`<p class="rule">Frequency comes from TUBELEX, 172 million words of English YouTube subtitles, on the Zipf scale (log10 of uses per billion words); uncommon means Zipf ${RARE} to below ${LESS_COMMON}, one to fewer than ten uses per million words; rare means below Zipf ${RARE}, fewer than one use per million words. Names and acronyms are left out. Words are lowercased and split at hyphens and apostrophes, as TUBELEX counts them, and an inflected word takes the frequency of its base form when that is higher: \u201cspillways\u201d counts as \u201cspillway\u201d, whose TUBELEX lemma frequency includes every inflection. Plurals, -ed, -ing and -s forms are matched by spelling; comparatives and derived words such as \u201cplanter\u201d keep their own frequency. A word counts as a name when the course never writes it in lower case and capitalises it mid-sentence. Words that appear in code anywhere in the course are left out. Frequency in subtitles stands in for how familiar a word is to a general audience, not to your learners; a word the course teaches can be rare and still well supported. Glossary tooltips are matched on their term.</p>`)}`, table: `${vocabularyTable(view, view.vocabulary!)}${rareLists(view, view.vocabulary!)}` })}` : ""}
${viewBlock({ id: "acronyms", level: 3, title: "Acronyms", question: "Which acronyms are used, and are they spelled out?", lead: `<p class="rule">Spelled out means the course expands the acronym somewhere, such as \u201cFull Name (ACR)\u201d or a glossary tooltip.</p>${method(`<p class="rule">Runs of two to six capital letters, ${transcribed(view) ? "on screen, in tooltips, in narration and in transcripts" : "on screen, in tooltips and in narration"}. Capitals in code, and words the course also writes in lower case, such as a shouted \u201cBYE\u201d, are not counted. An acronym counts as spelled out where the text reads "Full Name (ACR)", a capitalised name has its initials, the acronym introduces a list whose items spell it, or a glossary tooltip explains it. Other ways of spelling it out are not detected.</p>`)}`, table: acronymTable(view) })}
${terms ? renderTerms(terms) : ""}
</section>`;
}

export const LANGUAGE_STYLE = `
svg .sentence{stroke:var(--surface);stroke-width:1}svg .sentence.screen{fill:var(--ink-2)}svg .sentence.narration{fill:var(--accent)}svg .sentence.transcript{fill:var(--ink)}
svg .median{stroke:var(--ink);stroke-width:2}svg .median-halo{stroke:var(--surface);stroke-width:6}
svg .reference{stroke:var(--muted);stroke-width:1;stroke-dasharray:3 3}
.key.sentence-screen{border-radius:50%;background:var(--ink-2);width:8px;height:8px}
.key.sentence-narration{border-radius:50%;background:var(--accent);width:8px;height:8px}
.key.sentence-transcript{background:var(--ink);width:7px;height:7px}
.key.median-key{width:2px;height:12px;background:var(--ink)}
.longest{max-width:48rem;padding-left:1.4rem}.longest li{margin-bottom:.6rem}
.longest q{display:block;margin:.1rem 0}
section[aria-labelledby=language] td:nth-child(2),section[aria-labelledby=language] th[scope=row]{white-space:nowrap}
.share{color:var(--ink-2)}
.review-group>summary{font-weight:600}
.review-lesson{margin:.75rem 0 .25rem;font-size:.9rem}.review{max-width:48rem;padding-left:1.4rem}.review li{margin-bottom:.5rem}
.review code{font-size:.8rem;color:var(--ink-2)}.review q{display:block}
.num-inline{color:var(--ink-2);font-size:.85rem;font-variant-numeric:tabular-nums}
.vocabulary td.bar-cell{min-width:12rem;white-space:nowrap}.vocabulary .bar-total{margin-left:.5rem;font-variant-numeric:tabular-nums}
.vocabulary .rare-bar{display:inline-block;height:12px;background:var(--accent);vertical-align:middle;border-radius:0 2px 2px 0}
.review mark{background:none;color:inherit;font-weight:700;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px}
`;
