// A game seen from the other player's side. Games are stored from the side of
// the player who created them ("me" is the creator); a player who joined a
// shared game sees it flipped, so "me" is always whoever is looking.

import type { Game, GameState, RoundRecord } from "./types.ts";

type Side = "me" | "opponent";
const other = <T extends Side | null | undefined>(s: T): T => (s === "me" ? "opponent" : s === "opponent" ? "me" : s) as T;
const pair = <T>(p: { me: T; opponent: T }) => ({ me: p.opponent, opponent: p.me });

/** Swap two fields, leaving out the ones that end up empty. */
function swap<T extends object>(o: T, a: keyof T, b: keyof T): T {
  const out = { ...o };
  delete out[a];
  delete out[b];
  if (o[b] !== undefined) out[a] = o[b];
  if (o[a] !== undefined) out[b] = o[a];
  return out;
}

/** Keys like "me:<unit>" or "3:opponent" with the side swapped. */
const flipKeys = <T>(r: Record<string, T> | undefined) =>
  r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/^(me|opponent)(?=:)|(?<=:)(me|opponent)$/, (s) => other(s as Side)), v]));

function flipRound(r: RoundRecord): RoundRecord {
  const out: RoundRecord = { ...r, me: r.opponent, opponent: r.me };
  if (r.priority) out.priority = other(r.priority);
  if (r.first) out.first = other(r.first);
  return out;
}

export function flipState(s: GameState): GameState {
  const out: GameState = {
    ...s,
    attacker: other(s.attacker),
    firstThisRound: other(s.firstThisRound),
    activePlayer: other(s.activePlayer),
    cp: pair(s.cp),
    vp: pair(s.vp),
    fury: pair(s.fury),
    rage: pair(s.rage),
    tactics: s.opponentTactics ?? [],
    opponentTactics: s.tactics,
    units: flipKeys(s.units) ?? {},
  };
  if (s.underdog !== undefined) out.underdog = other(s.underdog);
  if (s.seizedInitiative !== undefined) out.seizedInitiative = other(s.seizedInitiative);
  if (s.scoredTurns) out.scoredTurns = flipKeys(s.scoredTurns);
  if (s.rounds) out.rounds = s.rounds.map(flipRound);
  if (s.clock) out.clock = { ...s.clock, me: s.clock.opponent, opponent: s.clock.me };
  if (s.used) out.used = flipKeys(s.used);
  return out;
}

/** The same game from the other side. Flipping twice gives the game back. */
export function flipGame(g: Game): Game {
  let out = swap(swap(swap(g, "myName", "opponentName"), "myFaction", "opponentFaction"), "myListId", "opponentListId");
  out = { ...out, myListId: out.myListId ?? "", opponentListId: out.opponentListId ?? "", state: flipState(g.state) };
  if (g.finished) {
    const c = g.finished.conclusion;
    out.finished = { ...g.finished, conclusion: c === "conceded-me" ? "conceded-opponent" : c === "conceded-opponent" ? "conceded-me" : c };
  }
  return out;
}
