import { useEffect, useMemo, useState } from "react";
import { PHASES, type Ability, type ArmyList, type Faction, type Game, type GameState, type Phase, type Unit } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { Card, RulesText, Stepper, useLoad, useMeta } from "../ui.tsx";
import { CoachChat } from "./CoachChat.tsx";
import { SetupFields } from "./Games.tsx";
import { WarscrollCard } from "./Lists.tsx";

type Side = "me" | "opponent";

const PHASE_MATCH: Record<Phase, RegExp> = {
  Deployment: /deployment/,
  "Start of Turn": /start of (the |any |your |enemy |)?(turn|battle round)/,
  Hero: /hero phase/,
  Movement: /movement phase/,
  Shooting: /shooting phase/,
  Charge: /charge phase/,
  Combat: /combat phase/,
  "End of Turn": /end of (the |any |your |enemy |)?(turn|battle round)/,
};

/** Is this ability usable by `owner` in `phase` while `active` is taking their turn? */
export function usableNow(a: Ability, phase: Phase, owner: Side, active: Side): boolean {
  if (!a.timing || a.kind === "Ability (Passive)") return false;
  const t = a.timing.toLowerCase();
  if (!PHASE_MATCH[phase].test(t)) return false;
  if (/\byour\b/.test(t)) return owner === active;
  if (/\benemy\b/.test(t)) return owner !== active;
  return true;
}

interface Source {
  owner: Side;
  from: string;
  ability: Ability;
}

function useUnits(lists: (ArmyList | undefined)[]) {
  const [units, setUnits] = useState<Record<string, Unit>>({});
  const ids = [...new Set(lists.flatMap((l) => l?.units.map((u) => u.unitId) ?? []))].sort().join(",");
  useEffect(() => {
    if (!ids) return;
    Promise.all(ids.split(",").map((id) => api<Unit>(`/units/${id}`))).then((us) => setUnits(Object.fromEntries(us.map((u) => [u.id, u]))));
  }, [ids]);
  return units;
}

export function GamePage({ id }: { id: string }) {
  const [game, setGame] = useState<Game>();
  const [lists] = useLoad<ArmyList[]>("/lists");
  const [tab, setTab] = useState<"play" | "coach" | "armies" | "setup">("play");

  useEffect(() => {
    api<Game>(`/games/${id}`).then(setGame);
  }, [id]);

  const myList = lists?.find((l) => l.id === game?.myListId);
  const oppList = lists?.find((l) => l.id === game?.opponentListId);
  const units = useUnits([myList, oppList]);
  const [myFaction] = useLoad<Faction>(myList ? `/factions/${encodeURIComponent(myList.faction)}` : null);
  const [oppFaction] = useLoad<Faction>(oppList ? `/factions/${encodeURIComponent(oppList.faction)}` : null);

  if (!game) return <p className="muted">Loading…</p>;

  const save = (g: Game) => {
    setGame(g);
    api(`/games/${g.id}`, { method: "PUT", json: g }).catch((e: Error) => alert(`Could not save: ${e.message}`));
  };
  const setState = (patch: Partial<GameState>) => save({ ...game, state: { ...game.state, ...patch } });

  return (
    <div className="stack">
      <div className="game-title">
        <h1>{game.name}</h1>
        <span className="muted">
          {myList?.faction ?? "?"} vs {oppList?.faction ?? "?"} · {game.battleplan || "battleplan not set"}
        </span>
      </div>
      <div className="tabs">
        {(["play", "coach", "armies", "setup"] as const).map((t) => (
          <button key={t} type="button" className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "play" ? "Play" : t === "coach" ? "Coach" : t === "armies" ? "Armies" : "Setup"}
          </button>
        ))}
      </div>

      {tab === "play" && (
        <>
          <Tracker game={game} setState={setState} />
          <PhaseChecklist game={game} myList={myList} oppList={oppList} units={units} myFaction={myFaction} oppFaction={oppFaction} />
          <TacticsCard state={game.state} setState={setState} />
          <UnitStatusCard game={game} myList={myList} oppList={oppList} units={units} setState={setState} />
          <LogCard game={game} onChange={setGame} />
        </>
      )}
      {tab === "coach" && (
        <CoachChat
          convoId={game.id}
          title="Coach"
          placeholder="e.g. Should I take the double turn? Who should my Stonehorn charge?"
          presets={[
            ["Pre-game brief", "pregame"],
            ["Post-game review", "review"],
          ]}
          quick={[
            "What should I do this phase?",
            "I won the priority roll. Should I go first or second?",
            "Which battle tactic objective should I go for this turn?",
            "What can my opponent do to punish me right now?",
          ]}
        />
      )}
      {tab === "armies" && (
        <>
          {[myList, oppList].map(
            (l) =>
              l && (
                <Card key={l.id} title={`${l.owner === "me" ? "My army" : "Opponent"}: ${l.name}`}>
                  <div className="stack">
                    {l.units.map((u) => (
                      <WarscrollCard key={u.key} unitId={u.unitId} title={`${u.name}${u.reinforced ? " (Reinforced)" : ""}`} notes={u.notes} />
                    ))}
                  </div>
                </Card>
              ),
          )}
        </>
      )}
      {tab === "setup" && (
        <Card title="Game setup">
          <SetupFields value={game} onChange={(v) => save({ ...game, ...v })} />
          <button
            type="button"
            onClick={async () => {
              if (!confirm("Delete this game and its coach conversation?")) return;
              await api(`/games/${game.id}`, { method: "DELETE" });
              window.location.hash = "#/games";
            }}
          >
            Delete game
          </button>
        </Card>
      )}
    </div>
  );
}

