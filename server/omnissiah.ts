// Omnissiah (github.com/felipegarzonc/omnissiah): AoS tournament data read
// daily from Listhammer: faction win rates, matchups, winning lists. The
// coach asks it through these tools when OMNISSIAH_URL and OMNISSIAH_KEY
// are set; without them the tools are left out and the coach searches the
// web as before.

import crypto from "node:crypto";
import { z } from "zod";
import type { ArmyList } from "../shared/types.ts";
import { Collection } from "./store.ts";

export const omnissiahReady = () => !!(process.env.OMNISSIAH_URL?.trim() && process.env.OMNISSIAH_KEY?.trim());

export const metaSchemas = {
  aos_meta_overview: z.object({}),
  aos_faction_meta: z.object({ faction: z.string().describe('As people write it: "Ogor Mawtribes", "Ogors", "SCE"…') }),
  aos_matchup: z.object({ faction: z.string(), opponent: z.string() }),
  aos_tournament_lists: z.object({
    faction: z.string().optional(),
    min_wins: z.number().int().optional().describe("4 = went 4-1 or better in a 5-round event"),
    since: z.string().optional().describe("Events on or after YYYY-MM-DD"),
    includes: z.string().optional().describe("A unit, formation or word the list must mention"),
    limit: z.number().int().optional().describe("Up to 10 (default 5)"),
  }),
  aos_articles: z.object({
    query: z.string().describe("A faction, unit, formation or topic"),
    limit: z.number().int().optional(),
    source: z.enum(["tabletop", "woehammer", "frontline", "spikeybits", "bols"]).optional(),
  }),
  aos_rules_updates: z.object({}),
  aos_winners_profile: z.object({ faction: z.string(), since: z.string().optional().describe('YYYY-MM-DD or "all"; default: since the last rules change') }),
  aos_compare_list: z.object({
    list: z.string().optional().describe("Name of one of the player's saved lists"),
    list_text: z.string().optional().describe("Or the list's text, as the Warhammer app exports it"),
    faction: z.string().optional().describe("Needed with list_text"),
  }),
  aos_scouting: z.object({ faction: z.string().describe("The player's faction"), opponent: z.string().describe("The opponent's faction") }),
  aos_trends: z.object({}),
  aos_player: z.object({ name: z.string() }),
  aos_top_players: z.object({ faction: z.string().optional() }),
  aos_region: z.object({ countries: z.array(z.string()).optional().describe("Default: Latin America") }),
} as const;

export type MetaTool = keyof typeof metaSchemas;

export const metaDescriptions: Record<MetaTool, string> = {
  aos_meta_overview: "Every faction's recent tournament record (win rate, games, players, top 4s, event wins, over-representation) and the events it comes from. Daily data from Listhammer.",
  aos_faction_meta: "One faction's tournament detail: recent and overall record, weekly trend, matchups against every faction (with going-first records), and the battle formations played.",
  aos_matchup: "How one faction does against another in recent tournaments, from both sides.",
  aos_articles:
    "Search AoS articles and news: Tabletop Battles (formerly Goonhammer) weekly competitive round-ups, Woehammer meta stats commentary and top lists, Frontline Gaming tactics, Spikey Bits and Bell of Lost Souls news. Gives titles, links, dates and short excerpts: link the article, don't retell it.",
  aos_rules_updates: "The latest battlescrolls, points updates, errata and FAQs seen in AoS news. Check it before trusting stats: numbers from before the latest change may no longer hold.",
  aos_winners_profile:
    "What a faction's top tournament lists (X-1 or better) choose: how often each unit, battle tactic card, lore and formation appears, also among undefeated lists. Top lists only, so it shows what top lists pick, not what loses.",
  aos_compare_list:
    "Compare one of the player's saved lists (by name) or a pasted list with its faction's top tournament lists: units most top lists bring that it lacks, how common its units are among them, tactic cards, formations, drops.",
  aos_scouting: "Before a game: what the opponent's faction brings in top tournament lists, and this matchup's record with its 95% range.",
  aos_trends: "Each faction's win rate now against a week and four weeks ago (rising and falling armies).",
  aos_player: "A tournament player's recent top results and lists (by name).",
  aos_top_players: "Players with the most X-1 or better results, overall or for one faction.",
  aos_region: "Events and top results in some countries (Latin America by default).",
  aos_tournament_lists: "Real tournament lists with their records, newest first. Filter by faction, minimum wins, date, or a unit the list must include. Use for list building and 'what is winning' questions.",
};

