# Personal comments on a report

Trace keeps a designer's comments in browser storage under the course hash. They leave the page only when the designer copies them for an assistant or downloads `comments.json`. Import merges comments by id for the same course revision.

A comment records the view, course ids, source file and line when available, and a text quote with nearby words. These anchors help find it again when the report is regenerated. An unresolved comment stays in the list. Comments change the report, never the course. When the designer asks for a course change, an agent uses the saved source pointers to find the lesson content.

## Implementation constraints

Source: [implementation before comment removal](https://github.com/Praxity/praxity-trace/tree/43b707be616875eec49542460baecd77d95d0db8). The rules below govern the named files and symbols.

### `src/comments.ts`: `isSentenceId`

A sentence id as the Language views print it: lesson.page, then s for on screen, n for narration or t for transcript and the sentence's order, "3.9.s2". "L3.p9.s2" is the earlier form, still read so comments saved before the change keep their sentence. Self-contained: the browser inlines it.

### `src/comments.ts`: `commentsFile`

A comments file checked field by field, for imports and for comments the browser stored. Self-contained apart from isSentenceId, because the browser inlines both.

### `src/comments.ts`: `quoteContext`

Context uses the same 32-character limit as a TextQuoteSelector.

### `src/comments.ts`: `COMMENTS_MARKUP`

Insert `COMMENTS_MARKUP` near the top of `.report-content`, inside `.viz-root`, so the panel inherits theme variables.

### `src/comments.ts`: `commentsClient`

Run `commentsClient` after the report script has copied title text to `data-tip`. Separate adjacent element text so an objective ID and its statement do not run together. Build icon buttons from the report template because icons are drawn at report generation time. Place the selection button above its mark because page previews open below.

### `src/comments.ts`: `rowText`

Separate the text of adjacent elements, which textContent runs together.
