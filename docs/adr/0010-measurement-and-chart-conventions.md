# Measurement and chart conventions

## Status

Accepted. Records existing behaviour.

## Context

Trace uses bounded measurements and rendering rules to describe courses. These rules retain the rationale formerly recorded beside their implementations.

## Decision

Source: [implementation before comment removal](https://github.com/Praxity/praxity-trace/tree/43b707be616875eec49542460baecd77d95d0db8). Each entry names the file and symbol governed by the rule. These notes preserve project rationale; they do not establish new platform guarantees.

### Course structure and timing

- `src/anatomy.ts` (`ROLES`, `roleOf`) groups blocks by what learners do. Visible card grids count as text; flip cards and carousels count as explore blocks. A sequence counts as explore only when horizontal and scrollable. Schema 1 lacks those settings, so its sequences count as text.
- `src/anatomy.ts` (`READING_WPM`, `FALLBACK_SPEAKING_WPM`, `PagePace`, `pageClock`) uses 238 words per minute for adult silent non-fiction reading, following Brysbaert (2019), and 150 for script estimates when measured audio is unavailable. Schema 0 can combine measured audio and estimates; schema 1 uses estimates. A page takes the longer of reading and narration time, so simultaneous channels are not added together. Clock keys are `lesson.page` and values are minutes from course start.
- `src/anatomy-view.ts` (`duration`, `compositionTable`, `blockGrid`, `rhythmNote`) rounds durations of ten minutes or more to whole minutes, shares each composition column's scale across lessons, and keeps grid cells square as courses grow. Rhythm notes identify activities inferred from prose by an alignment reviewer, since those counts include interpretation.
- `src/availability.ts` (`AVAILABLE`, `availabilityView`) follows the parent chain to find instruction hidden inside an explore block. Nested schema 1 blocks do not themselves identify that interaction. A pre-assessment is a deliberate ordering, not missing prior teaching. Choose the most available instruction first and the nearest instruction among ties.
- `src/places.ts` (`Located`, `isCreditPage`, `contentBlocks`) uses source-revision-bound positional refs, not transient IDs. Lessons and blocks are one-based; pages read `lesson.page` and column children extend block refs with `.n`. Source and credit pages are references rather than teaching, so text measures omit them. Columns are layout and their children replace them in content traversal.

### Concepts, objectives and evidence

- `src/concepts-view.ts` (`conceptsView`) demotes a model-labelled knowledge check only when the input establishes that it has no right answer. Unknown correctness retains the reviewer's interpretation. `lanes` draws mentions first so stronger roles remain visible. `prerequisiteColumns` reduces links against the remaining graph, so alternate routes through cycles cannot all disappear; routed links cross labels only in row gaps.
- `src/trace.ts` (`traceView`) places each child objective group directly below its parent group. The parent is the group containing a member's parent outside the child group. This makes indentation mean that the child builds toward the row above.
- `src/flow.ts` (`FlowView`, `renderFlow`) counts one unit per objective-group/item pair across every stage of the flow, including a no-evidence destination for groups with no items. Nodes distribute bands in the order of their far end to reduce crossings.
- `src/outcomes.ts` (`BLOOM`, `KNOWLEDGE`, `GAGNE`, `BLOOM_LEVELS_BY_VERB`) keeps verb classification provisional. Published lists disagree, and a verb's object determines its demand. The model's reading of the whole objective supplies the interpretation. Knowledge dimensions follow Krathwohl (2002); Gagné capabilities are categories, not a hierarchy. Verb placements retain all levels supplied by Stanny (2016) and Community Nutrition, credited in `NOTICE.md`.
- `src/distinctions.ts` (`Distinction`, `PROMPT_VERSION`) records whether the course states a difference, contrasts examples and asks learners to discriminate between confusable ideas. The rationale is interleaved discriminating examples, as discussed by Kornell and Bjork (2008).
- `src/spacing.ts` (`ENCOUNTER`, `spacingView`) shows encounter gaps in course minutes without prescribing a target. Cepeda et al. (2008) ties useful spacing to the retention interval, which Trace does not know.
- `src/emphasis.ts` (`emphasisView`) omits headings from authored emphasis counts because their theme styling would overwhelm the measure.

### Prose and sentence measures

- `src/text.ts` (`blockTexts` and its projection helpers) owns text extraction for every view. Views consume its screen, tooltip, narration and transcript channels instead of independently walking block data.
- `src/language.ts` (`Cohesion`, `CAUSAL`, `summarize`) counts shared content words between adjacent sentences within a page, plus explicit causal and contrastive connectives. A page boundary ends adjacency. Following the referential/deep-cohesion distinction of Graesser, McNamara and Kulikowich (2011), counts remain separate from derived shares and rates. Exclude ambiguous temporal connectives such as "since" and "while".
- `src/language.ts` (`SKIPPED_TYPES`, `MIN_GRADE_WORDS`, `languageView`) excludes headings, checks, controls and data displays from on-screen prose and treats source/credit pages as citations. Attached narration remains spoken prose. Readability grades require at least 100 words. Construction review lists deduplicate a sentence repeated across channels on the same page.
- `src/language.ts` (`sentences`) treats paragraphs and structural items as boundaries even without terminal punctuation. HTML source wrapping is whitespace; structural elements carry boundaries while inline tags may sit within words. A closing bracket, colon or semicolon before a capital, and a spaced hyphen before a capital or code, can delimit list items. Abbreviation masking prevents initials from creating false sentence boundaries.
- `src/language.ts` (`lengthReference`, `strip`) uses the course mean plus two standard deviations as a reference, not a grading threshold. Transcript squares sit above the median line because its 6 px halo would obscure a 3.9 px square drawn at the median length.

### Vocabulary and lexicon

- `scripts/build-lexicon.ts` (`merged` and `kept`) retains single words at Zipf 2 or above, rounded to one decimal. A base form takes the higher of its own frequency and its lemma frequency, which includes inflections. `NOTICE.md` records the TUBELEX inputs and regeneration command.
- `src/language.ts` (`Vocabulary`, `tokens`) represents familiarity as log10 uses per billion words from TUBELEX. Tokens use lowercase NFKC text, splitting hyphens and separating clitics. Acronyms have their own table and numbers are not vocabulary.
- `src/language.ts` (`codeWords`, `acronyms`, `vocabularyOf`) excludes code identifiers and sample input from vocabulary. Capitals also written in lowercase are not acronyms. A form always capitalised and occurring mid-sentence is treated as a name, not vocabulary to teach. A rare plural and its rare singular share one entry.
- `src/language.ts` (`ADVERB_EXCEPTIONS`, `zipfOf`) preserves spelling collisions and changes in meaning. Accidently, cally, dally, lively, publically and summarily do not receive ordinary adverb reduction. Accept only the listed adjective endings, look up the adjective directly, and never chain reductions or remove prefixes. For `-ically`, try `-ic` only when `-ical` is absent, not merely less frequent.
- `src/language.ts` (`baseForms`) considers only inflection bases found in the lexicon and uses the highest family frequency. Comparatives are excluded because `-er` also forms unrelated nouns, such as planter from plant.

## Consequences

Measurements retain their stated limits. When a counting or chart rule changes, update its owning decision and interface tests along with the implementation.
