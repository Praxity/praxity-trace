# Model work goes through bundles, never network calls

Trace never calls a model API. `prepare` writes a bundle, the host agent (in Rubato or any coding agent) answers it, and `report` validates the answer against the course hash before drawing it. Bundles cite blocks by position (`lesson.page.block`), not block ID, because a course Studio has never saved gets new IDs on every inspect run; the course hash pins positions to one source revision. This keeps Trace account-free and key-free, reuses whichever model the designer already runs, and records which model and prompt produced each annotation. Praxity Check uses the same pattern. Contextual surprisal needs token log-probabilities that a chat agent cannot supply; if it is ever built, it runs a local model and is recorded separately.

For typed inspection schema 1, freshness uses the producer `revision` and a Trace interpretation version rather than lesson hashes alone. This invalidates answers after manifest or sidecar edits while remaining stable across transient IDs. Bundles state schema 1's evidence limits and preserve narration provenance. See [ADR 0008](0008-typed-inspection-schema-1.md).

## Item-cue probes

Prompt version `item-cues/11`, with the projection suffix, prepares three isolated probes. Masked stem and options represent a test-wise learner who sees the question but does not know the subject. Plain choices-only asks whether the stem matters; cover-the-options needs a separate semantic judge. The 2026-10-19 evaluation masked options only. Its 49% versus 20% result does not validate the expanded stem-and-options probe.

Studio owns language provenance and inheritance. Under schema 1, projection 2, every included lesson must have `language: {value, source}`, with source `lesson` or `course` and an English primary language subtag, case-insensitively. Trace accepts regional tags and trims surrounding whitespace. Studio emits `course` only for an authored manifest declaration; `default` never qualifies. Inspect reports `course.language.workspaceContext: "unavailable"` because it does not read workspace settings. A lesson override takes precedence; lessons with no included keyed choices do not affect this population. Trace reads evidence from each owning lesson, never an operator's copied association. The producer revision already covers manifest-only and lesson-language-only edits. Both answer and operator course hashes bind that revision, and stale evidence rejects.

Missing or malformed lesson provenance retains `{applies: false, reason: "language-unconfirmed", detail}`. A default source or non-English value produces `reason: "language"` with affected refs. There is no override flag. Verified declarations establish declared language, not the language of every sentence. Inspect JSON remains the trusted producer boundary; Trace cannot authenticate hand-edited JSON against source bytes it does not receive.

A deny-only text screen checks each item's combined stem and options for known foreign grammatical markers. Its explicit English-discriminating evidence list is separate from `MASK_KEEP`; a/an/in/no/on/or/as/do/so/was/will/also/is/has/had/he/but/for/here and pronoun I are not evidence, even though masking retains them. Tokens are NFC Unicode letter words with internal straight or curly apostrophes, case-folded with curly apostrophes normalized. Digits and punctuation do not enter the word denominator. The screen reports evidence counts with conflicts, never uses a percentage to authorize scores and never vetoes solely for missing English markers. Short noun phrases and content-only options remain included. The finite conflict list catches the tested French, German, Portuguese and Spanish examples, including English stems with French options. It cannot prove English or guarantee detection of every erroneous authored declaration. Broader language identification needs separate evaluation.

Each bank is complete or unavailable. One unresolved, foreign or unmaskable included item withholds that entire bank and the pooled course; unaffected banks retain their own eligibility and scores. Included items stay in `count`; no scored denominator silently shrinks. `excluded` separately lists choices outside the supported probes. The manifest's `masked` describes the pooled course, and `maskedBanks` records eligibility per bank. Only complete eligible banks receive masked solver rows, even if pooled scoring is unavailable. With any runnable banks, the combined masked answer is `{bundleId, probe: "masked", applies: true, model, answers}` for exactly those rows. Otherwise it echoes the unavailable status. An answer's `applies` does not authorize a bank or pooled score.

Preparation, parsing and reporting recompute eligibility. Unavailable masked objects omit counts, chance expectation, `p`, `pLow`, attainable minima and small-bank flags. Injected scores are discarded; forged answers for blocked items reject. Eligible unsolved results are `{applies: true, status: "not run"}`. Scored results have `applies: true, status: "scored"` plus ordinary probe fields. When the masked gate is unavailable, stop and ask; never compute masked tails by hand or use a hand-masked fallback. Rubato owns its thresholds and pin update separately.

Both scored choice probes report exact Poisson-binomial upper `p` and lower `pLow`, inclusive of the observed count. `pMin` is the smallest attainable upper tail, all answers right. `pLowMin` is the smallest attainable lower tail, all answers wrong. Every scored bank and the pooled course expose these fields so consumers can compare their own thresholds. Existing `tooFewItems` and `tooFewItemsLow` retain their 0.05 reference, which is insufficient for a consumer using 0.025 or multiplicity corrections. No composite grade is added, consistent with ADR 0004.

Masking uses one deterministic injective dictionary across each item's NFC-normalized stem and options, preserving common article sounds and regular singular/plural bases. Silent-h hour, honest, honour/honor and heir families take a vowel onset. A closed you-sound list covers unicorn, university, utility, useful, used, usable, unified, usage, usability, utilize, utilization, Eurozone and euros, without broad uni-/ur- rules. Explicit spoken SMART, SCORM, HIPAA and LAN remain distinct from spelled MRI, HIV and X-ray. Generated all-caps forms start with `aeio` for vowel sounds or `bcdgjkpqtvwyz` for consonant sounds, so spelling and word reading agree. This bounded pronunciation approximation never learns from keys or authored articles.

Raw capitalization preserves KPIs/APIs plurals; the menu base preserves menus without a singular. Virus, radius, analysis and glass stay whole. Function words, pronoun I, cue words and punctuation remain. Digits use a consistent per-item derangement. Outputs never collide with another output, a kept word or a source word. Exhausted forms or residual combining marks produce `reason: "mask-space"` for the owning bank and pooled course.

Preparation writes solver inputs under `<bundle>/` and operator evidence in the
sibling `<bundle>-review/` folder. Only its `operator.json` records `seed` and
`optionOrder`, zero-based source indices for both choice probes. Neither the
bundle manifest nor root prompt contains these. The operator combines answers
in `<bundle>-review/answer.json`; report reads the adjacent `operator.json`.
The CLI returns the operator prompt, combined-answer and operator-file paths.
Keep keyed inspection JSON in a private input folder outside the bundle's
parent tree. Give each solver only a copy of its own probe folder in a separate
workspace, or supply its files inline. Solvers receive neither the operator
workspace nor the review folder, source course, keys, feedback or another probe.
The solver-readable root prompt contains no pointer to operator evidence.

The manifest and each runnable probe's items carry an independent random 128-bit
`bundleId`; the operator file associates it with the seed. Identity has no
derivation from a guessable replay seed. Every solver answer must
echo that ID and its exact `probe` tag. Report rejects another bundle's answer
and swapped masked/plain probe objects before scoring. Course hash and prompt
version validation also apply to the operator file, and recorded permutations
must match its seed. A random default seed varies each run; `--seed` replays
option order and eligible masking, while each preparation receives a new random ID. Repetition does not establish statistical independence between runs.
