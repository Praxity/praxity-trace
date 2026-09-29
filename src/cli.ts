#!/usr/bin/env node
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseAlignment, prepareAlignment } from "./alignment.ts";
import { alignmentView } from "./alignment-view.ts";
import { anatomy } from "./anatomy.ts";
import { traceView } from "./trace.ts";
import { spacingView } from "./spacing.ts";
import { availabilityView } from "./availability.ts";
import { distinctionsView, parseDistinctions, prepareDistinctions } from "./distinctions.ts";
import { parseConcepts, prepareConcepts } from "./concepts.ts";
import { conceptsView } from "./concepts-view.ts";
import { languageView } from "./language.ts";
import { emphasisView } from "./emphasis.ts";
import { parseTerms, prepareTerms, termsView } from "./terms.ts";
import { parseVisuals, prepareVisuals, visualsView } from "./visuals.ts";
import { type Course, courseHash, parseCourse } from "./inspect.ts";
import { buildPlaces, indexCourse, locateBlocks } from "./places.ts";
import { readHtmlCourse } from "./html.ts";
import { buildReport, renderHtml } from "./report.ts";
import { parseRecommendations, prepareRecommendations } from "./recommendations.ts";
import { parseTasks, prepareTasks, tasksView } from "./tasks.ts";
import { formatCommentsMarkdown, parseComments } from "./comments.ts";

const HELP = `Usage:
  praxity-trace report <inspect.json|html-dir|-> --out <dir> [--alignment <answer.json>] [--tasks <answer.json>] [--concepts <answer.json>] [--terms <answer.json>] [--visuals <answer.json>] [--distinctions <answer.json>] [--recommendations <answer.json>]
  praxity-trace prepare <alignment|tasks|concepts|terms|visuals|distinctions> <inspect.json|html-dir|-> --out <bundle-dir> [--comments <comments.json>]
  praxity-trace prepare recommendations <inspect.json|html-dir|-> --report <report.json> --out <bundle-dir>

<inspect.json> is the output of \`praxity inspect <course-dir> --schema 1\`; <html-dir> is an unzipped static HTML export; - reads inspect JSON from stdin.
report writes report.html and report.json to <dir>.
prepare writes a bundle for a model reviewer; its answer.json feeds the matching report option.
--comments adds the designer's comments on that view (downloaded from report.html) to the reviewer's prompt.
Recommendations come last: build the report with every other answer, prepare from its report.json, then build again with --recommendations.`;

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		out: { type: "string" },
		alignment: { type: "string" },
		tasks: { type: "string" },
		concepts: { type: "string" },
		terms: { type: "string" },
		visuals: { type: "string" },
		distinctions: { type: "string" },
		recommendations: { type: "string" },
		report: { type: "string" },
		comments: { type: "string" },
		help: { type: "boolean", short: "h" },
	},
});
const [command, ...rest] = positionals;
const usage = (code: number): never => {
	console.log(HELP);
	process.exit(code);
};
if (values.help) usage(0);
if (!values.out) usage(2);
const out = values.out as string;

const PREPARE = { alignment: prepareAlignment, tasks: prepareTasks, concepts: prepareConcepts, terms: prepareTerms, visuals: prepareVisuals, distinctions: prepareDistinctions };

