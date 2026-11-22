import packageJson from "../package.json" with { type: "json" };

export function requireSupportedNode(version: string): void {
	const range = packageJson.engines.node;
	const bounds = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(range);
	if (!bounds) throw new Error(`Unsupported Node engine range format: ${range}`);
	const [minimumMajor, minimumMinor, minimumPatch, upperMajor] = bounds.slice(1).map(Number) as [number, number, number, number];
	const parsed = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (parsed) {
		const [major, minor, patch] = parsed.slice(1).map(Number) as [number, number, number];
		const belowMinimum = major < minimumMajor || (major === minimumMajor && (minor < minimumMinor || (minor === minimumMinor && patch < minimumPatch)));
		if (!belowMinimum && major < upperMajor && major % 2 === 0) return;
	}
	throw new Error(`Trace requires an even-numbered Node LTS release (${range}); found ${version}.`);
}
