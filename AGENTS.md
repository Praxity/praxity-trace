# Praxity Trace

Trace is design diagnostics for learning courses, the course equivalent of a
performance trace. It reads a course and draws views that show a learning
designer how the course is built, so they can decide what to revise. It sits
beside Check (accessibility) and Proof (learner results), and is in research:
views are drafts until they prove useful on real courses.

Use the vocabulary in [CONTEXT.md](CONTEXT.md). Read [docs/adr/](docs/adr/)
before changing inputs, model use, runtime or scoring. Current work is in
[backlog.md](backlog.md).

## Design rules

- Input is the JSON from Studio's `praxity inspect <course-dir> --schema 1`. Build the course
  model from that contract; `@praxity/grammar` and other Studio source stay out
  of this repository (ADR 0001).
- Keep measurements, interpretations and learner observations separate in data
  and on screen. A reader can always tell which kind a mark is.
- Every mark carries a source pointer, so the designer can jump to the exact
  lesson, line and block.
- Views describe; the designer judges. Show counts, positions and durations
  with their units and counting rules stated (ADR 0004).
- Model work goes through `prepare` bundles. An answer records its model,
  prompt version and course hash; `report` rejects a mismatched hash or an
  unknown ref (ADR 0002). Bump the prompt version when the prompt changes.
- A view may include a model-written reading of the chart, labelled as an
  interpretation and placed after the data it interprets. The one exception is
  Recommendations, which opens the report as a generated summary and links to
  the views it draws on.

## Visualization

Design every view in the manner of Stephen Few: maximize data-ink, compare
along a common baseline, label directly, use colour only to encode a variable,
and keep neutral grey for context. Pick the chart from the question the view
answers. Each view has a Chart and a Table mode over the same values (ADR
0006). The table is the accessible representation and meets WCAG 2.2 AA in
full: keyboard reachable, labelled, reflowing at 320 CSS px. The chart keeps
contrast-safe colours and a text summary but its marks need not be focusable.

Keep the text above a chart to a sentence or two a designer needs: a finding,
or how to read what is not obvious. Counting rules, formulas and sources go in
a closed disclosure (`method()` in `src/modes.ts`), so they stay stated without
being in the way.

Use one vocabulary and one symbol per meaning across the report, as listed in
[CONTEXT.md](CONTEXT.md). Write pages as "3.9" (lesson.page). Orange marks only what a
designer may want to look at.

`report.html` is one self-contained file that works from `file://` and in
Rubato's Browser preview. `report.json` is the machine contract; the HTML
renders from it.

## Code

- Node 24.18+ runs `.ts` directly by type stripping, so write only erasable
  TypeScript: no enums, namespaces or parameter properties. Relative imports
  end in `.ts`.
- `skill/SKILL.md` documents the CLI for agents in Rubato and elsewhere.
  Update it in the same change as any CLI contract change.
- Run `pnpm verify` before handing off.

## Private material

Test fixtures are synthetic or come from `prax-format/examples` (CC0). Real
client and evidence courses go in `corpus/local/`, which Git ignores. Keep
their content out of commits, fixtures, docs and issue text.

The licence stack matches Praxity Check. Code copied from Check keeps working
under the same terms; code from Studio, Rubato or other repositories needs its
licence checked first.
