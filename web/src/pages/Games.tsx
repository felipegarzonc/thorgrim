import { useState } from "react";
import type { ArmyList, Game } from "../../../shared/types.ts";
import { GameCard, sideInfo } from "../gameView.tsx";
import { Icon, useLoad } from "../ui.tsx";
import { newGame } from "./Home.tsx";

export function GamesPage() {
  const [games] = useLoad<Game[]>("/games");
  const [lists] = useLoad<ArmyList[]>("/lists");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const q = query.trim().toLowerCase();
  const shown = (games ?? [])
    .filter((g) => {
      if (!q) return true;
      const me = sideInfo(g, lists, "me");
      const opp = sideInfo(g, lists, "opponent");
      return [g.name, g.battleplan, me.faction, opp.faction, opp.name].join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => (b.date ?? b.createdAt).localeCompare(a.date ?? a.createdAt) || b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Games</h1>
        <button type="button" className="icon" aria-label="Search games" aria-pressed={searching} onClick={() => setSearching(!searching)}>
          <Icon name="search" />
        </button>
      </div>
      {searching && <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Faction, opponent, battleplan…" aria-label="Search games" />}
      {games && !games.length && <p className="muted">No games yet. Tap + to start one.</p>}
      {shown.map((g) => (
        <GameCard key={g.id} game={g} lists={lists} />
      ))}
      <button type="button" className="fab" aria-label="New game" onClick={newGame}>
        <Icon name="plus" />
      </button>
    </div>
  );
}
