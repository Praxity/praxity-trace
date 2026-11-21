# Consume typed inspection schema 1

Trace reads `praxity inspect <course-dir> --schema 1` as an external process contract. This needs a Studio build with schema 1 support; it does not assume the producer branch has shipped. Schema 0 and static HTML/SCORM directories remain supported. The authoritative producer contract is Studio's `docs/prax-format/cli.md`, "Typed inspection, schema 1".

Schema 1 is a bounded text projection. Trace validates consumed fields and reference relationships, tolerates extra fields, and rejects unknown schema versions. It retains original inclusive line ranges, parent links and snapshot refs. The existing course index maps these refs to readable positional refs. IDs are metadata and may be transient; neither IDs nor opaque refs are durable edit targets.

Text conversion follows each field's declared format. Tag stripping uses the HTML parser for both schemas, so entities and literal angle brackets come out as written, and every tag boundary still reads as a space, as it did before; this keeps the words reviewers quoted from `course.md` valid, at the cost of splitting a word emphasised mid-word. HTML is parsed as untrusted text with the installed HTML parser, Markdown uses Trace's text conversion, and plain text preserves literal characters. Supported descendants count at their own blocks; containers contribute only their own labels. Visible prose includes headings, body, prompts and options. Feedback is a separate post-response channel and does not add to visible prose counts. Repeated feedback within a block appears once in reviewer evidence. Glossary terms already occur in that prose; definitions remain a separate tooltip channel. Enabled resolved narration is a separate spoken channel, with its sidecar or derived origin retained. Disabled candidates and unlinked counts remain evidence about coverage, not extra spoken words. Page narration uses the first block as its reviewer anchor. On an otherwise empty page, an internal narration-only block supplies a positional ref; it invents no Studio ref or authored location.

Analysis freshness uses Studio's `revision` plus a Trace interpretation version. This includes manifest and sidecar changes even when lesson source hashes are unchanged, and ignores transient IDs. Changing Trace's schema 1 interpretation requires a version bump. Bundle prompt versions change with their content or meaning; model execution stays outside Trace. Unknown answer refs remain errors. The schema 1 reading guidance (partial coverage, feedback shown after a response, no inferred correctness) travels in that bundle's `course.md`, beside the limits it explains. [ADR 0009](0009-transcript-channel.md) later changed the shared guidance, so every bundle prompt version moved with it.

Reports and bundles identify partial text coverage and unsupported blocks. Earlier schema 1 output has no `projectionVersion` marker and retains its original limitations: no assessment correctness or scoring, media details or measured narration duration. Trace rejects unknown projection versions. A zero extracted word count on an unsupported block says nothing about its authored text. Partial word counts also limit reading estimates and text-based comparisons.

## Projection version 2

Studio now emits `projectionVersion: 2` under the same `praxity-inspect/1` schema. Trace maps correctness and scoring separately. `keyed` identifies a knowledge check even when `scored` is false; `open` and `unavailable` leave pedagogical correctness unknown. Assessment groups carry aggregation and membership context, never an extra response count. The expanded text projection counts each field at its owning block and keeps answer keys, feedback, glossary definitions, media alternatives, transcripts and narration out of on-screen prose totals. Typed Markdown conversion honours escaped literal punctuation.

Media inventory records source URI and availability separately. `present` means Studio read a referenced local file; `missing`, `remote` and `blocked` remain explicit. Caption-track contents and remote assets are not fetched from inspect input. Authored media transcripts supply their own transcript channel and establish neither speech nor playback time. Unlinked narration retains its authored script, saved anchor and actual `narration.yaml` line range as unresolved evidence; it has no current block or page ref and is not counted as heard speech.

Stored narration duration is a `sidecar-recorded` alignment endpoint with unknown measurement and `isFullFileDuration: false`. Trace shows it separately from estimated script time. It does not calibrate a speaking rate or claim full-file audio length from that number. Arbitrary audio/video playback duration remains unavailable. The source inspection also cannot apply workspace scoring settings.

The schema 1 interpretation fingerprint is `trace-inspect/3`. Sequences count as text because schema 1 supplies no orientation or scrollable settings; Trace cannot determine whether their steps overflow a scroll strip. This interpretation change invalidates earlier saved answers. Projection 2 bundle prompt versions carry a `-projection-2` suffix because their `course.md` evidence changed; all bundle prompt versions also change when shared course-text guidance changes. Studio's `revision` now includes referenced local asset status and bytes, so media-only replacement, lesson edits and sidecar edits all invalidate saved model answers. Unreferenced files and remote contents remain outside that fingerprint.

