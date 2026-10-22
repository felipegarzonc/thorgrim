// The club ladder's results: one record per shared game whose final result
// both players confirmed, kept in the club's space. A game joins the ladder
// when the second player confirms, and leaves it if its result changes or
// it is deleted (until both confirm again).

import { inSeason, seasonRanges, seasonRecap, type ClubResult, type Season } from "../shared/ladder.ts";
import { waitUntil } from "@vercel/functions";
import { blobs } from "./blobs.ts";
import { FeedError } from "./feed.ts";
import { clubMembers } from "./members.ts";
import { notify } from "./notices.ts";
import type { Game } from "../shared/types.ts";
import { currentUser } from "./context.ts";
import { bothConfirmed, gameLists, ladderSides, type OpenGame } from "./sharedGames.ts";
import { Collection, newId } from "./store.ts";

const results = new Collection<ClubResult>("results", "club/");

export const listResults = () => results.list();

/** Bring the game's ladder record in line with its confirmations. */
export async function syncResult(o: OpenGame): Promise<void> {
  if (!bothConfirmed(o)) {
    if (await results.get(o.game.id)) await results.delete(o.game.id);
    return;
  }
  const { ownerId, playerId } = ladderSides(o);
  const g: Game = o.game; // the creator's terms: "me" is the creator
  // gameLists gives [mine, theirs] from the signed-in player's side.
  let [mine, theirs] = await gameLists(o);
  if (o.role === "player") [mine, theirs] = [theirs, mine];
  const confirmedAt = Object.values(g.confirmations ?? {})
    .map((c) => c.at)
    .sort()
    .pop()!;
  await results.save({
    id: g.id,
    date: g.date ?? g.createdAt.slice(0, 10),
    battleplan: g.battleplan,
    conclusion: g.finished!.conclusion,
    players: [
      { id: ownerId!, name: g.myName || g.share?.ownerName || "Player 1", faction: mine?.faction || g.myFaction || "", vp: g.state.vp.me },
      { id: playerId!, name: g.opponentName || g.share?.players[0]?.name || "Player 2", faction: theirs?.faction || g.opponentFaction || "", vp: g.state.vp.opponent },
    ],
    confirmedAt,
  });
}

/** A result the organiser of a club event entered (no shared game behind it). */
export async function saveEventResult(r: ClubResult) {
  await results.save(r);
}

/** A deleted game leaves the ladder. */
export async function forgetResult(gameId: string) {
  if (await results.get(gameId)) await results.delete(gameId);
}

/** For the page: the ladder with the signed-in member's id, to find their row. */
export async function ladder() {
  const [results, seasons] = await Promise.all([listResults(), listSeasons()]);
  return { me: currentUser().id, results, seasons };
}

// ---------- seasons ----------

const SEASONS = "club/settings/seasons.json";

export async function listSeasons(): Promise<Season[]> {
  const raw = await blobs().read(SEASONS);
  return raw ? (JSON.parse(raw.toString("utf8")) as Season[]) : [];
}

/**
 * Start a new season today (admins). The season that ends gets its recap,
 * and every member hears who won it.
 */
export async function startSeason(name: string): Promise<Season[]> {
  const today = new Date().toISOString().slice(0, 10);
  const seasons = await listSeasons();
  if (seasons.some((s) => s.start === today)) throw new FeedError("A season already started today.");
  const clean = name.trim().slice(0, 60) || `Season ${seasons.length + 1}`;
  const ending = seasonRanges(seasons)[0];
  const next = [...seasons, { id: newId(), name: clean, start: today }];
  await blobs().write(SEASONS, JSON.stringify(next, null, 2), "application/json");
  const results = await listResults();
  const done = inSeason(results, ending ? { start: ending.start, end: today } : { start: "0000-00-00", end: today });
  const recap = seasonRecap(done);
  const members = (await clubMembers()).map((m) => m.id);
  const text = recap.champion
    ? `🏆 ${ending?.name ?? "The season"} is over: ${recap.champion.name} is champion with ${recap.champion.points} points! ${clean} starts now. See the recap in the Ladder.`
    : `${clean} starts now on the club ladder.`;
  waitUntil(notify(members, text, "#/club/ladder").catch(() => undefined));
  return next;
}
