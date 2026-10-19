import { CUES, SOLVER_CUES, SPREAD_FIXES, type Cue, type ItemCueRow, type ItemCuesView, type ProbeScore } from "./item-cues.ts";
import { generated, method, reflowTables, viewBlock } from "./modes.ts";
import { esc, lessonTags, where } from "./places.ts";

const number = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2);
const probability = (p: number) => esc(p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const sentence = (text: string) => `${esc(text)}${/[.!?]$/.test(text) ? "" : "."}`;
function table(caption: string, headings: string[], rows: string): string {
	return `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(caption)}"><table><caption>${esc(caption)}</caption><thead><tr>${headings.map(heading => `<th scope="col">${esc(heading)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
const tails = (score: ProbeScore) => `Chance of this many or more by guessing: ${score.tooFewItems ? "Too few items to compare with guessing" : probability(score.p)}. Chance of this few or fewer: ${score.tooFewItemsLow ? "Too few items to compare with guessing" : probability(score.pLow)}.`;
function itemWhere(view: ItemCuesView, ref: string): string {
	const item = view.course.items.find(item => item.ref === ref), place = view.places[ref];
	return `${where(view.places, ref)} <span class="file">${esc(item?.label ?? ref)}${place ? ` · ${esc(place.file)}${place.line !== null ? `:${place.line}` : ""}` : ""}</span>`;
}
const sources = (view: ItemCuesView, refs: string[]) => [...new Set(refs)].map(ref => itemWhere(view, ref)).join("; ") || "None";

function summary(row: ItemCueRow): string {
	const score = row.choicesOnly;
	return score ? `<p>The solver picked the key on ${score.right} of ${score.total} items without seeing the questions. Guessing gets about ${number(score.chanceExpected)}. ${tails(score)} ${generated(score.model, "solver responses")}</p>`
		: "<p><strong>Probes not run.</strong> No solver test yet. Run praxity-trace prepare item-cues to test whether the options give away the key.</p>";
}

function overview(view: ItemCuesView): string {
	return table("Choices-only summary: course, then banks", ["Scope", "Right / total", "Guessing gets about", "Chance of this many or more", "Chance of this few or fewer", "Cover-the-options"], [view.course, ...view.banks].map(row => {
		const score = row.choicesOnly;
		return `<tr ${lessonTags(view.places, row.items.map(item => item.ref))}><th scope="row">${esc(row.label)}</th><td>${score ? `${score.right} / ${score.total}` : "Probes not run"}</td><td>${number(row.chanceExpected)}</td><td>${score ? score.tooFewItems ? "Too few items to compare with guessing" : probability(score.p) : "Probes not run"}</td><td>${score ? score.tooFewItemsLow ? "Too few items to compare with guessing" : probability(score.pLow) : "Probes not run"}</td><td>${row.coverTheOptions?.status ?? "Probes not run"}</td></tr>`;
	}).join(""));
}

function cueTables(row: ItemCueRow, view: ItemCuesView): string {
	return (["cue", "writing"] as const).map(kind => {
		const counts = kind === "cue" ? row.cueCounts : row.writingCounts;
		return `<h4>${kind === "cue" ? "Cues to the key" : "Item-writing checks, not evidence of a key cue"}</h4>${table(`${row.label}: ${kind === "cue" ? "cues to the key" : "item-writing checks"}`, ["Pattern", "Items", "What to change", "Where"], (Object.keys(CUES) as Cue[]).filter(cue => CUES[cue].kind === kind).map(cue => `<tr ${lessonTags(view.places, row.items.map(item => item.ref))}><th scope="row">${esc(CUES[cue].label)}</th><td>${counts[cue] === null ? "Not checked: English-only rule" : `${counts[cue]} / ${row.count}`}</td><td>${esc(CUES[cue].fix)}</td><td>${sources(view, row.items.filter(item => item.flags.some(flag => flag.cue === cue)).map(item => item.ref))}</td></tr>`).join(""))}`;
	}).join("");
}

function bankPatterns(row: ItemCueRow, view: ItemCuesView): string {
	const convergence = row.convergence;
	const refs = row.items.filter(item => item.flags.some(flag => flag.cue === "convergence")).map(item => item.ref);
	return `<h4>Patterns across the bank</h4>${convergence ? `<p>Picking the option that shares the most words with the others would get ${number(convergence.expected)} right; guessing gets ${number(convergence.chanceExpected)}. Chance of this many or more ${probability(convergence.p)}; chance of this few or fewer ${probability(convergence.pLow)}. ${convergence.p < 0.05 || refs.length ? esc(CUES.convergence.fix) : "No convergence pattern above guessing."}</p><p>The key alone shares the most words on ${counted(refs.length, "item")}: ${sources(view, refs)}.</p>` : "<p>Convergence: Not checked: English-only rule.</p>"}${row.consultation ? `<p>The key is the only consulting option in ${row.consultation.count} of ${counted(row.consultation.total, "item")}. ${row.consultation.count ? esc(SPREAD_FIXES.consultation) : "No consultation pattern to inspect."}</p>` : "<p>Consultation wording: Not checked: English-only rule.</p>"}`;
}

function spreads(row: ItemCueRow, view: ItemCuesView): string {
	const refs = row.items.map(item => item.ref);
	return `<h4>Key length and position</h4><p>${esc(SPREAD_FIXES.length)} ${esc(SPREAD_FIXES.position)}</p>${row.spreads.map(group => {
		const note = `<p>${group.options}-option items: ${counted(group.keyLongest, "key")} longest, ties included; guessing expects ${number(group.longestExpected)}. ${group.fixedCount} known fixed order; ${group.shuffledCount} shuffled at runtime; ${group.unknownCount} shuffle unknown.</p>`;
		if (row.id !== "course" && group.count < 20) return `${note}<p>Fewer than 20 items; inspect the course spread and the individual items.</p>`;
		return `${note}${table(`${row.label}: ${group.options}-option items (${group.count}), key position`, ["Position, known fixed order", "Keys", "Guessing expects"], group.keyPositions.map((count, i) => `<tr ${lessonTags(view.places, refs)}><th scope="row">Position ${i + 1}</th><td>${count}</td><td>${number(group.positionExpected)}</td></tr>`).join(""))}${table(`${row.label}: ${group.options}-option items (${group.count}), key length rank`, ["Length rank", "Keys", "Guessing expects", "Equal-share reference", "Length-rank band"], group.keyLengthRanks.map((count, i) => `<tr ${lessonTags(view.places, refs)}><th scope="row">Rank ${i + 1}${i === 0 ? ", shortest" : ""}</th><td>${count}</td><td>${number(group.rankExpected[i]!)}</td><td>${number(group.evenRankReference)}</td><td>${group.rankBand ? `${group.rankBand[i]} 10–40% band` : "Fewer than 20 items"}</td></tr>`).join(""))}`;
	}).join("")}`;
}

function solverResponses(row: ItemCueRow, view: ItemCuesView): string {
	const score = row.choicesOnly, cover = row.coverTheOptions;
	if (!score || !cover) return "";
	const refs = row.items.map(item => item.ref);
	const cueTotals = table(`${row.label}: solver cue totals`, ["Cue used", "Items", "What to change", "Where"], Object.entries(SOLVER_CUES).map(([code, cue]) => `<tr ${lessonTags(view.places, refs)}><th scope="row">${esc(cue.label)}</th><td>${score.cueCounts[code as keyof typeof SOLVER_CUES]}</td><td>${esc(cue.fix)}</td><td>${sources(view, score.items.filter(item => item.cue === code).map(item => item.ref))}</td></tr>`).join(""));
	const choices = table(`${row.label}: choices-only responses`, ["Item", "Chosen option", "Key", "Picked key", "Cue used", "Solver note"], score.items.map(item => `<tr ${lessonTags(view.places, [item.ref])}><th scope="row">${itemWhere(view, item.ref)}</th><td>${esc(item.response)}</td><td>${esc(item.key)}</td><td>${item.right ? "Yes" : "No"}</td><td>${esc(SOLVER_CUES[item.cue].label)}</td><td>${esc(item.note)}</td></tr>`).join(""));
	const judgement = { matches: "Matches key", differs: "Differs from key", cantTell: "Solver can't tell", alsoCorrect: "Stem answerable, key not unique" };
	const coverTable = table(`${row.label}: stem answers needing judgement`, ["Item", "Stem", "Solver answer", "Key", "Judgement"], [...cover.items].sort((a, b) => Number(b.judgement === "differs") - Number(a.judgement === "differs")).map(item => `<tr ${lessonTags(view.places, [item.ref])}><th scope="row">${itemWhere(view, item.ref)}</th><td>${esc(item.stem)}${item.stemDependsOnNonText ? "<p>Stem depends on non-text content.</p>" : ""}</td><td>${esc(item.response)}</td><td>${esc(item.key)}</td><td>${item.judgement ? judgement[item.judgement] : "Needs judgement · not judged"}</td></tr>`).join(""));
	return `<h4>What let the choices-only solver pick?</h4>${cueTotals}${choices}<h4>Can the stem be answered on its own?</h4><p>${generated(cover.model, "stem solver responses")}. ${cover.judged ? `${cover.right} stem answerable: ${cover.outcomes.matches} matches and ${cover.outcomes.alsoCorrect} also correct with a non-unique key; ${cover.outcomes.differs} differs, ${cover.outcomes.cantTell} can't tell, ${cover.pending} not judged.` : "Not judged. Answers need judgement; they are not marked wrong."}${cover.judgeModel ? ` Judgements: ${generated(cover.judgeModel, "separate judge")}.` : ""} Also-correct answers are defensible, not wrong or cover failures. Check that the options make the key the single best answer. No guessing probability is assigned to free answers.</p>${coverTable}`;
}

function itemTable(row: ItemCueRow, view: ItemCuesView): string {
	return table(`${row.label}: item measurements`, ["Item", "Key position", "Key length rank", "Key longest, ties included", "Option lengths, characters", "Patterns and changes"], row.items.map(item => `<tr ${lessonTags(view.places, [item.ref])}><th scope="row">${itemWhere(view, item.ref)}</th><td>${item.shuffle === false ? `Position ${item.keyPosition}` : `${item.shuffle ? "Shuffled at runtime" : "Shuffle unknown"}; authored position ${item.keyPosition}`}</td><td>${item.keyLengthRank}</td><td>${item.keyLongest ? "Yes" : "No"}</td><td>${item.lengths.join(", ")}</td><td>${item.flags.length ? `<ul>${item.flags.map(flag => `<li ${lessonTags(view.places, [item.ref])}>${sentence(CUES[flag.cue].label)} ${esc(flag.detail)}; options ${flag.options.join(", ")}. ${esc(CUES[flag.cue].fix)}</li>`).join("")}</ul>` : "No scripted patterns detected; read the probe results."}</td></tr>`).join(""));
}

function chart(row: ItemCueRow, view: ItemCuesView): string {
	const bars = (title: string, rows: Array<{ label: string; count: number; refs: string[] }>) => `<h4>${esc(title)}</h4><svg width="100%" viewBox="0 0 900 ${rows.length * 32 + 12}" role="img" aria-label="${esc(`${row.label}: ${title}. ${rows.map(value => `${value.label}: ${value.count}`).join("; ")}. Sources and changes are in Table mode.`)}">${rows.map((value, i) => `<g ${lessonTags(view.places, value.refs)}><text x="0" y="${i * 32 + 22}" fill="var(--ink-2)">${esc(value.label)}</text><rect x="420" y="${i * 32 + 8}" width="${400 * value.count / Math.max(1, row.count)}" height="18" fill="var(--ink-2)"/><text x="${428 + 400 * value.count / Math.max(1, row.count)}" y="${i * 32 + 22}" fill="var(--ink-2)">${value.count}</text></g>`).join("")}</svg>`;
	const cueBars = (["cue", "writing"] as const).map(kind => {
		const counts = kind === "cue" ? row.cueCounts : row.writingCounts;
		const selected = (Object.keys(CUES) as Cue[]).filter(cue => CUES[cue].kind === kind);
		return `${selected.filter(cue => counts[cue] === null).map(cue => `<p>${esc(CUES[cue].label)}: Not checked: English-only rule.</p>`).join("")}${bars(kind === "cue" ? "Cues to the key" : "Item-writing checks", selected.filter(cue => typeof counts[cue] === "number").map(cue => ({ label: CUES[cue].label, count: counts[cue]!, refs: row.items.filter(item => item.flags.some(flag => flag.cue === cue)).map(item => item.ref) })))}`;
	}).join("");
	return `${cueBars}<ul>${(Object.keys(CUES) as Cue[]).filter(cue => row.items.some(item => item.flags.some(flag => flag.cue === cue))).map(cue => `<li ${lessonTags(view.places, row.items.map(item => item.ref))}>${sentence(CUES[cue].label)} ${esc(CUES[cue].fix)}</li>`).join("")}</ul>${reflowTables(spreads(row, view))}`;
}

export function renderItemCues(view: ItemCuesView): string {
	if (!view.course.count) {
		if (!view.excluded.length) return "";
		return `<section aria-labelledby="item-cues">${viewBlock({ id: "item-cues", headingId: "item-cues", level: 2, title: "Item cues", lead: "<p>No eligible keyed choices. If keys are unavailable, export with inspect projection 2.</p>", table: table("Excluded items", ["Item", "Reason"], view.excluded.map(item => `<tr ${lessonTags(view.places, [item.ref])}><th scope="row">${itemWhere(view, item.ref)}</th><td>${esc(item.reason)}</td></tr>`).join("")) })}</section>`;
	}
	const rows = [view.course, ...view.banks];
	const body = (mode: "chart" | "table") => rows.map(row => `<div ${lessonTags(view.places, row.items.map(item => item.ref))}><h3>${esc(row.label)}</h3>${summary(row)}${bankPatterns(row, view)}${mode === "chart" ? chart(row, view) : `${cueTables(row, view)}${spreads(row, view)}${itemTable(row, view)}${solverResponses(row, view)}`}</div>`).join("");
	return `<section aria-labelledby="item-cues">${viewBlock({
		id: "item-cues", headingId: "item-cues", level: 2, title: "Item cues", question: "Can the options give away the key?",
		lead: `<p class="rule">These rules catch wording patterns only. A bank can pass them all and still give away its keys; the choices-only test is the measure. Solver answers are generated evidence, not learner observations.</p>${overview(view)}${method("<p>Banks use authored assessment groups, then lessons for ungrouped choices. The course row pools every included item once. Only single-selection, single-key choices with at least two readable text options are included, even if unscored.</p><p>Choices-only options are independently permuted per item using a reproducible hash of visible text and positional ref, never the key. Trace regenerates the mapping outside the bundle. The operator records actual model names. Both blind probes require every included item once. Cover-the-options requires a separate fresh judge for semantic matches, differences, also-correct answers or can't-tell responses; unjudged answers have no correctness score or p value.</p><p>Choices-only p is the exact upper tail, P(X ≥ right), and pLow the exact lower tail, P(X ≤ right), under independent uniform guesses at each item's 1/options. Mixed option counts use the exact Poisson-binomial distribution. Both tails include the observed count. Small banks are labelled per tail: upper when every answer right cannot reach p &lt; 0.05, lower when every answer wrong cannot reach pLow &lt; 0.05. Pooled counts, not a single lesson, are the primary comparison. Dependence between items and repeated solver runs limit inference.</p><p>Convergence sums pairwise content-word Jaccard overlaps rounded to nine decimals. Top ties split credit equally. Its exact tails use each item's fractional-credit distribution under random key placement. Only a unique key maximum is listed per item, and convergence is excluded from cueCounts. Consultation is a bank share, never an item flag.</p><p>English lexical checks run only for an en locale. Others explicitly say Not checked: English-only rule. Duplicate, near-duplicate and shared-lead checks use Unicode tokens without English stop words. Near-duplicates exceed 60% token Jaccard overlap and need meaning judgement; shared leads repeat four opening words or a label before a comma. They are item-writing checks, not evidence of a key cue.</p><p>Length is visible Unicode character count including spaces. Rank 1 is shortest; ties share the lower rank. Longest includes ties. Position counts include only known fixed-order items; authored positions remain in item records. Unknown shuffle stays unknown. Rank guessing expectations account for each item's ties; the equal-share reference is items/options. At least 20 items are needed to label the reference script's 10–40% rank band. Smaller banks use the course spread. These measurements describe patterns, not pass/fail rules.</p><p>Stem echo requires two more shared question content words in the key than every distractor. Simple English -s, -es, -ies, -ed and -ing suffixes are folded for stem echo; this is a rough lexical comparison, not semantic matching. Absolute words are always, never, none, every, completely, absolutely, entirely, all, must, necessarily; all can make incidental lexical hits. Qualifiers are only, just, merely. Hedges are usually, often, generally, sometimes, typically, depends, can depend, and may/might followed by a word other than not. Bare May, capitalized May inside an option, and could not are not hedges. Consultation uses ask, consult, check with, discuss with, agree with.</p>")}`,
		chart: body("chart"), table: body("table"),
		after: view.excluded.length ? table("Excluded items", ["Item", "Reason"], view.excluded.map(item => `<tr ${lessonTags(view.places, [item.ref])}><th scope="row">${itemWhere(view, item.ref)}</th><td>${esc(item.reason)}</td></tr>`).join("")) : "",
	})}</section>`;
}