Sentence splitting keeps blank-line paragraph breaks and separate structural items as boundaries before text is flattened for display. Wrapped single line breaks and VTT cue boundaries stay within a sentence. This changes Language sentence counts and can renumber later sentence ids on a page. It does not change the fingerprint or any prompt version: model answers cite block refs, not sentence ids, and `course.md` is unchanged. Comments anchored to a renumbered sentence find it again by quote, as [ADR 0007](0007-report-comments.md) describes.

## Hidden screen content and item-cues probes

The shared screen projection now removes hidden descendants and post-response HTML elements before text conversion, including hidden attributes, inline display/visibility hiding and known feedback classes. Attributes never become screen prose. Explicit feedback fields remain in their separate channel. Item-cues selects its stems and options through that projection, never through raw labels or a second parser. The schema 1 interpretation fingerprint advances to `trace-inspect/4`, invalidating older answers. Item-cues uses prompt version `item-cues/2` because blind option order, structured cue codes and cover-answer judgements changed. Other prompts retain their versions; their schema 1 answers are invalidated by the fingerprint.

Item-cues consumes optional authored `assessment.shuffle` when supplied. Projection 2 output that omits it remains shuffle-unknown; missing metadata never establishes fixed order. The HTML adapter preserves `response.selectionMode` and `response.shuffle` in its existing course model.

## Markdown glossary projection

Typed Markdown now uses the shared glossary rule to retain a term and remove its tooltip definition from screen text. Escaped literal glossary syntax stays literal; separately projected glossary definitions stay in the tooltip channel. This applies to every caller of the shared text projection, including bundles and page previews. The schema 1 interpretation fingerprint advances to `trace-inspect/5` so cached answers based on the earlier leaked definitions are rejected.

Item-cues advances to `item-cues/3`. Its blind stem input contains only the supplied stem, while missing-media qualifications stay in the report and judge view. The separate judge can return `alsoCorrect` for a defensible different answer, labelled "Another valid answer" and counted as stem answerability. It does not establish multiple correct offered options. Tighten the stem so only the key fits, or make the options settle which answer is best. Existing CLI command shapes and field names remain unchanged.

## Fail-closed item-cues eligibility

Item-cues keeps the shared visible-text projection and then checks each projected stem and option for remaining square or curly brackets. Any remaining delimiter excludes the entire item with a reason naming the field and bracket and advising removal or a manual check. This deliberately excludes literal bracket text too: the blind probes must not receive definitions from an inline construct Trace did not consume. Reports retain each exclusion and its reason, with `excludedCount` giving the total. Excluded items contribute to neither probe nor its scoring denominator.

This is an eligibility guard, not another inline parser. Studio should eventually supply visible field text rendered by its own tokenizer; that producer change is outside this view. Shared projection and its `trace-inspect/5` fingerprint remain unchanged. Item-cues advances to `item-cues/4` for the guarded item set and revised judge guidance. The command shapes and answer field names remain unchanged.

## Inspect-only blind preparation

Blind item-cues bundles require `praxity inspect <course> --schema 1` JSON with projection 2. The CLI refuses directories and non-inspect stdin before preparation, and preparation validates the course schema and projection before creating output. HTML export visibility cannot yet be established reliably for blind solver inputs. Scripted `report` checks remain available for HTML exports and schema 0; they do not write solver inputs.

The bracket guard remains unchanged in scope, including literal brackets. Excluded rows retain question excerpts and source pointers; the course summary counts exclusions, and the all-excluded view asks the author to review the reasons. Prompt version `item-cues/5` records the narrower preparation contract and revised alternative-answer guidance. The shared text projection and its freshness fingerprint are unchanged.

## Blind HTML field allow-list

Projection 2 can contain HTML choice stems even when options are Markdown. Item-cues eligibility accepts the markup Studio emits in choice stems: attribute-free `p`, `strong`, `em`, `code`, `del` and `mark`; `a` with only `href`; tooltips with exactly `class="inline-tooltip-trigger"` and `data-tooltip-content`; and doodles with exactly `class="praxity-doodle"`, `data-doodle` and `data-doodle-mods`. Class tokens split on HTML ASCII whitespace only. Non-ASCII whitespace remains part of a different, unknown class. Empty icon and variable spans remain excluded. The existing projection removes the tooltip attribute and its definition from solver prose. No style or hiding attribute, unknown class, or other element is accepted. Parsing errors and markup discarded by the fragment parser also exclude the item. Validation uses the installed HTML parser and accounts for every source character, including tags a fragment parser silently discards.

