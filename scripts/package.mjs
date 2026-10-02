import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const help = "Usage: node scripts/package.mjs --output <new-directory>";

let output;
try {
	const { values } = parseArgs({ options: { output: { type: "string" }, help: { type: "boolean", short: "h" } } });
	if (values.help) {
		console.log(help);
		process.exit(0);
	}
	if (!values.output?.trim()) throw new Error("--output is required.");
	output = resolve(values.output);
} catch (error) {
	console.error(`${error.message}\n${help}`);
	process.exit(2);
}

try {
	console.log(JSON.stringify(await build(output)));
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}

async function build(directory) {
	try {
		await lstat(directory);
		throw new Error(`Output already exists: ${directory}`);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	const payload = new Map();
	const linked = new Set();
	const copiedDirectories = new Set();
	const portable = (path) => path.split(sep).join("/");
	const inside = (base, path) => {
		const rel = relative(base, path);
		return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
	};

	async function collect(source, target, ancestors = new Set(), repository = false) {
		const physical = await realpath(source);
		if (repository && (!inside(root, physical) || /^(?:corpus\/local|node_modules|\.git)(?:\/|$)/.test(portable(relative(root, physical))))) {
			throw new Error(`Local content leaves the public repository: ${source}`);
		}
		const info = await stat(physical);
		if (info.isDirectory()) {
			copiedDirectories.add(resolve(source));
			copiedDirectories.add(physical);
			if (ancestors.has(physical)) throw new Error(`Directory link cycle: ${source}`);
			const next = new Set([...ancestors, physical]);
			for (const name of (await readdir(physical)).sort()) {
				// Dependencies are resolved separately, rather than copying a package manager's links.
				if (name === "node_modules" || name === ".git") continue;
				await collect(join(physical, name), join(target, name), next, repository);
			}
		} else if (info.isFile()) {
			if (/\.map$/i.test(target)) return;
			if (/\.(?:node|exe|dll|dylib|so|a|lib)$/i.test(target) || /^(?:node|nodejs)$/i.test(basename(target))) {
				throw new Error(`Native code or a bundled runtime is not portable: ${source}`);
			}
			const key = portable(target);
			if (payload.has(key) && payload.get(key) !== physical) throw new Error(`Conflicting payload path: ${key}`);
			payload.set(key, physical);
		} else {
			throw new Error(`Payload must contain regular files: ${source}`);
		}
	}

	async function localContent(source) {
		const absolute = resolve(source);
		if (linked.has(absolute)) return;
		linked.add(absolute);
		if (!inside(root, absolute)) throw new Error(`Local link leaves the repository: ${source}`);
		await collect(absolute, relative(root, absolute), new Set(), true);
		// Markdown in linked directories can introduce further local files or directories.
		for (const [target, file] of [...payload]) {
			if (!/\.md$/i.test(target) || linked.has(`read:${file}`)) continue;
			linked.add(`read:${file}`);
			const markdown = await readFile(file, "utf8");
			const links = [
				...markdown.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g),
				...markdown.matchAll(/^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm),
			];
			for (const match of links) {
				const href = match[1] ?? match[2];
				if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) continue;
				const path = decodeURIComponent(href.split(/[?#]/)[0]);
				if (path) await localContent(resolve(dirname(file), path));
			}
		}
	}

	async function dependency(name, owner, target, ancestors = new Map()) {
		const require = createRequire(join(owner, "package.json"));
		let packageRoot = dirname(require.resolve(name));
		for (;;) {
			try {
				const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
				if (pkg.name === name) break;
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			const parent = dirname(packageRoot);
			if (parent === packageRoot) throw new Error(`Cannot find installed package metadata for ${name}`);
			packageRoot = parent;
		}
		packageRoot = await realpath(packageRoot);
		if (ancestors.get(name) === packageRoot) return;
		await collect(packageRoot, target);
		const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
		const next = new Map(ancestors).set(name, packageRoot);
		const dependencies = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
		for (const child of Object.keys(dependencies).sort()) {
			try {
				await dependency(child, packageRoot, join(target, "node_modules", child), next);
			} catch (error) {
				const optional = Object.hasOwn(pkg.optionalDependencies ?? {}, child) || pkg.peerDependenciesMeta?.[child]?.optional;
				if (!(optional && error.code === "MODULE_NOT_FOUND")) throw error;
			}
		}
	}

	// Preserve the raw TypeScript: inlineClient serializes type-stripped function source.
	for (const path of ["src", "data/bloom-verbs.json", "data/tubelex-en.tsv.gz", "package.json", "LICENSE", "LICENSING.md", "NOTICE.md"]) {
		await collect(join(root, path), path, new Set(), true);
	}
	await localContent(join(root, "skill"));
	for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }).sort()) {
		await dependency(name, root, join("node_modules", name));
	}
	if ([...copiedDirectories].some((source) => inside(source, directory))) {
		throw new Error(`Output cannot be inside a copied source directory: ${directory}`);
	}
	const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
	const source = { revision: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain").length > 0 };
	// mkdir reserves the leaf exclusively, including a racing directory or dangling symlink.
	await mkdir(dirname(directory), { recursive: true });
	await mkdir(directory);
	const files = [];
	for (const [path, file] of [...payload].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
		const destination = join(directory, path);
		await mkdir(dirname(destination), { recursive: true });
		await copyFile(file, destination);
		const bytes = await readFile(destination);
		files.push({ path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
	}
	const inventory = {
		schemaVersion: 1,
		tool: "praxity-trace",
		version: manifest.version,
		source,
		target: { platform: "portable", arch: "portable" },
		nodeRequirement: manifest.engines.node,
		entry: "src/cli.ts",
		legalFiles: files.map(({ path }) => path).filter((path) => /(?:^|[._-])(?:licen[cs]e|licensing|copying|notice|copyright|third[-_]?party)(?:[._-]|$)/i.test(basename(path))),
		inventoryExcludes: ["inventory.json"],
		files,
	};
	await writeFile(join(directory, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
	return { ok: true, output: directory, inventory: join(directory, "inventory.json"), version: manifest.version, fileCount: files.length };
}
