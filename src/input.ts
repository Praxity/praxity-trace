import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export class JsonInputError extends Error {}

/** Decode at the byte boundary, before any JSON reader sees the input. */
export async function readInput(path: string): Promise<string> {
	let bytes: Buffer;
	if (path !== "-") bytes = await readFile(path);
	else {
		const chunks: Buffer[] = [];
		for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
		bytes = Buffer.concat(chunks);
	}
	let encoding = "utf-8";
	if (bytes.subarray(0, 4).equals(Buffer.from([0xff, 0xfe, 0, 0])) || bytes.subarray(0, 4).equals(Buffer.from([0, 0, 0xfe, 0xff]))) {
		throw new JsonInputError(`${basename(path)}: unsupported encoding; use UTF-8 or UTF-16 with a BOM.`);
	}
	if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = "utf-16le"; bytes = bytes.subarray(2); }
	else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = "utf-16be"; bytes = bytes.subarray(2); }
	try {
		// Fatal decoding refuses malformed bytes rather than silently replacing text.
		const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
		if (text.includes("\0")) throw new Error("NUL byte");
		return text;
	} catch {
		throw new JsonInputError(`${basename(path)}: invalid or unsupported encoding; use UTF-8 or UTF-16 with a BOM.`);
	}
}

/** Keep engine diagnostics, which may quote the entire input, out of errors. */
export function parseJson(json: string, source = "JSON input"): unknown {
	try { return JSON.parse(json); }
	catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
		const position = /position (\d+)/.exec(error.message)?.[1];
		const line = /line (\d+)/.exec(error.message)?.[1];
		const location = position ? `position ${position}` : line ? `line ${line}` : `position ${json.length}`;
		throw new JsonInputError(`${basename(source)}: invalid JSON at ${location}.`);
	}
}
