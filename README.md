# Praxity Trace

Trace is a course review tool for learning designers. It reads a course and
writes one report that shows how the course is built: what each lesson is made
of, where objectives are stated, taught and checked, where the instruction for
each knowledge check sits, what learners are asked to do, where concepts appear
and return, and where the reading gets hard. Use it when you inherit a course,
before a design review, or before you rewrite a lesson. Trace shows the course;
you decide what to change.

Status: experimental. Views and the report format may change between versions.

## Install

Trace needs Node 24.18 or newer and pnpm.

```sh
git clone https://github.com/Praxity/praxity-trace.git
cd praxity-trace
pnpm install
```

Run it with `node src/cli.ts`, or link the `praxity-trace` command with
`pnpm link --global`.

## Read a course

Trace reads three kinds of input:

- A Praxity Studio course. Export its structure with
  `praxity inspect <course-dir> --schema 1 > course.json`. Schema 0 still works.
- A folder of static HTML pages.
- An unzipped SCORM package.

```sh
praxity-trace report course.json --out report/
```

Open `report/report.html` in a browser. `report/report.json` holds the same data
for an LLM or a script. Every view has a Chart mode and a Table mode, and
every mark points to its lesson file and line.

## Views that need an LLM

Some views need judgment, such as which knowledge check covers which objective.
Trace never calls an LLM itself. It prepares a bundle with the course text, a
prompt and the answer format; you run it through an LLM you already use, such as
Claude or ChatGPT, which writes the answer; Trace checks the
answer against this revision of the course and draws the view.

```sh
praxity-trace prepare alignment course.json --out bundle/
# run bundle/prompt.md and bundle/course.md through your LLM; save its output as bundle/answer.json
praxity-trace report course.json --out report/ --alignment bundle/answer.json
```

The report labels these readings as interpretations. [skill/SKILL.md](skill/SKILL.md)
documents every command and bundle for agents.

## Limits

- Studio schema 1 gives Trace supported text only. Correctness, scoring, media
  details and measured audio durations are unavailable, and the report says so.
- HTML exports other than Studio's are read as far as their markup allows.
  Players that build their pages with JavaScript are not supported.
- Rare words, sentence-structure patterns and the cohesion measures use English
  word lists, so they run on English courses only. Other views work in any
  language.
- Trace gives no scores, grades or pass marks.

Praxity Trace by Ariel Harlap. Community source; see [LICENSING.md](LICENSING.md).
