// Thorgrim in Spanish. The app is written in English; this turns its text
// into Spanish: exact phrases first, then patterns for text with names and
// numbers in it ({1} in a pattern's output is its first group, translated
// too; $1 is the group as it is). The page translates what it shows
// (web/src/i18n.ts) and the server its notifications.
//
// The phrases themselves (es.ts) are large: the server loads them at once
// (index.ts), the page only for players who use Spanish (web/src/i18n.ts).

export type Lang = "en" | "es";

let PHRASES: Record<string, string> = {};
let PATTERNS: [RegExp, string][] = [];

/** Bring in the Spanish phrases (es.ts). */
export function useSpanish(phrases: Record<string, string>, patterns: [RegExp, string][]) {
  PHRASES = phrases;
  PATTERNS = patterns;
}

const phrase = (s: string): string | undefined => {
  const hit = PHRASES[s];
  if (hit !== undefined) return hit;
  for (const [re, out] of PATTERNS) {
    const m = re.exec(s);
    if (m) return out.replace(/\{(\d)\}|\$(\d)/g, (_, t: string | undefined, raw: string | undefined) => (t ? (phrase(m[+t]) ?? m[+t]) : m[+raw!]) ?? "");
  }
  return undefined;
};

/** `text` in `lang`, keeping the spaces around it; text with no translation stays as it is. */
export function translate(text: string, lang: Lang): string {
  if (lang !== "es" || !/[A-Za-z]/.test(text)) return text;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  const t = phrase(m[2]);
  return t === undefined ? text : m[1] + t + m[3];
}

/** Whether there is a translation (for tests). */
export const hasTranslation = (text: string) => phrase(text.trim()) !== undefined;
