# Coding learner tasks

Trace's **task type** describes the work a page asks the learner to do. It is an interpretation of an instruction, not a property of a block and not evidence that the learner did the work. Trace's existing **activity** still means a response without a right answer; a knowledge check still has a right answer. The Anatomy block inventory remains a separate measurement.

This guide adapts the learner-task categories discussed by [Conole and Fill (2005)](https://oro.open.ac.uk/11725/1/conole-2005-08.pdf) and the [Open University's learning-activities guide](https://www.open.edu/openlearncreate/mod/oucontent/view.php?id=177551&section=1.2). The OU guide lists assessment as a seventh category. Trace records **assessment purpose separately**, so an assessed written artifact remains productive. The exact 2007 chapter and 2008 taxonomy references cited in later summaries have not been verified from full bibliographic sources; this guide does not assign its six-family wording to a specific 2007 or 2008 version.

| Task type | Use when the learner is asked to… | Do not infer from… |
| --- | --- | --- |
| Assimilative | Attend to information: read, watch or listen. | Opening a control alone; the learner may be asked to do more with its content. |
| Information handling | Find, select, compare, organise or interpret information. | A multiple-choice control alone; identify the information operation in the prompt. |
| Communicative | Exchange ideas with another person. | A share button or a discussion space with no request to communicate. |
| Productive | Make an artifact: a written explanation, plan, worksheet or other output. | A response control alone; a brief keyed choice may serve another task. |
| Experiential | Practise a decision or action in a situated case or procedure. | A scenario decoration with no decision or action requested. |
| Adaptive | Change a model or simulation and inspect its response to test a prediction. | Clicking, revealing prose or stepping through cards. |

Record `assessmentPurpose` as `none`, `diagnostic` (checks prior knowledge), `practice` (feedback or rehearsal), `summative` (used to establish success), or `unknown`. This field never changes a task type. Record `work` as `inside` or `outside` the course; outside work is a request, not observed participation. Assign several task types when the same requested work genuinely combines them. Split an instruction into separate annotations when its parts happen in different places. Use `unknown` alone when the visible request does not support one of the six families. A page with no supported assignment is unclassified; a page with an unsupported inspected block is also shown as unsupported, and the two statuses can overlap.

## Matched synthetic examples

These refs are positions in the committed [schema 1 fixtures](../test/fixtures/tasks/) and identify the exact lesson line through each fixture's `inspect.json`. The expected readings are provisional. A designer may choose a legitimate alternative where the quoted request supports it.

| Pair or case | Source and expected descriptive reading | Legitimate alternative or limit |
| --- | --- | --- |
| Accordion prose | Awareness `lesson.prax:8` (`1.1.2`) asks learners to open headings and read; assimilative. The accordion at line 10 contains prose at lines 13 and 17. | If a later instruction asked learners to compare the two levels, add information handling at that instruction. The click alone is not adaptive. |
| Hypothesis-testing simulation | Judgment `lesson.prax:30` (`1.3.2`) asks for a prediction, setting change and comparison; adaptive plus information handling. A button at line 32 links the local slider model. | The button alone is not an adaptive task. Browser operation and packaging of the linked asset remain to be tested. The rule is synthetic. |
| Watching | Awareness `lesson.prax:25` (`1.2.2`) requests watching; assimilative. The video source is at line 27. | The remote placeholder's playback and contents are unverified. |
| Producing | Judgment `lesson.prax:39` (`1.4.2`) asks for a written explanation; productive. | The same block also requests a separate outside discussion, coded communicative with a second annotation. |
| External worksheet | Procedural `lesson.prax:51` (`1.5.2`) asks for a completed worksheet outside the course; productive, outside. | Its completion cannot be inferred from the inspected course. |
| Optional support | Procedural `lesson.prax:29` (`1.3.2`) asks for a restart decision; experiential, practice. The only stated pressure rule is inside the optional accordion at line 21. | A learner may open the note or arrive knowing the rule; this fixture does not observe either. |
| Supported check beside it | Procedural `lesson.prax:39` (`1.4.2`) states the gauge rule on the check page, and line 41 (`1.4.3`) applies it; assimilative then experiential. | The check remains a check in Anatomy, regardless of its task type. |
| Deliberate pre-assessment | Awareness `lesson.prax:36–38` (`1.3.2–3`) explicitly asks for a prior-knowledge answer before teaching; diagnostic with task type unknown for the simple recall response. | A designer may code information handling if they consider selecting between options an information operation; the guide requires a stated operation beyond the control. |
| Premature check | Judgment `lesson.prax:8` (`1.1.2`) asks for a Bayesian update before any such method is taught; experiential, summative according to author context. | Prior training could make it appropriate; the fixture's author context says it was silently assumed. |
| Declared prerequisite | Procedural `lesson.prax:8` (`1.1.2`) directs learners to an earlier plant briefing; assimilative, outside. | The briefing's contents and completion are not visible to Trace. |
| Supported rule beside the assumed prerequisite | Judgment `lesson.prax:18–20` (`1.2.2–3`) states a rule before asking for a decision; assimilative then experiential. | This supports only the gauge-disagreement decision, not the earlier Bayesian question. |
| Viewing versus assessment success | Awareness `lesson.prax:48` (`1.4.2`) is a reference summary in a viewing-completion course. Judgment `lesson.prax:8` (`1.1.2`) is an assessment-success case in the author's plan. | Completion and scoring policy are author context for these fixtures; the task view does not infer actual LMS success. |
| Unsupported input | Awareness `lesson.prax:57` (`1.5.3`) is a variable block whose schema 1 text coverage is unsupported; page `1.5` stays unclassified and unsupported. | This block may contain no learner prose. Unsupported coverage is a limit of inspection, not proof of a missing task. The supported reference summary at line 48 is the nearby counterexample. |

No task type has a preferred share. A pattern needs the course's audience, objective and completion policy before a designer judges it. See the separate `context.md` beside each fixture; that context cannot supply missing learner-facing instruction.
