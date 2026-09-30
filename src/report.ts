import { typedLimits, type TypedMedia, type TypedNarration, type TypedAssessmentGroup, type SourceLocation } from "./inspect.ts";
import { formattedText } from "./text.ts";
import { inlineClient } from "./client.ts";
import packageJson from "../package.json" with { type: "json" };
import { ALIGNMENT_STYLE, type AlignmentView } from "./alignment-view.ts";
import { TRACE_STYLE, type TraceView } from "./trace.ts";
import { FLOW_SCRIPT, FLOW_STYLE } from "./flow.ts";
import { DISTINCTIONS_STYLE, type DistinctionsView } from "./distinctions.ts";
import { SPACING_STYLE, type SpacingView } from "./spacing.ts";
import { AVAILABILITY_STYLE, type AvailabilityView } from "./availability.ts";
import { GUIDES } from "./guides.ts";
import { RECOMMENDATIONS_STYLE, type RecommendationsView, renderRecommendations } from "./recommendations.ts";
import { TERMS_STYLE, type TermsView } from "./terms.ts";
import { VISUALS_STYLE, type VisualsView } from "./visuals.ts";
import { LANGUAGE_STYLE, type LanguageView } from "./language.ts";
import { EMPHASIS_STYLE, type EmphasisView } from "./emphasis.ts";
import { CONCEPTS_STYLE, type ConceptsView } from "./concepts-view.ts";
import { TASKS_STYLE, type TasksView } from "./tasks.ts";
import { FILTER_ALL, method, MODES_ALL, MODES_SCRIPT, MODES_STYLE, outline } from "./modes.ts";
import { SECTIONS } from "./sections.ts";
import { SCROLL_HINT_SCRIPT, SCROLL_HINT_STYLE } from "./scrollhint.ts";
import { COMMENTS_MARKUP, COMMENTS_SCRIPT, COMMENTS_STYLE } from "./comments.ts";
import { THEME_HEAD_SCRIPT, THEME_SCRIPT, THEME_STYLE, THEME_SWITCH, themeable } from "./theme.ts";
import { type LessonAnatomy, type Rhythm, rhythm } from "./anatomy.ts";
import { lessonTitle, pageKey } from "./places.ts";

export interface Report {
	tool: { name: "Praxity Trace"; version: string };
	courseHash: string;
	coverage?: { status: "partial"; limitations: string };
	source: { schema: string; studioVersion: string; revision?: string; projectionVersion?: 2; places?: import("./places.ts").Places; unlinkedNarrationCount?: number; mediaInventory?: Array<TypedMedia & { ref: string; lesson: number; page: number; location: SourceLocation | null }>; assessmentGroups?: Array<TypedAssessmentGroup & { ref: string; location: SourceLocation | null }>; unlinkedNarration?: Array<TypedNarration & { lesson: number; lessonFile: string }> };
	course: { title: string; locale: string };
	/** Schema 0 measured rate when available; otherwise a script-estimate fallback. */
	speakingWpm: number;
	anatomy: LessonAnatomy[];
	rhythm: Rhythm;
	trace: TraceView;
	language: LanguageView;
	emphasis: EmphasisView;
	alignment?: AlignmentView;
	concepts?: ConceptsView;
	terms?: TermsView;
	visuals?: VisualsView;
	spacing?: SpacingView;
	distinctions?: DistinctionsView;
	availability?: AvailabilityView;
	tasks?: TasksView;
	/** What to look for in each view (src/guides.ts), for agents reading this file. */
	guides: Omit<typeof GUIDES, "tasks"> & Partial<Pick<typeof GUIDES, "tasks">>;
	recommendations?: RecommendationsView;
}

/** Views that need a model's answer; each is drawn only when its answer is supplied. */
export type ModelViews = Pick<Report, "alignment" | "tasks" | "concepts" | "terms" | "visuals" | "spacing" | "distinctions" | "availability">;

const { tasks: taskGuide, ...baseGuides } = GUIDES;

export function buildReport(
	course: { title: string; locale: string },
	source: Report["source"],
	courseHash: string,
	{ speakingWpm, lessons }: { speakingWpm: number; lessons: LessonAnatomy[] },
	trace: TraceView,
	language: LanguageView,
	emphasis: EmphasisView,
	models: ModelViews = {},
): Report {
	return {
		...(source.schema === "praxity-inspect/1" ? { coverage: { status: "partial" as const, limitations: typedLimits(source.projectionVersion) } } : {}),
		tool: { name: "Praxity Trace", version: packageJson.version },
		courseHash,
		source,
		course,
		speakingWpm,
		anatomy: lessons,
		rhythm: rhythm(lessons, models.alignment && {
			model: models.alignment.model,
			pages: new Set(models.alignment.activities.flatMap((activity) => {
				const place = models.alignment?.places[activity.ref];
				return place ? [pageKey(place.lesson, place.page)] : [];
			})),
		}),
		trace,
		language,
		emphasis,
		...models,
		guides: models.tasks ? GUIDES : baseGuides,
	};
}

const esc = (value: string | number) =>
	String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
