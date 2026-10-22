// Club nights and tournaments. Members sign up; the organiser pairs each
// round (round 1 at random, later rounds by standing with no rematches, an
// odd player out gets a bye). A table's result comes from its game once both
// players confirmed it (the club ladder's results), or from the organiser.

export interface ClubEvent {
  id: string;
  kind: "night" | "tournament";
  name: string;
  /** YYYY-MM-DD */
  date: string;
  /** "19:00" */
  time?: string;
  place?: string;
  notes?: string;
  points: number;
  /** Rounds planned (tournaments). */
  rounds?: number;
  organiser: { id: string; name: string };
  createdAt: string;
  players: { id: string; name: string; faction?: string }[];
  pairings: EventRound[];
  finishedAt?: string;
}

export interface EventRound {
  round: number;
  tables: EventTable[];
}

export interface EventTable {
  /** Player ids; b is null for a bye. */
  a: string;
  b: string | null;
  /** The shared game the two play, once started (it lives in a's space). */
  gameId?: string;
  /** A result the organiser entered (a game played on paper, a no-show). */
  manual?: { a: number; b: number };
}

/** A table's final score, a's side first, when it is known. */
export type TableResult = { a: number; b: number };

export interface EventStanding {
  id: string;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  /** Win 3, draw 1, bye 3. */
  points: number;
  vpFor: number;
  vpAgainst: number;
  opponents: string[];
  byes: number;
}

/** The standings after the results known so far. */
export function eventStandings(e: Pick<ClubEvent, "players" | "pairings">, resultOf: (t: EventTable) => TableResult | undefined): EventStanding[] {
  const by = new Map<string, EventStanding>(
    e.players.map((p) => [p.id, { id: p.id, name: p.name, played: 0, won: 0, drawn: 0, lost: 0, points: 0, vpFor: 0, vpAgainst: 0, opponents: [], byes: 0 }]),
  );
  for (const r of e.pairings) {
    for (const t of r.tables) {
      const a = by.get(t.a);
      if (!a) continue;
      if (t.b === null) {
        a.byes++;
        a.points += 3;
        continue;
      }
      const b = by.get(t.b);
      if (!b) continue;
      a.opponents.push(b.id);
      b.opponents.push(a.id);
      const res = resultOf(t);
      if (!res) continue;
      for (const [me, them, mine, theirs] of [
        [a, b, res.a, res.b],
        [b, a, res.b, res.a],
      ] as const) {
        me.played++;
        me.vpFor += mine;
        me.vpAgainst += theirs;
        if (mine > theirs) me.won++;
        else if (mine < theirs) me.lost++;
        else me.drawn++;
        me.points = (me.won + me.byes) * 3 + me.drawn;
        void them;
      }
    }
  }
  return [...by.values()].sort(
    (x, y) => y.points - x.points || y.vpFor - y.vpAgainst - (x.vpFor - x.vpAgainst) || y.vpFor - x.vpFor || x.name.localeCompare(y.name),
  );
}

/**
 * The next round's tables. Round 1 is shuffled; later rounds go down the
 * standings pairing each player with the next one they haven't played yet.
 * With an odd number, the lowest player without a bye sits out (a bye).
 */
export function pairNextRound(standing: EventStanding[], round: number, random: () => number = Math.random): EventTable[] {
  let pool = [...standing];
  if (round === 1) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  const tables: EventTable[] = [];
  if (pool.length % 2) {
    const sitOut = [...pool].reverse().find((p) => !p.byes) ?? pool[pool.length - 1];
    pool = pool.filter((p) => p !== sitOut);
    tables.push({ a: sitOut.id, b: null });
  }
  const paired = pairUp(pool) ?? greedy(pool);
  return [...paired, ...tables];
}

/** Pair down the list with no rematches (backtracking), or undefined when that can't be done. */
function pairUp(pool: EventStanding[]): EventTable[] | undefined {
  if (!pool.length) return [];
  const [first, ...rest] = pool;
  for (let i = 0; i < rest.length; i++) {
    if (first.opponents.includes(rest[i].id)) continue;
    const after = pairUp(rest.filter((_, j) => j !== i));
    if (after) return [{ a: first.id, b: rest[i].id }, ...after];
  }
  return undefined;
}

/** Everyone has played everyone: just pair neighbours. */
const greedy = (pool: EventStanding[]): EventTable[] =>
  Array.from({ length: pool.length / 2 }, (_, i) => ({ a: pool[2 * i].id, b: pool[2 * i + 1].id }));
