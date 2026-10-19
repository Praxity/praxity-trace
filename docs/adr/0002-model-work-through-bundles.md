# Model work goes through bundles, never network calls

Trace never calls a model API. `prepare` writes a bundle, the host agent (in Rubato or any coding agent) answers it, and `report` validates the answer against the course hash before drawing it. Bundles cite blocks by position (`lesson.page.block`), not block ID, because a course Studio has never saved gets new IDs on every inspect run; the course hash pins positions to one source revision. This keeps Trace account-free and key-free, reuses whichever model the designer already runs, and records which model and prompt produced each annotation. Praxity Check uses the same pattern. Contextual surprisal needs token log-probabilities that a chat agent cannot supply; if it is ever built, it runs a local model and is recorded separately.

For typed inspection schema 1, freshness uses the producer `revision` and a Trace interpretation version rather than lesson hashes alone. This invalidates answers after manifest or sidecar edits while remaining stable across transient IDs. Bundles state schema 1's evidence limits and preserve narration provenance. See [ADR 0008](0008-typed-inspection-schema-1.md).

## Item-cue probes

Prompt version `item-cues/9`, with the projection suffix, prepares three isolated
solver folders. The 2026-10-19 assessment-writing evaluation masked options
only. This version adds the masked stem: the probe represents a test-wise
learner who sees the question but does not know the subject. That evaluation's
49% versus 20% result does not validate this expanded probe.

One deterministic, injective dictionary spans each item's stem and options.
Text is normalized to NFC first. Content words become same-length pseudo-words,
preserving common article-sound exceptions and a shared base plus trailing `s`
for regular singular/plural forms. Silent-h hour, honest, honour/honor and heir
families take a vowel onset; uni-, use, usu-, ur-, eu-, one and once take a
consonant onset. All-caps initialisms use the first letter name: A E F H I L M N
O R S X take an. Generated forms are checked against the same sound rule. This
small table covers common exceptions and spelled initialisms only, not general
pronunciation or acronyms spoken as words. Singular -us, -is and -ss words stay
whole. Other irregular inflections remain separate words. Function and cue
words and punctuation remain. Digits now use one consistent scrambled per-item
map, matching the evaluation and hand-run fallback's scrambling rule. Its exact
digit assignments need not match the evaluation script. Replacements cannot
reuse another word's output, equal a kept word or equal any source word. If no
unused form remains, or a content word retains a combining mark after NFC,
the entire masked probe is unavailable with
`{applies: false, reason: "mask-space", detail}`.

Inspect projection 2's `course.locale` may be a producer default, not authored
or resolved language. It cannot establish English by itself. Trace retains an
optional lesson `lang` when supplied and rejects any included item's explicitly
non-English lesson. It also requires nominal English course metadata and a
deterministic text screen over all included stems: at least 20% of word tokens
must occur in the English keep list, and each stem of four or more words must
have at least one such token. Options do not contribute to this screen.

The threshold was calibrated on five existing English projection-2 fixtures:
examples 13/30, procedural 13/20, judgment 10/22, awareness 3/6 and Lantern Marsh
29/53. Their shares span 43.3% to 65.0%, with no long stem lacking a keep word.
Synthetic French and Spanish fixtures have 0/34 and 0/31. The 20% floor leaves
margin below these English fixtures; it is a limited English/French/Spanish
screen, not language identification or confirmation of producer provenance.
Missing or non-English metadata, a conflicting lesson lang, low pooled share
or a long stem without a keep word yields
`{applies: false, reason: "language", detail}` with the measured share, counts
and threshold in detail, and no scores or probabilities. Small-bank flags also
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
Keep keyed inspection JSON in a private input folder outside the bundle's
parent tree. Give each solver only a copy of its own probe folder in a separate
workspace, or supply its files inline. Solvers receive neither the operator
workspace nor the review folder, source course, keys, feedback or another probe.
The solver-readable root prompt contains no pointer to operator evidence.

The manifest and each probe's items carry an independent random 128-bit
`bundleId`; the operator file associates it with the seed. Identity has no
derivation from a guessable replay seed. Every solver answer must
echo that ID and its exact `probe` tag. Report rejects another bundle's answer
and swapped masked/plain probe objects before scoring. Course hash and prompt
version validation also apply to the operator file, and recorded permutations
must match its seed. A random default seed varies each run; `--seed` replays
masked content and order, while each preparation receives a new random ID. Repetition does not establish statistical independence between runs.