.viz-root{color-scheme:light;--surface:#fcfcfb;--plane:#f4f4f1;--ink:#0b0b0b;--ink-2:#52514e;--muted:#6b6a65;--grid:#e6e5df;--axis:#c9c8bf;--accent:#2a78d6;--on-accent:#000;--look:#c4501f;--note:#fdf0c2;--note-strong:#f7d95c;--note-ring:#a87f00;--bar:#a3a29b;--rail:#9c9b94}
@media (prefers-color-scheme:dark){.viz-root{color-scheme:dark;--surface:#1a1a19;--plane:#232322;--ink:#f4f4f1;--ink-2:#c3c2b7;--muted:#a3a29b;--grid:#2e2e2c;--axis:#44443f;--accent:#3987e5;--on-accent:#0b0b0b;--look:#e0703f;--note:#5e5116;--note-strong:#86701c;--note-ring:#e8c14a;--bar:#6b6a65;--rail:#6b6a65}}
*{box-sizing:border-box}
html{scroll-padding-top:4.5rem}
body{margin:0;background:var(--surface)}
.viz-root{font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--surface);min-height:100vh;margin:0;padding:0}
.report-content{--space-1:.5rem;--space-2:.75rem;--space-3:1rem;--space-4:1.5rem;--space-5:2.25rem;--space-6:3rem;--space-7:4.5rem;min-width:0;max-width:78rem;margin:0 auto;padding:0 4rem 4rem 2.5rem}
/* Top bar: the report's controls, always in reach. */
.topbar{position:sticky;top:0;z-index:15;display:flex;align-items:center;justify-content:space-between;gap:1rem;height:3.5rem;padding:0 max(4rem,calc((100vw - 78rem)/2 + 4rem)) 0 max(2.5rem,calc((100vw - 78rem)/2 + 2.5rem));background:color-mix(in srgb,var(--surface) 90%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--grid)}
.topbar-title{display:flex;align-items:baseline;gap:.75rem;min-width:0;margin:0;font-size:.875rem;white-space:nowrap}
.topbar-title .product{font-weight:650;letter-spacing:-.01em}
.topbar-title .course{color:var(--ink-2);overflow:hidden;text-overflow:ellipsis}
.topbar-controls{display:flex;align-items:center;gap:.5rem;flex:none}
.topbar-controls>*+*{margin-left:.25rem}
/* Report head */
.report-head{padding:2.75rem 0 1.5rem}
.report-content h1{font-size:1.875rem;line-height:1.2;font-weight:650;letter-spacing:-.015em;margin:0 0 .4rem}
.meta{margin:0 0 1rem;color:var(--ink-2);font-size:.9rem}
.lesson-key{display:flex;flex-wrap:wrap;gap:.35rem 1.25rem;margin:0;padding:0;list-style:none;font-size:.875rem;color:var(--ink-2)}
.lesson-key li{display:flex;gap:.4rem}.lesson-code{font-weight:650;color:var(--ink);font-variant-numeric:tabular-nums}
/* Sections and views */
.report-content > section{display:flow-root;margin:0;padding:0;border:0}
.report-content > section + section{margin-block-start:var(--space-6);padding-block-start:var(--space-4);border-block-start:1px solid var(--grid)}
.report-content h2{font-size:1.375rem;line-height:1.25;font-weight:650;letter-spacing:-.01em;margin:0}
.report-content h3{font-size:1.125rem;line-height:1.3;font-weight:620;margin:0}
.report-content .view-question{font-size:.9375rem}
.report-content .chart-title{font-size:.9375rem;color:var(--ink-2);font-weight:600}
.report-content .rule{max-width:46rem;margin:0;color:var(--ink-2);font-size:.9rem;line-height:1.55}
.report-content :is(.section-head,.view,.method,.legend,.chart-title){margin:0}
.report-content .section-head>.view-question,.report-content .section-head>h2+.rule{margin-block-start:var(--space-1)}
.report-content .section-head>.view-question+.rule{margin-block-start:var(--space-2)}
.report-content .section-head>.rule+.method{margin-block-start:var(--space-4)}
.report-content .section-head + :is(.view,.recommendation-list){margin-block-start:var(--space-4)}
.report-content .view + :is(.view,.generated-summary),.report-content .generated-summary + .view{margin-block-start:var(--space-5)}
.report-content .view > *{margin-block:0}
.report-content .view > .view-head + :is(.rule,.method,.table-wrap,.scroll-frame,.chart-title){margin-block-start:var(--space-2)}
.report-content .view > :is(.rule,.table-wrap,.scroll-frame) + .method{margin-block-start:var(--space-4)}
.report-content .view > .method + .method{margin-block-start:var(--space-1)}
.report-content .view > :is(.mode-chart,.mode-table,.rhythm,.guide){margin-block-start:var(--space-4)}
.report-content :is(.mode-chart,.mode-table,.pace-mode,.avail-mode,.lesson-variant) > *{margin-block:0}
.report-content :is(.mode-chart,.mode-table,.pace-mode,.avail-mode,.lesson-variant) > * + *{margin-block-start:var(--space-2)}
.report-content .mode-chart > :is(.pace-mode,.avail-mode){margin-block-start:0}
.report-content :is(.mode-chart,.mode-table) > :is(h4,.chart-title) + *{margin-block-start:var(--space-1)}
.report-content :is(.mode-chart,.mode-table):has(>.chart-title) > .lesson-variant{margin-block-start:var(--space-1)}
.report-content .method > :not(summary){margin-block:0}
.report-content .method > summary + *{margin-block-start:var(--space-1)}
.meta,.file{color:var(--ink-2)}
.file{display:block;font-size:.8rem;font-weight:400}
code{font:.85em ui-monospace,SFMono-Regular,Menlo,monospace}
abbr.defined{text-decoration:underline dotted var(--muted);text-underline-offset:.2em;cursor:help}
/* Content-sized tables by default; prose-heavy tables use the available reading width.
   SVG charts keep their own dimensions and scaling. Mobile table rules below still take precedence. */
:is(.objectives,.objective-groups,.evidence-table,.terms,.visuals){width:100%}
.viz-root a{color:inherit;text-decoration:none}
.viz-root a:hover{text-decoration:underline;text-underline-offset:.2em}
.viz-root a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* Tables */
:where(.viz-root) table{width:auto;max-width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:.875rem}
.report-content caption{text-align:left;font-size:.9375rem;font-weight:600;color:var(--ink-2);padding:0 0 var(--space-1)}
th,td{padding:.45rem .7rem;border-bottom:1px solid var(--grid);text-align:left;vertical-align:top}
thead th{vertical-align:bottom;color:var(--ink-2);font-size:.8rem;font-weight:600;line-height:1.25;border-bottom:1px solid var(--axis)}
thead th.num{white-space:normal;max-width:7rem}
thead th.two-line{white-space:nowrap}
tbody th{font-weight:500}
tbody tr:hover>*{background:color-mix(in srgb,var(--plane) 70%,transparent)}
tbody tr[hidden]{display:none}
.num{text-align:right}
td.where{white-space:nowrap;color:var(--ink-2)}.channel{display:block;font-size:.75rem;color:var(--muted)}
.oid{display:inline-block;min-width:2.9rem;font-weight:650;font-variant-numeric:tabular-nums;color:var(--ink)}
.group-member{display:grid;grid-template-columns:2.9rem minmax(0,1fr);align-items:baseline}.group-member .oid{min-width:0}
.composition tbody th{min-width:14rem}.composition td.num{white-space:nowrap}.composition .bar{display:inline-block;height:8px;margin-right:.5rem;vertical-align:0;background:var(--bar);border-radius:1px;min-width:1px}
.table-wrap,.scroll{overflow-x:auto;position:relative}
.table-wrap.long-table{max-height:70vh;overflow-y:auto;border-bottom:1px solid var(--axis);scrollbar-gutter:stable}
.sticky-table thead th,.long-table thead th{position:sticky;top:0;z-index:1;background:var(--surface);box-shadow:0 1px var(--axis)}
.table-cue{margin:.2rem 0 .75rem;color:var(--ink-2);font-size:.8rem}
.viz-root p,.viz-root li,.viz-root summary{overflow-wrap:anywhere}
.table-wrap:focus-visible,.scroll:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* Disclosures */
.report-content .method>summary{font-size:.85rem}
.report-content summary{cursor:pointer;color:var(--ink-2);font-size:.9rem;list-style:none;display:inline-flex;align-items:center;gap:.4rem}
.report-content summary::-webkit-details-marker{display:none}
.report-content summary:not(.icon-button)::before{content:"";width:.4rem;height:.4rem;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .12s;margin-right:.1rem}
.report-content details[open]>summary:not(.icon-button)::before{transform:rotate(45deg)}
.report-content summary:hover{color:var(--ink)}
@media (prefers-reduced-motion:reduce){.report-content summary::before{transition:none}}
/* Charts */
svg text{font:12px system-ui,-apple-system,"Segoe UI",sans-serif;fill:var(--ink-2)}
svg .page-label{fill:var(--muted)}
svg .grid{stroke:var(--grid)}svg .page{stroke:var(--axis)}
svg .mark{fill:var(--ink-2)}svg .mark.check{fill:var(--accent)}svg .mark.activity{fill:none;stroke:var(--accent);stroke-width:2}
svg [data-page]{pointer-events:all}svg .hit{fill:none;pointer-events:all}svg g:hover .hit{fill:var(--grid)}svg g:hover>.hit:has(~.crosshair){fill:none}
svg .narration{fill:var(--ink-2)}svg .narration-estimated{fill:var(--ink-2);fill-opacity:.28;stroke:var(--ink-2);stroke-width:1}
svg .reading{stroke:var(--accent);stroke-width:2}
svg .cumulative-narration{fill:none;stroke:var(--ink);stroke-width:2}svg .cumulative-narration.estimated{stroke-dasharray:4 3}svg .cumulative-reading{fill:none;stroke:var(--accent);stroke-width:2}
svg .bg{fill:var(--ink-2)}svg .bg.activity,svg .bg.check{fill:var(--accent)}svg .bg.l1{opacity:.35}svg .bg.l2{opacity:.55}svg .bg.l3{opacity:.78}svg .bg.l4{opacity:1}svg .bg.activity,svg .bg.check{opacity:1}
.key.bg-key-1{background:var(--ink-2);opacity:.35}.key.bg-key-2{background:var(--ink-2);opacity:.55}.key.bg-key-3{background:var(--ink-2);opacity:.78}.key.bg-key-4{background:var(--ink-2)}
.view:has(input[name=pace-view][value=page]:checked) .pace-mode[data-mode=cumulative],.view:has(input[name=pace-view][value=cumulative]:checked) .pace-mode[data-mode=page]{display:none}
.legend{display:flex;flex-wrap:wrap;gap:.3rem 1.1rem;align-items:center;color:var(--ink-2);font-size:.825rem}
.key{display:inline-block;width:11px;height:11px;margin-right:.4rem;vertical-align:-1px;border-radius:2px}
.key.activity{border:2px solid var(--accent)}.key.check{background:var(--accent)}
.key.narration{background:var(--ink-2)}.key.narration-estimated{border:1px solid var(--ink-2);background:color-mix(in srgb,var(--ink-2) 28%,transparent)}
.key.reading{height:2px;background:var(--accent);vertical-align:3px;border-radius:0}
.key.cumulative-narration{height:2px;background:var(--ink);vertical-align:3px;border-radius:0}.key.cumulative-reading{height:2px;background:var(--accent);vertical-align:3px;border-radius:0}
.interpretation{max-width:46rem;padding-left:1.1rem;font-size:.9rem}.interpretation li{margin:.4rem 0}.interpretation .file{display:inline;margin-left:.35rem}
.generated-summary{margin:0;padding:var(--space-3) 1.25rem;border-left:3px solid var(--axis);background:color-mix(in srgb,var(--plane) 60%,transparent);border-radius:0 8px 8px 0;max-width:50rem}
.report-content .generated-summary>.interpretation{margin:var(--space-2) 0 0}
/* Contents rail */
.views{position:fixed;z-index:14;right:max(.75rem,calc((100vw - 78rem)/2 + .75rem));top:5rem;width:2.25rem}
.views ul{position:absolute;right:0;top:0;display:grid;gap:0;list-style:none;padding:.25rem 0;margin:0;max-height:calc(100vh - 6rem);overflow:auto;width:2.25rem}
.views li{margin:0}
.views a{display:flex;justify-content:flex-end;align-items:center;gap:.6rem;min-height:1.4rem;padding:0 .3rem;color:var(--ink);text-decoration:none;white-space:nowrap;border-radius:4px}
.views a::after{content:"";display:block;flex:none;width:1.1rem;height:2px;border-radius:1px;background:var(--rail)}
.views a.sub::after{width:.55rem;opacity:.7}
.views a[aria-current]::after{width:1.6rem;height:2px;background:var(--ink)}
.views a.sub[aria-current]::after{width:1.1rem}
.toc-label{display:none;min-width:0}
.views:hover ul,.views:focus-within ul{width:min(19rem,calc(100vw - 2rem));padding:.5rem;background:var(--surface);border:1px solid var(--axis);border-radius:10px;box-shadow:0 10px 30px rgb(0 0 0 / .12)}
.views:hover .toc-label,.views:focus-within .toc-label{display:block;font-size:.85rem}
.views:hover a.sub .toc-label,.views:focus-within a.sub .toc-label{color:var(--ink-2);padding-left:.75rem}
.views:hover a,.views:focus-within a{justify-content:space-between;white-space:normal;padding:.15rem .4rem}
.views a:hover,.views a:focus-visible{background:var(--plane);outline:none}
.views a:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
[data-page]:focus-visible,[title]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* Tooltip card */
.report-tip{position:fixed;z-index:60;max-width:min(24rem,calc(100vw - 1rem));max-height:calc(100vh - 1rem);overflow:auto;padding:.6rem .75rem;background:var(--surface);color:var(--ink);border:1px solid var(--axis);border-radius:8px;box-shadow:0 10px 30px rgb(0 0 0 / .14);font-size:.825rem;line-height:1.45;white-space:normal;pointer-events:auto}
.report-tip[hidden]{display:none}
.table-wrap th .sort{display:inline-grid;place-items:center;vertical-align:-3px;margin-left:.2rem;width:1.35rem;height:1.35rem;padding:0;border:0;border-radius:4px;background:none;color:var(--muted);cursor:pointer}
.table-wrap th .sort:hover,.table-wrap th .sort.active{color:var(--ink);background:var(--plane)}
.table-wrap th .sort:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.rhythm{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:.5rem 2rem;max-width:46rem}
.rhythm-title{font-size:.875rem;font-weight:600;margin:0 0 .25rem}.rhythm ul{margin:0;padding:0;list-style:none;font-size:.875rem;font-variant-numeric:tabular-nums}.rhythm li{margin:.1rem 0}.rhythm li .file{display:inline;margin-left:.5rem}
.report-tip strong{display:block;font-weight:600;margin-bottom:.2rem}
.tip-facts{display:grid;grid-template-columns:auto 1fr;column-gap:.75rem;font-variant-numeric:tabular-nums}.tip-facts>div{display:contents}.tip-facts>.tip-line{display:block;grid-column:1/-1}.tip-facts span:first-child{color:var(--ink-2)}
.report-tip .tip-about{margin:.2rem 0 0;color:var(--ink-2)}
.tip-preview{margin-top:.5rem;padding-top:.5rem;border-top:1px solid var(--axis);color:var(--ink-2)}
.tip-preview h4{margin:.35rem 0 0;font-size:inherit;font-weight:600;color:var(--ink)}.tip-preview h4:first-child,.tip-preview p:first-child{margin-top:0}
.tip-preview p{margin:.3rem 0 0}.tip-preview ul{margin:.25rem 0 0;padding-left:1.1rem}.tip-preview li{margin:.1rem 0}
svg .crosshair{stroke:var(--ink-2);stroke-width:1;opacity:0;pointer-events:none}svg .crosshair-dot{opacity:0;pointer-events:none;stroke:var(--surface);stroke-width:1.5}svg g:hover>.crosshair,svg g:hover>.crosshair-dot{opacity:1}svg .crosshair-dot.narration{fill:var(--ink)}svg .crosshair-dot.reading{fill:var(--accent)}
@media(max-width:50rem){.report-content{padding:0 1rem 3rem}.topbar{padding:0 1rem}.topbar-title .course{display:none}.views{position:static;width:auto;margin:1rem 0}.views ul,.views:hover ul,.views:focus-within ul{position:static;width:auto;max-height:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.25rem .75rem;padding:0;border:0;border-radius:0;box-shadow:none;background:none;overflow:visible}.views a{min-height:2rem;padding:.2rem;white-space:normal;justify-content:flex-start}.views li:has(a.sub){display:none}.views a::after{display:none}.toc-label{display:block}}
@media(max-width:34rem){.topbar-title .product{display:none}}
footer{margin-top:4rem;padding-top:1rem;border-top:1px solid var(--grid);color:var(--muted);font-size:.8rem}
footer a{color:inherit}
`;

export function reportClient() {
const previews = JSON.parse(document.getElementById('page-previews')?.textContent || '{}') as Record<string, { lesson: number; number: number; title: string; narrated: boolean; checks: number; activities: number; unknownResponses?: number; partial?: boolean; lines: Array<{ kind: string; text: string }> }>;
const tip = document.createElement('div');
tip.id = 'report-tip';
tip.className = 'report-tip';
tip.setAttribute('role', 'tooltip');
tip.hidden = true;
document.querySelector('.viz-root')?.append(tip);
let active: Element | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let dismissed = false;
function hide(force = false) {
  clearTimeout(timer);
  if (!force && active === document.activeElement) return;
  active?.removeAttribute('aria-describedby');
  active = null;
  tip.hidden = true;
}
function show(el: Element, event?: PointerEvent) {
  // The comment composer sits where the tooltip would; hovering marks behind it must not cover it.
  if (document.getElementById('comments-composer')?.hidden === false) return;
  if (dismissed && active === el) return;
  clearTimeout(timer);
  if (active !== el) hide(true);
  active = el;
  dismissed = false;
  tip.replaceChildren();
  const page = previews[(el as HTMLElement | SVGElement).dataset.page || ''];
  if (page) {
    const heading = document.createElement('strong');
    heading.textContent = page.lesson + '.' + page.number + '  ' + page.title;
    tip.append(heading);
  }
  // A mark's own note: lines, and "label<TAB>value" pairs lined up in two columns.
  const note = (el as HTMLElement | SVGElement).dataset.tip;
  if (note) {
    const facts = document.createElement('div');
    facts.className = 'tip-facts';
    note.split('\n').forEach((text) => {
      const [label, value] = text.split('\t');
      const line = document.createElement('div');
      if (value === undefined) { line.className = 'tip-line'; line.textContent = label || ''; }
      else { const k = document.createElement('span'); k.textContent = label || ''; const v = document.createElement('span'); v.textContent = value; line.append(k, v); }
      facts.append(line);
    });
    tip.append(facts);
  }
  if (page) {
    const n = (count: number, one: string, many: string) => count + ' ' + (count === 1 ? one : many);
    const about = document.createElement('p');
    about.className = 'tip-about';
    about.textContent = [page.partial ? (page.narrated ? 'Enabled narration script' : 'Enabled narration script not found in the inspected content') : (page.narrated ? 'Narrated' : 'No narration'), n(page.checks, 'known knowledge check', 'known knowledge checks'), n(page.activities, 'activity', 'activities'), ...(page.unknownResponses ? [n(page.unknownResponses, 'response with unknown correctness', 'responses with unknown correctness') + (page.partial ? ': correctness not found in the inspected content' : '')] : [])].join(', ');
    if (page.partial) {
      const coverage = document.createElement('a');
      coverage.href = '#coverage';
      coverage.textContent = 'coverage note';
      about.append(' · ', coverage);
    }
    tip.append(about);
    if (page.lines.length) {
      const preview = document.createElement('div');
      preview.className = 'tip-preview';
      let list: HTMLUListElement | null = null;
      page.lines.forEach(({ kind, text }) => {
        if (kind === 'item') {
          if (!list) { list = document.createElement('ul'); preview.append(list); }
          const item = document.createElement('li'); item.textContent = text; list.append(item);
          return;
        }
        list = null;
        const line = document.createElement(kind === 'heading' ? 'h4' : 'p');
        line.textContent = text;
        preview.append(line);
      });
      tip.append(preview);
    }
  }
  if (!tip.childNodes.length) return hide(true);
  tip.hidden = false;
  el.setAttribute('aria-describedby', tip.id);
  // Tall chart columns: open beside the pointer, not below the whole plot.
  const rect = el.getBoundingClientRect();
  const atPointer = event && rect.height > 48;
  const left = atPointer ? event.clientX + 14 : rect.left;
  const top = atPointer ? event.clientY + 14 : rect.bottom + 8;
  tip.style.left = Math.max(8, Math.min(left, window.innerWidth - tip.offsetWidth - 8)) + 'px';
  // No room below: open above the trigger rather than clamping over it, which would block its click.
  const above = !atPointer && top + tip.offsetHeight > window.innerHeight - 8;
  tip.style.top = Math.max(8, above ? rect.top - tip.offsetHeight - 8 : Math.min(top, window.innerHeight - tip.offsetHeight - 8)) + 'px';
}
const targets = new Set(document.querySelectorAll('[data-page], [title]'));
document.querySelectorAll('svg title').forEach(title => { if (title.parentElement) targets.add(title.parentElement); });
const setup = (el: Element) => {
  const title = el.getAttribute('title') || el.querySelector(':scope > title')?.textContent || '';
  // ARIA prohibits a name on generic elements and role-less SVG shapes; those keep only data-tip, which the tooltip and comments read.
  const nameable = el.hasAttribute('role') || el.matches('a[href], button, input, select, textarea, img');
  if (title && nameable && !el.hasAttribute('aria-label') && (el.namespaceURI === 'http://www.w3.org/2000/svg' || !el.textContent.trim())) el.setAttribute('aria-label', title);
  if (title) (el as HTMLElement | SVGElement).dataset.tip = title;
  el.removeAttribute('title');
  if (el.namespaceURI === 'http://www.w3.org/2000/svg') el.querySelector(':scope > title')?.remove();
  if (el.namespaceURI === 'http://www.w3.org/2000/svg' || el.closest('.mode-chart')) el.removeAttribute('tabindex');
  el.addEventListener('pointerenter', event => show(el, event instanceof PointerEvent ? event : undefined));
  el.addEventListener('pointerleave', () => { dismissed = false; timer = setTimeout(() => hide(), 120); });
  // Keyboard focus only: focus moved by script after a click (opening a panel) must not pop a tooltip.
  el.addEventListener('focus', () => { if (el.matches(':focus-visible')) show(el); });
  el.addEventListener('blur', () => { dismissed = false; hide(true); });
};
targets.forEach(setup);
// Buttons added after load (a comment's actions) adopt the same tooltip on first hover or focus.
const adopt = (event: Event) => {
  const el = event.target instanceof Element ? event.target.closest('button[title]') : null;
  if (!el || targets.has(el)) return;
  targets.add(el);
  setup(el);
  if (event instanceof PointerEvent || el.matches(':focus-visible')) show(el, event instanceof PointerEvent ? event : undefined);
};
document.addEventListener('pointerover', adopt);
document.addEventListener('focusin', adopt);
document.querySelectorAll('.mode-chart svg [tabindex]').forEach(el => el.removeAttribute('tabindex'));
// Segmented controls: the option's name shows as a tooltip on hover and on keyboard focus.
document.querySelectorAll('.seg input').forEach(input => {
  const label = input.closest('label');
  input.addEventListener('focus', () => { if (label) show(label); });
  input.addEventListener('blur', () => hide(true));
});
tip.addEventListener('pointerenter', () => clearTimeout(timer));
tip.addEventListener('pointerleave', () => hide());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !tip.hidden) { dismissed = true; hide(true); }
});
const links = [...document.querySelectorAll<HTMLAnchorElement>('.views a')];
const headings = links.map(link => document.getElementById(link.hash.slice(1)));
links.forEach((link, index) => link.addEventListener('click', () => {
  headings[index]?.closest('details')?.setAttribute('open', '');
  const panel = headings[index]?.closest('.mode-table,.mode-chart');
  const input = panel?.closest('.view')?.querySelector<HTMLInputElement>(':scope > .view-head .seg-mode input[value="' + (panel?.classList.contains('mode-table') ? 'table' : 'chart') + '"]');
  if (input) { input.checked = true; requestAnimationFrame(() => { sizeTables(); headings[index]?.scrollIntoView(); }); }
}));
function currentSection() {
  let current = 0;
	const narrow = matchMedia('(max-width:50rem)').matches;
  headings.forEach((heading, index) => { if ((!narrow || !links[index]?.classList.contains('sub')) && heading?.getClientRects().length && heading.getBoundingClientRect().top <= 120) current = index; });
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = headings.findLastIndex((heading, index) => (!narrow || !links[index]?.classList.contains('sub')) && heading?.getClientRects().length);
  links.forEach((link, index) => index === current ? link.setAttribute('aria-current', 'location') : link.removeAttribute('aria-current'));
}
document.addEventListener('scroll', currentSection, { passive: true });
window.addEventListener('resize', currentSection);
currentSection();
function sizeTables() {
  document.querySelectorAll<HTMLElement>('.table-wrap').forEach(wrap => {
    wrap.classList.remove('long-table');
    // The scroll hint may later wrap the table in a frame; the cue sits before whichever is outermost.
    const outer = wrap.parentElement?.classList.contains('scroll-frame') ? wrap.parentElement : wrap;
    const cue = outer.previousElementSibling?.classList.contains('table-cue') ? outer.previousElementSibling as HTMLElement : null;
    if (wrap.querySelectorAll('tbody tr').length > 15) wrap.classList.add('sticky-table');
    if (wrap.scrollHeight > window.innerHeight * 1.5) {
      wrap.classList.add('long-table');
      if (!cue) outer.insertAdjacentHTML('beforebegin', '<p class="table-cue">Scroll within this table for more rows.</p>');
      else cue.hidden = false;
    } else if (cue) cue.hidden = true;
  });
}
// Sortable tables: a sort button beside each column label cycles ascending, descending and the
// original (course) order. Tables whose rows form groups (rowspans, grouped members) keep their order.
const SORT_ICONS: Record<string, string> = {
  none: '<path d="M3 9l4 -4l4 4m-4 -4v14" /><path d="M21 15l-4 4l-4 -4m4 4v-14" />',
  ascending: '<path d="M12 5l0 14" /><path d="M16 9l-4 -4" /><path d="M8 9l4 -4" />',
  descending: '<path d="M12 5l0 14" /><path d="M16 15l-4 4" /><path d="M8 15l4 4" />',
};
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const sortKey = (cell: Element | undefined) => ((cell as HTMLElement | undefined)?.dataset.sort ?? cell?.textContent ?? '').trim();
const compare = (a: string, b: string) => {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  const x = Number(a.replace(/,/g, '')), y = Number(b.replace(/,/g, ''));
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : collator.compare(a, b);
};
document.querySelectorAll<HTMLTableElement>('.report-content .table-wrap > table').forEach(table => {
  const body = table.tBodies[0];
  const heads = [...(table.tHead?.rows[0]?.cells ?? [])];
  if (!body || body.rows.length <= 6 || table.tHead?.rows.length !== 1 || body.querySelector('[rowspan], [colspan], tr.group-start')) return;
  const original = [...body.rows];
  const resets: Array<() => void> = [];
  heads.forEach((head, column) => {
    const label = (head.textContent || '').trim();
    if (!label) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort';
    button.setAttribute('aria-label', 'Sort by ' + label);
    const draw = (state: string) => { button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SORT_ICONS[state] + '</svg>'; };
    draw('none');
    resets.push(() => { head.removeAttribute('aria-sort'); button.classList.remove('active'); draw('none'); });
    button.addEventListener('click', () => {
      const state = head.getAttribute('aria-sort') === 'ascending' ? 'descending' : head.getAttribute('aria-sort') === 'descending' ? 'none' : 'ascending';
      resets.forEach(reset => reset());
      const rows = state === 'none' ? original : [...original].sort((a, b) => compare(sortKey(a.cells[column]), sortKey(b.cells[column])) * (state === 'ascending' ? 1 : -1));
      body.append(...rows);
      if (state !== 'none') { head.setAttribute('aria-sort', state); button.classList.add('active'); }
      draw(state);
    });
    head.append(button);
  });
});
sizeTables();
requestAnimationFrame(sizeTables);
window.addEventListener('resize', sizeTables);
document.addEventListener('change', event => { if (event.target instanceof Element && event.target.matches('.seg-mode input, input[name="mode-all"]')) requestAnimationFrame(sizeTables); });
}
const SCRIPT = inlineClient(reportClient);

function sourceLabel(location: SourceLocation | null): string {
	return location ? `${location.file}:${location.startLine}${location.endLine === location.startLine ? "" : `–${location.endLine}`}` : "source location unavailable";
}

function expandedEvidence(report: Report): string {
	if (report.source.projectionVersion !== 2) return "";
	const media = report.source.mediaInventory ?? [];
	const groups = report.source.assessmentGroups ?? [];
	const unlinked = report.source.unlinkedNarration ?? [];
	const recorded = report.anatomy.flatMap((lesson, l) => lesson.pace.flatMap(page => (page.recordedNarration ?? []).map(item => ({ lesson: l + 1, page: page.number, ...item }))));
	const status = (source: TypedMedia["source"]) => source ? `${source.availability}: ${source.uri}` : "unavailable source";
	return `<details class="source-evidence"><summary>Media, assessment groups and unresolved narration</summary>
<h2>Media inventory</h2>${media.length ? `<ul>${media.map(item => `<li><span data-page="${pageKey(item.lesson, item.page)}">${pageKey(item.lesson, item.page)}</span> · ${esc(item.kind)} · ${esc(status(item.source))} · <code>${esc(sourceLabel(item.location))}</code>${item.alt !== null ? `<br>Alternative: ${esc(item.alt)}` : ""}${item.description ? `<br>Description: ${esc(formattedText(item.description))}` : ""}${item.caption ? `<br>Caption: ${esc(formattedText(item.caption))}` : ""}${item.transcript ? `<br>Authored transcript: ${esc(formattedText(item.transcript))}` : ""}${item.captionTracks.length ? `<br>Caption tracks: ${item.captionTracks.map(track => esc(status(track.source))).join("; ")} (contents unavailable)` : ""}</li>`).join("")}</ul>` : `<p>No projected media references.</p>`}
<h2>Assessment groups</h2>${groups.length ? `<ul>${groups.map(group => `<li><code>${esc(sourceLabel(group.location))}</code> · ${esc(group.mode)} · ${esc(group.aggregation)} · members ${group.memberRefs.map(ref => esc(ref)).join(", ") || "none"}${group.unresolvedMemberCount ? ` · ${group.unresolvedMemberCount} unresolved` : ""}. This is aggregation context, not an extra question.</li>`).join("")}</ul>` : `<p>No projected assessment groups.</p>`}
<h2>Recorded narration endpoints</h2>${recorded.length ? `<ul>${recorded.map(item => `<li><span data-page="${pageKey(item.lesson, item.page)}">${pageKey(item.lesson, item.page)}</span> · <code>${esc(sourceLabel(item.location))}</code> · ${item.seconds} s sidecar-recorded endpoint; full-file duration and measurement unknown.</li>`).join("")}</ul>` : `<p>No resolved sidecar-recorded endpoints.</p>`}
<h2>Unresolved narration</h2>${unlinked.length ? `<ul>${unlinked.map(item => `<li>L${item.lesson} · <code data-source-file="${esc(item.location?.file ?? "")}" data-source-line="${item.location?.startLine ?? ""}">${esc(sourceLabel(item.location))}</code> · saved anchor ${esc(JSON.stringify(item.unresolvedAnchor))}. ${item.value ? `Authored script: ${esc(item.value)}.` : "No authored script."} Audio ${esc(status(item.audio ?? null))}; ${item.duration ? `${item.duration.seconds} s sidecar-recorded endpoint, full-file duration unknown` : "duration unknown"}. No current block or page link; hearing is unconfirmed.</li>`).join("")}</ul>` : `<p>No unresolved narration.</p>`}</details>`;
}

export function renderHtml(report: Report): string {
	const pages = report.anatomy.reduce((sum, lesson) => sum + lesson.pages, 0);
	const previews = Object.fromEntries(report.anatomy.flatMap((lesson, index) => lesson.pace.map((page) => [
		pageKey(index + 1, page.number),
		{ lesson: index + 1, lessonTitle: lesson.title, number: page.number, title: page.title, lines: page.preview?.lines ?? [], narrated: page.preview?.narrated ?? page.narrationSeconds > 0, checks: page.preview?.checks ?? 0, activities: page.preview?.activities ?? 0, unknownResponses: page.preview?.unknownResponses, partial: page.measurementStatus === "partial" },
	])));
	const { html: body, entries } = outline(() => SECTIONS.filter((section) => report.tasks || section.views[0]?.id !== "tasks").map((section) => section.render(report)).join("\n"));
	// Recommendations open the report but link to views drawn after them, so they render last.
	const recommendations = report.recommendations ? `${renderRecommendations(report.recommendations, new Map(entries.flatMap((entry) => (entry.view ? [[entry.view, esc(entry.title)] as const] : []))))}\n` : "";
	const html = `<!doctype html>
<html lang="${esc(report.course.locale)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(report.course.title)} · Praxity Trace</title><script>${THEME_HEAD_SCRIPT}</script><style>${themeable(`${STYLE}${ALIGNMENT_STYLE}${CONCEPTS_STYLE}${LANGUAGE_STYLE}${EMPHASIS_STYLE}${TERMS_STYLE}${VISUALS_STYLE}${TRACE_STYLE}${FLOW_STYLE}${SPACING_STYLE}${AVAILABILITY_STYLE}${RECOMMENDATIONS_STYLE}${DISTINCTIONS_STYLE}${MODES_STYLE}${SCROLL_HINT_STYLE}${COMMENTS_STYLE}${report.tasks ? TASKS_STYLE : ""}`)}${THEME_STYLE}${report.source.projectionVersion === 2 ? `.source-evidence{max-width:46rem;overflow-wrap:anywhere}.source-evidence h2{font-size:1rem;margin:1rem 0 .25rem}.source-evidence ul{padding-left:1.25rem;margin:.25rem 0}.source-evidence li+li{margin-top:.5rem}` : ""}</style></head>
<body><main class="viz-root">
<header class="topbar"><p class="topbar-title"><span class="product">Praxity Trace</span><span class="course">${esc(report.course.title)}</span></p><div class="topbar-controls">${MODES_ALL}${FILTER_ALL}${THEME_SWITCH}${COMMENTS_MARKUP}</div></header>
<!-- contents rail -->
<div class="report-content">
<div class="report-head">
<h1>${esc(report.course.title)}</h1>
${report.coverage ? `<div id="coverage"><p class="rule">${report.source.projectionVersion === 2 ? "Partial input: Studio identifies keyed and open responses, scoring settings, media references and asset status. Unsupported text and playback timing remain unavailable." : "Partial input: Studio supplies text for some block types only, and no correct answers, scoring, media details or audio durations, so related counts are incomplete or estimated."}</p>${method(`<p class="rule">${esc(report.coverage.limitations)}</p>`, "What is missing")}</div>` : ""}
<p class="meta">${report.anatomy.length} ${report.anatomy.length === 1 ? "lesson" : "lessons"}, ${pages} ${pages === 1 ? "page" : "pages"}. Pages use lesson.page (3.9 means lesson 3, page 9).</p>
<p class="meta">Read from Studio ${esc(report.source.studioVersion)}, course revision <code>${report.courseHash.slice(0, 12)}</code>.</p>
<ol class="lesson-key">${report.anatomy.map((lesson, index) => `<li><span class="lesson-code">L${index + 1}</span>${esc(lessonTitle(index + 1, lesson.title))}</li>`).join("")}</ol>${report.source.projectionVersion === 2 ? `
${expandedEvidence(report)}` : ""}
</div>
${recommendations}${body}
<footer>Praxity Trace by Ariel Harlap · <a href="https://github.com/Praxity/praxity-trace">github.com/Praxity/praxity-trace</a></footer>
<!--
Tabler Icons (https://tabler.io/icons)

MIT License

Copyright (c) 2020-2026 Paweł Kuna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
-->
</div></main><script type="application/json" id="page-previews">${JSON.stringify(previews).replace(/</g, "\\u003c")}</script><script type="application/json" id="report-meta">${JSON.stringify({ course: report.course.title, courseHash: report.courseHash, lessons: report.anatomy.map((lesson, index) => ({ number: index + 1, file: lesson.file, title: lesson.title })) }).replace(/</g, "\\u003c")}</script><script>${SCRIPT}${MODES_SCRIPT}${THEME_SCRIPT}${SCROLL_HINT_SCRIPT}${FLOW_SCRIPT}</script><script>${COMMENTS_SCRIPT}</script></body></html>
`;
	const rail = [...(report.recommendations ? [{ title: "Recommendations", level: 2 as const, anchor: "recommendations" }] : []), ...entries];
	const links = rail.map((entry) => `<li><a class="${entry.level === 3 ? "sub" : ""}" href="#${esc(entry.anchor)}" aria-label="${esc(entry.title)}"><span class="toc-label">${esc(entry.title)}</span></a></li>`);
	return html.replace("<!-- contents rail -->", `<nav class="views" aria-label="Contents"><ul>${links.join("")}</ul></nav>`);
}
