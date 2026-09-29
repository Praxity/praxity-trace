# Personal comments on a report

Trace keeps a designer's comments in browser storage under the course hash. They leave the page only when the designer copies them for an assistant or downloads `comments.json`. Import merges comments by id for the same course revision.

A comment records the view, course ids, source file and line when available, and a text quote with nearby words. These anchors help find it again when the report is regenerated. An unresolved comment stays in the list. Comments change the report, never the course. When the designer asks for a course change, an agent uses the saved source pointers to find the lesson content.
