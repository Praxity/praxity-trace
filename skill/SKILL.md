---
name: praxity-trace
description: Chart a Praxity Studio course or static HTML export as a report of composition, pace, objectives, concepts, language and item cues. Use when reviewing a course's design or testing whether keyed choices disclose their answers.
---

# Praxity Trace

Trace describes a course and leaves judgment to the designer. Report what the views show. Label your own reading as interpretation and keep it separate.

With a portable artifact, replace `praxity-trace` in the commands below with `node "<artifact>/src/cli.ts"`. Use Node >=24.18 supplied by your host. Quote paths that contain spaces.

1. Choose an input. For a Studio project, run `praxity inspect <course-dir> --schema 1 > course.json` and use `course.json`. For a static HTML export or an unzipped SCORM package, use its directory. `<course-dir>` is the folder that contains `course.yaml`. The `praxity` launcher comes from Studio or Rubato's tools directory.
2. For each model view you need (`alignment`, `tasks`, `concepts`, `terms`, `visuals`, `distinctions`), run `praxity-trace prepare <view> <input> --out <bundle>`. Read `<bundle>/prompt.md` and `<bundle>/course.md`, then write `<bundle>/answer.json` exactly as the prompt specifies. Cite only refs that appear in `course.md`. For `tasks`, follow the [task-coding guide](../docs/task-coding-guide.md): classify requested work, quote its instruction and record assessment purpose separately.
3. Run `praxity-trace report <input> --out <dir>`, adding `--alignment`, `--tasks`, `--concepts`, `--terms`, `--visuals` and `--distinctions` with each prepared `answer.json`. When `report` rejects an answer, it names the field to fix. A course-hash mismatch means the course changed, so prepare a new bundle.
4. For the Recommendations section, run `praxity-trace prepare recommendations <input> --report <dir>/report.json --out <bundle>`, answer it the same way, then run step 3 again with `--recommendations <bundle>/answer.json` added. Recommendations use `recommendations/3`. A report-hash mismatch means the report changed since you prepared; prepare again.
5. Serve `<dir>` through a local preview server and open `report.html` for the designer. `report.json` holds the same data. Every mark carries its lesson file and line or ref, so you can open the block the designer asks about.
6. After the course changes, repeat from step 1.

Schema 1 requires a Studio build that supports `--schema 1`. Trace still accepts schema 0, which older builds produce with `praxity inspect <course-dir>`. Both `prepare` and `report` accept `-` to read inspect JSON from stdin. Re-inspect after manifest or sidecar edits, even when lesson files have not changed.

Read the input coverage notice before interpreting schema 1 results. The text projection is partial. Earlier schema 1 output has no correctness or scoring; projection version 2 supplies authored correctness and scoring separately. Narration times remain script estimates; stored sidecar endpoints do not establish full-file duration. A missing field is not evidence that a course lacks that feature. Studio refs are snapshot addresses, so find content with Trace source pointers and the original lesson line ranges.

Structure contains Anatomy and Pace. Objective groups are part of the Course trace view, which view links call `trace`. Its Table mode lists all members, statement locations and what they build toward. The HTML and `report.json` no longer include page similarity.

Before interpreting a view for the designer, read its entry in `report.json` under `guides`: the patterns worth noticing and what each could mean. Offer those readings as possibilities; a pattern that looks like a gap may be the course's intent.

## Item cues

Keep these command shapes:

- `praxity-trace report <input> --out <dir>` includes scripted measurements.
- `praxity-trace prepare item-cues <input> --out <new-empty-bundle>` prepares blind probes.
- `praxity-trace report <input> --item-cues <answer.json> --out <dir>` scores responses.

