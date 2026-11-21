# Node and TypeScript, not Python

Trace runs on Node 24 with type-stripped TypeScript. Python has better NLP (spaCy dependency parsing, textstat) and was the main alternative. Node won because Rubato and Studio's CLI already ship a Node 24 runtime, so bundling Trace adds almost nothing, while bundling Python and its models adds hundreds of megabytes. Most planned views are counting and timing, and semantic work goes to bundles. If a view later needs a dependency parser, add an optional Python sidecar that reads the same bundle.

## Implementation constraints

Source: [implementation before comment removal](https://github.com/Praxity/praxity-trace/tree/43b707be616875eec49542460baecd77d95d0db8). The rules below govern the named files and symbols.

### `scripts/package.mjs`: `collect`

Dependencies are resolved separately, rather than copying a package manager's links.

### `scripts/package.mjs`: `localContent`

Markdown in linked directories can introduce further local files or directories.

### `scripts/package.mjs`: `build`

Preserve the raw TypeScript: inlineClient serializes type-stripped function source. The tasks prompt cites the coding guide by package path; the skill no longer links it. mkdir reserves the leaf exclusively, including a racing directory or dangling symlink.

### `src/client.ts`: `inlineClient`

Script text that declares each helper from its source, then calls `fn` with `args` as JSON. Node strips types when it runs these files, so `toString()` yields plain JavaScript. A client function may reference only browser globals, its parameters, and the helpers passed with it.

### `src/input.ts`: `readInput`

Fatal decoding refuses malformed bytes rather than silently replacing text.

### `src/input.ts`: `parseJson`

Keep engine diagnostics, which may quote the entire input, out of errors.
