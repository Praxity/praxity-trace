# Praxity Trace

If `AGENTS.local.md` exists, read it before starting. It holds maintainer context and is not part of the repository.

Trace is design diagnostics for learning courses, the course equivalent of a
performance trace. It reads a course and draws views that show a learning
designer how the course is built, so they can decide what to revise. Its sibling
tools are Check (accessibility) and Proof (learner results). Trace is a
research project: views stay drafts until they prove useful on real courses.
Current work is tracked outside this repository.

## Design rules

- Input is the JSON from Studio's `praxity inspect <course-dir> --schema 1`.
  Build the course model from that contract. Keep `@praxity/grammar` and
  other Studio source out of this repository (ADR 0001).
- Keep measurements, interpretations and learner observations separate in data
  and on screen, so a reader can always tell which kind a mark is.
- Every mark carries a source pointer, so the designer can jump to the exact
  lesson, line and block.
- Views describe the course and leave judgment to the designer. Show counts,
  positions and durations with their units and counting rules stated
  (ADR 0004).
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
and keep neutral grey for context. Choose the chart that answers the view's
question. Each view has a Chart and a Table mode over the same values (ADR
0006). The table is the accessible representation and meets WCAG 2.2 AA in
full: keyboard reachable, labelled, reflowing at 320 CSS px. The chart keeps
contrast-safe colours and a text summary but its marks need not be focusable.

Limit the text above a chart to the sentence or two a designer needs: a
finding, or how to read what is not obvious. Put counting rules, formulas and
sources in a closed disclosure (`method()` in `src/modes.ts`), so they stay
stated without crowding the chart.

Use one term and one symbol per meaning across the report.
[GLOSSARY.md](GLOSSARY.md) lists them, including the page format and the one
use of orange.

`report.html` is one self-contained file that works from `file://` and in
Rubato's Browser preview. `report.json` is the machine contract; the HTML
renders from it.

## Code

- Node runs `.ts` directly by type stripping, so write only erasable
  TypeScript: no enums, namespaces or parameter properties. End relative
  imports in `.ts`.
- `skill/SKILL.md` is the CLI guide for agents in Rubato and elsewhere. Update
  it in the same change as any CLI contract change.
- `pnpm verify` is the integrated gate. Run it locally before handing off. In a
  delegated run, workers run the smallest relevant check and the root runs
  `pnpm verify` once after integration.

## Private material

Test fixtures are synthetic or come from `prax-format/examples` (CC0). Real
client and evidence courses go in `corpus/local/`, which Git ignores. Keep
their content out of commits, fixtures, docs and issue text.

Praxity Trace is source-available under the unmodified
[PolyForm Perimeter License 1.0.1](https://polyformproject.org/licenses/perimeter/1.0.1).
Code copied from Check stays under the same terms. Verify the licence of code
from Studio, Rubato or other repositories before copying it.
