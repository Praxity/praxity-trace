# Schema 1 fixture

`examples.schema1.inspect.json` was generated from the four CC0 `prax-format/examples` lessons and this synthetic manifest:

```yaml
title: Examples
locale: en
lessons:
  - minimal.prax
  - interactive-module.prax
  - quiz-course.prax
  - full-featured.prax
```

Producer: the local Studio `feat/studio-inspection-contract` build, reporting version `0.2.0`, on 2026-09-26. Command:

```sh
node /path/to/studio/dist/studio-cli/praxity.mjs inspect /path/to/examples-course --schema 1
```

Only JSON whitespace was changed for readability. The fixture has 4 lessons, 97 blocks and 77 narration entries. It is not a claim that schema 1 has shipped in an installed Studio release. Transient IDs in this capture must not influence Trace refs or hashes.

To rerun the external process checks with that build and course directory:

```sh
TRACE_STUDIO_CLI=/path/to/studio/dist/studio-cli/praxity.mjs \
TRACE_EXAMPLE_COURSE=/path/to/examples-course \
node --test test/schema1-cli.test.ts
```

The live test copies the examples into `/tmp/codex-schema1/`, then checks independent runs, sidecar and manifest changes, and Unicode with LF/CRLF locations. Without those environment variables, the fixture CLI test still runs and the live producer test is skipped.
