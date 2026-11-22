import assert from "node:assert/strict";
import { test } from "node:test";
import { requireSupportedNode } from "../src/runtime.ts";

test("accepts supported Node 24 and 26 releases", () => {
	for (const version of ["v24.22.1", "v24.23.0", "v26.1.0", "v26.13.1"]) {
		assert.doesNotThrow(() => requireSupportedNode(version), version);
	}
});

test("rejects Node below the minimum, odd Node 25 despite the npm range, and Node 27 or later", () => {
	for (const version of ["v22.22.1", "v24.22.0", "v24.21.9", "v25.0.0", "v27.0.0", "v28.0.0", "v26.1.0-rc.1", "invalid"]) {
		assert.throws(() => requireSupportedNode(version), /Trace requires an even-numbered Node LTS release \(>=24\.22\.1 <27\)/, version);
	}
});
