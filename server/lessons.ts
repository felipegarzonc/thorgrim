// What the coach remembers between games: the "one thing to try next game"
// from the player's own post-game reviews (stored with each game, see
// GameReview), with where the points went. The coach reads them before every
// plan and answer, the ones against the same army first.

import type { Game } from "../shared/types.ts";
import { baseFaction } from "../shared/season.ts";
import { currentUser } from "./context.ts";
import { myGames } from "./sharedGames.ts";

/** At most this many lessons, and this many from other matchups. */
const MAX = 6;
const MAX_OTHER = 3;

const when = (g: Game) => g.date || g.finished?.at.slice(0, 10) || g.createdAt.slice(0, 10);

/** The lessons for the `current` game (left out itself), as dossier text; empty without any reviewed games. */
export function lessonsFrom(games: Game[], current?: Pick<Game, "id" | "opponentFaction">): string {
  const reviewed = games
    .filter((g) => g.review?.tryNext && g.id !== current?.id)
    .sort((a, b) => when(b).localeCompare(when(a)) || b.createdAt.localeCompare(a.createdAt));
  if (!reviewed.length) return "";
  const against = current?.opponentFaction ? baseFaction(current.opponentFaction) : "";
  const same = against ? reviewed.filter((g) => g.opponentFaction && baseFaction(g.opponentFaction) === against) : [];
  const picked = [...same.slice(0, MAX), ...reviewed.filter((g) => !same.includes(g)).slice(0, Math.min(MAX_OTHER, MAX - same.length))];
  const line = (g: Game) => {
    const { me, opponent } = g.state.vp;
    const result = me > opponent ? "won" : me < opponent ? "lost" : "drew";
    const who = [g.opponentName, g.opponentFaction && baseFaction(g.opponentFaction)].filter(Boolean).join(", ") || "an opponent";
    const r = g.review!;
    return `- ${when(g)}, ${g.myFaction ? `${baseFaction(g.myFaction)} ` : ""}vs ${who}: ${result} ${me}-${opponent}. Try next: ${r.tryNext}${r.lost.length ? ` (Points went: ${r.lost.join(" ")})` : ""}`;
  };
  return [
    "## Lessons from my earlier games (from your post-game reviews, newest first)",
    "Hold me to these where they fit this game: in a brief or game plan, name the ones that matter for this matchup. Don't repeat the list back to me.",
    ...picked.map(line),
  ].join("\n");
}

// Reading every game is slow online, so each player's games are kept for a minute.
const cache = new Map<string, { at: number; games: Promise<Game[]> }>();
const TTL = 60_000;

/** The signed-in player's lessons for a game (or a chat) against `opponentFaction`. */
export async function lessonsFor(gameId?: string, opponentFaction?: string): Promise<string> {
  const me = currentUser();
  const user = `${me.id}|${me.prefix}`;
  let hit = cache.get(user);
  if (!hit || Date.now() - hit.at > TTL) {
    hit = { at: Date.now(), games: myGames() };
    cache.set(user, hit);
    hit.games.catch(() => cache.delete(user));
  }
  return lessonsFrom(await hit.games, { id: gameId ?? "", opponentFaction });
}
