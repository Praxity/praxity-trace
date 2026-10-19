# Model work goes through bundles, never network calls

Trace never calls a model API. `prepare` writes a bundle, the host agent (in Rubato or any coding agent) answers it, and `report` validates the answer against the course hash before drawing it. Bundles cite blocks by position (`lesson.page.block`), not block ID, because a course Studio has never saved gets new IDs on every inspect run; the course hash pins positions to one source revision. This keeps Trace account-free and key-free, reuses whichever model the designer already runs, and records which model and prompt produced each annotation. Praxity Check uses the same pattern. Contextual surprisal needs token log-probabilities that a chat agent cannot supply; if it is ever built, it runs a local model and is recorded separately.

For typed inspection schema 1, freshness uses the producer `revision` and a Trace interpretation version rather than lesson hashes alone. This invalidates answers after manifest or sidecar edits while remaining stable across transient IDs. Bundles state schema 1's evidence limits and preserve narration provenance. See [ADR 0008](0008-typed-inspection-schema-1.md).

## Item-cue probes

Prompt version `item-cues/8`, with the projection suffix, prepares three isolated
solver folders. The 2026-10-19 assessment-writing evaluation masked options
only. This version adds the masked stem: the probe represents a test-wise
learner who sees the question but does not know the subject. That evaluation's
49% versus 20% result does not validate this expanded probe.

One deterministic, injective dictionary spans each item's stem and options.
Text is normalized to NFC first. Content words become same-length pseudo-words,
keeping vowel initials for a/an agreement and a shared base plus trailing `s`
for regular singular/plural forms. This is a lexical heuristic, not English
morphology analysis; irregular plurals remain separate words. Function and cue
words and punctuation remain. Digits now use one consistent scrambled per-item
map, matching the evaluation and hand-run fallback's scrambling rule. Its exact
digit assignments need not match the evaluation script. Replacements cannot
reuse another word's output, equal a kept word or equal any source word. If no
unused form remains, the entire masked probe is unavailable with
`{applies: false, reason: "mask-space", detail}`.

Inspect projection 2 supplies language in `course.locale`. Only confirmed `en`
or English subtags permit masking. Missing, blank or other locales yield
`{applies: false, reason: "language", detail}` with no score or probabilities.
Missing schema-1 locale is retained as an empty, unconfirmed locale. No language
or masking-space failure can pass the guessing-cue gate. Small-bank flags also
leave their tail unverified. This changes the evidence emphasized, not ADR
0004's rule against composite course grades or pass/fail scores.

A scored course or bank `masked` has `applies: true` and the existing probe
score fields, including exact `p` and `pLow`. Its item rows show authored text;
`items[].masked` retains the masked stem, response and key in expandable report
details. Plain `choicesOnly` remains the "does the stem matter?" diagnostic.
`coverTheOptions` still requires a separate semantic judge.

Preparation writes solver inputs under `<bundle>/` and operator evidence in the
sibling `<bundle>-review/` folder. Only its `operator.json` records `seed` and
`optionOrder`, zero-based source indices for both option probes. Neither the
bundle manifest nor root prompt contains these. The operator combines answers
in `<bundle>-review/answer.json`; report reads the adjacent `operator.json`.
The CLI returns the operator prompt, combined-answer and operator-file paths.
Solvers receive only their own folder's prompt and items, never the review
folder, source course, keys, feedback or another probe.

The manifest and each probe's items carry `bundleId`. Every solver answer must
echo that ID and its exact `probe` tag. Report rejects another bundle's answer
and swapped masked/plain probe objects before scoring. Course hash and prompt
version validation also apply to the operator file, and recorded permutations
must match its seed. A random default seed varies each run; `--seed` replays
it. Repetition does not establish statistical independence between runs.
