# Contributing

The Praxity Trace repository is public and experimental. It is not accepting
outside contributions. Report security problems as described in [`SECURITY.md`](SECURITY.md).

To check the portable package with Electron, set `TRACE_ELECTRON` to the absolute
path of an Electron executable, then run `node --test test/package.test.ts`.
The test runs the packaged CLI with plain Node and Electron with
`ELECTRON_RUN_AS_NODE=1` in clean environments. It compares stdout and the bytes
of `report.json` and `report.html`, and fails on any stderr output. The artifact
is staged outside `node_modules`, where Node refuses to strip TypeScript.
Without `TRACE_ELECTRON`, this test reports a skip. A set but unusable executable
path fails the test.
