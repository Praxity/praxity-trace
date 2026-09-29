/** A browser function, or a helper it calls, whose source is inlined into report.html. */
type ClientFunction = (...args: never[]) => unknown;

/**
 * Script text that declares each helper from its source, then calls `fn` with `args` as JSON.
 * Node strips types when it runs these files, so `toString()` yields plain JavaScript. A client
 * function may reference only browser globals, its parameters, and the helpers passed with it.
 */
export function inlineClient(fn: ClientFunction, args: unknown[] = [], helpers: ClientFunction[] = []): string {
	return `${helpers.map((helper) => `const ${helper.name} = ${helper.toString()};`).join("\n")}\n(${fn.toString()})(${args.map((arg) => JSON.stringify(arg).replace(/</g, "\\u003c")).join(",")});\n`;
}