function Tracker({ game, setState }: { game: Game; setState: (p: Partial<GameState>) => void }) {
  const s = game.state;
  const other = (side: Side): Side => (side === "me" ? "opponent" : "me");
  const [askPriority, setAskPriority] = useState(false);

  const nextPhase = () => {
    const i = PHASES.indexOf(s.phase);
    if (s.phase === "Deployment" || i < PHASES.length - 1) return setState({ phase: PHASES[Math.max(1, i + 1)] });
    // End of turn: hand over, or start a new battle round.
    if (s.activePlayer === s.firstThisRound) setState({ activePlayer: other(s.activePlayer), phase: "Start of Turn" });
    else setAskPriority(true);
  };
  const startRound = (first: Side) => {
    setAskPriority(false);
    setState({
      round: s.round + 1,
      firstThisRound: first,
      activePlayer: first,
      phase: "Start of Turn",
      // Season rule (GHB 2026-27): gain rage dice equal to your fury level.
      rage: { me: s.fury.me, opponent: s.fury.opponent },
    });
  };
  const doubleTurnFor = s.firstThisRound === "me" ? "opponent" : "me";

  return (
    <Card title={`Round ${s.round} · ${s.activePlayer === "me" ? "My turn" : "Opponent's turn"}`}>
      <div className="phase-bar">
        {PHASES.map((p) => (
          <button key={p} type="button" className={p === s.phase ? "active" : ""} onClick={() => setState({ phase: p })}>
            {p}
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" className="primary" onClick={nextPhase}>
          Next phase →
        </button>
        <button type="button" onClick={() => setState({ activePlayer: other(s.activePlayer) })}>
          Switch active player
        </button>
      </div>
      {askPriority && (
        <div className="callout">
          <p>
            <strong>Battle round {s.round + 1}: who goes first?</strong> {doubleTurnFor === "me" ? "Going first gives you a double turn" : "Going first gives your opponent a double turn"}
            {" "}— the player who takes a double turn can't use a battle tactic that round. Ask the coach if unsure.
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={() => startRound("me")}>
              I go first
            </button>
            <button type="button" onClick={() => startRound("opponent")}>
              Opponent goes first
            </button>
            <button type="button" onClick={() => setAskPriority(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="score-grid">
        <div />
        <strong>Me</strong>
        <strong>Opp</strong>
        {(["vp", "cp", "fury", "rage"] as const).map((k) => (
          <ScoreRow key={k} label={k === "vp" ? "VP" : k === "cp" ? "CP" : k === "fury" ? "Fury" : "Rage dice"} value={s[k]} onChange={(v) => setState({ [k]: v })} />
        ))}
      </div>
      <label>
        Objectives
        <input value={s.objectives} onChange={(e) => setState({ objectives: e.target.value })} placeholder="e.g. I hold A and C, B contested, they hold D" />
      </label>
      <label>
        Board notes for the coach
        <textarea rows={2} value={s.notes} onChange={(e) => setState({ notes: e.target.value })} placeholder="Positions, distances, key threats…" />
      </label>
    </Card>
  );
}

function ScoreRow({ label, value, onChange }: { label: string; value: { me: number; opponent: number }; onChange: (v: { me: number; opponent: number }) => void }) {
  return (
    <>
      <span>{label}</span>
      <Stepper label="" value={value.me} onChange={(v) => onChange({ ...value, me: v })} />
      <Stepper label="" value={value.opponent} onChange={(v) => onChange({ ...value, opponent: v })} />
    </>
  );
}

function PhaseChecklist(props: {
  game: Game;
  myList?: ArmyList;
  oppList?: ArmyList;
  units: Record<string, Unit>;
  myFaction?: Faction;
  oppFaction?: Faction;
}) {
  const { game, myList, oppList, units, myFaction, oppFaction } = props;
  const s = game.state;
  const sources = useMemo(() => {
    const out: Source[] = [];
    const add = (owner: Side, list?: ArmyList, faction?: Faction) => {
      const seen = new Set<string>();
      for (const lu of list?.units ?? []) {
        const st = s.units[`${owner}:${lu.key}`];
        if (st?.destroyed || seen.has(lu.unitId)) continue;
        seen.add(lu.unitId);
        for (const a of units[lu.unitId]?.abilities ?? []) out.push({ owner, from: lu.name, ability: a });
      }
      for (const r of faction?.rules ?? []) {
        if (/battle traits/i.test(`${r.group} ${r.entry}`)) out.push({ owner, from: "Battle traits", ability: r.ability });
      }
    };
    add("me", myList, myFaction);
    add("opponent", oppList, oppFaction);
    return out;
  }, [myList, oppList, units, myFaction, oppFaction, s.units]);

  const now = sources.filter((x) => usableNow(x.ability, s.phase, x.owner, s.activePlayer));
  const reactions = sources.filter((x) => x.ability.timing?.toLowerCase().startsWith("reaction"));
  const mine = now.filter((x) => x.owner === "me");
  const theirs = now.filter((x) => x.owner === "opponent");

  const List = ({ items }: { items: Source[] }) =>
    items.length ? (
      <ul className="checklist">
        {items.map((x, i) => (
          <li key={i}>
            <details>
              <summary>
                <strong>{x.ability.name}</strong> <span className="muted">— {x.from}</span> <span className="timing">{x.ability.timing}</span>
              </summary>
              {x.ability.declare && <RulesText text={`*Declare:* ${x.ability.declare}`} />}
              <RulesText text={x.ability.effect} />
            </details>
          </li>
        ))}
      </ul>
    ) : (
      <p className="muted">Nothing specific.</p>
    );

  return (
    <Card title={`${s.phase}: don't forget`}>
      <h3>My abilities</h3>
      <List items={mine} />
      <h3>Opponent can use</h3>
      <List items={theirs} />
      {reactions.length > 0 && (
        <details>
          <summary>Reactions in play ({reactions.length})</summary>
          <List items={reactions} />
        </details>
      )}
      <p className="muted small">Core abilities (All-out Attack/Defence, Counter-charge, Covering Fire, Redeploy…) come from your core rules, not listed here.</p>
    </Card>
  );
}

function TacticsCard({ state, setState }: { state: GameState; setState: (p: Partial<GameState>) => void }) {
  const meta = useMeta();
  const [pick, setPick] = useState("");
  const add = () => {
    if (!pick || state.tactics.some((t) => t.card === pick)) return;
    setState({ tactics: [...state.tactics, { card: pick, affray: false, strike: false, domination: false }] });
    setPick("");
  };
  return (
    <Card title="My battle tactics">
      {state.tactics.map((t, i) => {
        const card = meta?.battleTactics.find((c) => c.name === t.card);
        const toggle = (k: "affray" | "strike" | "domination") =>
          setState({ tactics: state.tactics.map((x, j) => (j === i ? { ...x, [k]: !x[k] } : x)) });
        return (
          <div key={t.card} className="tactic">
            <div className="row spread">
              <strong>{t.card}</strong>
              <button type="button" className="small" onClick={() => setState({ tactics: state.tactics.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
            {card?.Card && <RulesText text={card.Card} />}
            {(["affray", "strike", "domination"] as const).map((k) => {
              const text = card?.[(k[0].toUpperCase() + k.slice(1)) as "Affray" | "Strike" | "Domination"];
              return (
                <label key={k} className="inline tactic-step">
                  <input type="checkbox" checked={t[k]} onChange={() => toggle(k)} />
                  <span>
                    <strong>{k[0].toUpperCase() + k.slice(1)}</strong>
                    {text && <RulesText text={text} />}
                  </span>
                </label>
              );
            })}
          </div>
        );
      })}
      {state.tactics.length < 2 && (
        <div className="row">
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Add a battle tactic card…</option>
            {meta?.battleTactics.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
          <button type="button" onClick={add} disabled={!pick}>
            Add
          </button>
        </div>
      )}
    </Card>
  );
}

function UnitStatusCard(props: { game: Game; myList?: ArmyList; oppList?: ArmyList; units: Record<string, Unit>; setState: (p: Partial<GameState>) => void }) {
  const { game, myList, oppList, units, setState } = props;
  const s = game.state;
  const update = (key: string, patch: Partial<{ damage: number; destroyed: boolean }>) =>
    setState({ units: { ...s.units, [key]: { ...(s.units[key] ?? { damage: 0, destroyed: false }), ...patch } } });
  const section = (owner: Side, list?: ArmyList) =>
    list && (
      <div>
        <h3>{owner === "me" ? "My units" : "Their units"}</h3>
        {list.units.map((lu) => {
          const key = `${owner}:${lu.key}`;
          const st = s.units[key] ?? { damage: 0, destroyed: false };
          const u = units[lu.unitId];
          const total = u?.stats ? Number(u.stats.health) * u.models * (lu.reinforced ? 2 : 1) : undefined;
          return (
            <div key={key} className={`unit-row ${st.destroyed ? "destroyed" : ""}`}>
              <span className="unit-name">
                {lu.name}
                {lu.reinforced ? " (R)" : ""}
                {total ? <span className="muted"> {Math.max(0, total - st.damage)}/{total}</span> : null}
              </span>
              <Stepper label="dmg" value={st.damage} onChange={(v) => update(key, { damage: v })} />
              <label className="inline">
                <input type="checkbox" checked={st.destroyed} onChange={(e) => update(key, { destroyed: e.target.checked })} /> dead
              </label>
            </div>
          );
        })}
      </div>
    );
  return (
    <Card title="Units">
      {section("me", myList)}
      {section("opponent", oppList)}
    </Card>
  );
}

function LogCard({ game, onChange }: { game: Game; onChange: (g: Game) => void }) {
  const [text, setText] = useState("");
  const add = async () => {
    if (!text.trim()) return;
    const prefix = `R${game.state.round} ${game.state.activePlayer === "me" ? "my" : "their"} ${game.state.phase}: `;
    onChange(await api<Game>(`/games/${game.id}/log`, { method: "POST", json: { text: prefix + text } }));
    setText("");
  };
  return (
    <Card title="Game log">
      <div className="row">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="What happened? e.g. Charge failed on a 7, lost Mournfangs" />
        <button type="button" onClick={add}>
          Log
        </button>
      </div>
      <ul className="log">
        {[...game.log].reverse().map((l, i) => (
          <li key={i}>{l.text}</li>
        ))}
      </ul>
    </Card>
  );
}
