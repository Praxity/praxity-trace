import type { Block, Course, Page, SourceLocation } from "./inspect.ts";

export interface Located {
	ref: string;
	lesson: string;
	lessonNumber: number;
	page: number;
	order: number;
	position: number;
	credit: boolean;
	block: Block;
}

export interface Place {
	sourceRef?: string;
	parentRef?: string | null;
	location?: SourceLocation | null;
	lesson: number;
	lessonTitle: string;
	page: number;
	file: string;
	line: number | null;
	position: number;
}

export type Places = Record<string, Place>;

export interface LessonSpan {
	file: string;
	title: string;
	start: number;
}

export interface CourseIndex {
	blocks: readonly Located[];
	block(ref: string): Located | undefined;
	sourceBlock(ref: string): Located | undefined;
	lessonNumber(file: string): number;
	page(lesson: number, page: number): Page | undefined;
	axis: { blocks: number; lessons: LessonSpan[] };
}

export const pageKey = (lesson: number, page: number) => `${lesson}.${page}`;

const CREDIT = /^(sources?\b|source photos|source references)/i;
export const isCreditPage = (title: string) => CREDIT.test(title);

export function contentBlocks(block: Block): Block[] {
	if (block.ref || block.type !== "columns") return [block];
	const items = Array.isArray(block.data.items) ? block.data.items : [];
	return items.flatMap((item) => {
		const children = (item as { children?: unknown }).children;
		return Array.isArray(children)
			? (children as Block[]).flatMap((child) => contentBlocks({ ...child, line: block.line }))
			: [];
	});
}

const indexes = new WeakMap<Course, CourseIndex>();

export function indexCourse(course: Course): CourseIndex {
	const cached = indexes.get(course);
	if (cached) return cached;
	let position = 0;
	const blocks: Located[] = course.lessons.flatMap((lesson, l) => {
		let order = 0;
		return lesson.pages.flatMap((page) =>
			page.blocks.flatMap((block, b) => {
				const base = `${l + 1}.${page.number}.${b + 1}`;
				return contentBlocks(block).map((part, c) => ({
					ref: !block.ref && block.type === "columns" ? `${base}.${c + 1}` : base,
					lesson: lesson.file,
					lessonNumber: l + 1,
					page: page.number,
					order: order++,
					position: position++,
					credit: isCreditPage(page.title),
					block: part,
				}));
			}),
		);
	});
	const byRef = new Map(blocks.map((item) => [item.ref, item]));
	const bySourceRef = new Map(blocks.filter(item => item.block.ref).map(item => [item.block.ref!, item]));
	const numbers = new Map(course.lessons.map((lesson, l) => [lesson.file, l + 1]));
	const pages = new Map(course.lessons.flatMap((lesson, l) => lesson.pages.map((page) => [pageKey(l + 1, page.number), page] as const)));
	const index: CourseIndex = {
		blocks: Object.freeze(blocks),
		block: (ref) => byRef.get(ref),
		sourceBlock: (ref) => bySourceRef.get(ref),
		lessonNumber: (file) => numbers.get(file) ?? 0,
		page: (lesson, page) => pages.get(pageKey(lesson, page)),
		axis: {
			blocks: blocks.length,
			lessons: course.lessons.map((lesson) => ({ file: lesson.file, title: lesson.title, start: blocks.findIndex((item) => item.lesson === lesson.file) })),
		},
	};
	indexes.set(course, index);
	return index;
}

export const locateBlocks = (course: Course): readonly Located[] => indexCourse(course).blocks;
export const courseAxis = (course: Course) => indexCourse(course).axis;

export function buildPlaces(course: Course, refs: Iterable<string>): Places {
	const index = indexCourse(course);
	const places: Places = {};
	for (const ref of refs) {
		const found = index.block(ref);
		if (!found) continue;
		places[ref] = {
			lesson: found.lessonNumber,
			lessonTitle: course.lessons[found.lessonNumber - 1]?.title ?? "",
			page: found.page,
			file: found.lesson,
			line: found.block.line,
			sourceRef: found.block.ref, parentRef: found.block.parentRef, location: found.block.location,
			position: found.position,
		};
	}
	return places;
}

export const esc = (value: string | number) =>
	String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const clip = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
export const lessonTitle = (number: number, title: string) => title.replace(new RegExp(`^Lesson\\s+${number}\\s*[:.–-]\\s*`, "i"), "");
export const lessonHeading = (number: number, title: string) => `L${number} · ${lessonTitle(number, title)}`;

export const sourceOf = (place: Place) => (place.line === null ? place.file : `${place.file}:${place.line}`);

export function where(places: Places, ref: string): string {
	const place = places[ref];
	if (!place) return esc(ref);
	return `<span data-page="${pageKey(place.lesson, place.page)}" title="${esc(`${place.lessonTitle}, page ${place.page} · ${sourceOf(place)}`)}">${pageKey(place.lesson, place.page)}</span>`;
}

export function wheres(places: Places, refs: string[]): string {
	const byLesson = new Map<number, { title: string; pages: Set<number> }>();
	for (const ref of refs) {
		const place = places[ref];
		if (!place) continue;
		const entry = byLesson.get(place.lesson) ?? { title: place.lessonTitle, pages: new Set<number>() };
		entry.pages.add(place.page);
		byLesson.set(place.lesson, entry);
	}
	return [...byLesson]
		.sort(([a], [b]) => a - b)
		.map(([lesson, entry]) => `<span title="${esc(entry.title)}">${[...entry.pages].sort((a, b) => a - b).map((page) => pageKey(lesson, page)).join(", ")}</span>`)
		.join(", ");
}

export function short(places: Places, ref: string): string {
	const place = places[ref];
	return place ? pageKey(place.lesson, place.page) : ref;
}

export function lessonKey(lessons: LessonSpan[]): string {
	return `<p class="legend lesson-key">${lessons.map((lesson, index) => `<span><strong>L${index + 1}</strong> ${esc(lesson.title)}</span>`).join("")}</p>`;
}

export function lessonTags(places: Places, refs: string[]): string {
	return `data-lessons="${[...new Set(refs.flatMap((ref) => places[ref] ? [places[ref].lesson] : []))].sort((a, b) => a - b).join(" ")}"`;
}
