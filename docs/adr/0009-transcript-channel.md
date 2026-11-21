# Keep supplied media prose in a transcript channel

Authored audio/video transcripts and readable HTML caption tracks are useful course evidence, including descriptions of demonstrations with no speech. Trace measures this prose in a separate transcript channel, anchored to its media block, so it cannot inflate on-screen words, narration estimates or course timing. Inspect JSON supplies authored transcripts but no caption-track contents; HTML supplies local readable VTT cues. Neither establishes playback duration.

Terms, learner-task and visual-opportunity quotes validate against the cited channel. Alignment retains transcript instruction links and their source text. Concept occurrences keep one ref and role per block across all text channels: the view tracks encounters with an idea, so adding a channel field would split the same encounter without answering its question. All bundle prompt versions change with the shared guidance; the schema 1 interpretation fingerprint advances from `trace-inspect/2` to `trace-inspect/3`.

## Implementation constraints

Source: [implementation before comment removal](https://github.com/Praxity/praxity-trace/tree/43b707be616875eec49542460baecd77d95d0db8). The rules below govern the named files and symbols.

### `src/html.ts`: `readCaptionTracks`

Read cue prose only. Cue timestamps describe captions, never full media playback length. Cues and their line wraps can divide one sentence; only authored punctuation ends it.

### `src/html.ts`: `captionFingerprint`

Caption evidence includes its owning block position; absent prose preserves the HTML byte hash.

### `src/html.ts`: `supplyCaptionTracks`

Studio markup nests media under its authored block; retain that block as the source pointer.
