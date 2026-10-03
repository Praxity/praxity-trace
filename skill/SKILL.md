---
name: praxity-trace
description: Chart a Praxity Studio course or static HTML export as a report of composition, pace, objectives, concepts and language. Use when reviewing a course's design.
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
