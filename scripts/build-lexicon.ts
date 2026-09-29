// Builds data/tubelex-en.tsv.gz from TUBELEX's English lists (https://github.com/naist-nlp/tubelex,
// frequencies/tubelex-en.tsv.xz and tubelex-en-lemma-pos.tsv.xz, BSD-3-Clause). Decompress both, then:
//   node scripts/build-lexicon.ts tubelex-en.tsv tubelex-en-lemma-pos.tsv
// Each entry is a single word at Zipf 2 or above, rounded to one decimal. A base form takes its
// lemma frequency, which counts all its inflections, when that is higher than its own.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const zipfs = (path: string) => {
	const rows = readFileSync(path, "utf8").trim().split("\n").slice(1).map((line) => line.split("\t"));
	const total = Number(rows.find(([word]) => word === "[TOTAL]")?.[1]);
	return rows.flatMap(([word, count]) => (word && /^\p{L}+$/u.test(word) ? [[word, Math.log10((Number(count) / total) * 1e9)] as const] : []));
};
const merged = new Map(zipfs(process.argv[2] as string));
for (const [lemma, zipf] of zipfs(process.argv[3] as string)) merged.set(lemma, Math.max(zipf, merged.get(lemma) ?? 0));
const kept = [...merged].filter(([, zipf]) => zipf >= 2).sort((a, b) => b[1] - a[1]).map(([word, zipf]) => `${word}\t${zipf.toFixed(1)}`);
writeFileSync(new URL("../data/tubelex-en.tsv.gz", import.meta.url), gzipSync(`${kept.join("\n")}\n`, { level: 9 }));
console.log(`${kept.length} words`);
