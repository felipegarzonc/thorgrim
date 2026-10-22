// The club ladder's results: one record per shared game whose final result
// both players confirmed, kept in the club's space. A game joins the ladder
// when the second player confirms, and leaves it if its result changes or
// it is deleted (until both confirm again).

import type { ClubResult } from "../shared/ladder.ts";
import type { Game } from "../shared/types.ts";
import { currentUser } from "./context.ts";
import { bothConfirmed, gameLists, ladderSides, type OpenGame } from "./sharedGames.ts";
import { Collection } from "./store.ts";

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
  return { me: currentUser().id, results: await listResults() };
}
