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

`report <input> --out <dir>` always includes scripted item-cues measurements. It reports key position and length-rank spreads, convergence, stem echo, distractor absolutes and qualifiers, duplicate or near-duplicate options, shared leads and the hedged or consultation key pattern. Counts describe lexical cues, never distractor plausibility.

To attack keyed choices without revealing their answers:

1. Run `praxity-trace prepare item-cues <input> --out <new-empty-bundle>`. Use inspect projection 2 or a Studio HTML export with authored keys. Trace includes single-selection choices with exactly one known key, even when unscored; the report lists exclusions. Earlier schema 1 has no keys to inspect.
2. Give `<bundle>/choices-only/prompt.md` and `items.json` to one fresh solver. Give only `<bundle>/cover-the-options/prompt.md` and its `items.json` to a separate fresh solver. Neither solver may be the item writer or see the other probe, source course, keys or feedback. The bundle deliberately omits `course.md`; `--comments` is rejected for this view.
3. Each solver writes its folder's `answer.json` with `model` and `answers`. Choices-only rows are `{ "ref": "1.1.1", "choice": 2, "cue": "stem-independent wording cue, or guessed" }`, with a one-based option number. Cover-the-options rows are `{ "ref": "1.1.1", "answer": "short answer, or can't tell" }`. Each must answer every supplied item once.
4. Combine the two untouched answer objects into `<bundle>/answer.json`: copy `view`, `promptVersion` and `courseHash` from `manifest.json`, then add `choicesOnly` and `coverTheOptions` with the matching solver objects. The root `prompt.md` shows the complete shape.
5. Run `praxity-trace report <input> --item-cues <bundle>/answer.json --out <dir>`.

Read `report.json.itemCues.banks[]`. Banks use authored assessment groups, then lesson banks for ungrouped choices. `cueCounts` counts each cue once per item; `items[].flags` names the cue and its option positions. `spreads` separates option counts, so three-option and four-option items are not compared on the same ranks. Length is visible character count including spaces; ties share the lower rank. Positions are authored order, before runtime shuffling. The scripted lexical rules are English-only.

Each probe records `right`, `total`, `chanceExpected`, `p` and every response with its source ref; choices-only keeps the solver's named cue. The chance reference sums `1/options`. `p` is an exact one-sided binomial tail, using the Poisson-binomial extension when option counts differ. There is no fixed passing rate. Cover-the-options uses normalized literal key-text matching, so correct paraphrases remain unmatched. Its p is only a uniform-choice reference, since free-response guessing has no known probability. Answerability from the stem alone is not evidence of option cues. Inspect the responses before revising.

## Objective levels

In `report.json`, `alignment.objectives[]` carries `bloomCandidates`, every listed level of the leading verb; `verbBloom`, the listed level when there is exactly one, otherwise null; and `modelBloom`, the reviewer's level from the verb and its object, or null. `bloomDiffers` is true only when that single listed level and a non-null reviewer level differ. `levelReason` records the reviewer's reason. Each objective's `ref` resolves to its source pointer in `alignment.places`.

`bloom` keeps the single listed level as the measurement. For multi-level or unlisted verbs, it uses `modelBloom`, labelled generated by `bloomSource`. Table mode shows differing listed and reviewer levels with the reason; Chart mode keeps the listed position and adds a labelled generated interpretation. Read a difference as a prompt to inspect the objective's object and the reviewer's reasoning. It is not a score. The answer contract and alignment prompt version are unchanged.

## Transcript evidence

Read Transcript lines as supplied media prose, including descriptions with no speech. Inspect projection 2 supplies authored `media.transcript`; its caption-track contents remain unavailable. Schema 0 and embedded Studio HTML may supply authored `data.transcript`. HTML also reads local readable VTT caption and subtitle tracks. Transcripts add no on-screen words, narration time or playback time.

In `report.json`, `language.lessons[].channels.transcript` holds transcript sentence and word summaries. English vocabulary counts also include `language.vocabulary.lessons[].transcript`. These optional fields are absent only when the course has no nonblank transcript text. Transcript sentence records use `channel: "transcript"`, ids such as `3.9.t2`, and the owning media block ref; longest, flagged and rare-word lists can include them.

Terms flags, Tasks evidence and Visuals opportunities accept `screen`, `narration` or `transcript`; their quotes must occur in the cited channel. Alignment support also accepts `tooltip` and preserves transcript instruction links. `availability.checks[].available` and `availability.checks[].instructionLinks[].available` can be `transcript`, labelled "In a transcript only" without orange. Concepts keep one occurrence and role per block across channels.

Prepare fresh answers after this contract change: old prompt versions are rejected, and schema 1 freshness uses `trace-inspect/3`. Copy the current `promptVersion` and `courseHash` from the bundle manifest, including its `-projection-2` suffix when present.

## Designer comments

The designer can comment on the report in the browser and send the comments as a `comments.json` download or a "Copy for assistant" Markdown list. Each comment names its view, the objectives, page ("page 3.9": lesson 3, page 9), sentence id ("3.9.s2") and, when known, the lesson file and line it came from.

- To correct a model view, re-prepare it with the comments: `praxity-trace prepare <view> <input> --out <bundle> --comments comments.json`. The prompt then includes the designer's comments on that view, which override the model's own judgment. Write the new answer and re-run `report`.
- To split an objective group, pass the Course trace comment to `prepare alignment --comments`. The alignment prompt then includes comments on `trace` that identify objectives, alongside alignment comments.
- To act on the course when the designer asks (for example "find a good position in L3 for a knowledge check for this term"), use each comment's file, line and page to open the lesson source, make the change the designer asked for, then repeat from step 1. Comments never change the course on their own.
