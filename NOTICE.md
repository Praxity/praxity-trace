# Notices and acknowledgements

## Praxity Trace

Copyright © 2026 Ariel Harlap.

Canonical attribution: **Praxity Trace by Ariel Harlap**

Project: <https://github.com/Praxity/praxity-trace>

Praxity Trace is community source software that shows learning designers how a
course is built: its composition, sequence, concepts, objectives and language.
See `LICENSE` and `LICENSING.md` for permitted uses and commercial-licensing
requirements.

## Contributors

- Ariel Harlap — creator and current contributor

External code contributions are not accepted during development. Git metadata
alone is not used to infer copyright ownership or contributor credit.

## Licence text

The licence includes the unmodified
[PolyForm Perimeter License 1.0.1](https://polyformproject.org/licenses/perimeter/1.0.1),
copyright PolyForm Project Inc. The PolyForm Project separately permits reuse
of its licence texts. The Praxity Community Permission is specific to Praxity
Trace.

## Third-party data

`data/tubelex-en.tsv.gz` is derived from the English word and lemma frequency lists of TUBELEX
(<https://github.com/naist-nlp/tubelex>, `frequencies/tubelex-en.tsv.xz` and `tubelex-en-lemma-pos.tsv.xz`):
single words at Zipf 2 or above, with counts converted to Zipf values by
`scripts/build-lexicon.ts`. Cite Nohejl et al., "Beyond Film Subtitles: Is
YouTube the Best Approximation of Spoken Vocabulary?", COLING 2025 (<https://aclanthology.org/2025.coling-main.641/>). The authors
do not endorse Praxity Trace. TUBELEX is distributed under this licence:

```text
BSD 3-Clause License

Copyright (c) 2022-4, Adam Nohejl
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Bloom verb list

`data/bloom-verbs.json` adapts verb-to-level placements from two CC BY 4.0 sources. Trace also keeps a short list of its own in `src/outcomes.ts`.

This file adapts verb placements from the following sources. Preserve these credits, source links, licence links, and change notices when distributing the JSON. CC BY 4.0 permits reuse and adaptation with attribution; attribution does not imply that the authors endorse Praxity Trace.

### `stanny2016`

Claudia J. Stanny, “Reevaluating Bloom’s Taxonomy: What Measurable Verbs Can and Cannot Say about Student Learning,” *Education Sciences* 6(4), 37 (2016), Table 1. © 2016 Claudia J. Stanny. [Source article](https://doi.org/10.3390/educsci6040037) ([full text](https://files.eric.ed.gov/fulltext/EJ1135621.pdf)). Licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

**Changes:** Extracted Table 1, lowercased and alphabetized base verbs, split `back/back up`, reduced `give examples` and `tell/tell why` to their head verbs, deduplicated placements, and relabeled `Knowledge` as revised Bloom `Remember`; no other category label needed conversion.

### `community_nutrition`

Krystal L. Hodge and Sarah Tauber, “Goal Setting and Program Planning,” Table 5.3, *Community Nutrition*. © Krystal L. Hodge and Sarah Tauber. [Source chapter](https://iopn.library.illinois.edu/pressbooks/communitynutrition/chapter/chapter-5-goal-setting-and-program-planning/). Licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/), except where otherwise noted by the book; no exception is marked for Table 5.3.

**Changes:** Extracted Table 5.3, lowercased and alphabetized base verbs, reduced `give examples` to `give`, deduplicated placements, and merged only identical verb-level placements with Stanny’s Table 1; category labels required no conversion.

The source licences provide no warranties. The `ambiguous` and `sources` fields were calculated from these two tables; they are added indexing metadata, not claims made by either source.

## Icons

`src/icons.ts` embeds outline icons from Tabler Icons (<https://tabler.io/icons>),
MIT License, Copyright (c) 2020-2026 Paweł Kuna. The MIT License requires the
copyright notice and permission notice in copies or substantial portions: a
bundle that ships `report.html` includes this notice.

## Runtime dependencies

Record each runtime dependency here with its version, licence and copyright
holder when it is added.

- `parse5` 8.0.1, MIT, copyright (c) 2013-2019 Ivan Nikulin: reads HTML input.
- `entities` 8.1.0 (a `parse5` dependency), BSD-2-Clause, copyright (c) Felix
  Böhm.

A distribution that bundles them must include their licence texts from
`node_modules`.

Development dependencies include TypeScript under Apache-2.0 and type packages
under MIT terms. The lockfile is the authoritative version inventory.
