// Each member's language: the page says which it shows (header x-lang), the
// coach writes in it, and notifications reach the member in theirs.

import type { Lang } from "../shared/i18n/index.ts";
import { blobs } from "./blobs.ts";
import { currentUser } from "./context.ts";

const known = new Map<string, Lang>();
const prefsPath = (prefix: string) => `${prefix}settings/prefs.json`;

export async function langOf(prefix: string): Promise<Lang> {
  const hit = known.get(prefix);
  if (hit) return hit;
  const raw = await blobs().read(prefsPath(prefix)).catch(() => undefined);
  const lang: Lang = raw && (JSON.parse(raw.toString("utf8")) as { lang?: Lang }).lang === "es" ? "es" : "en";
  known.set(prefix, lang);
  return lang;
}

/** Remember the language a member's page is in (written only when it changes). */
export async function rememberLang(prefix: string, lang: Lang) {
  if ((await langOf(prefix)) === lang) return;
  known.set(prefix, lang);
  await blobs().write(prefsPath(prefix), JSON.stringify({ lang }), "application/json");
}

/** For the coach's instructions: write in the player's language. */
export const langNote = () =>
  currentUser().lang === "es"
    ? "\n\nThe player uses the app in Spanish: write everything for them in Spanish (Spain), keeping the names of units, factions, battleplans, battle tactic cards and rules as they are in English."
    : "";
