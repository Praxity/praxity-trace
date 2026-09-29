# Node and TypeScript, not Python

Trace runs on Node 24 with type-stripped TypeScript. Python has better NLP (spaCy dependency parsing, textstat) and was the main alternative. Node won because Rubato and Studio's CLI already ship a Node 24 runtime, so bundling Trace adds almost nothing, while bundling Python and its models adds hundreds of megabytes. Most planned views are counting and timing, and semantic work goes to bundles. If a view later needs a dependency parser, add an optional Python sidecar that reads the same bundle.
