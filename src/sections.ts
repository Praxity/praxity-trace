import { renderAlignment } from "./alignment-view.ts";
import { renderAnatomy, renderPace } from "./anatomy-view.ts";
import { renderAvailability } from "./availability.ts";
import { renderConcepts } from "./concepts-view.ts";
import { renderDistinctions } from "./distinctions.ts";
import { renderEmphasis } from "./emphasis.ts";
import type { ViewId } from "./guides.ts";
import { renderSentences, renderWords } from "./language.ts";
import { sectionHead } from "./modes.ts";
import type { Report } from "./report.ts";
import { renderSpacing } from "./spacing.ts";
import { renderTrace } from "./trace.ts";
import { renderVisuals } from "./visuals.ts";
import { renderTasks } from "./tasks.ts";

/**
 * The report's sections in reading order: which views each draws, when each view has data, and
 * how the section renders. The report, the views a recommendation may cite, and the checks that
 * every view has a guide all read this list, so a new view is added here once.
 */
export interface Section {
	views: Array<{ id: ViewId; present: (report: Report) => boolean }>;
	render: (report: Report) => string;
}

const always = () => true;

/** A section that gathers several views under one heading. The body is drawn after the heading, so the contents rail lists them in page order. */
const section = (id: string, title: string, question: string, body: () => string) => {
	const head = sectionHead(id, title, question);
	return `<section aria-labelledby="${id}">\n${head}\n${body()}\n</section>`;
};

// Broad to specific: what the course is, what it promises and whether it delivers, how ideas are
// taught, how it is written, how it is presented.
export const SECTIONS: Section[] = [
	{ views: [{ id: "trace", present: always }], render: (report) => renderTrace(report.trace) },
	{
		views: [{ id: "anatomy", present: always }, { id: "pace", present: always }],
		render: (report) =>
			section("course-structure", "Structure", "What is the course made of, and how long does it take?", () => `${renderAnatomy(report)}\n${renderPace(report)}`),
	},
	{
		views: [
			...(["outcomes", "flow", "evidence"] as const).map((id) => ({ id, present: (report: Report) => Boolean(report.alignment) })),
			{ id: "availability", present: (report) => Boolean(report.alignment && report.availability) },
		],
		render: (report) =>
				report.alignment ? renderAlignment(report.alignment, (positions) => (report.availability ? renderAvailability(report.availability, positions) : "")) : "",
	},
	{ views: [{ id: "tasks", present: (report) => Boolean(report.tasks) }], render: (report) => report.tasks ? `<section aria-labelledby="tasks">${renderTasks(report.tasks)}</section>` : "" },
	{
		views: [
			{ id: "concepts", present: (report) => Boolean(report.concepts) },
			{ id: "prerequisites", present: (report) => Boolean(report.concepts) },
			{ id: "spacing", present: (report) => Boolean(report.concepts && report.spacing) },
			{ id: "distinctions", present: (report) => Boolean(report.concepts && report.distinctions) },
		],
		render: (report) =>
			report.concepts
				? renderConcepts(report.concepts, () => report.spacing ? renderSpacing(report.spacing) : "", () => report.distinctions ? renderDistinctions(report.distinctions) : "")
				: "",
	},
	{
		views: [
			{ id: "sentence-length", present: always },
			{ id: "readability", present: always },
			{ id: "structure", present: always },
		],
		render: (report) => renderSentences(report.language),
	},
	{
		views: [
			{ id: "vocabulary", present: (report) => Boolean(report.language.vocabulary) },
			{ id: "acronyms", present: always },
			{ id: "terms", present: (report) => Boolean(report.terms) },
		],
		render: (report) => renderWords(report.language, report.terms),
	},
	{
		views: [{ id: "emphasis", present: always }, { id: "visuals", present: (report) => Boolean(report.visuals) }],
		render: (report) =>
			section("presentation", "Presentation", "What does the course emphasise, and where could a diagram carry the text?", () => `${renderEmphasis(report.emphasis)}\n${report.visuals ? renderVisuals(report.visuals) : ""}`),
	},
];

/** Views the report draws, in order; a recommendation may only cite these. */
export const presentViews = (report: Report): ViewId[] =>
	SECTIONS.flatMap((section) => section.views.filter((view) => view.present(report)).map((view) => view.id));
