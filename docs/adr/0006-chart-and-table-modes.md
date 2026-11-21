# Chart and table modes

Each view offers two representations of the same data, switched by a Chart / Table control: a table, which is the accessible and complete representation, and a chart, which is free to be more visual and less table-bound (an alluvial flow, a pixel grid, a matrix). The table meets WCAG 2.2 AA in full: keyboard reachable, screen-reader labelled, reflowing at 320 CSS px. The chart must meet contrast and must not trap focus, but its individual marks need not be focusable or reflow; it carries a text summary and points to the table. This keeps a keyboard or screen-reader user from tabbing through thousands of marks, and lets a chart earn its place by showing a pattern rather than by being accessible on its own. Agents read `report.json`, not either representation.

## Implementation constraints

Source: [implementation before comment removal](https://github.com/Praxity/praxity-trace/tree/43b707be616875eec49542460baecd77d95d0db8). The rules below govern the named files and symbols.

### `src/alignment-view.ts`: `matrix`

One line per group: the first objective in full, the rest as ids whose text shows on hover, so a large group does not stretch its row. The chart is aria-hidden, so the ids hover but take no focus; Table mode and the Course trace list every member in full.

### `src/alignment-view.ts`: `taxonomyByLesson`

A reviewer level that differs from the listed one gets its own band right of the lesson's other dots, wide enough for its direct label, so its connector and label cross no other mark. Lessons with no difference keep the plain column. The width per character is an estimate for 11 px system-ui. Each framework reads upward from its foundations, as Bloom does from Remember: Fink from foundational knowledge, Gagné from verbal information through cognitive strategies, then attitudes and motor skills.

### `src/alignment-view.ts`: `taxonomyByLesson`

Ordered taxonomies read upward from the lowest level; Fink's dimensions are not a hierarchy. The solid dot stays at the listed level, the verb-list measurement; the open grey circle at the reviewer's level is an interpretation, joined to it and labelled where it sits.

### `src/modes.ts`: `absence`

Absence claims share one coverage qualifier in HTML, SVG labels and plain tooltips. Charts have role="img", so keep their labels noninteractive; the table supplies the coverage link.

### `src/modes.ts`: `reflowTables`

Narrow screens stack each table row into "column: value" lines (MODES_STYLE). Chromium drops table semantics from elements shown as blocks, so each data table carries explicit table roles, and each body cell names its column in data-label for the visible label. A label is the header cells over the cell's logical column, outermost first; a cell spanning columns takes only the headers those columns share, so a note across a whole row has none. The attributes go in at their parsed offsets and every other byte stays as the renderer wrote it. A table hidden from assistive technology is a chart drawn with table markup and keeps its layout.

### `src/modes.ts`: `viewBlock`

Every table outside the chart is data a reader may need at 320 CSS px, the lead's included.

### `src/modes.ts`: `modesClient`

Sets every view's mode from the top bar and remembers it; builds the lesson filters. A filter hides table rows from other lessons and dims chart marks from other lessons, so a course-wide chart keeps its shape while the chosen lessons stand out. The lessons a row belongs to: a pair of pages can span two. Explicit attributes first, then a page pointer, then a leading "L3" or "3.9" in the row's first cell. One lesson or all: a chart drawn per lesson swaps in its expanded version; other charts dim marks from other lessons; tables hide their rows.

### `src/modes.ts`: `apply`

Tagged rows, list items and lesson headings hide when none of their lessons match. Untagged chart rows keep their context while individual marks dim. Marks dim; row labels, which also carry pages, stay readable.

### `src/report.ts`: `show`

The comment composer sits where the tooltip would; hovering marks behind it must not cover it. Tall chart columns: open beside the pointer, not below the whole plot. No room below: open above the trigger rather than clamping over it, which would block its click.

### `src/report.ts`: `setup`

ARIA prohibits a name on generic elements and role-less SVG shapes; those keep only data-tip, which the tooltip and comments read. Chromium makes SVG elements with focus listeners tabbable even without tabindex. Marks keep pointer previews; their Table representation supplies keyboard access to the same details. Focus moved by script after a click must not pop a tooltip.

### `src/report.ts`: `sizeTables`

A table stacked for a narrow screen keeps its full height in the page; the cue claims a scroll region only where the region really scrolls.

### `src/report.ts`: `reportClient`

Sortable tables: a sort button beside each column label cycles ascending, descending and the original (course) order. Tables whose rows form groups (rowspans, grouped members) keep their order. Decorative chart tables are hidden from assistive technology and must not gain controls.

### `src/report.ts`: `renderHtml`

Recommendations open the report but link to views drawn after them, so they render last.

### `src/scrollhint.ts`: `update`

An arrow disappears at the edge. Keep keyboard focus in its scroll region when it does.

### `src/theme.ts`: `THEME_HEAD_SCRIPT`

Apply the saved theme in `<head>` before first paint, so loading does not flash the wrong theme.
