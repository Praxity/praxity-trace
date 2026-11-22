# Node and TypeScript, not Python

Trace requires Node `>=24.22.1 <27` and runs source with type-stripped TypeScript. Python has better NLP (spaCy dependency parsing, textstat) and was the main alternative. Node won because Rubato and Studio's CLI already ship a Node 24 runtime, so bundling Trace adds almost nothing, while bundling Python and its models adds hundreds of megabytes. Most planned views are counting and timing, and semantic work goes to bundles. If a view later needs a dependency parser, add an optional Python sidecar that reads the same bundle.

2026-11-21: Support Node 24 and Node 26 LTS. The package range is
`>=24.22.1 <27`; the CLI also rejects odd majors, including Node 25, which
falls inside that numeric range but is not an LTS line. The runtime check
reads the bounds from `package.json`, the owner of the supported range.

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

## npm distribution

2026-11-22: The npm package name is `@praxity/trace`; the command remains
`praxity-trace`. The portable inventory's `tool` field reads the package name
from `package.json`. npm packs it as `praxity-trace-<version>.tgz`. Keep the
package private until publishing is approved.

Node refuses to strip TypeScript under `node_modules`. The npm package therefore
ships compiled `lib/` JavaScript. `prepack` calls `scripts/package.mjs --npm`,
using the existing TypeScript compiler API dev dependency with ES2023 output and
rewritten relative import extensions. This preserves the function source used
by `inlineClient`. The existing portable build keeps raw TypeScript and its
inventory format unchanged. Runtime data and package metadata remain one directory
above each layout's modules (`src/` or `lib/`).

The npm allowlist includes the tasks coding guide, which the tasks prompt names
by package path, and its linked synthetic task examples, alongside the skill,
data and legal notices. The smoke proof checks relative Markdown links in
shipped skill and docs files against the npm pack file list. npm installs
runtime dependencies; development tools are needed only when building the tarball.
Trace consumes Studio inspect JSON supplied by the caller; it does not locate
or launch Studio.
