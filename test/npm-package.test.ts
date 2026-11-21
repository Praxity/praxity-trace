import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("npm build removes stale output and emits executable JavaScript for every runtime module", async () => {
	await mkdir(join(root, "lib"), { recursive: true });
	await writeFile(join(root, "lib/obsolete.js"), "obsolete");
	execFileSync(process.execPath, [join(root, "scripts/package.mjs"), "--npm"], { cwd: root });
	const sources = await readdir(join(root, "src"));
	assert.deepEqual((await readdir(join(root, "lib"))).sort(), sources.map(name => name.replace(/\.ts$/, ".js")).sort());
	for (const source of sources) {
		const compiled = await readFile(join(root, "lib", source.replace(/\.ts$/, ".js")), "utf8");
		assert.doesNotMatch(compiled, /(?:from\s*|import\s*\()["']\.\.?\/[^"']+\.ts["']/);
	}
	assert.match(await readFile(join(root, "lib/cli.js"), "utf8"), /^#!\/usr\/bin\/env node\n/);
	assert.match(execFileSync(process.execPath, [join(root, "lib/cli.js"), "--help"], { encoding: "utf8" }), /Usage:/);
});