if (command === "prepare" && rest.length === 2 && rest[0] === "recommendations") {
	if (!values.report) usage(2);
	await prepareRecommendations(await readCourse(rest[1] as string), values.report as string, out);
	console.log(JSON.stringify({ ok: true, bundle: out, prompt: join(out, "prompt.md"), answer: join(out, "answer.json") }));
} else if (command === "prepare" && rest.length === 2 && Object.hasOwn(PREPARE, rest[0] as string)) {
	const course = await readCourse(rest[1] as string);
	const view = rest[0] as keyof typeof PREPARE;
	await PREPARE[view](course, out);
	if (values.comments) {
		// Designer comments on the section this view renders in steer the next answer.
		const SECTION: Record<keyof typeof PREPARE, string> = { alignment: "alignment", tasks: "tasks", concepts: "concepts", terms: "language", visuals: "visuals", distinctions: "concepts" };
		const file = parseComments(await readFile(values.comments, "utf8"));
		const mine = { ...file, comments: file.comments.filter((comment) => (comment.view === SECTION[view] || (view === "alignment" && comment.view === "trace" && comment.target.objectives?.length))) };
		if (mine.comments.length) {
			const stale = file.courseHash !== courseHash(course) ? " They were written on an earlier revision of the course; apply them where they still fit." : "";
			await appendFile(join(out, "prompt.md"), `\n## Designer comments\n\nThe designer left these comments on the previous report's ${SECTION[view]} section. Follow them where they correct or constrain your answer (for example, keep objectives separate that you would otherwise group); they override your own judgment on the points they cover.${stale}\n\n${formatCommentsMarkdown(mine).split("\n").slice(4).join("\n")}`);
		}
	}
	console.log(JSON.stringify({ ok: true, bundle: out, prompt: join(out, "prompt.md"), answer: join(out, "answer.json") }));
} else if (command === "report" && rest.length === 1) {
	const course = await readCourse(rest[0] as string);
	const models = {
		...(values.alignment
			? { alignment: alignmentView(course, parseAlignment(await readFile(values.alignment, "utf8"), course)) }
			: {}),
		...(values.concepts
			? { concepts: conceptsView(course, parseConcepts(await readFile(values.concepts, "utf8"), course)) }
			: {}),
		...(values.terms ? { terms: termsView(course, parseTerms(await readFile(values.terms, "utf8"), course)) } : {}),
		...(values.distinctions
			? { distinctions: distinctionsView(course, parseDistinctions(await readFile(values.distinctions, "utf8"), course)) }
			: {}),
	};
	const shape = anatomy(course);
	const withVisuals = values.visuals ? { ...models, visuals: visualsView(course, parseVisuals(await readFile(values.visuals, "utf8"), course), shape.lessons) } : models;
	const withSpacing = withVisuals.concepts ? { ...withVisuals, spacing: spacingView(withVisuals.concepts, shape.lessons) } : withVisuals;
	const availability = withSpacing.alignment ? availabilityView(course, withSpacing.alignment, shape.lessons) : undefined;
	const derived = {
		...withSpacing,
		...(availability ? { availability } : {}),
		...(values.tasks ? { tasks: tasksView(course, parseTasks(await readFile(values.tasks, "utf8"), course), withSpacing.alignment && availability ? { alignment: withSpacing.alignment, availability } : undefined) } : {}),
	};
	const built = buildReport(
		course.course,
		{
			schema: course.schema, studioVersion: course.studioVersion,
			...(course.schema === "praxity-inspect/1" ? {
				revision: course.revision,
				...(course.projectionVersion === 2 ? {
					projectionVersion: 2 as const,
					mediaInventory: locateBlocks(course).flatMap((item) => (item.block.media ?? []).map((media) => ({ ref: item.ref, lesson: item.lessonNumber, page: item.page, location: item.block.location ?? null, ...media }))),
					assessmentGroups: locateBlocks(course).filter((item) => item.block.assessmentGroup).map((item) => ({ ref: item.ref, location: item.block.location ?? null, ...item.block.assessmentGroup!, memberRefs: item.block.assessmentGroup!.memberRefs.map((sourceRef) => indexCourse(course).sourceBlock(sourceRef)?.ref ?? sourceRef) })),
					unlinkedNarration: course.lessons.flatMap((lesson, l) => (lesson.unlinkedNarration ?? []).map((item) => ({ lesson: l + 1, lessonFile: lesson.file, ...item }))),
				} : {}),
				places: buildPlaces(course, locateBlocks(course).map((item) => item.ref)),
				unlinkedNarrationCount: course.lessons.reduce((sum, lesson) => sum + (lesson.unlinkedNarrationCount ?? 0), 0),
			} : {}),
		},
		courseHash(course),
		shape,
		traceView(course, shape.lessons, models),
		languageView(course),
		emphasisView(course, models.concepts, models.alignment),
		derived,
	);
	const report = values.recommendations ? { ...built, recommendations: parseRecommendations(await readFile(values.recommendations, "utf8"), course, built) } : built;
	await mkdir(out, { recursive: true });
	await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
	await writeFile(join(out, "report.html"), renderHtml(report));
	console.log(JSON.stringify({ ok: true, html: join(out, "report.html"), courseHash: report.courseHash }));
} else {
	usage(2);
}

async function readInput(path: string): Promise<string> {
	if (path !== "-") return readFile(path, "utf8");
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

async function readCourse(path: string): Promise<Course> {
	return path !== "-" && (await stat(path)).isDirectory() ? readHtmlCourse(path) : parseCourse(await readInput(path));
}
