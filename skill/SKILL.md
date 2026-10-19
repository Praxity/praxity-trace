---
name: praxity-trace
description: Chart a Praxity course or HTML export as a report of composition, pace, objectives, concepts, language and item cues, and act on designer comments left on that report. Use to review a course's design, test whether keyed choices give away their answers, or apply comments from a Trace report.
---

# Praxity Trace

Trace describes a course and leaves judgment to the designer. Report what the views show, and label your own reading as interpretation.

Through Rubato, run `praxity trace <command>`. A standalone install runs `praxity-trace <command>`, or `node "<package>/src/cli.ts" <command>` with Node 24.18 or later. The examples use `praxity-trace`. Quote paths that contain spaces.

## Report on a course

1. Choose an input. For a Studio course folder (the one holding `course.yaml`), run `praxity inspect <course-dir> --schema 1 > course.json` and use `course.json`. For a static HTML export or an unzipped SCORM package, use its folder. `prepare` and `report` also read inspect JSON from `-` (stdin). Inspect again after any lesson, manifest or sidecar edit.
2. For each model view you need (`alignment`, `tasks`, `concepts`, `terms`, `visuals`, `distinctions`), run `praxity-trace prepare <view> <input> --out <bundle>`. Read `<bundle>/prompt.md` and `<bundle>/course.md`, then write `<bundle>/answer.json` exactly as the prompt specifies, citing only refs that appear in `course.md`.
3. Run `praxity-trace report <input> --out <dir>`, adding `--alignment`, `--tasks`, `--concepts`, `--terms`, `--visuals` and `--distinctions` with each prepared `answer.json`. A rejected answer names the field to fix. A course-hash or prompt-version mismatch means the course or Trace changed since you prepared; prepare a new bundle.
4. Recommendations come last. Run `praxity-trace prepare recommendations <input> --report <dir>/report.json --out <bundle>`, answer it the same way, then run step 3 again with `--recommendations <bundle>/answer.json`.
5. Serve `<dir>` through a local preview server and open `report.html` for the designer. `report.json` holds the same data. Every mark carries its lesson file and line or ref, so you can open the block the designer asks about.

Before interpreting a view, read its entry under `guides` in `report.json`: the patterns worth noticing and what each could mean. Offer those readings as possibilities; a pattern that looks like a gap may be the course's intent. Read the input coverage notice first: a missing field is not evidence that the course lacks a feature. [Report fields](references/report.md) explains objective levels, transcripts, item-cue fields and exclusions.

## Item cues

Every report includes scripted item-cue checks. The blind probes test whether a solver can pick the key from the options alone, or answer from the stem alone. When someone is writing or revising the bank, the `assessment-writing` skill owns the pass gates and the three-pass cap.

1. Prepare the probes from schema 1 inspect JSON into a new, empty folder: `praxity-trace prepare item-cues course.json --out <bundle>`. HTML exports and schema 0 are refused here.
2. Follow the bundle's root `prompt.md`. It says which fresh agent gets which probe folder and what neither may see, and gives the `answer.json` shape. Copy `view`, `promptVersion` and `courseHash` from the manifest. Record each solver's actual model, not its self-report.
3. Run `praxity-trace report course.json --out <dir> --item-cues <bundle>/answer.json`. Cover-the-options rows show stem, response and key as "not judged".
4. A separate fresh judge agent, not the writer or either solver, compares those rows by meaning and adds `coverJudgement` to each `coverTheOptions.answers` row, as the bundle prompt describes, with its model in `coverTheOptions.judgeModel`. Run the same report command again.

Read `report.json.itemCues.course` first: it pools every included item once, and `banks[]` breaks it down by assessment group or lesson with the same fields. `choicesOnly.p` and `choicesOnly.pLow` are the exact upper and lower tails against guessing; scores unusually high or low can both signal a cue. Small banks say "Too few items to compare with guessing"; read them through the course row. Zero scripted counts don't prove a clean bank, and without solver responses the report says "Probes not run". Read `excluded` before trusting counts: each reason names what to fix or check by hand.

## Designer comments

The designer can comment on the report in the browser and hand you a `comments.json` download or a "Copy for assistant" list. Each comment names its view, objectives, page ("page 3.9" is lesson 3, page 9), sentence id ("3.9.s2") and, when known, the lesson file and line.

- To correct a model view, prepare it again with `--comments comments.json`. The prompt then includes the designer's comments on that view, which override the model's own judgment. Write the new answer and rerun `report`. To split an objective group, pass the Course trace comment to `prepare alignment --comments`. `prepare item-cues` refuses comments, which could reveal keys.
- To change the course when the designer asks, open the lesson at each comment's file, line and page, make the requested change, then report again from step 1. Comments never change the course on their own.
