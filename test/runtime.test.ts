import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { requireSupportedNode } from "../src/runtime.ts";

test("accepts supported Node 24 and 26 releases", () => {
	for (const version of ["v24.22.1", "v24.23.0", "v26.1.0", "v26.13.1"]) {
		assert.doesNotThrow(() => requireSupportedNode(version), version);
	}
});

test("rejects Node below the minimum, odd Node 25 despite the npm range, and Node 27 or later", () => {
	for (const version of ["v22.22.1", "v24.22.0", "v24.21.9", "v25.0.0", "v27.0.0", "v28.0.0", "v26.1.0-rc.1", "invalid"]) {
		assert.throws(() => requireSupportedNode(version), /Trace requires Node 24 \(24\.22\.1 or later\) or Node 26; received/, version);
	}
});

for (const version of ["v24.22.0", "v25.0.0", "v27.0.0"]) {
	test(`CLI rejects ${version} with only an actionable message`, () => {
		const preload = `data:text/javascript,${encodeURIComponent(`Object.defineProperty(process, "version", { value: ${JSON.stringify(version)} });`)}`;
		const result = spawnSync(process.execPath, ["--import", preload, fileURLToPath(new URL("../src/cli.ts", import.meta.url)), "--help"], { encoding: "utf8", timeout: 30_000 });
		assert.ifError(result.error);
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr.trim(), `Trace requires Node 24 (24.22.1 or later) or Node 26; received ${version}`);
	});
}