Prepare blind probes only from `praxity inspect <course> --schema 1` JSON with projection 2. HTML exports and schema 0 are refused for preparation; `report` can still run scripted checks on them without writing solver inputs. Only single-selection choices with exactly one known key and at least two readable text options are included, even when unscored. Read `excluded` and `excludedCount`. In HTML fields, Trace accepts only attribute-free `p` elements and `span` tooltips whose only attributes are `class="inline-tooltip-trigger"` and `data-tooltip-content`. Tooltip definitions stay out of solver inputs. Other markup, including styles, hiding attributes and unfamiliar classes, excludes the whole item; simplify it or re-export from current Studio. Trace leaves out any item whose question or options still contain square or curly brackets after it removes glossary definitions, even brackets meant as text. The exclusion names the field and bracket and shows the question excerpt. Remove the brackets or check the item by hand. Earlier schema 1 has no known keys. Shuffled and shuffle-unknown items retain authored positions as evidence but are excluded from fixed-position counts.

1. Prepare the bundle. Give only `choices-only/prompt.md` and its `items.json` to one fresh solver, and only `cover-the-options/prompt.md` and its `items.json` to a separate fresh solver. Neither may be the writer or see the other probe, source course, keys or feedback. The bundle omits `course.md`; `--comments` is rejected. Keep post-solve report and judge evidence outside this bundle.
2. Collect both answer objects. Choices-only rows contain `ref`, a one-based `choice` in the supplied shuffled order, a fixed `cue` code and a brief `note`. Codes are listed in the prompt; `other` requires an explanation. Cover-the-options rows contain `ref` and a short `answer`, or "can't tell". Both solvers answer every supplied item once. Natural paraphrases are welcome.
3. The operator records the actual model names and combines the untouched arrays under `choicesOnly: {model, answers}` and `coverTheOptions: {model, answers}` in `answer.json`. Copy `view`, `promptVersion` and `courseHash` from the manifest. Use `item-cues/6`, with the manifest's projection suffix. Trace regenerates each item's key-independent permutation outside the bundle and maps the choices back when scoring.
4. Run report with `--item-cues`. For cover-the-options, it lists the stem, response and key as "needs judgement". It does not score literal text or call unjudged answers wrong. A separate fresh judge agent, not the writer or either solver, compares those report rows by meaning and adds `coverJudgement: "matches" | "differs" | "cantTell" | "alsoCorrect"` to each `coverTheOptions.answers` row. Record that agent in `coverTheOptions.judgeModel`, then run the same report command. `cantTell` means the solver could not tell; it is separate from an answer that differs. `alsoCorrect`, labelled "Another valid answer", means the stem solver gave a different answer that is also correct. The stem is answerable. This is not a cover failure or a wrong answer. Tighten the stem so only the key fits, or make the options settle which answer is best. The report notes when the omitted stem evidence includes media, code or examples.

Read `report.json.itemCues.course` first. It pools included items once; `banks[]` has the same fields as a breakdown by authored assessment group or lesson. Rubato consumes `itemCues.course.choicesOnly`: `right`, `total`, `chanceExpected`, `p` for the exact upper tail, and `pLow` for the exact lower tail. Both tails include the observed count and use each item's `1/options`, so mixed option counts use the exact Poisson-binomial distribution. The same fields appear on every bank. Scores unusually low or high can both indicate a cue. Small banks retain exact values in JSON but display "Too few items to compare with guessing" separately for each tail: `tooFewItems` tests the all-right upper tail; `tooFewItemsLow` tests the all-wrong lower tail. Avoid interpreting isolated small banks or repeated solver runs as independent evidence.

`coverTheOptions` keeps every stem, solver response and key with a judgement or null. Before judgement, `right` is null and status is "not judged". With judgements, it records matches, differs, also-correct, can't-tell, pending and judged counts. Both matches and also-correct answers count in `right`, the number of defensible stem answers; `outcomes.alsoCorrect` separately counts other valid free answers. It does not establish that several offered options are correct. No chance probability or p value is assigned to free answers. Check correct paraphrases by meaning. Stem answerability has a different purpose from choices-only cue detection.

Each item record has a visible `label` containing its full block ref and a short stem excerpt, also present in both probe result arrays. HTML item rows and source lists show that label plus the source file and line, so questions on one page remain distinct.

`cueCounts` reports cues to the key. `writingCounts` separately reports high option overlap and shared openings, which may be intentional parallel options. Every pattern has an author action, with limits against overcorrection. `choicesOnly.cueCounts` totals solver cue codes and links them to the same guidance. Zero scripted counts do not establish a clean bank; without solver responses the report says "Probes not run".

