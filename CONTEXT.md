# Praxity Trace

Trace shows a learning designer how a course is built, so they can decide what
to change. It describes a course; it does not grade it.

## Course

**Course**:
An ordered set of lessons. A Studio project is one course.

**Lesson**:
One `.prax` file in a course's order.
_Avoid_: module, chapter

**Page**:
One slide-shaped screen of a lesson.
_Avoid_: slide, screen

**Block**:
One authored element on a page, such as a paragraph, image, card group or knowledge check.
_Avoid_: component, widget

**Source pointer**:
The lesson file, line range and block ID a mark refers to.

**Objective**:
A statement of what learners should be able to do after the course, stated in the course or in `trace.yaml`.
_Avoid_: outcome, goal, ILO

**Concept**:
An idea the course introduces and expects learners to use, confirmed by the designer.
_Avoid_: topic, keyword

**Response opportunity**:
A point where the learner must answer, choose or act, such as a knowledge check or branch.
_Avoid_: interaction, engagement

**Knowledge check**:
A question with a right answer. With an Alignment answer, the checks it classes as `knowledge`; without one, assessment blocks with a correct option.
_Avoid_: quiz item, assessment (for this meaning)

**Activity**:
A response without a right answer: a reflection or discussion prompt, or a worksheet. Tables may split it into **Online activity** and **Worksheet activity**.

**Task type**:
An interpretation of what the course asks the learner to do, using the six families assimilative, information handling, communicative, productive, experiential and adaptive. A page can have several task types. The label does not change **activity** or **knowledge check**. See [the coding guide](docs/task-coding-guide.md).

**Assessment purpose**:
Why a task checks work: diagnostic, practice, summative, none or unknown. Recorded separately from task type; an assessed written artifact can still be productive.

**Unclassified / unsupported**:
Unclassified means no supported task type was assigned to a page. Unsupported means inspect marks at least one block's text coverage unsupported; that block may contain no learner prose. The two can overlap.

**Explore block**:
Content the learner opens or steps through, such as an accordion, tabs, flip cards, a card carousel, a scrollable horizontal sequence or a labelled graphic. Visible card grids and non-scrolling sequences are text. It is interactive but not an activity: the learner reveals, not responds.
_Avoid_: interaction, activity (for this meaning)
_Avoid_: learning activity, practice, response, engagement

**Instruction**:
Where the course teaches what a check or activity needs: on screen, in narration, or both.
_Avoid_: teaching support, where the teaching sits

## Evidence

**Measurement**:
A fact computed from the course itself, such as a count, position or duration.

**Interpretation**:
A semantic reading proposed by a model, such as "these two phrases name the same concept". Always fallible and designer-correctable.
_Avoid_: finding, insight, AI analysis

**Learner observation**:
What learners actually did, from tracked results. Out of scope for now.

## Output

**View**:
One chart or table answering one design question. Structure contains Anatomy and Pace. Course trace includes objective groups, with every member, statement location and parent objective in Table mode.
_Avoid_: dashboard, widget

**Mark**:
One visual element of a view that stands for course content and carries a source pointer.

**Report**:
The `report.html` and `report.json` produced for one course revision.

**Bundle**:
A folder Trace prepares for a model reviewer: extracted course text, a prompt and the expected answer schema.
_Avoid_: packet, request

**Annotation**:
One interpretation returned in a bundle's answer, tied to source pointers and the course hash.

**Chart mode / Table mode**:
The two representations every view offers (ADR 0006). The table is the accessible one.

## Symbols

One meaning per symbol across every view:

| Meaning | Symbol |
|---|---|
| Objective stated | open grey diamond |
| Instruction (taught) | open dark circle |
| Activity | open blue square |
| Knowledge check | filled blue square |
| Concept defined | filled dark circle |
| Concept example, mention or recap | small filled grey circle |
| Something to look at | orange (never used for an ordinary category) |

Pages read "3.9" (lesson 3, page 9), a convention the report head states once; sentence ids extend it as "3.9.s2" (n for narration). Lessons read "L3", and lesson headings "L3 · Title".
