# Projection 2 fixtures

`examples.projection2.inspect.json` comes from the CC0 `prax-format/examples` lessons with the synthetic `course.yaml` described in `examples.schema1.md`. The smoke fixtures come from a synthetic course with assessments, media and an unresolved narration sidecar. No client material is included.

Studio producer: `feat/import-assessment-types`, CLI build `dist/studio-cli/praxity.mjs`, version `0.2.0`, 2026-09-26. Each JSON file was generated with:

```sh
node <studio>/dist/studio-cli/praxity.mjs inspect <copied-course-dir> --schema 1
```

The smoke variants change one input at a time from `smoke.projection2.inspect.json`: `media` appends a comment to the referenced SVG, `lesson` appends one synthetic sentence to `lesson.prax`, and `sidecar` changes the unresolved script in `narration.yaml`. The media and sidecar variants retain the same lesson SHA-256 as the base fixture. The fixtures stay in the test suite so freshness checks do not need a Studio installation.

The optional live check uses a copied course and the same external CLI:

```sh
TRACE_STUDIO_CLI=<studio>/dist/studio-cli/praxity.mjs TRACE_SMOKE_COURSE=/tmp/codex-proj2/smoke-course node --test test/schema1-projection2.test.ts
```