Convergence is a bank/course statistic against guessing, including exact fractional tie-credit tails. Only a unique key maximum is listed per item, and it is excluded from `cueCounts`. Consultation is also a bank share, never an item flag. English lexical rules run only for an `en` locale; other languages explicitly say "Not checked: English-only rule" in `applicability`, with null lexical counts. Unicode duplicate, overlap and shared-lead checks still run.

`spreads` separates option counts and includes authored positions, known fixed-order positions, shuffled/unknown counts, length ranks and longest-key counts including ties. Length is visible character count including spaces; rank 1 is shortest and ties share the lower rank. Guessing expectations account for ties; the equal-share reference is items/options. At least 20 items are needed to label the reference script's 10-40% rank band. Use the pooled course spread for smaller banks. Spread key length ranks across the bank; do not move every key to another single rank.

## Objective levels

In `report.json`, `alignment.objectives[]` carries `bloomCandidates`, every listed level of the leading verb; `verbBloom`, the listed level when there is exactly one, otherwise null; and `modelBloom`, the reviewer's level from the verb and its object, or null. `bloomDiffers` is true only when that single listed level and a non-null reviewer level differ. `levelReason` records the reviewer's reason. Each objective's `ref` resolves to its source pointer in `alignment.places`.

`bloom` keeps the single listed level as the measurement. For multi-level or unlisted verbs, it uses `modelBloom`, labelled generated by `bloomSource`. Table mode shows differing listed and reviewer levels with the reason; Chart mode keeps the listed position and adds a labelled generated interpretation. Read a difference as a prompt to inspect the objective's object and the reviewer's reasoning. It is not a score. The answer contract and alignment prompt version are unchanged.

## Transcript evidence

Read Transcript lines as supplied media prose, including descriptions with no speech. Inspect projection 2 supplies authored `media.transcript`; its caption-track contents remain unavailable. Schema 0 and embedded Studio HTML may supply authored `data.transcript`. HTML also reads local readable VTT caption and subtitle tracks. Transcripts add no on-screen words, narration time or playback time.

In `report.json`, `language.lessons[].channels.transcript` holds transcript sentence and word summaries. English vocabulary counts also include `language.vocabulary.lessons[].transcript`. These optional fields are absent only when the course has no nonblank transcript text. Transcript sentence records use `channel: "transcript"`, ids such as `3.9.t2`, and the owning media block ref; longest, flagged and rare-word lists can include them.

Terms flags, Tasks evidence and Visuals opportunities accept `screen`, `narration` or `transcript`; their quotes must occur in the cited channel. Alignment support also accepts `tooltip` and preserves transcript instruction links. `availability.checks[].available` and `availability.checks[].instructionLinks[].available` can be `transcript`, labelled "In a transcript only" without orange. Concepts keep one occurrence and role per block across channels.

Prepare fresh answers after this contract change: old prompt versions are rejected, and schema 1 freshness uses `trace-inspect/5`. Copy the current `promptVersion` and `courseHash` from the bundle manifest, including its `-projection-2` suffix when present.

## Designer comments

The designer can comment on the report in the browser and send the comments as a `comments.json` download or a "Copy for assistant" Markdown list. Each comment names its view, the objectives, page ("page 3.9": lesson 3, page 9), sentence id ("3.9.s2") and, when known, the lesson file and line it came from.

- To correct a model view, re-prepare it with the comments: `praxity-trace prepare <view> <input> --out <bundle> --comments comments.json`. The prompt then includes the designer's comments on that view, which override the model's own judgment. Write the new answer and re-run `report`.
- To split an objective group, pass the Course trace comment to `prepare alignment --comments`. The alignment prompt then includes comments on `trace` that identify objectives, alongside alignment comments.
- To act on the course when the designer asks (for example "find a good position in L3 for a knowledge check for this term"), use each comment's file, line and page to open the lesson source, make the change the designer asked for, then repeat from step 1. Comments never change the course on their own.