async function get(path: string, params: Record<string, string | number | undefined> = {}, json?: unknown): Promise<unknown> {
  const base = process.env.OMNISSIAH_URL!.trim().replace(/\/$/, "");
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString();
  const res = await fetch(`${base}${path}${qs ? `?${qs}` : ""}`, {
    method: json === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${process.env.OMNISSIAH_KEY!.trim()}`, ...(json === undefined ? {} : { "content-type": "application/json" }) },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || `Tournament data unavailable (HTTP ${res.status})`);
  return body;
}

/** The last daily read (for the admin): whether it's set up, and how the read went. */
export async function omnissiahStatus(): Promise<{ configured: boolean; keyFingerprint?: string; status?: unknown; error?: string }> {
  if (!omnissiahReady()) return { configured: false };
  // Compare with the fingerprint Omnissiah shows at its / page: different means different keys.
  const keyFingerprint = crypto.createHash("sha256").update(process.env.OMNISSIAH_KEY!.trim()).digest("hex").slice(0, 8);
  try {
    return { configured: true, keyFingerprint, status: await get("/status") };
  } catch (e) {
    return { configured: true, keyFingerprint, error: (e as Error).message };
  }
}

/** Omnissiah's answer for a path, or undefined when it isn't set up or can't answer (callers carry on without it). */
export async function omnissiahGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T | undefined> {
  if (!omnissiahReady()) return undefined;
  try {
    return (await get(path, params)) as T;
  } catch (e) {
    console.error(`Omnissiah ${path}:`, (e as Error).message);
    return undefined;
  }
}

/** A tool's answer, as compact JSON for the model. */
export async function runMetaTool(name: MetaTool, input: unknown): Promise<string> {
  const args = metaSchemas[name].parse(input) as Record<string, string | number | undefined>;
  let out: unknown;
  switch (name) {
    case "aos_meta_overview":
      out = await get("/factions");
      break;
    case "aos_faction_meta":
      out = await get(`/factions/${encodeURIComponent(String(args.faction))}`);
      break;
    case "aos_matchup":
      out = await get("/matchup", { a: args.faction, b: args.opponent });
      break;
    case "aos_articles":
      out = await get("/articles", { q: args.query, limit: Math.min(Number(args.limit ?? 3), 5), source: args.source });
      break;
    case "aos_rules_updates":
      out = await get("/rules/changes", { limit: 5 });
      break;
    case "aos_winners_profile":
      out = await get(`/profile/${encodeURIComponent(String(args.faction))}`, { since: args.since });
      break;
    case "aos_compare_list": {
      let text = args.list_text as string | undefined;
      let faction = args.faction as string | undefined;
      if (args.list) {
        const wanted = String(args.list).toLowerCase();
        const mine = await new Collection<ArmyList>("lists").list();
        const l = mine.find((x) => x.name.toLowerCase() === wanted) ?? mine.find((x) => x.name.toLowerCase().includes(wanted));
        if (!l) throw new Error(`No saved list called "${args.list}". The player's lists: ${mine.map((x) => x.name).join(", ") || "none"}.`);
        text = l.rawText;
        faction ??= l.faction;
      }
      if (!text || !faction) throw new Error("Give the name of a saved list, or the list's text and its faction.");
      out = await get("/compare", {}, { faction, list: text });
      break;
    }
    case "aos_scouting":
      out = await get("/scouting", { faction: args.faction, opponent: args.opponent });
      break;
    case "aos_trends":
      out = await get("/trends");
      break;
    case "aos_player":
      out = await get("/players", { name: args.name });
      break;
    case "aos_top_players":
      out = await get("/players/top", { faction: args.faction, limit: 10 });
      break;
    case "aos_region":
      out = await get("/region", { countries: (args.countries as unknown as string[] | undefined)?.join(",") });
      break;
    case "aos_tournament_lists":
      out = await get("/lists", { faction: args.faction, minWins: args.min_wins, since: args.since, includes: args.includes, limit: Math.min(Number(args.limit ?? 5), 10) });
      break;
  }
  return JSON.stringify(out);
}
