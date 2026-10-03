# Lantern Marsh keeper practice

Original synthetic course for a larger Trace report. All names, places, rules,
prose, narration scripts and media are invented for this fixture. No client or
real organisation material is included. The source and assets are authored for
this repository and covered by its licence. No Studio implementation or course
content was copied. Public `.prax` examples informed syntax only.

The course has 9 lessons and 37 pages, in `source/course.yaml` order. It uses the
default page runtime, with `moduleDeck: false`. Page counts include both authored
branch consequences, even though a learner follows one path per attempt.

| Lesson | Pages | Content exercised |
|---|---:|---|
| L1 Read the marsh route | 4 | Objective, route image and alt text, glossary, accordion, keyed unscored check, map worksheet, disabled script |
| L2 Read the shutter signals | 4 | Objective, glossary, flip cards, keyed check, partner activity |
| L3 Keep a useful ledger | 4 | Objective, glossary, tabs, scored keyed check, reflection, deliberately long sentence |
| L4 Compare the bell patterns | 4 | Objective, glossary, local audio and transcript, accordion, keyed check, rhythm activity |
| L5 Choose a reply path | 5 | Objective, glossary, keyed unscored branch choice, two destinations, shared handoff activity |
| L6 Watch a shutter move | 4 | Objective, glossary, local video, transcript and caption track, keyed check, drawing worksheet |
| L7 Check a loose shutter | 4 | Objective, glossary, accordion, keyed check, worksheet, deliberately long sentence |
| L8 Hand the route to another keeper | 4 | Objective, glossary, tabs, keyed check, handoff rehearsal and reflection |
| L9 Build your fieldbook | 4 | Objective, glossary, fieldbook worksheet and reflections, zero enabled narration |

## Narration and media

`source/narration.yaml` supplies a page script for every page in L1 through L8.
Studio also derives narration from eligible blocks. The disabled L1 reminder
is a resolved sidecar candidate and remains evidence, without contributing
spoken words. L9 has lesson narration disabled and explicit disabled anchors
for every candidate. Studio 0.3.0's inspect projection preserves candidates
without applying the lesson `enabled` switch to their `disabled` fields, so
those explicit anchors make L9's zero spoken count visible through schema 1.

The SVG is a small original route sketch. The WAV is one second of 8 kHz,
16-bit mono PCM, with two 660 Hz tones and a quiet gap. The WEBM is a two-second
160 by 90 px VP8 canvas animation recorded with a headless browser. Its amber
panel moves across a white disc and stops halfway. Both media transcripts
describe these demonstrations and state that they contain no speech. The VTT
describes the video motion. Audio/video transcripts belong to `media.transcript`;
they are separate from narration and on-screen prose.

L5's `route-reply` assessment uses real `then: jump @quiet-path` and
`then: jump @repeat-path` actions after result conditions. Destinations have
explicit page IDs and names. The quiet page declares `var: rejoin = true` and
jumps to `shared-handoff` under `when: rejoin is true`. The repeat path continues
to that same page. A bare `then:` line without a condition is prose in this
parser. Conditions name a declared variable or a block result; a bare `true`
would name an undeclared variable instead of supplying a boolean literal.
The heading and prose separate the variable declaration from the rule. Without
that separation, this parser treats `when` and `then` as variable parameters.
Syntax was checked against Studio's public format reference, its
`docs/prax-format/examples/patterns/dialogue-branching.prax`, and grammar tests
for logic, page-break parameters and media. The dialogue example uses show
actions; the format reference documents page jumps.

## Inspection provenance

`inspect.json` is unchanged stdout from Studio's external inspect command. It
was generated on 2026-10-03 with Studio CLI 0.3.0 at commit
`f956eb84c42436dd113c508191cded525d77add8`, using schema 1, projection version 2.
The capture has no producer warnings and no unlinked narration. Studio ran on
a fresh scratch copy, never on the tracked source. Its generated project
metadata and any source migration stay outside this fixture.

Run this PowerShell from the Trace repository root to regenerate. It creates a
unique scratch directory and writes native inspect stdout as UTF-8 without a
BOM. Set `$studio` to the same reviewed CLI build when reproducing this capture.

```powershell
$fixture = (Resolve-Path 'test/fixtures/lantern-marsh').Path
$studio = 'D:\GitHub\praxity-studio\dist\studio-cli\praxity.mjs'
$scratchRoot = 'D:\tmp\trace-fixture'
@'
const { cpSync, mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const [fixture, studio, scratchRoot] = process.argv.slice(2);
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(join(scratchRoot, "lantern-marsh-source-"));
cpSync(join(fixture, "source"), scratch, { recursive: true });
const result = spawnSync(process.execPath, [studio, "inspect", scratch, "--schema", "1"], {
  encoding: "utf8", maxBuffer: 20 * 1024 * 1024,
});
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
if (JSON.parse(result.stdout).ok !== true) throw new Error(result.stdout);
writeFileSync(join(fixture, "inspect.json"), result.stdout, "utf8");
console.log(scratch);
'@ | node - $fixture $studio $scratchRoot
```

The fixture tests pin source-derived expectations rather than copying Trace
outputs. Page 1.1 has 92 on-screen words. Its enabled scripts have 105 words,
made from the 16-word sidecar script and body paragraphs of 24, 50 and 15
words. The page estimate is 42 seconds at 150 words per minute. L5's choice
contains 18 on-screen words; feedback and answer metadata add none. Branch
heading pointers begin at source lines 43, 56 and 66. L9 retains disabled
candidate evidence and has zero enabled spoken words on all four pages.

```powershell
node --test test/larger-course.test.ts
node src/cli.ts report test/fixtures/lantern-marsh/inspect.json --out D:\tmp\trace-fixture\report
```
