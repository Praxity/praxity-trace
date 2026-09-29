# Read the learner-task view

1. Inspect the Studio course: `praxity inspect <course-dir> --schema 1 > course.json`.
2. Prepare the optional view: `praxity-trace prepare tasks course.json --out tasks-bundle`. Read `prompt.md`, `course.md` and the [coding guide](task-coding-guide.md). Write `tasks-bundle/answer.json` using exact quotes and positional refs from `course.md`; record the model name. The bundle manifest records the taxonomy, prompt version and course hash.
3. Build the report: `praxity-trace report course.json --tasks tasks-bundle/answer.json --out report`. Open `report/report.html` or read `report/report.json`.

The Learner tasks section sits after Alignment because it shows the requested work before the report turns to concepts and language. Each chart column is a page in course order. A filled cell means an answer assigned that task type on that page; one page counts once per type. A mixed page appears in several rows. Unclassified and unsupported are separate rows. The table lists every annotation, exact quote, source ref, explanation, work location and assessment purpose. The page labels open the same previews used elsewhere in Trace.

These are generated interpretations of requests. The outside-course label does not show participation. Compare a suspicious mark with the quoted instruction and the author's intent. The measured Anatomy inventory remains a separate view. If the course changes, prepare and answer again; a saved answer for the old course hash is rejected.

Try the three [synthetic fixtures](../test/fixtures/tasks/): each has an inspect JSON, a hand-coded `answer.json`, separate author context and a frozen baseline report JSON. Awareness's remote media URLs are inert placeholders; Judgment links a local slider model. The controller will check browser reflow and accessibility; the automated tests check markup and view data.
