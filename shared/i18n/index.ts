// Thorgrim in Spanish. The app is written in English; this turns its text
// into Spanish: exact phrases first, then patterns for text with names and
// numbers in it ({1} in a pattern's output is its first group, translated
// too; $1 is the group as it is). The page translates what it shows
// (web/src/i18n.ts) and the server its notifications.

import { ES_PATTERNS, ES_PHRASES } from "./es.ts";

export type Lang = "en" | "es";

const phrase = (s: string): string | undefined => {
  const hit = ES_PHRASES[s];
  if (hit !== undefined) return hit;
  for (const [re, out] of ES_PATTERNS) {
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
