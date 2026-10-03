/** Patterns to inspect after each view, also supplied to report readers and reviewers. */
export interface Reading {
	/** A pattern visible in the view. */
	see: string;
	/** A specific inspection the pattern calls for. */
	could: string;
	mode?: "table";
	paceMode?: "cumulative";
}

export const GUIDES = {
	trace: [
		{ see: "Objectives stated but never practised or checked", could: "For each objective without a check or activity, inspect its stated page and decide where learners show that learning." },
		{ see: "Long stretches of instruction with no activity or check", could: "Inspect where learners first use the instruction and whether that response needs preparation along the way." },
		{ see: "New concepts bunched on a few pages", could: "Open those pages and check how many ideas learners must distinguish before using them." },
	],
	anatomy: [
		{ see: "A lesson made almost entirely of text", could: "Compare its reading passages with the actions its objectives ask learners to perform." },
		{ see: "Explore blocks carrying much of a lesson", could: "If a later knowledge check depends on this content, check whether learners are prompted to open it." },
		{ see: "Activities or checks only at the end of a lesson", could: "Inspect whether learners need a chance to use earlier instruction before reaching the final checks." },
		{ see: "Long runs of pages without an activity or check", could: "Open the next activity or check and trace which pages it asks learners to use." },
	],
	tasks: [
		{ see: "A page asks for more than one task type", could: "Inspect each quoted request to see how the kinds of work fit together." },
		{ see: "Work requested outside the course", could: "Read the quoted request and check where learners are told to complete and submit the work.", mode: "table" },
		{ see: "Unclassified or unsupported pages", could: "Open the source page and check whether its task request is available in the inspected text." },
	],
	pace: [
		{ see: "Narration much longer than reading time", could: "The audio may add explanation. Check whether learners can also read it in captions or a script." },
		{ see: "A few pages far longer than their neighbours", could: "Open those pages and inspect the passages or media that account for the extra time." },
		{ see: "A steep stretch of the running total", could: "The steepest section adds the most time; inspect those pages if course duration is under review.", paceMode: "cumulative" },
	],
	evidence: [
		{ see: "An objective group with no check or activity", could: "Read the grouped objectives and identify where learners could demonstrate each stated action." },
		{ see: "One group with most of the evidence", could: "Compare the linked checks and activities with the actions promised by the other objective groups." },
	],
	flow: [
		{ see: "Checks whose instruction comes after them", could: "Open the check and its linked instruction to confirm whether learners are meant to answer first." },
		{ see: "Evidence that traces back to few objectives", could: "Compare the linked tasks with the actions stated by the other objectives." },
	],
	outcomes: [
		{ see: "Objectives mostly at Remember and Understand", could: "Read the objective verbs and check whether they state the intended demands of the course." },
		{ see: "Most objectives Verbal information in Gagné's terms", could: "Check whether the objectives also need to name a skill learners must perform." },
		{ see: "Objectives that state an action but no conditions or standard", could: "Inspect whether the action needs a stated context or criterion to make success clear." },
	],
	availability: [
		{ see: "Needed instruction behind a click", could: "Check whether the page prompts learners to open the instruction before answering." },
		{ see: "Needed instruction many minutes before the check", could: "Check whether learners can find or recall instruction taught much earlier.", mode: "table" },
		{ see: "Needed instruction only in narration, a transcript or a tooltip", could: "Open the source and check whether learners can also find the instruction on screen or beside the media." },
		{ see: "Pre-assessments", could: "Inspect what the results change, such as which pages learners see next." },
		{ see: "Checks taught only after they are asked, not marked as pre-assessments", could: "Open the check and later instruction to confirm whether that order is intended." },
		{ see: "Checks with no instruction found", could: "Read the check and look for the knowledge or reasoning it requires in the cited course material." },
	],
	concepts: [
		{ see: "A concept used before it is defined", could: "Read its first use and check whether the passage needs the later definition to make sense." },
		{ see: "Defined concepts with no knowledge check", could: "Inspect the linked activities and decide where learners should demonstrate use of the concept." },
		{ see: "A concept that appears once and never returns", could: "Open its only appearance and check whether later tasks depend on it." },
	],
	prerequisites: [
		{ see: "A concept that comes before what it builds on", could: "Compare the two definitions and check what the earlier passage expects learners to know." },
	],
	spacing: [
		{ see: "Long gaps between encounters with a concept", could: "Inspect the first encounter after the gap and what it asks learners to recall." },
		{ see: "Every encounter within a few minutes", could: "Check whether later course pages require the concept after its final encounter." },
	],
	distinctions: [
		{ see: "A confusable pair with no stated difference or contrasting example", could: "Read both explanations and look for a passage that makes the difference explicit." },
		{ see: "Pairs stated but never checked", could: "Inspect where learners are asked to choose between the two ideas." },
	],
	"sentence-length": [
		{ see: "Sentences past the dashed line or among the longest", could: "Read the longest sentences and check which steps or qualifications could be separated." },
		{ see: "Narration sentences longer than on-screen ones", could: "Long spoken sentences are harder to revisit. Check whether learners have a readable script or transcript." },
	],
	readability: [
		{ see: "A lesson with few shared words between sentences", could: "Open a passage and check whether each sentence makes its connection to the previous one clear." },
		{ see: "Few causal or contrast connectives in an explanatory lesson", could: "Open an explanatory passage with few links between sentences and check whether its cause or contrast is actually stated." },
		{ see: "A lesson high on several measures at once", could: "Read its flagged sentences together to see which wording accounts for the counts." },
		{ see: "A lesson several Flesch–Kincaid grades above the rest", could: "Compare its sentence lengths and subject terms with a lower-scoring lesson." },
	],
	structure: [
		{ see: "Clusters of possible passive patterns or front-loaded sentences", could: "Open the examples below that lesson's counts and check whether the marked wording hides the actor or delays the main point." },
		{ see: "The same construction repeating in one lesson", could: "Read the examples together and check whether the same revision would clarify each one." },
	],
	vocabulary: [
		{ see: "A lesson with many rare words", could: "Inspect the rare-word list and check how the lesson explains its subject terms." },
		{ see: "Rare words with no glossary tooltip", could: "Check whether the nearby text explains the word or uses it as an example." },
	],
	acronyms: [
		{ see: "Acronyms never spelled out", could: "Read the first use and check whether the intended audience has enough information to decode it." },
	],
	terms: [
		{ see: "Flags clustered in one lesson", could: "Open the flags in that lesson and check what prior knowledge its passages assume." },
		{ see: "Unstated premises", could: "Read the quoted passage and identify the missing fact or reasoning step it depends on." },
	],
	emphasis: [
		{ see: "A high share of emphasised words", could: "Open a page with many marked phrases and check which words still stand out." },
		{ see: "Emphasis on labels rather than concepts", could: "Read the phrase list and check whether formatting helps learners find the ideas they need.", mode: "table" },
	],
	visuals: [
		{ see: "A passage that states several steps, branches or pairings", could: "Read the quoted passage and check whether a diagram could show those relationships while preserving its qualifications." },
	],
} satisfies Record<string, Reading[]>;

export type ViewId = keyof typeof GUIDES;
export const VIEW_IDS = Object.keys(GUIDES) as ViewId[];
export const isViewId = (value: unknown): value is ViewId => typeof value === "string" && Object.hasOwn(GUIDES, value);
