// Omnissiah (github.com/felipegarzonc/omnissiah): AoS tournament data read
// daily from Listhammer: faction win rates, matchups, winning lists. The
// coach asks it through these tools when OMNISSIAH_URL and OMNISSIAH_KEY
// are set; without them the tools are left out and the coach searches the
// web as before.

import { z } from "zod";

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
} as const;

export type MetaTool = keyof typeof metaSchemas;

export const metaDescriptions: Record<MetaTool, string> = {
  aos_meta_overview: "Every faction's recent tournament record (win rate, games, players, top 4s, event wins, over-representation) and the events it comes from. Daily data from Listhammer.",
  aos_faction_meta: "One faction's tournament detail: recent and overall record, weekly trend, matchups against every faction (with going-first records), and the battle formations played.",
  aos_matchup: "How one faction does against another in recent tournaments, from both sides.",
  aos_tournament_lists: "Real tournament lists with their records, newest first. Filter by faction, minimum wins, date, or a unit the list must include. Use for list building and 'what is winning' questions.",
};

async function get(path: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
  const base = process.env.OMNISSIAH_URL!.trim().replace(/\/$/, "");
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString();
  const res = await fetch(`${base}${path}${qs ? `?${qs}` : ""}`, {
    headers: { authorization: `Bearer ${process.env.OMNISSIAH_KEY!.trim()}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || `Tournament data unavailable (HTTP ${res.status})`);
  return body;
}

/** The last daily read (for the admin): whether it's set up, and how the read went. */
export async function omnissiahStatus(): Promise<{ configured: boolean; status?: unknown; error?: string }> {
  if (!omnissiahReady()) return { configured: false };
  try {
    return { configured: true, status: await get("/status") };
  } catch (e) {
    return { configured: true, error: (e as Error).message };
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
    case "aos_tournament_lists":
      out = await get("/lists", { faction: args.faction, minWins: args.min_wins, since: args.since, includes: args.includes, limit: Math.min(Number(args.limit ?? 5), 10) });
      break;
  }
  return JSON.stringify(out);
}
