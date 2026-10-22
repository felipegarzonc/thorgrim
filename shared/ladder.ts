// The club ladder, from confirmed results: shared games both players
// confirmed (server/ladder.ts keeps those). Win 3 points, draw 1, loss 0;
// ties broken by VP difference, then wins.

import { baseFaction } from "./season.ts";

export interface ClubResult {
  /** The game's id. */
  id: string;
  date: string;
  battleplan: string;
  conclusion: "played" | "conceded-me" | "conceded-opponent" | "time";
  /** The game's creator first ("me" in the game), then the opponent who joined. */
  players: { id: string; name: string; faction: string; vp: number }[];
  confirmedAt: string;
}

export interface Standing {
  id: string;
  name: string;
  /** The army they played most. */
  faction: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  vpFor: number;
  vpAgainst: number;
}

/** 0 or 1: who won, or null for a draw. A concession beats the score. */
export function winnerOf(r: ClubResult): 0 | 1 | null {
  if (r.conclusion === "conceded-me") return 1;
  if (r.conclusion === "conceded-opponent") return 0;
  const [a, b] = r.players;
  return a.vp > b.vp ? 0 : a.vp < b.vp ? 1 : null;
}

export function standings(results: ClubResult[]): Standing[] {
  const by = new Map<string, Standing & { armies: Map<string, number> }>();
  const sorted = [...results].sort((x, y) => x.date.localeCompare(y.date) || x.confirmedAt.localeCompare(y.confirmedAt));
  for (const r of sorted) {
    const w = winnerOf(r);
    r.players.slice(0, 2).forEach((p, i) => {
      const other = r.players[1 - i];
      const s = by.get(p.id) ?? { id: p.id, name: p.name, faction: "", played: 0, won: 0, drawn: 0, lost: 0, points: 0, vpFor: 0, vpAgainst: 0, armies: new Map() };
      s.name = p.name || s.name; // the latest name they played under
      s.played++;
      if (w === null) s.drawn++;
      else if (w === i) s.won++;
      else s.lost++;
      s.points = s.won * 3 + s.drawn;
      s.vpFor += p.vp;
      s.vpAgainst += other.vp;
      if (p.faction) s.armies.set(baseFaction(p.faction), (s.armies.get(baseFaction(p.faction)) ?? 0) + 1);
      by.set(p.id, s);
    });
  }
  return [...by.values()]
    .map(({ armies, ...s }) => ({ ...s, faction: [...armies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "" }))
    .sort((a, b) => b.points - a.points || b.vpFor - b.vpAgainst - (a.vpFor - a.vpAgainst) || b.won - a.won || a.name.localeCompare(b.name));
}

/** One member's record against each opponent. */
export function headToHead(results: ClubResult[], me: string): { id: string; name: string; won: number; drawn: number; lost: number }[] {
  const by = new Map<string, { id: string; name: string; won: number; drawn: number; lost: number }>();
  for (const r of results) {
    const i = r.players.findIndex((p) => p.id === me);
    if (i < 0 || i > 1) continue;
    const them = r.players[1 - i];
    const w = winnerOf(r);
    const h = by.get(them.id) ?? { id: them.id, name: them.name, won: 0, drawn: 0, lost: 0 };
    if (w === null) h.drawn++;
    else if (w === i) h.won++;
    else h.lost++;
    by.set(them.id, h);
  }
  return [...by.values()].sort((a, b) => b.won + b.drawn + b.lost - (a.won + a.drawn + a.lost));
}

/** How each army does at the club. */
export function armyStats(results: ClubResult[]): { faction: string; played: number; won: number; rate: number }[] {
  const by = new Map<string, { faction: string; played: number; won: number; rate: number }>();
  for (const r of results) {
    const w = winnerOf(r);
    r.players.slice(0, 2).forEach((p, i) => {
      if (!p.faction) return;
      const f = baseFaction(p.faction);
      const s = by.get(f) ?? { faction: f, played: 0, won: 0, rate: 0 };
      s.played++;
      if (w === i) s.won++;
      s.rate = s.won / s.played;
      by.set(f, s);
    });
  }
  return [...by.values()].sort((a, b) => b.played - a.played || b.rate - a.rate);
}
