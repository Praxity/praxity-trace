import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PROMPT_VERSION } from "../src/concepts.ts";
import { courseHash, parseCourse } from "../src/inspect.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const packager = join(root, "scripts/package.mjs");
const fixture = join(root, "test/fixtures");
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const portable = (path: string) => path.split(sep).join("/");

function run(args: string[], cwd: string, expected = 0, env?: NodeJS.ProcessEnv) {
	const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", env, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
	assert.ifError(result.error);
	assert.equal(result.status, expected, result.stderr || result.stdout);
	return result;
}

async function paths(directory: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(path: string) {
		for (const name of await readdir(join(directory, path))) {
			const item = join(path, name);
			const info = await lstat(join(directory, item));
			assert.equal(info.isSymbolicLink(), false, item);
			if (info.isDirectory()) await walk(item);
			else {
				assert.ok(info.isFile(), item);
				found.push(portable(item));
			}
		}
	}
	await walk("");
	return found.sort();
}

async function installedPackage(name: string, owner: string): Promise<string> {
	let directory = dirname(createRequire(join(owner, "package.json")).resolve(name));
	for (;;) {
		try {
			if (JSON.parse(await readFile(join(directory, "package.json"), "utf8")).name === name) return directory;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const parent = dirname(directory);
		assert.notEqual(parent, directory, `Missing installed metadata for ${name}`);
		directory = parent;
	}
}

// Node 24's permission model restricts filesystem, subprocesses and addons, but not networking.
// Patch both CommonJS and ESM builtins before importing Trace, and prove the guard with probes.
const networkGuard = `import net from 'node:net';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const denied = () => { throw new Error('Network disabled for portable artifact test'); };
net.Socket.prototype.connect = denied;
net.connect = denied;
net.createConnection = denied;
dgram.createSocket = denied;
for (const key of Object.keys(dns)) if (key === 'lookup' || key === 'lookupService' || key.startsWith('resolve') || key === 'reverse') dns[key] = denied;
for (const key of Object.keys(dns.promises)) if (key === 'lookup' || key === 'lookupService' || key.startsWith('resolve') || key === 'reverse') dns.promises[key] = denied;
http.request = http.get = https.request = https.get = denied;
globalThis.fetch = denied;
syncBuiltinESMExports();
`;

test("portable artifact inventories unchanged payload and runs after relocation with checkout and networking denied", async (t) => {
	const scratch = await realpath(await mkdtemp(join(tmpdir(), "trace portable package ")));
	t.after(() => rm(scratch, { recursive: true, force: true }));
	assert.ok(!resolve(scratch).startsWith(resolve(root)), "Relocation must be outside the checkout");
	const first = join(scratch, "first location with spaces");
	const relocated = join(scratch, "relocated artifact with spaces");
	const result = JSON.parse(run([packager, "--output", first], scratch).stdout);
	assert.equal(result.ok, true);
	assert.equal(result.output, first);
	assert.equal(result.inventory, join(first, "inventory.json"));
	await rename(first, relocated);
	await assert.rejects(lstat(first), { code: "ENOENT" });

	const inventory = JSON.parse(await readFile(join(relocated, "inventory.json"), "utf8"));
	const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	assert.equal(inventory.schemaVersion, 1);
	assert.equal(inventory.tool, "praxity-trace");
	assert.equal(inventory.version, manifest.version);
	assert.match(inventory.source.revision, /^[0-9a-f]{40}$/);
	const gitRevision = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
	assert.equal(gitRevision.status, 0, gitRevision.stderr);
	assert.equal(inventory.source.revision, gitRevision.stdout.trim());
	const gitStatus = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" });
	assert.equal(gitStatus.status, 0, gitStatus.stderr);
	assert.equal(inventory.source.dirty, gitStatus.stdout.trim().length > 0);
	assert.deepEqual(inventory.target, { platform: "portable", arch: "portable" });
	assert.equal(inventory.nodeRequirement, ">=24.18");
	assert.equal(inventory.nodeRequirement, manifest.engines.node);
	assert.equal(inventory.entry, "src/cli.ts");
	assert.deepEqual(inventory.inventoryExcludes, ["inventory.json"]);
	const payloadPaths = (await paths(relocated)).filter((path) => path !== "inventory.json");
	assert.deepEqual(inventory.files.map((file: { path: string }) => file.path), payloadPaths);
	assert.equal(result.fileCount, payloadPaths.length);
	for (const file of inventory.files as Array<{ path: string; size: number; sha256: string }>) {
		assert.ok(!file.path.startsWith("/") && !file.path.includes("\\") && !file.path.split("/").includes(".."), file.path);
		assert.doesNotMatch(file.path, /\.map$|\.(?:node|exe|dll|dylib|so|lib|a)$|(?:^|\/)(?:node|nodejs)$/i);
		const bytes = await readFile(join(relocated, file.path));
		assert.equal(file.size, bytes.length, file.path);
		assert.equal(file.sha256, sha256(bytes), file.path);
		for (const privatePath of [root.replace(/[\\/]$/, ""), portable(root).replace(/\/$/, ""), root.replaceAll("\\", "\\\\").replace(/\\\\$/, "")]) {
			assert.equal(bytes.includes(Buffer.from(privatePath)), false, `Private build path in ${file.path}`);
		}
	}
	for (const path of ["package.json", "LICENSE", "LICENSING.md", "NOTICE.md", "data/bloom-verbs.json", "data/tubelex-en.tsv.gz", "skill/SKILL.md", "docs/task-coding-guide.md", ...(await paths(join(root, "src"))).map((path) => `src/${path}`), ...(await paths(join(fixture, "tasks"))).map((path) => `test/fixtures/tasks/${path}`)]) {
		assert.deepEqual(await readFile(join(relocated, path)), await readFile(join(root, path)), path);
	}
	assert.deepEqual(payloadPaths.filter((path) => path.startsWith("data/")), ["data/bloom-verbs.json", "data/tubelex-en.tsv.gz"]);
	assert.ok(!payloadPaths.some((path) => /(?:^|\/)(?:\.pnpm|\.git|corpus|typescript|@types)(?:\/|$)/.test(path)));
	const parse5 = await installedPackage("parse5", root);
	const entities = await installedPackage("entities", parse5);
	for (const [source, destination] of [[parse5, "node_modules/parse5"], [entities, "node_modules/parse5/node_modules/entities"]]) {
		const originals = (await paths(source!)).filter((path) => !path.endsWith(".map"));
		assert.deepEqual(await paths(join(relocated, destination!)), destination === "node_modules/parse5" ? [...originals, ...(await paths(join(relocated, "node_modules/parse5/node_modules"))).map((path) => `node_modules/${path}`)].sort() : originals);
		for (const path of originals) assert.deepEqual(await readFile(join(relocated, destination!, path)), await readFile(join(source!, path)), path);
	}
	for (const path of ["LICENSE", "LICENSING.md", "NOTICE.md", "node_modules/parse5/LICENSE", "node_modules/parse5/node_modules/entities/LICENSE"]) assert.ok(inventory.legalFiles.includes(path), path);
	for (const path of inventory.legalFiles) assert.ok(payloadPaths.includes(path), path);

	const inputRoot = join(scratch, "inputs");
	const output = join(scratch, "outputs");
	await mkdir(inputRoot);
	await mkdir(output);
	await cp(join(fixture, "html/studio"), join(inputRoot, "studio"), { recursive: true });
	// Exercise entities with the existing synthetic export, including an entity inside nested markup.
	const lesson = join(inputRoot, "studio/lesson-one.html");
	await writeFile(lesson, (await readFile(lesson, "utf8")).replace("A short note.", "A short &amp; <strong>nested &copy;</strong> note &#x1F642;."));
	const schemaInput = join(inputRoot, "inspect.json");
	await cp(join(fixture, "examples.schema1.inspect.json"), schemaInput);
	const guard = join(inputRoot, "deny-network.mjs");
	await writeFile(guard, networkGuard);
	const env: NodeJS.ProcessEnv = { PATH: "", ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) };
	// POSIX module resolution walks ancestors; macOS temporary paths live under /private.
	const readable = process.platform === "win32" ? scratch : join(sep, scratch.split(sep).filter(Boolean)[0]!);
	assert.ok(!resolve(root).startsWith(`${readable}${sep}`), "The readable temporary tree must exclude the checkout");
	const restrictions = ["--permission", `--allow-fs-read=${readable}`, `--allow-fs-write=${output}`, "--import", pathToFileURL(guard).href];
	const entry = join(relocated, inventory.entry);
	const cli = (args: string[], expected = 0) => run([...restrictions, entry, ...args], scratch, expected, env);
	const probe = run([...restrictions, "--input-type=module", "--eval", `import { readFileSync } from 'node:fs'; try { readFileSync(${JSON.stringify(join(root, "package.json"))}); process.exit(9); } catch (error) { if (error.code !== 'ERR_ACCESS_DENIED') throw error; console.log(error.code); }`], scratch, 0, env);
	assert.equal(probe.stdout.trim(), "ERR_ACCESS_DENIED");
	const networkProbe = run([...restrictions, "--input-type=module", "--eval", `import { connect } from 'node:net'; import { createSocket } from 'node:dgram'; import { lookup } from 'node:dns'; import { request } from 'node:http'; import { get } from 'node:https'; const attempts = [() => connect(9, '127.0.0.1'), () => createSocket('udp4'), () => lookup('localhost', () => {}), () => request('http://127.0.0.1'), () => get('https://127.0.0.1'), () => fetch('http://127.0.0.1')]; for (const attempt of attempts) { try { await attempt(); process.exit(9); } catch (error) { if (!error.message.includes('Network disabled')) throw error; } } console.log(attempts.length);`], scratch, 0, env);
	assert.equal(networkProbe.stdout.trim(), "6");
	assert.match(cli(["--help"]).stdout, /Usage:/);
	assert.match(cli([], 2).stdout, /Usage:/);
	assert.match(cli(["report", join(inputRoot, "missing.json"), "--out", join(output, "missing")], 1).stderr, /ENOENT/);

	for (const [input, name, schema] of [[join(inputRoot, "studio"), "html", "praxity-html/0"], [schemaInput, "schema1", "praxity-inspect/1"]]) {
		const reportDirectory = join(output, `${name} report`);
		const stdout = JSON.parse(cli(["report", input!, "--out", reportDirectory]).stdout);
		assert.equal(stdout.ok, true);
		assert.equal(stdout.html, join(reportDirectory, "report.html"));
		const report = JSON.parse(await readFile(join(reportDirectory, "report.json"), "utf8"));
		assert.equal(report.source.schema, schema);
		assert.match(report.courseHash, /^[0-9a-f]{64}$/);
		assert.equal(stdout.courseHash, report.courseHash);
		if (name === "schema1") assert.equal(report.courseHash, courseHash(parseCourse(await readFile(schemaInput, "utf8"))));
		const html = await readFile(stdout.html, "utf8");
		assert.match(html, /Tabler Icons/);
		assert.match(html, /Copyright \(c\) 2020-2026 Paweł Kuna/);
		assert.match(html, /Permission is hereby granted/);
		assert.match(html, /SOFTWARE\.\n-->/);
		assert.doesNotMatch(html, /import\s*\(|require\s*\(|sourceMappingURL|D:\\GitHub/);
		// Parsing emitted scripts verifies raw function serialization still yields runnable JavaScript.
		const scripts = [...html.matchAll(/<script(?![^>]*type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/g)];
		assert.ok(scripts.length > 0);
		for (const script of scripts) assert.doesNotThrow(() => new Function(script[1]!), "Emitted browser script must parse");
		const bundle = join(output, `${name} bundle`);
		const prepared = JSON.parse(cli(["prepare", "concepts", input!, "--out", bundle]).stdout);
		assert.deepEqual(prepared, { ok: true, bundle, prompt: join(bundle, "prompt.md"), answer: join(bundle, "answer.json") });
		const bundleManifest = JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8"));
		assert.equal(bundleManifest.courseHash, report.courseHash);
		assert.equal(bundleManifest.promptVersion, PROMPT_VERSION);
		assert.match(await readFile(prepared.prompt, "utf8"), /# Concept review/);
		if (name === "html") {
			const courseText = await readFile(join(bundle, "course.md"), "utf8");
			assert.match(courseText, /A short & nested © note 🙂/);
			assert.doesNotMatch(courseText, /Hidden definition/);
		}
	}
});

test("packager refuses existing files, directories and symlinks without changing them", async (t) => {
	const scratch = await mkdtemp(join(tmpdir(), "trace package overwrite "));
	t.after(() => rm(scratch, { recursive: true, force: true }));
	const directory = join(scratch, "existing");
	await mkdir(directory);
	const sentinel = join(directory, "keep.txt");
	await writeFile(sentinel, "preserve me");
	const link = join(scratch, "linked output");
	await symlink(directory, link, process.platform === "win32" ? "junction" : "dir");
	const dangling = join(scratch, "dangling output");
	await symlink(join(scratch, "missing target"), dangling, process.platform === "win32" ? "junction" : "dir");
	for (const output of [directory, sentinel, link, dangling]) {
		assert.match(run([packager, "--output", output], scratch, 1).stderr, /Output already exists/);
		assert.equal(await readFile(sentinel, "utf8"), "preserve me");
		assert.deepEqual(await readdir(directory), ["keep.txt"]);
	}
	assert.ok((await lstat(link)).isSymbolicLink());
	assert.ok((await lstat(dangling)).isSymbolicLink());
});

test("packager validates arguments and fails before writing when a runtime dependency is missing", async (t) => {
	const scratch = await mkdtemp(join(tmpdir(), "trace package errors "));
	t.after(() => rm(scratch, { recursive: true, force: true }));
	for (const args of [[], ["--output"], ["--output", ""], ["--unknown"], ["unexpected"]]) assert.match(run([packager, ...args], scratch, 2).stderr, /Usage:/);
	assert.match(run([packager, "--help"], scratch).stdout, /Usage:/);
	const fake = join(scratch, "isolated source");
	for (const path of ["scripts", "src", "data", "skill"]) await mkdir(join(fake, path), { recursive: true });
	await cp(packager, join(fake, "scripts/package.mjs"));
	for (const path of ["LICENSE", "LICENSING.md", "NOTICE.md"]) await writeFile(join(fake, path), "Synthetic licence\n");
	for (const path of ["src/cli.ts", "data/bloom-verbs.json", "data/tubelex-en.tsv.gz", "skill/SKILL.md"]) await writeFile(join(fake, path), "synthetic\n");
	await writeFile(join(fake, "package.json"), JSON.stringify({ name: "praxity-trace", version: "0.1.1", engines: { node: ">=24.18" }, dependencies: { "trace-test-missing-runtime-dependency": "1.0.0" } }));
	const output = join(scratch, "must not exist");
	assert.match(run([join(fake, "scripts/package.mjs"), "--output", output], scratch, 1).stderr, /trace-test-missing-runtime-dependency/);
	await assert.rejects(lstat(output), { code: "ENOENT" });
	await writeFile(join(fake, "package.json"), JSON.stringify({ name: "praxity-trace", version: "0.1.1", engines: { node: ">=24.18" }, dependencies: {} }));
	const nested = join(fake, "src", "embedded artifact");
	assert.match(run([join(fake, "scripts/package.mjs"), "--output", nested], scratch, 1).stderr, /inside a copied source directory/);
	await assert.rejects(lstat(nested), { code: "ENOENT" });
	const alias = join(scratch, "source alias");
	await symlink(join(fake, "src"), alias, process.platform === "win32" ? "junction" : "dir");
	const aliased = join(alias, "new parent", "embedded artifact");
	assert.match(run([join(fake, "scripts/package.mjs"), "--output", aliased], scratch, 1).stderr, /inside a copied source directory/);
	await assert.rejects(lstat(join(alias, "new parent")), { code: "ENOENT" });
});
