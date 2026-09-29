import { inlineClient } from "./client.ts";
import { segmented } from "./modes.ts";
/**
 * Light / System / Dark. Views write their dark colours as `@media (prefers-color-scheme:dark){…}`;
 * this rewrites each such block so it applies when the reader picks Dark, or picks System on a dark
 * system, and never when they pick Light.
 */
export function themeable(css: string): string {
	const marker = "@media (prefers-color-scheme:dark){";
	let out = "";
	let from = 0;
	for (let start = css.indexOf(marker); start !== -1; start = css.indexOf(marker, from)) {
		let depth = 1;
		let end = start + marker.length;
		for (; end < css.length && depth > 0; end += 1) {
			if (css[end] === "{") depth += 1;
			else if (css[end] === "}") depth -= 1;
		}
		const inner = css.slice(start + marker.length, end - 1);
		const scope = (prefix: string) =>
			inner.replace(/([^{}]+)\{([^{}]*)\}/g, (_, selectors: string, body: string) =>
				`${selectors.split(",").map((selector) => `${prefix} ${selector.trim()}`).join(",")}{${body}}`,
			);
		out += `${css.slice(from, start)}${marker}${scope(":root:not([data-theme=light])")}}${scope(":root[data-theme=dark]")}`;
		from = end;
	}
	return out + css.slice(from);
}

/** Runs in <head> so the saved theme applies before the first paint. */
export const THEME_HEAD_SCRIPT = `try{const t=localStorage.getItem('trace-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch{}`;

export const THEME_SWITCH = segmented("theme", "Theme", [
	{ value: "light", label: "Light theme", icon: "sun" },
	{ value: "system", label: "Match the system theme", icon: "device-desktop", checked: true },
	{ value: "dark", label: "Dark theme", icon: "moon" },
]);

export function themeClient() {
  const root = document.documentElement;
  const current = root.dataset.theme || 'system';
  document.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach((input) => {
    input.checked = input.value === current;
    input.addEventListener('change', () => {
      if (input.value === 'system') delete root.dataset.theme; else root.dataset.theme = input.value;
      try { input.value === 'system' ? localStorage.removeItem('trace-theme') : localStorage.setItem('trace-theme', input.value); } catch {}
    });
  });
}
export const THEME_SCRIPT = inlineClient(themeClient);

/** color-scheme follows the choice so form controls and scrollbars match. */
export const THEME_STYLE = `
:root[data-theme=light]{color-scheme:light}:root[data-theme=dark]{color-scheme:dark}
`;
