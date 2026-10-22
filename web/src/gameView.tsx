// How a game shows up in lists: names, factions, score and result.

import { baseFaction } from "../../shared/season.ts";
import { result } from "../../shared/scoring.ts";
import type { ArmyList, Game } from "../../shared/types.ts";
import { gamePhotoUrl } from "./pages/report.tsx";
import { Avatar } from "./ui.tsx";

export type Side = "me" | "opponent";

export function sideInfo(game: Game, lists: ArmyList[] | undefined, side: Side) {
  const list = lists?.find((l) => l.id === (side === "me" ? game.myListId : game.opponentListId));
  const faction = list?.faction || (side === "me" ? game.myFaction : game.opponentFaction) || "";
  const name = (side === "me" ? game.myName : game.opponentName) || (side === "me" ? "You" : "Opponent");
  return { list, faction, name, base: faction ? baseFaction(faction) : "Unknown faction", sub: faction.includes(" - ") ? faction.split(" - ").slice(1).join(" - ") : "" };
}

export const gameDate = (g: Game) =>
  new Date(`${g.date ?? g.createdAt.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

export function statusOf(game: Game): { label: string; tone: "win" | "loss" | "draw" | "live" } {
  const r = result(game);
  if (r === "win") return { label: "VICTORY", tone: "win" };
  if (r === "loss") return { label: "DEFEAT", tone: "loss" };
  if (r === "draw") return { label: "DRAW", tone: "draw" };
  const started = (game.state.rounds?.length ?? 0) > 0 && game.state.phase !== "Deployment";
  return { label: started ? `ROUND ${game.state.round}` : "SETUP", tone: "live" };
}

/** Where to open a game: results when finished, the current round when playing, else setup. */
export function gameHref(game: Game) {
  if (game.finished) return `#/games/${game.id}/results`;
  if ((game.state.rounds?.length ?? 0) > 0 && game.state.phase !== "Deployment") return `#/games/${game.id}/round-${game.state.round}`;
  return `#/games/${game.id}`;
}

export function GameCard({ game, lists, actions, link = true }: { game: Game; lists?: ArmyList[]; actions?: React.ReactNode; link?: boolean }) {
  const me = sideInfo(game, lists, "me");
  const opp = sideInfo(game, lists, "opponent");
  const status = statusOf(game);
  const photo = game.report?.photos[0] ?? game.state.tablePhoto?.path;
  const body = (
    <>
    {photo && (
      <div className="gc-photo">
        <img src={gamePhotoUrl(game.id, photo)} alt="" loading="lazy" />
        {game.report?.title && <span className="gc-photo-title">{game.report.title}</span>}
      </div>
    )}
    <div className="game-card-body">
      <div className="gc-side">
        <span className="muted gc-date">{gameDate(game)}</span>
        <Avatar faction={me.faction} size={1.9} />
        <b className="gc-name">{me.name}</b>
        <span className="gc-faction">{me.base}</span>
        {me.sub && <small className="muted">{me.sub}</small>}
      </div>
      <div className="gc-score">
        <span className="big-score">
          {game.state.vp.me}-{game.state.vp.opponent}
        </span>
        <span className={`gc-status ${status.tone} ${status.label === "SETUP" ? "setup" : ""}`}>{status.label}</span>
      </div>
      <div className="gc-side right">
        <span className="muted gc-date">{game.access?.role === "player" ? `Shared by ${game.access.ownerName || opp.name}` : game.access?.players.length ? "Shared game" : "\u00a0"}</span>
        <Avatar faction={opp.faction} size={1.9} />
        <b className="gc-name">{opp.name}</b>
        <span className="gc-faction">{opp.base}</span>
        {opp.sub && <small className="muted">{opp.sub}</small>}
      </div>
    </div>
    </>
  );
  return (
    <article className="game-card">
      {actions || !link ? body : <a href={gameHref(game)}>{body}</a>}
      {actions && <div className="gc-actions">{actions}</div>}
    </article>
  );
}
