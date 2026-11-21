import { readFileSync } from "node:fs";

export const BLOOM = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"] as const;
export type Bloom = (typeof BLOOM)[number];

export const KNOWLEDGE = ["Factual", "Conceptual", "Procedural", "Metacognitive"] as const;
export type Knowledge = (typeof KNOWLEDGE)[number];

export const GAGNE = ["Verbal information", "Intellectual skill", "Cognitive strategy", "Attitude", "Motor skill"] as const;
export type Gagne = (typeof GAGNE)[number];

export const GAGNE_HELP: Record<Gagne, string> = {
	"Verbal information": "Stating or recalling facts, names, rules or ideas in words.",
	"Intellectual skill": "Using concepts, rules or procedures to do something: classify, decide, solve, build.",
	"Cognitive strategy": "Managing one's own learning or thinking: planning, monitoring, choosing an approach.",
	Attitude: "Choosing to act in a certain way; a disposition shown by what the learner opts to do.",
	"Motor skill": "Physical movement done smoothly and accurately.",
};
export const KNOWLEDGE_HELP: Record<Knowledge, string> = {
	Factual: "Terms and specific details.",
	Conceptual: "Categories, principles, models and how they relate.",
	Procedural: "How to do something: methods, techniques, criteria for when to use them.",
	Metacognitive: "Knowledge of one's own thinking and of strategies for learning.",
};

export const FINK = [
	"Foundational knowledge",
	"Application",
	"Integration",
	"Human dimension",
	"Caring",
	"Learning how to learn",
] as const;
export type Fink = (typeof FINK)[number];

const BLOOM_VERBS: Record<Bloom, string[]> = {
	Remember: ["define", "identify", "list", "name", "recall", "recognize", "recite", "state", "label", "match"],
	Understand: ["describe", "explain", "summarize", "summarise", "interpret", "classify", "discuss", "paraphrase", "illustrate", "outline", "understand"],
	Apply: ["apply", "use", "demonstrate", "implement", "execute", "solve", "carry"],
	Analyze: ["analyze", "analyse", "compare", "contrast", "differentiate", "distinguish", "examine", "organize", "relate", "deconstruct"],
	Evaluate: ["evaluate", "assess", "judge", "justify", "critique", "defend", "argue", "prioritize", "recommend"],
	Create: ["create", "design", "develop", "formulate", "generate", "plan", "produce", "construct", "propose"],
};


const BLOOM_LEVELS_BY_VERB = (() => {
	const listed = JSON.parse(readFileSync(new URL("../data/bloom-verbs.json", import.meta.url), "utf8")) as { levels: Record<Bloom, string[]> };
	const levels = new Map<string, Set<Bloom>>();
	for (const table of [BLOOM_VERBS, listed.levels]) {
		for (const [level, verbs] of Object.entries(table) as Array<[Bloom, string[]]>) {
			for (const verb of verbs) levels.set(verb, (levels.get(verb) ?? new Set<Bloom>()).add(level));
		}
	}
	return levels;
})();

const LEAD_IN = /^(?:(?:you will )?be able to|learners will|participants will|to)\s+/i;

export function leadingVerb(objective: string): string {
	const text = objective.trim().replace(LEAD_IN, "");
	return /^(?:a|an|the)\s/i.test(text) ? "" : (text.match(/^[\p{L}-]+/u)?.[0] ?? "").toLowerCase();
}

export interface VerbLevels {
	verb: string;
	bloom: Bloom | null;
	bloomCandidates?: Bloom[];
}

export function verbLevels(objective: string): VerbLevels {
	const verb = leadingVerb(objective);
	const listed = [...(BLOOM_LEVELS_BY_VERB.get(verb) ?? [])].sort((a, b) => BLOOM.indexOf(a) - BLOOM.indexOf(b));
	const bloom = listed.length === 1 ? (listed[0] as Bloom) : null;
	return { verb, bloom, bloomCandidates: listed };
}
