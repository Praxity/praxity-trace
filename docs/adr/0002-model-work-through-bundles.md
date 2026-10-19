# Model work goes through bundles, never network calls

Trace never calls a model API. `prepare` writes a bundle, the host agent (in Rubato or any coding agent) answers it, and `report` validates the answer against the course hash before drawing it. Bundles cite blocks by position (`lesson.page.block`), not block ID, because a course Studio has never saved gets new IDs on every inspect run; the course hash pins positions to one source revision. This keeps Trace account-free and key-free, reuses whichever model the designer already runs, and records which model and prompt produced each annotation. Praxity Check uses the same pattern. Contextual surprisal needs token log-probabilities that a chat agent cannot supply; if it is ever built, it runs a local model and is recorded separately.

For typed inspection schema 1, freshness uses the producer `revision` and a Trace interpretation version rather than lesson hashes alone. This invalidates answers after manifest or sidecar edits while remaining stable across transient IDs. Bundles state schema 1's evidence limits and preserve narration provenance. See [ADR 0008](0008-typed-inspection-schema-1.md).

## Item-cue probes

Item-cues prompt version `item-cues/7`, with the projection suffix, prepares three
isolated solver folders. `masked` replaces content words with deterministic
same-length pseudo-words within each item, preserving English function and cue
words, numbers and punctuation. This is the guessing-cue gate. Plain
`choicesOnly` remains the "does the stem matter?" diagnostic because subject
knowledge can identify a generally true option without its stem.
`coverTheOptions` still needs separate semantic judgement. Report data adds
`masked`, including exact `p` and `pLow`, at course and bank level; existing
field names stay unchanged. This changes which evidence the report emphasizes,
not ADR 0004's rule against course grades or composite pass/fail scores.

Preparation records a random default `seed` or the supplied `--seed` integer,
and `optionOrder`, a ref-to-permutation map of zero-based source indices. Both
option probes share that order; neither keys nor correctness influence it.
Operators copy the full manifest into the combined answer. Report validates each
recorded permutation against the course and seed, then maps responses through
it. Solvers receive only their own items and prompt, never the manifest, source
course, another probe, keys or feedback. Different seeds vary order and masking;
they do not establish statistical independence between repeated solver runs.
