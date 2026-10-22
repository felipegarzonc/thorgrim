import { useState } from "react";
import type { ArmyList, Game } from "../../../shared/types.ts";
import { GameCard, sideInfo } from "../gameView.tsx";
import { api } from "../api.ts";
import { Icon, useLoad } from "../ui.tsx";
import { newGame } from "./Home.tsx";

export function GamesPage() {
  const [games, reload] = useLoad<Game[]>("/games");
  const [lists] = useLoad<ArmyList[]>("/lists");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setPicked((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const removePicked = async () => {
    if (!picked.size || !confirm(`Delete ${picked.size} game${picked.size > 1 ? "s" : ""}? This can't be undone.`)) return;
    setBusy(true);
    for (const id of picked) await api(`/games/${id}`, { method: "DELETE" }).catch(() => undefined);
    setBusy(false);
    setPicked(new Set());
    setSelecting(false);
    reload();
  };

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
    <div className="stack rise">
      <div className="page-head">
        <h1 className="grow">Games</h1>
        {!!games?.length && (
          <button type="button" className="small ghost accent" aria-pressed={selecting} onClick={() => (setSelecting(!selecting), setPicked(new Set()))}>
            {selecting ? "Done" : "Select"}
          </button>
        )}
        <button type="button" className="icon" aria-label="Search games" aria-pressed={searching} onClick={() => setSearching(!searching)}>
          <Icon name="search" />
        </button>
      </div>
      {selecting && (
        <div className="select-bar">
          <span className="grow">{picked.size ? `${picked.size} selected` : "Tap the games to delete"}</span>
          <button type="button" className="danger" disabled={!picked.size || busy} onClick={removePicked}>
            <Icon name="trash" /> {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}
      {searching && <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Faction, opponent, battleplan…" aria-label="Search games" />}
      {games && !games.length && <p className="muted">No games yet. Tap + to start one.</p>}
      {shown.map((g) =>
        selecting ? (
          <button key={g.id} type="button" className={`pick-game ${picked.has(g.id) ? "on" : ""}`} aria-pressed={picked.has(g.id)} onClick={() => toggle(g.id)}>
            <span className="pick-check" aria-hidden="true">
              {picked.has(g.id) && <Icon name="check" />}
            </span>
            <GameCard game={g} lists={lists} link={false} />
          </button>
        ) : (
          <GameCard key={g.id} game={g} lists={lists} />
        ),
      )}
      {!selecting && (
        <button type="button" className="fab" aria-label="New game" onClick={newGame}>
          <Icon name="plus" />
        </button>
      )}
    </div>
  );
}
