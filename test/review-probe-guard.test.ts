import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCourse} from '../src/inspect.ts';
import {prepareItemCues} from '../src/item-cues.ts';
const balanced = ["Red square", "Red circle", "Blue square", "Blue circle"];
const planted = [
	{ cue: "convergence", options: ["Red square", "Red circle", "Blue square", "Green dot"] },
	{ cue: "stem-echo", stem: "Find amber violet", options: ["Amber violet", "Blue", "Green", "Red"] },
	{ cue: "distractor-absolutes", options: ["Red", "Always blue", "Green", "Violet"] },
	{ cue: "duplicate", options: ["Red", "Blue", " blue! ", "Violet"] },
	{ cue: "near-duplicate", options: ["Water moves through copper pipe", "Water moves through steel pipe", "Orange", "Violet"] },
	{ cue: "shared-lead", options: ["Check the current report today", "Check the current report tomorrow", "Green", "Violet"] },
	{ cue: "distractor-qualifiers", options: ["Red", "Just blue", "Green", "Violet"] },
	{ cue: "hedged-key", options: ["Usually red", "Blue", "Green", "Violet"] },
] as const;

function fixture() {
	const lesson = (title: string, rows: Array<{ options: readonly string[]; stem?: string }>) => ({ file: `${title}.prax`, title, sha256: "synthetic", narration: [], unlinkedNarration: [], unlinkedNarrationCount: 0,
		pages: [{ ref: `${title}/page`, id: null, number: 1, title, blocks: rows.map((row, i) => ({ ref: `${title}/${i}`, parentRef: null, id: null, type: "assessment", coverage: "text", location: { file: `${title}.prax`, startLine: i + 1, endLine: i + 1 },
			texts: [{ ref: `${title}/${i}/stem`, role: "prompt", format: "plain", value: row.stem ?? "Which symbol is specified?", location: null }, ...row.options.map((value, j) => ({ ref: `${title}/${i}/option/${j}`, role: "option", format: "plain", value, location: null })), { ref: `${title}/${i}/feedback`, role: "feedback", format: "plain", value: "FEEDBACK_CANARY_472", location: null }],
			assessment: { responseType: "choice", correctness: "keyed", selectionMode: "single", options: row.options.map((label, j) => ({ ref: `${title}/${i}/response/${j}`, label, correct: j === 0 })), scoring: { gradingMode: "none", scored: false, points: null, required: false, attempts: 0, feedbackMode: null }, secret: "KEY_CANARY_851" } })) }] });
	return { ok: true, schema: "praxity-inspect/1", projectionVersion: 2, studioVersion: "synthetic", revision: "a".repeat(64), course: { title: "Synthetic cue banks", locale: "en" }, lessons: [lesson("leaking", [...planted]), lesson("clean", [{ options: balanced }])] };
}

const shapes = [
 ['nested label', '[Red [square]]{NESTED_CANARY: Red square is the key}'],
 ['escaped label', String.raw`[Red \] square]{ESCAPED_CANARY: Red square is the key}`],
 ['nested definition', '[Red]{DEFINITION_CANARY: Red square is the key ]{nested {deeper}}}'],
 ['unknown construct', '[[UNPARSED_CANARY: future syntax]]'],
] as const;
for (const [name,shape] of shapes) test('review guard regression: '+name, async context => {
 const raw=fixture(),template=raw.lessons[1]!.pages[0]!.blocks[0]!;
 raw.lessons=[raw.lessons[1]!];
 raw.lessons[0]!.pages[0]!.blocks=['prompt','option'].map(role=>{
  const block=structuredClone(template);block.ref='edge-'+role;
  block.texts.forEach((text,j)=>{
   text.ref=block.ref+'/text-'+j;
   if(text.role===role&&(role==='prompt'||j===1)){text.format='markdown';text.value=shape;}
  });
  if(role==='option')block.assessment.options[0]!.label=shape;
  return block;
 });
 raw.lessons[0]!.pages[0]!.blocks.push(template);
 const out=await mkdtemp(join(tmpdir(),'trace-review-guard-'));
 context.after(()=>rm(out,{recursive:true,force:true}));
 await prepareItemCues(parseCourse(JSON.stringify(raw)),out);
 const scan=async (dir:string):Promise<void>=>{for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);if(entry.isDirectory())await scan(path);
  else assert.doesNotMatch(await readFile(path,'utf8'),/[A-Z_]+_CANARY|Red square is the key|future syntax/,path);
 }};
 await scan(out);
 for(const probe of ['choices-only','cover-the-options'])assert.deepEqual(JSON.parse(await readFile(join(out,probe,'items.json'),'utf8')).map((row:{ref:string})=>row.ref),['1.1.3']);
});
