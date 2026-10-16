import { useState } from "react";
import type { ArmyList, Game, LibraryDoc } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { Card, useLoad } from "../ui.tsx";

export function GamesPage() {
  const [games] = useLoad<Game[]>("/games");
  return (
    <div className="stack">
      <NewGame />
      <Card title="Games">
        {!games?.length && <p className="muted">No games yet.</p>}
        <ul className="rows">
          {games?.map((g) => (
            <li key={g.id}>
              <a href={`#/games/${g.id}`}>
                <strong>{g.name}</strong>
              </a>
              <span className="muted">
                {g.battleplan || "no battleplan"} · Round {g.state.round} · VP {g.state.vp.me}–{g.state.vp.opponent} · {g.createdAt.slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function SetupFields({
  value,
  onChange,
}: {
  value: Pick<Game, "name" | "myListId" | "opponentListId" | "battleplan" | "battleplanNotes" | "references">;
  onChange: (v: Partial<Game>) => void;
}) {
  const [lists] = useLoad<ArmyList[]>("/lists");
  const [docs] = useLoad<LibraryDoc[]>("/library");
  const refFor = (id: string) => value.references.find((r) => r.docId === id);
  const toggleRef = (id: string, on: boolean) =>
    onChange({ references: on ? [...value.references, { docId: id }] : value.references.filter((r) => r.docId !== id) });
  const setPages = (id: string, pages: string) => onChange({ references: value.references.map((r) => (r.docId === id ? { ...r, pages } : r)) });

  return (
    <>
      <div className="grid2">
        <label>
          Game name
          <input value={value.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Club night vs Skaven" />
        </label>
        <label>
          My list
          <select value={value.myListId} onChange={(e) => onChange({ myListId: e.target.value })}>
            <option value="">—</option>
            {lists?.filter((l) => l.owner === "me").map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.faction})
              </option>
            ))}
          </select>
        </label>
        <label>
          Opponent list
          <select value={value.opponentListId} onChange={(e) => onChange({ opponentListId: e.target.value })}>
            <option value="">—</option>
            {lists?.filter((l) => l.owner === "opponent").map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.faction})
              </option>
            ))}
          </select>
        </label>
        <label>
          Battleplan
          <input value={value.battleplan} onChange={(e) => onChange({ battleplan: e.target.value })} placeholder="Name of the battleplan" />
        </label>
      </div>
      <label>
        Battleplan & map notes
        <textarea
          rows={3}
          value={value.battleplanNotes}
          onChange={(e) => onChange({ battleplanNotes: e.target.value })}
          placeholder="Deployment, objectives, special rules, terrain layout…"
        />
      </label>
      {docs && docs.length > 0 && (
        <fieldset>
          <legend>Rules & maps for this game (battleplan pages, map images)</legend>
          {docs.map((d) => {
            const ref = refFor(d.id);
            return (
              <div key={d.id} className="ref-row">
                <label className="inline">
                  <input type="checkbox" checked={!!ref} onChange={(e) => toggleRef(d.id, e.target.checked)} /> {d.title}{" "}
                  <span className="muted">({d.kind === "pdf" ? `${d.pages} p.` : d.kind})</span>
                </label>
                {ref && d.kind === "pdf" && (
                  <input className="pages" value={ref.pages ?? ""} onChange={(e) => setPages(d.id, e.target.value)} placeholder="pages e.g. 42-43" />
                )}
              </div>
            );
          })}
        </fieldset>
      )}
    </>
  );
}

function NewGame() {
  const [setup, setSetup] = useState({ name: "", myListId: "", opponentListId: "", battleplan: "", battleplanNotes: "", references: [] as Game["references"] });
  const [attacker, setAttacker] = useState<"me" | "opponent">("me");
  const create = async () => {
    const g = await api<Game>("/games", { method: "POST", json: { ...setup, attacker } });
    window.location.hash = `#/games/${g.id}`;
  };
  return (
    <Card title="New game">
      <SetupFields value={setup} onChange={(v) => setSetup({ ...setup, ...v })} />
      <label>
        Attacker
        <select value={attacker} onChange={(e) => setAttacker(e.target.value as "me" | "opponent")}>
          <option value="me">Me</option>
          <option value="opponent">Opponent</option>
        </select>
      </label>
      <button type="button" className="primary" onClick={create} disabled={!setup.myListId}>
        Start game
      </button>
    </Card>
  );
}
