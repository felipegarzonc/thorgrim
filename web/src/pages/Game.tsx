import { useEffect, useMemo, useState } from "react";
import { PHASES, type Ability, type ArmyList, type Faction, type Game, type GameState, type Phase, type Unit } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { Card, RulesText, Stepper, useLoad, useMeta } from "../ui.tsx";
import { BATTLE_ROUNDS, CORE_COMMANDS, SEASON_ABILITIES, SEIZE_EXCEPTION_LEAD, newBattleRound, usableBy } from "../../../shared/season.ts";
import { CoachChat } from "./CoachChat.tsx";
import { SetupFields } from "./Games.tsx";
import { WarscrollCard } from "./Lists.tsx";

type Side = "me" | "opponent";
type Tab = "play" | "coach" | "armies" | "setup";

const TABS: [Tab, string, string][] = [
  ["play", "Play", "M4 20V10l8-6 8 6v10z"],
  ["coach", "Coach", "M4 5h16v11H9l-5 4z"],
  ["armies", "Armies", "M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z"],
  ["setup", "Setup", "M4 7h10M18 7h2M4 17h4M12 17h8"],
];

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
  const [tab, setTab] = useState<Tab>("play");

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
      <nav className="tabs" aria-label="Game sections">
        {TABS.map(([t, label, icon]) => (
          <button key={t} type="button" className={tab === t ? "active" : ""} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={icon} />
            </svg>
            {label}
          </button>
        ))}
      </nav>

      {tab === "play" && (
        <>
          <Tracker game={game} setState={setState} onAsk={() => setTab("coach")} />
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

function Tracker({ game, setState, onAsk }: { game: Game; setState: (p: Partial<GameState>) => void; onAsk: () => void }) {
  const s = game.state;
  const other = (side: Side): Side => (side === "me" ? "opponent" : "me");
  const [askPriority, setAskPriority] = useState(false);
  const [editing, setEditing] = useState<StatEdit | null>(null);

  const nextPhase = () => {
    // Deployment over: pick who takes the first turn of round 1.
    if (s.phase === "Deployment") return setAskPriority(true);
    const i = PHASES.indexOf(s.phase);
    if (i < PHASES.length - 1) return setState({ phase: PHASES[i + 1] });
    // End of turn: hand over, or start a new battle round.
    if (s.activePlayer === s.firstThisRound) setState({ activePlayer: other(s.activePlayer), phase: "Start of Turn" });
    else setAskPriority(true);
  };
  const firstRound = s.phase === "Deployment";
  const gameOver = !firstRound && s.round >= BATTLE_ROUNDS;
  const startRound = (first: Side) => {
    setAskPriority(false);
    const r = firstRound ? { seized: null, underdog: null, cp: { me: 4, opponent: 4 } } : newBattleRound(s, first);
    setState({
      round: firstRound ? 1 : s.round + 1,
      firstThisRound: first,
      activePlayer: first,
      phase: "Start of Turn",
      underdog: r.underdog,
      seizedInitiative: r.seized,
      cp: r.cp,
      // Simmering Rage: rage dice equal to fury level; unspent ones are lost.
      rage: { me: s.fury.me, opponent: s.fury.opponent },
    });
  };
  const wentSecond = other(s.firstThisRound);
  const lead = (side: Side) => s.vp[other(side)] - s.vp[side];
  const seizeNote = (side: Side) =>
    firstRound || side !== wentSecond
      ? ""
      : lead(side) >= SEIZE_EXCEPTION_LEAD
        ? " (double turn, but trailing by 11+ VP so battle tactics still allowed)"
        : " — seizes the initiative: no battle tactics that turn, the other player becomes underdog";

  const phaseIndex = PHASES.indexOf(s.phase);
  const nextLabel =
    s.phase === "Deployment"
      ? "Start round 1"
      : phaseIndex < PHASES.length - 1
        ? `Next: ${PHASES[phaseIndex + 1]}`
        : s.activePlayer === s.firstThisRound
          ? `End turn → ${other(s.activePlayer) === "me" ? "my" : "their"} turn`
          : gameOver
            ? "End game"
            : `Start round ${s.round + 1}`;

  return (
    <Card>
      <div className="round-line">
        <span className="round">
          {firstRound ? "Deployment" : <>Round {s.round} <span>/ {BATTLE_ROUNDS}</span></>}
        </span>
        {!firstRound && (
          <button type="button" className={`pill ${s.activePlayer === "me" ? "" : "opponent"}`} style={{ minHeight: 0, border: 0 }} onClick={() => setState({ activePlayer: other(s.activePlayer) })} title="Switch active player">
            {s.activePlayer === "me" ? "MY TURN" : "THEIR TURN"}
          </button>
        )}
      </div>

      <div className="scoreboard">
        <SidePanel side="me" label="Me" s={s} setState={setState} editing={editing} onEdit={setEditing} />
        <SidePanel side="opponent" label="Opponent" s={s} setState={setState} editing={editing} onEdit={setEditing} />
      </div>
      {editing && (
        <div className="stat-editor">
          <span>
            {editing.side === "me" ? "My" : "Their"} {STAT_NAMES[editing.stat]}
          </span>
          <Stepper
            label=""
            value={s[editing.stat][editing.side]}
            onChange={(v) => setState({ [editing.stat]: { ...s[editing.stat], [editing.side]: Math.max(0, v) } })}
          />
          <button type="button" className="small" onClick={() => setEditing(null)}>
            Done
          </button>
        </div>
      )}
      {s.seizedInitiative && !firstRound && (
        <p className="small warning">{s.seizedInitiative === "me" ? "You" : "Your opponent"} seized the initiative: no battle tactics that turn.</p>
      )}

      <nav className="phase-strip" aria-label="Phases">
        {PHASES.filter((p) => p !== "Deployment" || firstRound).map((p) => {
          const i = PHASES.indexOf(p);
          const cls = i < phaseIndex ? "past" : i === phaseIndex ? "current" : "";
          return (
            <button key={p} type="button" className={cls} aria-current={i === phaseIndex ? "step" : undefined} onClick={() => setState({ phase: p })}>
              {p}
            </button>
          );
        })}
      </nav>
      <div className="turn-actions">
        <button type="button" className="primary next-btn" onClick={nextPhase}>
          {nextLabel} →
        </button>
        <button type="button" className="secondary" onClick={onAsk}>
          Ask coach
        </button>
      </div>
      {askPriority && gameOver && (
        <div className="callout">
          <p>
            <strong>Battle round {BATTLE_ROUNDS} is over: the game has ended.</strong> Final score {s.vp.me}–{s.vp.opponent}. Open the Coach tab for a post-game review.
          </p>
          <button type="button" onClick={() => setAskPriority(false)}>
            Close
          </button>
        </div>
      )}
      {askPriority && !gameOver && (
        <div className="callout">
          <p>
            <strong>{firstRound ? "Battle round 1: who takes the first turn?" : `Battle round ${s.round + 1}: who goes first?`}</strong>{" "}
            {firstRound ? "The player who finished deploying first decides." : "Priority roll winner decides (tie: whoever went first last round)."} CP will be set to 4 each, +1 for the underdog.
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={() => startRound("me")}>
              I go first{seizeNote("me")}
            </button>
            <button type="button" onClick={() => startRound("opponent")}>
              Opponent goes first{seizeNote("opponent")}
            </button>
            <button type="button" onClick={() => setAskPriority(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
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

type Stat = "cp" | "fury" | "rage";
type StatEdit = { side: Side; stat: Stat };
const STAT_NAMES: Record<Stat, string> = { cp: "command points", fury: "fury level", rage: "rage dice" };

/** One player's half of the scoreboard: big VP plus CP / Fury / Rage (tap one to edit it). */
function SidePanel(props: { side: Side; label: string; s: GameState; setState: (p: Partial<GameState>) => void; editing: StatEdit | null; onEdit: (e: StatEdit | null) => void }) {
  const { side, label, s, setState, editing, onEdit } = props;
  const setVp = (v: number) => setState({ vp: { ...s.vp, [side]: Math.max(0, v) } });
  const who = side === "me" ? "my" : "their";
  return (
    <div className={`side ${side}`}>
      <span className="side-label">
        {label}
        {s.underdog === side && s.phase !== "Deployment" && <span className="badge">Underdog</span>}
      </span>
      <div className="vp">
        <button type="button" aria-label={`Remove 1 from ${who} VP`} onClick={() => setVp(s.vp[side] - 1)}>
          −
        </button>
        <span className="vp-value" aria-live="polite">
          {s.vp[side]}
          <small> VP</small>
        </span>
        <button type="button" aria-label={`Add 1 to ${who} VP`} onClick={() => setVp(s.vp[side] + 1)}>
          +
        </button>
      </div>
      <div className="mini-stats">
        {(["cp", "fury", "rage"] as const).map((k) => {
          const active = editing?.side === side && editing.stat === k;
          return (
            <button
              key={k}
              type="button"
              className={`mini-stat ${active ? "active" : ""}`}
              aria-pressed={active}
              aria-label={`${who} ${STAT_NAMES[k]}: ${s[k][side]}. Tap to change.`}
              onClick={() => onEdit(active ? null : { side, stat: k })}
            >
              <span>{k === "cp" ? "CP" : k === "fury" ? "Fury" : "Rage"}</span>
              <b>{s[k][side]}</b>
            </button>
          );
        })}
      </div>
    </div>
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

  const commands = [...CORE_COMMANDS, ...SEASON_ABILITIES];
  const commandsFor = (o: Side) => commands.filter((c) => usableBy(c, s.phase, o, s.activePlayer) && (c.cost === 0 || c.cost <= s.cp[o]));

  const AbilityItem = ({ x }: { x: Source }) => (
    <li>
      <details>
        <summary>
          <span className="name">
            <b>{x.ability.name}</b>
            <span>
              {x.from} · {x.ability.timing}
            </span>
          </span>
          <span className={`who ${x.owner}`}>{x.owner === "me" ? "YOU" : "THEM"}</span>
        </summary>
        <div className="body">
          {x.ability.declare && <RulesText text={`*Declare:* ${x.ability.declare}`} />}
          <RulesText text={x.ability.effect} />
        </div>
      </details>
    </li>
  );
  const CommandItem = ({ c, o }: { c: (typeof commands)[number]; o: Side }) => (
    <li>
      <details>
        <summary>
          <span className="name">
            <b>{c.name}</b>
            <span>{c.cost > 0 ? "Command" : "Season ability"}</span>
          </span>
          <span className={`who ${o}`}>
            {o === "me" ? "YOU" : "THEM"}
            {c.cost > 0 ? ` · ${c.cost} CP` : ""}
          </span>
        </summary>
        <div className="body">{c.summary}</div>
      </details>
    </li>
  );

  return (
    <Card title={`${s.phase} — don't forget`}>
      <ul className="forget">
        {mine.map((x, i) => (
          <AbilityItem key={`m${i}`} x={x} />
        ))}
        {commandsFor("me").map((c) => (
          <CommandItem key={`mc${c.name}`} c={c} o="me" />
        ))}
        {(theirs.length > 0 || commandsFor("opponent").length > 0) && <hr className="divider" />}
        {theirs.map((x, i) => (
          <AbilityItem key={`t${i}`} x={x} />
        ))}
        {commandsFor("opponent").map((c) => (
          <CommandItem key={`tc${c.name}`} c={c} o="opponent" />
        ))}
      </ul>
      {reactions.length > 0 && (
        <details>
          <summary className="muted small" style={{ padding: "0.5rem 0", cursor: "pointer" }}>
            Reactions in play ({reactions.length})
          </summary>
          <ul className="forget">
            {reactions.map((x, i) => (
              <AbilityItem key={`r${i}`} x={x} />
            ))}
          </ul>
        </details>
      )}
      <p className="muted small">Commands you can't afford are hidden. Tap a line for details; command summaries are short versions of the General's Handbook rules.</p>
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
        const steps = ["affray", "strike", "domination"] as const;
        const nextStep = steps.find((k) => !t[k]);
        const cap = (k: string) => k[0].toUpperCase() + k.slice(1);
        // First line of each objective's text is its name, e.g. "Master of Arms:".
        const title = (k: (typeof steps)[number]) => card?.[cap(k) as "Affray" | "Strike" | "Domination"]?.split("\n")[0].replace(/:\s*$/, "");
        return (
          <div key={t.card} className="tactic">
            <div className="row spread" style={{ margin: 0 }}>
              <h2>{t.card}</h2>
              <span className="muted small">5 VP each</span>
            </div>
            <div className="tiles">
              {steps.map((k) => {
                const status = t[k] ? "done" : k === nextStep ? "next" : "locked";
                return (
                  <button
                    key={k}
                    type="button"
                    className={`tile ${status}`}
                    aria-pressed={t[k]}
                    disabled={status === "locked"}
                    onClick={() => toggle(k)}
                    title={status === "next" ? "Mark as completed" : t[k] ? "Undo" : "Complete the earlier objective first"}
                  >
                    <b>{cap(k)}</b>
                    <span>{t[k] ? "Done" : status === "locked" ? "Locked" : (title(k) ?? "Next")}</span>
                  </button>
                );
              })}
            </div>
            <details>
              <summary className="muted small" style={{ cursor: "pointer" }}>
                Card rules
              </summary>
              {card?.Card && <RulesText text={card.Card} />}
              {steps.map((k) => {
                const text = card?.[cap(k) as "Affray" | "Strike" | "Domination"];
                return text ? <RulesText key={k} text={`**${cap(k)}** — ${text}`} /> : null;
              })}
              <button type="button" className="small" onClick={() => setState({ tactics: state.tactics.filter((_, j) => j !== i) })}>
                Remove card
              </button>
            </details>
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
              <div className="unit-main">
                <div className="unit-top">
                  <span>
                    {lu.name}
                    {lu.reinforced ? " (R)" : ""}
                  </span>
                  {total ? <span className="muted">{st.destroyed ? 0 : Math.max(0, total - st.damage)} / {total}</span> : null}
                </div>
                {total ? (
                  <div className={`hp ${owner}`} aria-hidden="true">
                    <div style={{ width: `${st.destroyed ? 0 : Math.max(0, ((total - st.damage) / total) * 100)}%` }} />
                  </div>
                ) : null}
              </div>
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
