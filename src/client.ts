type ClientFunction = (...args: never[]) => unknown;

export function inlineClient(fn: ClientFunction, args: unknown[] = [], helpers: ClientFunction[] = []): string {
	return `${helpers.map((helper) => `const ${helper.name} = ${helper.toString()};`).join("\n")}\n(${fn.toString()})(${args.map((arg) => JSON.stringify(arg).replace(/</g, "\\u003c")).join(",")});\n`;
}
