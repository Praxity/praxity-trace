# Read courses through Studio's inspect command

Trace reads `.prax` courses from the JSON printed by Studio's `praxity inspect <course-dir> --schema 1`, not by importing `@praxity/grammar`. The grammar package is unlicensed Studio source, and Rubato stages only reviewed Studio distributables, so a direct import would tie a community-source tool to private code. The `.prax` format itself is CC BY 4.0, so a standalone reader remains possible, but it would drift from the real parser. The HTML/SCORM reader produces the same course model as inspect JSON, as described in ADR 0005.

Trace accepts typed schema 1 and retains schema 0 compatibility. The schema identifier selects validation and text interpretation. Schema 1 uses explicit text roles and formats, retains the flat preorder and parent links, and maps opaque Studio refs to Trace positional refs in the existing course index. Text conversion stays in `text.ts`; no Studio implementation is imported. See [the schema 1 decision](0008-typed-inspection-schema-1.md) for counting and coverage limits.

## 2026-09-29

Praxity Trace is source-available under the unmodified
[PolyForm Perimeter License 1.0.1](https://polyformproject.org/licenses/perimeter/1.0.1).

Versions up to and including v0.1.1 were released under PolyForm Perimeter
1.0.1 with the Praxity Community Permission 1.0. Copies of those versions keep
those terms.