Preparation, answer validation and scored denominators all use this check. The shared visibility projection remains unchanged, with no interpretation fingerprint bump. The exclusion reason names the rejected tag or attribute and asks authors to check the item by hand. The item-cues prompt advances to `item-cues/6` for the narrower accepted evidence. Studio-rendered visible text remains the long-term replacement.

## Implementation constraints

Source: [implementation before comment removal](https://github.com/Praxity/praxity-trace/tree/43b707be616875eec49542460baecd77d95d0db8). The rules below govern the named files and symbols.

### `src/inspect.ts`: `withPageNarration`

Views read narration from blocks. Studio can also narrate a whole page; that narration plays with the page, so Trace attributes it to the page's first block.

### `src/inspect.ts`: `parseTypedCourse`

A narration-only page still needs a positional ref for quotes and reviewer answers. This internal carrier has no Studio block identity; each script retains its page provenance.

### `src/item-cues.ts`: `probeHtml`

HTML class tokens split on ASCII whitespace, as defined by [HTML section 2.3.7, Space-separated tokens](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#space-separated-tokens). Unicode spaces remain part of an unknown class. The existing `test/item-cues.test.ts` test "HTML probe eligibility allows only inventoried paragraphs and tooltips across file, stdin and owning preparation" exercises ASCII whitespace alongside non-breaking space, zero-width space and BOM cases.

A parsed fragment alone does not establish that every source tag was accepted. [HTML section 13.2.6.4.7, The "in body" insertion mode](https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inbody), handles `html` start tags without inserting a new element and ignores a `body` start tag when the stack lacks a body element, as can occur in fragment parsing. `probeHtml` requires source-location coverage for every source character so discarded tags cannot bypass its allow-list. The existing `test/item-cues.test.ts` test "HTML allow-list refuses hiding, unfamiliar markup and malformed attributes even when visible text looks safe" includes `html`, `body`, `head` and doctype inputs.

### `src/item-cues.ts`: `keyedChoices`

Fail closed on leftover delimiters, including unfamiliar syntax, until the producer supplies rendered text.

### `src/item-cues.ts`: `ENGLISH_EVIDENCE`

Keep English language evidence separate from `MASK_KEEP`, because words preserved by masking can be cross-language homographs and do not confirm English.

### `src/item-cues.ts`: `maskedLanguage`

Declared language comes only from Studio. Text evidence can veto, never authorize it.

### `src/item-cues.ts`: `maskedPlan`

Entire banks are runnable or unavailable; a blocked item never reduces a scored denominator.

### `src/item-cues.ts`: `maskItem`

A digit substitution is a per-item derangement, preserving equality and digit counts.

### `src/text.ts`: `typedHtml`, `stripTags` and `decodeText`

Normalise text according to Studio's declared format. Plain angle brackets stay literal. Parse HTML instead of stripping it with a regex, but retain the earlier spacing at every tag boundary so quotes from saved `course.md` remain valid. Keep encoded angle brackets intact until `stripTags` has removed tags; otherwise a literal comparison such as "reading < -0.3" could be mistaken for markup.

### `src/text.ts`: `RAW_TOOLTIP`, `VOICE_CUE` and `spoken`

Tooltip definitions may contain one nested brace level, including a code example. Voice cues must stand alone: brackets attached to a word, as in `readings[gauge]`, are code. Remove a cue's horizontal space without consuming a paragraph boundary. A cue-only line must not create an extra blank paragraph when removed.

### `src/text.ts`: `typedHtml`

In HTML, source line breaks are whitespace even when the field has no element wrapper.

### `src/text.ts`: `clean`

Removes Studio source syntax a learner never sees as text; HTML tags stay for callers that need block boundaries. `&lt;` and `&gt;` stay encoded until the tags are stripped (stripTags), so text such as "reading &lt; -0.3" is not read as the start of a tag.

### `src/text.ts`: `spoken`

A cue-only line is not an authored blank line; removing it must not create a paragraph.

### `src/text.ts`: `blockTexts`

Code is left out of prose measures, but a reviewer needs it: a question can ask what the code does.
