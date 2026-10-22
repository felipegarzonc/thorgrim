import { useState } from "react";
import { listPoints, type ArmyList, type Unit } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { Avatar, Card, RulesText, useLoad, useMeta } from "../ui.tsx";

type Parsed = Pick<ArmyList, "faction" | "units" | "unmatched" | "tacticCards">;

export function ListsPage({ selectedId }: { selectedId?: string }) {
  const [lists, reload] = useLoad<ArmyList[]>("/lists");
  const selected = lists?.find((l) => l.id === selectedId);
  return (
    <div className="stack">
      {selected && <ListView list={selected} onDeleted={reload} />}
      <Card title="Saved lists">
        {!lists?.length && <p className="muted">No lists yet. Paste your list and your opponent's list above.</p>}
        <ul className="rows">
          {lists?.map((l) => (
            <li key={l.id} className="list-entry">
              <Avatar faction={l.faction} size={2} />
              <a href={`#/lists/${l.id}`}>
                <strong>{l.name}</strong>
              </a>
              <span className={`tag ${l.owner}`}>{l.owner === "me" ? "Mine" : "Opponent"}</span>
              <span className="muted">
                {l.faction || "faction?"} · {l.units.length} units · {listPoints(l)} pts
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {!selected && <ListForm onSaved={reload} />}
    </div>
  );
}

function ListForm({ onSaved }: { onSaved: () => void }) {
  const meta = useMeta();
  const [name, setName] = useState("");
  const [owner, setOwner] = useState<"me" | "opponent">("me");
  const [faction, setFaction] = useState("");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Parsed>();
  const [busy, setBusy] = useState(false);

  const parse = async () => setParsed(await api<Parsed>("/lists/parse", { method: "POST", json: { text, faction } }));
  const save = async () => {
    setBusy(true);
    try {
      const list = await api<ArmyList>("/lists", { method: "POST", json: { name, owner, faction: faction || parsed?.faction, rawText: text } });
      setText("");
      setName("");
      setParsed(undefined);
      onSaved();
      window.location.hash = `#/lists/${list.id}`;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add an army list">
      <p className="muted">Paste a list exported from the Warhammer AoS app, New Recruit, or copied from Listhammer.</p>
      <div className="grid2">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Stonehorn Beastclaw 2k" />
        </label>
        <label>
          Whose list
          <select value={owner} onChange={(e) => setOwner(e.target.value as "me" | "opponent")}>
            <option value="me">Mine</option>
            <option value="opponent">Opponent</option>
          </select>
        </label>
        <label>
          Faction (auto-detected if blank)
          <select value={faction} onChange={(e) => setFaction(e.target.value)}>
            <option value="">Auto-detect</option>
            {meta?.factions.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        List text
        <textarea data-gramm="false" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Frostlord on Stonehorn (340)\n• General\nMournfang Pack (200)\n• Reinforced\n…"} />
      </label>
      <div className="row">
        <button type="button" onClick={parse} disabled={!text.trim()}>
          Check list
        </button>
        <button type="button" className="primary" onClick={save} disabled={!text.trim() || busy}>
          Save list
        </button>
      </div>
      {parsed && (
        <div className="parsed">
          <p>
            Faction: <strong>{parsed.faction || "not detected — pick one above"}</strong>
          </p>
          <ul>
            {parsed.units.map((u) => (
              <li key={u.key}>
                {u.name}
                {u.reinforced ? " (Reinforced)" : ""} {u.points ? <span className="muted">{u.points} pts</span> : null}
                {u.notes.length > 0 && <span className="muted"> — {u.notes.join(", ")}</span>}
              </li>
            ))}
          </ul>
          {parsed.tacticCards && parsed.tacticCards.length > 0 && <p>Battle tactic cards: <strong>{parsed.tacticCards.join(", ")}</strong></p>}
          {parsed.unmatched.length > 0 && <p className="warning">Not recognised: {parsed.unmatched.join(" · ")}</p>}
        </div>
      )}
    </Card>
  );
}

function ListView({ list, onDeleted }: { list: ArmyList; onDeleted: () => void }) {
  const remove = async () => {
    if (!confirm(`Delete ${list.name}?`)) return;
    await api(`/lists/${list.id}`, { method: "DELETE" });
    onDeleted();
    window.location.hash = "#/lists";
  };
  return (
    <Card
      title={list.name}
      actions={
        <>
          <a className="button" href="#/lists">
            New list
          </a>
          <button type="button" onClick={remove}>
            Delete
          </button>
        </>
      }
    >
      <p className="muted">
        {list.owner === "me" ? "My list" : "Opponent list"} · {list.faction}{list.formation ? ` · ${list.formation.name}${list.formation.points ? ` (${list.formation.points} pts)` : ""}` : ""} · {listPoints(list)} pts
        {list.tacticCards?.length ? ` · Tactics: ${list.tacticCards.join(", ")}` : ""}
      </p>
      {list.unmatched.length > 0 && <p className="warning">Not recognised: {list.unmatched.join(" · ")}</p>}
      <div className="stack">
        {list.units.map((u) => (
          <WarscrollCard key={u.key} unitId={u.unitId} title={`${u.name}${u.reinforced ? " (Reinforced)" : ""}`} notes={u.notes} />
        ))}
      </div>
    </Card>
  );
}

export function WarscrollCard({ unitId, title, notes = [] }: { unitId: string; title: string; notes?: string[] }) {
  const [open, setOpen] = useState(false);
  const [unit] = useLoad<Unit>(open ? `/units/${unitId}` : null);
  return (
    <details className="warscroll" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <strong>{title}</strong>
        {notes.length > 0 && <span className="muted"> — {notes.join(", ")}</span>}
      </summary>
      {unit && (
        <div>
          {unit.stats && (
            <div className="statline">
              <span>Move {unit.stats.move}</span>
              <span>Health {unit.stats.health}</span>
              <span>Save {unit.stats.save}</span>
              <span>Control {unit.stats.control}</span>
              {unit.stats.ward && <span>Ward {unit.stats.ward}</span>}
              <span>Models {unit.models}</span>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Weapon</th>
                  <th>Rng</th>
                  <th>Atk</th>
                  <th>Hit</th>
                  <th>Wnd</th>
                  <th>Rnd</th>
                  <th>Dmg</th>
                  <th>Ability</th>
                </tr>
              </thead>
              <tbody>
                {unit.weapons.map((w) => (
                  <tr key={w.name}>
                    <td>{w.name}</td>
                    <td>{w.range ?? "melee"}</td>
                    <td>{w.attacks}</td>
                    <td>{w.hit}</td>
                    <td>{w.wound}</td>
                    <td>{w.rend}</td>
                    <td>{w.damage}</td>
                    <td>{w.ability}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unit.abilities.map((a) => (
            <div key={a.name} className="ability">
              <strong>{a.name}</strong> {a.timing && <span className="timing">{a.timing}</span>}
              {a.declare && <RulesText text={`*Declare:* ${a.declare}`} />}
              <RulesText text={a.effect} />
            </div>
          ))}
          <p className="muted">Keywords: {unit.keywords.join(", ")}</p>
        </div>
      )}
    </details>
  );
}
