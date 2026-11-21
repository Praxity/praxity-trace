import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const npm = process.env.npm_execpath;
assert.ok(npm, "Run through npm run test:npm to locate the host npm CLI");
await mkdir(join(root, "out"), { recursive: true });
const scratch = await mkdtemp(join(root, "out", "npm-smoke-"));
try {
	const nodeDirectory = join(scratch, "node-only");
	await mkdir(nodeDirectory);
	const node = join(nodeDirectory, process.platform === "win32" ? "node.exe" : "node");
	await copyFile(process.execPath, node);
	const environment = {
		PATH: nodeDirectory, HOME: scratch, USERPROFILE: scratch, TEMP: scratch, TMP: scratch,
		SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec,
		npm_config_cache: join(scratch, "cache"), npm_config_prefix: join(scratch, "prefix"),
		npm_config_userconfig: join(scratch, "npmrc"), npm_config_globalconfig: join(scratch, "global-npmrc"),
		npm_config_script_shell: process.platform === "win32" ? process.env.ComSpec : "/bin/sh",
	};
	const run = (cli, args, cwd, env = environment) => execFileSync(node, [cli, ...args], { cwd, env, encoding: "utf8", timeout: 120_000 });
	const [packed] = JSON.parse(run(npm, ["pack", "--json", "--pack-destination", scratch], root, { ...process.env, ...environment }));
	console.log(JSON.stringify({ filename: packed.filename, size: packed.size, unpackedSize: packed.unpackedSize, files: packed.files.map(file => file.path) }, null, 2));
	assert.ok(packed.files.some(file => file.path === "lib/cli.js"));
	assert.ok(!packed.files.some(file => /^(?:src|test|scripts|node_modules)\//.test(file.path)));
	const project = join(scratch, "clean install");
	await mkdir(project);
	await writeFile(join(project, "package.json"), '{"private":true}\n');
	run(npm, ["install", join(scratch, packed.filename), "--no-audit", "--no-fund"], project);
	const npx = join(dirname(npm), "npx-cli.js");
	assert.match(run(npx, ["--no-install", "praxity-trace", "--help"], project), /Usage:/);
	const input = join(project, "synthetic course");
	await mkdir(input);
	await writeFile(join(input, "index.html"), '<!doctype html><html lang="en"><head><title>Practice</title></head><body><h1>Practice</h1><p>Read the map and choose a safe route.</p></body></html>');
	const output = join(project, "report");
	const result = JSON.parse(run(npx, ["--no-install", "praxity-trace", "report", input, "--out", output], project));
	assert.equal(result.ok, true);
	const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
	assert.equal(report.source.schema, "praxity-html/0");
	assert.match(report.courseHash, /^[a-f0-9]{64}$/);
	const html = await readFile(join(output, "report.html"), "utf8");
	const scripts = [...html.matchAll(/<script(?![^>]*type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/g)];
	assert.ok(scripts.length > 0);
	for (const script of scripts) assert.doesNotThrow(() => new Function(script[1]));
	console.log("Clean npm install: npx --help and synthetic HTML report passed with only Node on PATH.");
} finally {
	await rm(scratch, { recursive: true, force: true });
}
