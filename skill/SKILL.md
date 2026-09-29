---
name: praxity-trace
description: Chart a Praxity Studio course or static HTML export as a report of composition, pace, objectives, concepts and language. Use when reviewing a course's design.
---

# Praxity Trace

Trace describes a course; the designer judges it. Report what the views show, and keep your own reading separate and labelled as interpretation.

1. Choose an input. For a Studio project, run `praxity inspect <course-dir> --schema 1 > course.json` and use `course.json`. For a static HTML export or an unzipped SCORM package, use its directory. `<course-dir>` contains `course.yaml`; the `praxity` launcher comes from Studio or Rubato's tools directory.
2. For each model view you need (`alignment`, `tasks`, `concepts`, `terms`, `visuals`, `distinctions`), run `praxity-trace prepare <view> <input> --out <bundle>`. Read `<bundle>/prompt.md` and `<bundle>/course.md`, then write `<bundle>/answer.json` exactly as the prompt specifies. Cite only refs that appear in `course.md`. For `tasks`, use the [task-coding guide](../docs/task-coding-guide.md); classify requested work, quote its instruction and record assessment purpose separately.
3. Run `praxity-trace report <input> --out <dir>`, adding `--alignment`, `--tasks`, `--concepts`, `--terms`, `--visuals` and `--distinctions` with each prepared `answer.json`. A rejected answer names the field to fix; a course-hash mismatch means the course changed, so prepare a new bundle.
4. For the Recommendations section, run `praxity-trace prepare recommendations <input> --report <dir>/report.json --out <bundle>`, answer it the same way, then run step 3 again with `--recommendations <bundle>/answer.json` added. Recommendations use `recommendations/2`. A report-hash mismatch means the report changed since you prepared; prepare again.
5. Serve `<dir>` through a local preview server and open `report.html` for the designer. `report.json` holds the same data; every mark carries its lesson file and line or ref, so you can open the block the designer asks about.
6. After the course changes, repeat from step 1.

Schema 1 requires a Studio build that supports `--schema 1`. Schema 0 remains accepted from older builds with `praxity inspect <course-dir>`. Both `prepare` and `report` accept `-` for inspect JSON on stdin. Re-inspect after manifest or sidecar edits, even when lesson files have not changed.

Read the input coverage notice before interpreting schema 1 results. Its text projection is partial, correctness and scoring are unavailable, and narration times are estimates. A missing field is not evidence that a course lacks that feature. Studio refs are snapshot addresses; use Trace source pointers and the original lesson line ranges to find content.

Structure contains Anatomy and Pace. Objective groups are part of Course trace, identified as `trace` in view links. Its Table mode lists all members, statement locations and what they build toward. Page similarity is no longer included in the HTML or `report.json`.

Before interpreting a view for the designer, read its entry in `report.json` under `guides`: the patterns worth noticing and what each could mean. Offer those readings as possibilities; a pattern that looks like a gap may be the course's intent.

## Designer comments

The designer can comment on the report in the browser and send the comments as a `comments.json` download or a "Copy for assistant" Markdown list. Each comment names its view, the objectives, page ("page 3.9": lesson 3, page 9), sentence id ("3.9.s2") and, when known, the lesson file and line it came from.

- To correct a model view, re-prepare it with the comments: `praxity-trace prepare <view> <input> --out <bundle> --comments comments.json`. The prompt then includes the designer's comments on that view, which override the model's own judgment. Write the new answer and re-run `report`.
- To split an objective group, pass the Course trace comment to `prepare alignment --comments`; comments identifying objectives in `trace` are included with alignment comments.
- To act on the course when the designer asks (for example "find a good position in L3 for a knowledge check for this term"), use each comment's file, line and page to open the lesson source, make the change the designer asked for, then repeat from step 1. Comments never change the course on their own.
