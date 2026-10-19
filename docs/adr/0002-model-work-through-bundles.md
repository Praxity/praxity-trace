# Model work goes through bundles, never network calls

Trace never calls a model API. `prepare` writes a bundle, the host agent (in Rubato or any coding agent) answers it, and `report` validates the answer against the course hash before drawing it. Bundles cite blocks by position (`lesson.page.block`), not block ID, because a course Studio has never saved gets new IDs on every inspect run; the course hash pins positions to one source revision. This keeps Trace account-free and key-free, reuses whichever model the designer already runs, and records which model and prompt produced each annotation. Praxity Check uses the same pattern. Contextual surprisal needs token log-probabilities that a chat agent cannot supply; if it is ever built, it runs a local model and is recorded separately.

For typed inspection schema 1, freshness uses the producer `revision` and a Trace interpretation version rather than lesson hashes alone. This invalidates answers after manifest or sidecar edits while remaining stable across transient IDs. Bundles state schema 1's evidence limits and preserve narration provenance. See [ADR 0008](0008-typed-inspection-schema-1.md).

## Item-cue probes

Prompt version `item-cues/10`, with the projection suffix, prepares two runnable diagnostics and one held masked folder. The 2026-10-19 assessment-writing evaluation masked options only. The dormant text transform adds the masked stem: the probe represents a test-wise learner who sees the question but does not know the subject. That evaluation's 49% versus 20% result does not validate this expanded probe.

Current inspect schema 1, projection 2 has no locale provenance. Its `course.locale` may be a producer default; neither that value nor a keep-word percentage can confirm English. Masked preparation, parsing and reporting therefore always return `{applies: false, reason: "language-unconfirmed", detail}`. Supplied non-English lesson `lang` remains an additional veto in the detail. There is no override flag. The pooled 20% text screen is removed as an authorizer.

This is the activation boundary: Studio must first report locale provenance (Studio backlog, 2026-10-19), and a follow-up Trace PR must verify that producer contract before enabling masked scoring. Consuming provenance, a separate English-discriminating deny-only evidence list and per-bank partial accounting are outside this change. A text screen cannot authorize scoring. Until activation, the masked gate is unavailable: stop and ask; never compute tails manually or use a hand-masked fallback. Rubato's own gate wording is maintained separately.

Every unavailable course and bank omits masked counts, chance expectation, `p`, `pLow` and small-bank flags. No masked solver rows are written. The held answer echoes its bundle ID, probe tag and refusal. Parsing recomputes eligibility from the course, rejects forged `applies: true` answers and discards injected scores. Reporting also recomputes eligibility rather than trusting the answer. HTML states the real hold reason. Plain `choicesOnly` remains the "does the stem matter?" diagnostic, with its existing exact tails. `coverTheOptions` still requires a separate semantic judge. This does not change ADR 0004's rule against composite grades.

The dormant masking transform uses one deterministic injective dictionary across each item's stem and options, normalizing text to NFC. It preserves common article sounds and regular singular/plural bases. Silent-h hour, honest, honour/honor and heir families take a vowel onset. A closed you-sound word list includes unicorn, university, utility, useful and European; it does not classify all uni-/ur- words alike. Explicit spoken acronyms SMART, SCORM, HIPAA and LAN remain distinct from spelled MRI, HIV and X-ray. Spelled initials A E F H I L M N O R S X take an. Generated forms retain the selected sound class. This is a bounded common-exception table, not a pronunciation engine, and never learns from keys or authored articles.

Raw capitalization preserves KPIs/APIs plurals; an explicit menu base preserves menus when the singular is absent. Singular virus, radius, analysis and glass stay whole. Other irregular inflections remain separate. Function words, including I, cue words and punctuation remain. Digits use one consistent per-item scrambling map. Replacements never reuse another word's output, equal a kept word or equal any source word. Exhausted replacement spaces or residual combining marks fail the transform closed. These pure text rules remain tested while masked preparation and scoring are held.

Preparation writes solver inputs under `<bundle>/` and operator evidence in the
sibling `<bundle>-review/` folder. Only its `operator.json` records `seed` and
`optionOrder`, zero-based source indices for the plain option diagnostic. Neither the
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
plain option order, while each preparation receives a new random ID. Repetition does not establish statistical independence between runs.
