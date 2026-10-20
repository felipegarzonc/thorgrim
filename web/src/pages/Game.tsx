import { useEffect, useMemo, useState } from "react";
import type { AttackProfile, Crit, SimulationResult } from "../../../engine/dice.ts";
import {
  BATTLE_ROUNDS,
  CORE_COMMANDS,
  newBattleRound,
  scoringFor,
  SEASON_ABILITIES,
  SEIZE_EXCEPTION_LEAD,
  TACTIC_STEPS,
  TACTIC_VP,
  usableBy,
} from "../../../shared/season.ts";
import { PHASES, type Ability, type ArmyList, type FactionRule, type Game, type GameState, type ListUnit, type Phase, type TacticProgress, type Unit } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { Card, RulesText, useLoad, useMeta } from "../ui.tsx";
import { CoachChat } from "./CoachChat.tsx";
import { SetupFields } from "./Games.tsx";
import { WarscrollCard } from "./Lists.tsx";

type Side = "me" | "opponent";
type Tab = "play" | "coach" | "armies" | "setup";
type Update = (patch: Partial<GameState>, log?: string) => void;

const other = (s: Side): Side => (s === "me" ? "opponent" : "me");
const sideName = (s: Side) => (s === "me" ? "me" : "them");

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
  if (!a.timing || a.kind === "Ability (Passive)" || a.kind === "Rule") return false;
  const t = a.timing.toLowerCase();
  if (!PHASE_MATCH[phase].test(t)) return false;
  if (/\byour\b/.test(t)) return owner === active;
  if (/\benemy\b/.test(t)) return owner !== active;
  return true;
}

// ---------- data hooks ----------

function useUnits(lists: (ArmyList | undefined)[]) {
  const [units, setUnits] = useState<Record<string, Unit>>({});
  const ids = [...new Set(lists.flatMap((l) => l?.units.map((u) => u.unitId) ?? []))].sort().join(",");
  useEffect(() => {
    if (!ids) return;
    Promise.all(ids.split(",").map((id) => api<Unit>(`/units/${id}`))).then((us) => setUnits(Object.fromEntries(us.map((u) => [u.id, u]))));
  }, [ids]);
  return units;
}

/** Total health of a list unit (doubled models when reinforced). */
function unitHealth(lu: ListUnit, u?: Unit) {
  if (!u?.stats) return undefined;
  const h = Number(u.stats.health);
  return Number.isFinite(h) ? h * u.models * (lu.reinforced ? 2 : 1) : undefined;
}

interface Army {
  side: Side;
  list?: ArmyList;
  rules: FactionRule[];
}

// ---------- page ----------

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
  const [myRules] = useLoad<FactionRule[]>(myList ? `/lists/${myList.id}/rules` : null);
  const [oppRules] = useLoad<FactionRule[]>(oppList ? `/lists/${oppList.id}/rules` : null);

  if (!game) return <p className="muted">Loading…</p>;

  const armies: Record<Side, Army> = {
    me: { side: "me", list: myList, rules: myRules ?? [] },
    opponent: { side: "opponent", list: oppList, rules: oppRules ?? [] },
  };

  const save = (g: Game) => {
    setGame(g);
    api(`/games/${g.id}`, { method: "PUT", json: g }).catch((e: Error) => alert(`Could not save: ${e.message}`));
  };
  // Every state change can add a line to the automatic game log.
  const update: Update = (patch, log) => {
    const state = { ...game.state, ...patch };
    // Round starts read on their own; everything else gets "R2 my Combat:" context.
    const prefix = log?.startsWith("Battle round") ? "" : `R${game.state.round} ${game.state.activePlayer === "me" ? "my" : "their"} ${game.state.phase}: `;
    const entry = log ? [{ at: new Date().toISOString(), text: prefix + log }] : [];
    save({ ...game, state, log: [...game.log, ...entry] });
  };

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
          <Tracker game={game} update={update} onAsk={() => setTab("coach")} />
          {game.state.phase === "End of Turn" && <ScoringPanel game={game} update={update} />}
          <PhaseChecklist game={game} armies={armies} units={units} />
          <OddsCard game={game} armies={armies} units={units} />
          <TacticsCard state={game.state} update={update} />
          <UnitsCard game={game} armies={armies} units={units} update={update} />
        </>
      )}
      {tab === "coach" && (
        <>
          <BoardInfo state={game.state} update={update} />
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
          <LogCard game={game} update={update} />
        </>
      )}
      {tab === "armies" &&
        [myList, oppList].map(
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

// ---------- scoreboard & turn flow ----------

function Tracker({ game, update, onAsk }: { game: Game; update: Update; onAsk: () => void }) {
  const s = game.state;
  const [askPriority, setAskPriority] = useState(false);
  const [editing, setEditing] = useState<StatEdit | null>(null);

  const firstRound = s.phase === "Deployment";
  const gameOver = !firstRound && s.round >= BATTLE_ROUNDS;
  const phaseIndex = PHASES.indexOf(s.phase);

  const nextPhase = () => {
    if (firstRound) return setAskPriority(true);
    if (phaseIndex < PHASES.length - 1) return update({ phase: PHASES[phaseIndex + 1] });
    if (s.activePlayer === s.firstThisRound) return update({ activePlayer: other(s.activePlayer), phase: "Start of Turn" });
    setAskPriority(true);
  };
  const startRound = (first: Side) => {
    setAskPriority(false);
    const r = firstRound ? { seized: null, underdog: null, cp: { me: 4, opponent: 4 } } : newBattleRound(s, first);
    const round = firstRound ? 1 : s.round + 1;
    update(
      {
        round,
        firstThisRound: first,
        activePlayer: first,
        phase: "Start of Turn",
        underdog: r.underdog,
        seizedInitiative: r.seized,
        cp: r.cp,
        // Simmering Rage: rage dice equal to fury level; unspent ones are lost.
        rage: { me: s.fury.me, opponent: s.fury.opponent },
      },
      `Battle round ${round}: ${first === "me" ? "I go" : "opponent goes"} first${r.seized ? " (seized the initiative)" : ""}.`,
    );
  };
  const wentSecond = other(s.firstThisRound);
  const seizeNote = (side: Side) =>
    firstRound || side !== wentSecond
      ? ""
      : s.vp[other(side)] - s.vp[side] >= SEIZE_EXCEPTION_LEAD
        ? " (double turn, tactics still allowed: 11+ VP behind)"
        : " — seizes the initiative";
  const nextLabel = firstRound
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
          {firstRound ? (
            "Deployment"
          ) : (
            <>
              Round {s.round} <span>/ {BATTLE_ROUNDS}</span>
            </>
          )}
        </span>
        {!firstRound && (
          <button
            type="button"
            className={`pill ${s.activePlayer === "me" ? "" : "opponent"}`}
            style={{ minHeight: 0, border: 0 }}
            onClick={() => update({ activePlayer: other(s.activePlayer) })}
            title="Switch active player"
          >
            {s.activePlayer === "me" ? "MY TURN" : "THEIR TURN"}
          </button>
        )}
      </div>

      <div className="scoreboard">
        <SidePanel side="me" label="Me" s={s} update={update} editing={editing} onEdit={setEditing} />
        <SidePanel side="opponent" label="Opponent" s={s} update={update} editing={editing} onEdit={setEditing} />
      </div>
      {editing && (
        <div className="stat-editor">
          <span>
            {editing.side === "me" ? "My" : "Their"} {STAT_NAMES[editing.stat]}
          </span>
          <span className="stepper">
            {[-1, 1].map((d) => (
              <button
                key={d}
                type="button"
                aria-label={d < 0 ? "decrease" : "increase"}
                onClick={() => update({ [editing.stat]: { ...s[editing.stat], [editing.side]: Math.max(0, s[editing.stat][editing.side] + d) } })}
              >
                {d < 0 ? "−" : "+"}
              </button>
            ))}
          </span>
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
          return (
            <button
              key={p}
              type="button"
              className={i < phaseIndex ? "past" : i === phaseIndex ? "current" : ""}
              aria-current={i === phaseIndex ? "step" : undefined}
              onClick={() => update({ phase: p })}
            >
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
            <strong>The game is over:</strong> {s.vp.me}–{s.vp.opponent}. Open the Coach tab for a post-game review.
          </p>
          <button type="button" onClick={() => setAskPriority(false)}>
            Close
          </button>
        </div>
      )}
      {askPriority && !gameOver && (
        <div className="callout">
          <p>
            <strong>{firstRound ? "Who takes the first turn?" : `Round ${s.round + 1}: who goes first?`}</strong>{" "}
            <span className="small muted">{firstRound ? "The player who finished deploying first decides." : "Priority roll winner decides."}</span>
          </p>
          <div className="stack" style={{ gap: "0.4rem" }}>
            <button type="button" className="primary" onClick={() => startRound("me")}>
              I go first{seizeNote("me")}
            </button>
            <button type="button" onClick={() => startRound("opponent")}>
              Opponent goes first{seizeNote("opponent")}
            </button>
            <button type="button" className="small" onClick={() => setAskPriority(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

type Stat = "cp" | "fury" | "rage";
type StatEdit = { side: Side; stat: Stat };
const STAT_NAMES: Record<Stat, string> = { cp: "command points", fury: "fury level", rage: "rage dice" };

/** One player's half of the scoreboard: big VP plus CP / Fury / Rage (tap one to edit it). */
function SidePanel(props: { side: Side; label: string; s: GameState; update: Update; editing: StatEdit | null; onEdit: (e: StatEdit | null) => void }) {
  const { side, label, s, update, editing, onEdit } = props;
  const setVp = (v: number) => update({ vp: { ...s.vp, [side]: Math.max(0, v) } });
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

// ---------- end-of-turn scoring ----------

const turnKey = (s: GameState) => `${s.round}:${s.activePlayer}`;
const cap = (k: string) => k[0].toUpperCase() + k.slice(1);
const tacticsOf = (s: GameState, side: Side) => (side === "me" ? s.tactics : (s.opponentTactics ?? []));
const tacticsKey = (side: Side) => (side === "me" ? "tactics" : "opponentTactics");

function ScoringPanel({ game, update }: { game: Game; update: Update }) {
  const meta = useMeta();
  const s = game.state;
  const side = s.activePlayer;
  const lines = scoringFor(game.battleplan, s.round);
  const tactics = tacticsOf(s, side);
  const seized = s.seizedInitiative === side;
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [manual, setManual] = useState(0);
  const key = turnKey(s);
  useEffect(() => {
    setTicked({});
    setManual(0);
  }, [key]);

  const scored = s.scoredTurns?.[key];
  if (scored !== undefined)
    return (
      <Card>
        <p style={{ margin: 0 }}>
          <b>
            {side === "me" ? "You" : "They"} scored {scored} VP this turn.
          </b>{" "}
          <span className="muted small">Adjust on the scoreboard if needed.</span>
        </p>
      </Card>
    );

  const nextStep = (t: TacticProgress) => TACTIC_STEPS.find((k) => !t[k]);
  const objectiveVp = lines ? lines.reduce((sum, l, i) => sum + (ticked[`l${i}`] ? l.vp : 0), 0) : manual;
  const tacticPicks = tactics.flatMap((t, i) => (ticked[`t${i}`] && nextStep(t) ? [{ i, step: nextStep(t)! }] : []));
  const total = objectiveVp + tacticPicks.length * TACTIC_VP;

  const apply = () => {
    const nextTactics = tactics.map((t, i) => {
      const pick = tacticPicks.find((p) => p.i === i);
      return pick ? { ...t, [pick.step]: true } : t;
    });
    const parts = [objectiveVp ? `${objectiveVp} for objectives` : "", ...tacticPicks.map((p) => `${cap(p.step)} of ${tactics[p.i].card}`)].filter(Boolean);
    update(
      {
        vp: { ...s.vp, [side]: s.vp[side] + total },
        [tacticsKey(side)]: nextTactics,
        scoredTurns: { ...(s.scoredTurns ?? {}), [key]: total },
      } as Partial<GameState>,
      `${side === "me" ? "I" : "They"} scored ${total} VP${parts.length ? ` (${parts.join(", ")})` : ""}.`,
    );
  };

  return (
    <Card title={`Score ${side === "me" ? "your" : "their"} turn`} className={`score-panel ${side}`}>
      {lines ? (
        lines.map((l, i) => (
          <label key={i} className="inline score-line">
            <input type="checkbox" checked={!!ticked[`l${i}`]} onChange={(e) => setTicked({ ...ticked, [`l${i}`]: e.target.checked })} />
            <span>{l.label}</span>
            <b>+{l.vp}</b>
          </label>
        ))
      ) : (
        <div className="row spread">
          <span className="small muted">{game.battleplan ? `No scoring card for "${game.battleplan}" — enter objective VP:` : "Set the battleplan in Setup to get its scoring. Objective VP:"}</span>
          <span className="stepper">
            <button type="button" aria-label="decrease" onClick={() => setManual(Math.max(0, manual - 1))}>
              −
            </button>
            <span className="stepper-value">{manual}</span>
            <button type="button" aria-label="increase" onClick={() => setManual(manual + 1)}>
              +
            </button>
          </span>
        </div>
      )}
      {tactics.map((t, i) => {
        const step = nextStep(t);
        if (!step) return null;
        const text = meta?.battleTactics.find((c) => c.name === t.card)?.[cap(step) as "Affray" | "Strike" | "Domination"];
        return (
          <label key={t.card} className="inline score-line">
            <input type="checkbox" disabled={seized} checked={!!ticked[`t${i}`]} onChange={(e) => setTicked({ ...ticked, [`t${i}`]: e.target.checked })} />
            <span>
              {cap(step)}: {text?.split("\n")[0].replace(/:\s*$/, "") ?? t.card} <span className="muted small">({t.card})</span>
            </span>
            <b>+{TACTIC_VP}</b>
          </label>
        );
      })}
      {seized && <p className="small warning">Seized the initiative: no battle tactics this turn.</p>}
      <button type="button" className="primary" style={{ width: "100%", marginTop: "0.5rem" }} onClick={apply}>
        Add {total} VP {side === "me" ? "to me" : "to them"}
      </button>
    </Card>
  );
}

// ---------- don't forget ----------

interface Source {
  owner: Side;
  from: string;
  ability: Ability;
}

function PhaseChecklist({ game, armies, units }: { game: Game; armies: Record<Side, Army>; units: Record<string, Unit> }) {
  const s = game.state;
  const sources = useMemo(() => {
    const out: Source[] = [];
    for (const side of ["me", "opponent"] as const) {
      const { list, rules } = armies[side];
      const seen = new Set<string>();
      for (const lu of list?.units ?? []) {
        if (s.units[`${side}:${lu.key}`]?.destroyed || seen.has(lu.unitId)) continue;
        seen.add(lu.unitId);
        for (const a of units[lu.unitId]?.abilities ?? []) out.push({ owner: side, from: lu.name, ability: a });
      }
      for (const r of rules) out.push({ owner: side, from: r.group && !/battle traits/i.test(r.group) ? r.group : r.entry || "Faction", ability: r.ability });
    }
    return out;
  }, [armies, units, s.units]);

  const now = sources.filter((x) => usableNow(x.ability, s.phase, x.owner, s.activePlayer));
  const reactions = sources.filter((x) => x.ability.timing?.toLowerCase().startsWith("reaction"));
  const commands = [...CORE_COMMANDS, ...SEASON_ABILITIES];
  const commandsFor = (o: Side) => commands.filter((c) => usableBy(c, s.phase, o, s.activePlayer) && (c.cost === 0 || c.cost <= s.cp[o]));

  const AbilityItem = ({ x }: { x: Source }) => {
    const value = x.ability.extra?.["Casting Value"] ?? x.ability.extra?.["Chanting Value"];
    return (
      <li>
        <details>
          <summary>
            <span className="name">
              <b>{x.ability.name}</b>
              <span>
                {x.from}
                {value ? ` · ${x.ability.extra?.["Casting Value"] ? "cast" : "chant"} ${value}` : ""}
                {x.ability.timing ? ` · ${x.ability.timing}` : " · always on"}
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
  };
  const CommandItem = ({ c, o }: { c: (typeof commands)[number]; o: Side }) => (
    <li>
      <details>
        <summary>
          <span className="name">
            <b>{c.name}</b>
            <span>{c.cost > 0 ? "Command" : "Season rule"}</span>
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
  // Army-wide passives (formation, enhancements) never match a phase, so list them once.
  const alwaysOn = (["me", "opponent"] as const).flatMap((side) =>
    armies[side].rules
      .filter((r) => !r.ability.timing && r.ability.kind !== "Rule" && !/battle traits/i.test(`${r.group} ${r.entry}`))
      .map((r) => ({ owner: side, from: r.group || r.entry, ability: r.ability })),
  );
  const mine = now.filter((x) => x.owner === "me");
  const theirs = now.filter((x) => x.owner === "opponent");

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
      {alwaysOn.length > 0 && (
        <details>
          <summary className="muted small" style={{ padding: "0.5rem 0", cursor: "pointer" }}>
            Always on: formation & enhancements ({alwaysOn.length})
          </summary>
          <ul className="forget">
            {alwaysOn.map((x, i) => (
              <AbilityItem key={`p${i}`} x={x} />
            ))}
          </ul>
        </details>
      )}
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
    </Card>
  );
}

// ---------- attack odds ----------

const num = (v: string) => Number(/(\d+)/.exec(v)?.[1] ?? 0);
const critOf = (a: string): Crit => {
  const t = a.toLowerCase();
  return t.includes("2 hits") ? "2 hits" : t.includes("auto-wound") ? "auto-wound" : t.includes("crit (mortal)") ? "mortal" : "none";
};
const plusOne = (dmg: string) => (/^\d+$/.test(dmg) ? String(Number(dmg) + 1) : /\+\d+$/.test(dmg) ? dmg.replace(/\+(\d+)$/, (_, n) => `+${Number(n) + 1}`) : `${dmg}+1`);

interface GameUnit {
  key: string;
  side: Side;
  lu: ListUnit;
  u?: Unit;
  health?: number;
  damage: number;
  destroyed: boolean;
}

function gameUnits(game: Game, armies: Record<Side, Army>, units: Record<string, Unit>): GameUnit[] {
  return (["me", "opponent"] as const).flatMap((side) =>
    (armies[side].list?.units ?? []).map((lu) => {
      const key = `${side}:${lu.key}`;
      const st = game.state.units[key] ?? { damage: 0, destroyed: false };
      const u = units[lu.unitId];
      return { key, side, lu, u, health: unitHealth(lu, u), damage: st.damage, destroyed: st.destroyed };
    }),
  );
}

function OddsCard({ game, armies, units }: { game: Game; armies: Record<Side, Army>; units: Record<string, Unit> }) {
  const s = game.state;
  const all = gameUnits(game, armies, units).filter((g) => !g.destroyed && g.u);
  const [attackerKey, setAttackerKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [ranged, setRanged] = useState(s.phase === "Shooting");
  const [charged, setCharged] = useState(s.phase === "Charge" || s.phase === "Combat");
  const [aoa, setAoa] = useState(false);
  const [saveBonus, setSaveBonus] = useState(false);
  const [result, setResult] = useState<{ mean: number; sim: SimulationResult }>();
  const [open, setOpen] = useState(false);

  useEffect(() => setRanged(s.phase === "Shooting"), [s.phase]);
  const attacker = all.find((g) => g.key === attackerKey) ?? all.find((g) => g.side === s.activePlayer);
  const target = all.find((g) => g.key === targetKey && g.side !== attacker?.side) ?? all.find((g) => g.side !== attacker?.side);

  const profiles: AttackProfile[] = useMemo(() => {
    if (!attacker?.u) return [];
    const perModel = num(attacker.u.stats?.health ?? "0");
    const models = attacker.u.models * (attacker.lu.reinforced ? 2 : 1);
    const alive = perModel ? Math.max(1, models - Math.floor(attacker.damage / perModel)) : models;
    return attacker.u.weapons
      .filter((w) => (w.kind === "ranged") === ranged)
      .map((w) => ({
        name: w.name,
        attacks: w.attacks,
        hit: num(w.hit),
        wound: num(w.wound),
        rend: w.rend === "-" ? 0 : num(w.rend),
        damage: charged && /charge \(\+1 damage\)/i.test(w.ability) ? plusOne(w.damage) : w.damage,
        crit: critOf(w.ability),
        models: alive,
        hitMod: aoa ? 1 : 0,
      }));
  }, [attacker?.key, attacker?.damage, ranged, charged, aoa, units]);

  const tu = target?.u;
  const targetProfile = tu?.stats
    ? {
        save: num(tu.stats.save) || null,
        ward: tu.stats.ward ? num(tu.stats.ward) : null,
        saveMod: saveBonus ? 1 : 0,
        health: num(tu.stats.health),
        models: tu.models * (target!.lu.reinforced ? 2 : 1),
        damageTaken: target!.damage,
      }
    : undefined;

  useEffect(() => {
    if (!open || !profiles.length || !targetProfile) return setResult(undefined);
    const t = setTimeout(() => {
      api<{ simulation: SimulationResult; perProfile: { expectedDamage: number }[] }>("/calc/damage", {
        method: "POST",
        json: { profiles, target: targetProfile, runs: 10000 },
      }).then((r) => setResult({ mean: r.perProfile.reduce((a, p) => a + p.expectedDamage, 0), sim: r.simulation }));
    }, 200);
    return () => clearTimeout(t);
  }, [open, JSON.stringify(profiles), JSON.stringify(targetProfile)]);

  const options = (side: Side | "other") =>
    all
      .filter((g) => (side === "other" ? g.side !== attacker?.side : true))
      .map((g) => (
        <option key={g.key} value={g.key}>
          {g.side === "me" ? "Mine" : "Theirs"} · {g.lu.name}
          {g.lu.reinforced ? " (R)" : ""}
          {g.damage ? ` (−${g.damage})` : ""}
        </option>
      ));

  return (
    <Card>
      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary style={{ cursor: "pointer", listStyle: "none" }}>
          <h2 style={{ display: "inline" }}>Attack odds</h2> <span className="muted small">— who can kill what, with current damage</span>
        </summary>
        <div className="grid2" style={{ marginTop: "0.6rem" }}>
          <label>
            Attacker
            <select value={attacker?.key ?? ""} onChange={(e) => setAttackerKey(e.target.value)}>
              {options("me")}
            </select>
          </label>
          <label>
            Target
            <select value={target?.key ?? ""} onChange={(e) => setTargetKey(e.target.value)}>
              {options("other")}
            </select>
          </label>
        </div>
        <div className="chips" style={{ margin: "0.3rem 0" }}>
          <button type="button" className={`chip ${ranged ? "" : "strong"}`} aria-pressed={!ranged} onClick={() => setRanged(false)}>
            Melee
          </button>
          <button type="button" className={`chip ${ranged ? "strong" : ""}`} aria-pressed={ranged} onClick={() => setRanged(true)}>
            Shooting
          </button>
          <button type="button" className={`chip ${charged ? "strong" : ""}`} aria-pressed={charged} onClick={() => setCharged(!charged)}>
            Charged
          </button>
          <button type="button" className={`chip ${aoa ? "strong" : ""}`} aria-pressed={aoa} onClick={() => setAoa(!aoa)}>
            All-out Attack
          </button>
          <button type="button" className={`chip ${saveBonus ? "strong" : ""}`} aria-pressed={saveBonus} onClick={() => setSaveBonus(!saveBonus)}>
            Target +1 save
          </button>
        </div>
        {!profiles.length && <p className="muted small">{attacker?.lu.name} has no {ranged ? "shooting" : "melee"} weapons.</p>}
        {result && profiles.length > 0 && (
          <div className="kpis">
            <div>
              <span className="kpi accent">{result.mean.toFixed(1)}</span>
              <span className="muted small">average damage</span>
            </div>
            {result.sim.killChance !== undefined && (
              <div>
                <span className="kpi">{Math.round(result.sim.killChance * 100)}%</span>
                <span className="muted small">to destroy {target?.lu.name}</span>
              </div>
            )}
            {result.sim.expectedModelsSlain !== undefined && (
              <div>
                <span className="kpi">{result.sim.expectedModelsSlain.toFixed(1)}</span>
                <span className="muted small">models slain</span>
              </div>
            )}
          </div>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          Uses the warscroll weapons and models still alive. Other buffs (spells, auras, champions): use the full Calculator.
        </p>
      </details>
    </Card>
  );
}

// ---------- battle tactics ----------

function TacticsCard({ state, update }: { state: GameState; update: Update }) {
  const meta = useMeta();
  const [pick, setPick] = useState<Record<Side, string>>({ me: "", opponent: "" });

  const section = (side: Side) => {
    const tactics = tacticsOf(state, side);
    const set = (next: TacticProgress[], vpDelta: number, log: string) =>
      update({ [tacticsKey(side)]: next, vp: { ...state.vp, [side]: Math.max(0, state.vp[side] + vpDelta) } } as Partial<GameState>, log);
    return (
      <div key={side} className={`tactic-side ${side}`}>
        <h3>{side === "me" ? "My battle tactics" : "Their battle tactics"}</h3>
        {tactics.map((t, i) => {
          const card = meta?.battleTactics.find((c) => c.name === t.card);
          const nextStep = TACTIC_STEPS.find((k) => !t[k]);
          const lastDone = [...TACTIC_STEPS].reverse().find((k) => t[k]);
          const title = (k: (typeof TACTIC_STEPS)[number]) => card?.[cap(k) as "Affray" | "Strike" | "Domination"]?.split("\n")[0].replace(/:\s*$/, "");
          const blocked = state.seizedInitiative === side && state.activePlayer === side;
          return (
            <div key={t.card} className="tactic">
              <div className="row spread" style={{ margin: 0 }}>
                <b>{t.card}</b>
                <span className="muted small">{TACTIC_VP} VP each</span>
              </div>
              <div className="tiles">
                {TACTIC_STEPS.map((k) => {
                  const status = t[k] ? "done" : k === nextStep ? "next" : "locked";
                  // Only the next objective can be completed, and only the latest one undone.
                  const canToggle = (status === "next" && !blocked) || (t[k] && k === lastDone);
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`tile ${status}`}
                      aria-pressed={t[k]}
                      disabled={!canToggle}
                      onClick={() =>
                        set(
                          tactics.map((x, j) => (j === i ? { ...x, [k]: !x[k] } : x)),
                          t[k] ? -TACTIC_VP : TACTIC_VP,
                          `${side === "me" ? "I" : "They"} ${t[k] ? "undid" : "completed"} ${cap(k)} of ${t.card} (${t[k] ? "−" : "+"}${TACTIC_VP} VP).`,
                        )
                      }
                    >
                      <b>{cap(k)}</b>
                      <span>{t[k] ? "Done · undo" : status === "locked" ? "Locked" : blocked ? "Not this turn" : (title(k) ?? "Next")}</span>
                    </button>
                  );
                })}
              </div>
              <details>
                <summary className="muted small" style={{ cursor: "pointer" }}>
                  Card rules
                </summary>
                {card?.Card && <RulesText text={card.Card} />}
                {TACTIC_STEPS.map((k) => {
                  const text = card?.[cap(k) as "Affray" | "Strike" | "Domination"];
                  return text ? <RulesText key={k} text={`**${cap(k)}** — ${text}`} /> : null;
                })}
                <button type="button" className="small" onClick={() => set(tactics.filter((_, j) => j !== i), 0, `Removed ${t.card}.`)}>
                  Remove card
                </button>
              </details>
            </div>
          );
        })}
        {tactics.length < 2 && (
          <div className="row">
            <select value={pick[side]} onChange={(e) => setPick({ ...pick, [side]: e.target.value })} aria-label={`Add a battle tactic card for ${sideName(side)}`}>
              <option value="">Add a battle tactic card…</option>
              {meta?.battleTactics
                .filter((c) => !tactics.some((t) => t.card === c.name))
                .map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
            </select>
            <button
              type="button"
              disabled={!pick[side]}
              onClick={() => {
                set([...tactics, { card: pick[side], affray: false, strike: false, domination: false }], 0, `Picked ${pick[side]}.`);
                setPick({ ...pick, [side]: "" });
              }}
            >
              Add
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card title="Battle tactics">
      {section("me")}
      {section("opponent")}
    </Card>
  );
}

// ---------- units ----------

function UnitsCard({ game, armies, units, update }: { game: Game; armies: Record<Side, Army>; units: Record<string, Unit>; update: Update }) {
  const s = game.state;
  const [view, setView] = useState<Side>(other(s.activePlayer));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showDead, setShowDead] = useState(false);
  useEffect(() => setView(other(s.activePlayer)), [s.activePlayer]);

  const list = gameUnits(game, armies, units).filter((g) => g.side === view);
  const dead = list.filter((g) => g.destroyed);
  const shown = list.filter((g) => showDead || !g.destroyed);

  const change = (g: GameUnit, damage: number, destroyed?: boolean) => {
    const dmg = Math.max(0, damage);
    const isDead = destroyed ?? (g.health !== undefined && dmg >= g.health);
    const who = `${g.side === "me" ? "My" : "Their"} ${g.lu.name}`;
    const log =
      isDead && !g.destroyed
        ? `${who} destroyed.`
        : !isDead && g.destroyed
          ? `${who} back on the table.`
          : dmg > g.damage
            ? `${who} took ${dmg - g.damage} damage${g.health ? ` (${Math.max(0, g.health - dmg)}/${g.health} left)` : ""}.`
            : undefined;
    update({ units: { ...s.units, [g.key]: { damage: dmg, destroyed: isDead } } }, log);
    if (isDead) setOpenKey(null);
  };

  return (
    <Card
      title="Units"
      actions={
        <div className="seg" role="group" aria-label="Which army">
          {(["opponent", "me"] as const).map((v) => (
            <button key={v} type="button" className={view === v ? `active ${v}` : ""} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "me" ? "Mine" : "Theirs"}
            </button>
          ))}
        </div>
      }
    >
      {shown.map((g) => {
        const left = g.health !== undefined ? (g.destroyed ? 0 : Math.max(0, g.health - g.damage)) : undefined;
        const isOpen = openKey === g.key;
        return (
          <div key={g.key} className={`unit-row ${g.destroyed ? "destroyed" : ""}`}>
            <button type="button" className="unit-main unit-toggle" aria-expanded={isOpen} onClick={() => setOpenKey(isOpen ? null : g.key)}>
              <span className="unit-top">
                <span>
                  {g.lu.name}
                  {g.lu.reinforced ? " (R)" : ""}
                </span>
                <span className="muted">{g.destroyed ? "destroyed" : left !== undefined ? `${left} / ${g.health}` : ""}</span>
              </span>
              {g.health !== undefined && (
                <span className={`hp ${g.side}`} aria-hidden="true">
                  <span style={{ width: `${((left ?? 0) / g.health) * 100}%` }} />
                </span>
              )}
            </button>
            {isOpen && (
              <div className="quick">
                {g.destroyed ? (
                  <button type="button" onClick={() => change(g, 0, false)}>
                    Bring back
                  </button>
                ) : (
                  <>
                    <button type="button" aria-label="Heal 1" onClick={() => change(g, g.damage - 1)}>
                      −1
                    </button>
                    {[1, 3, 5].map((n) => (
                      <button key={n} type="button" className="dmg" aria-label={`${n} damage`} onClick={() => change(g, g.damage + n)}>
                        +{n}
                      </button>
                    ))}
                    <button type="button" className="kill" onClick={() => change(g, g.health ?? g.damage, true)}>
                      Destroyed
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {dead.length > 0 && (
        <button type="button" className="small" style={{ marginTop: "0.5rem" }} onClick={() => setShowDead(!showDead)}>
          {showDead ? "Hide" : "Show"} {dead.length} destroyed
        </button>
      )}
    </Card>
  );
}

// ---------- coach tab extras ----------

function BoardInfo({ state, update }: { state: GameState; update: Update }) {
  const [objectives, setObjectives] = useState(state.objectives);
  const [notes, setNotes] = useState(state.notes);
  const dirty = objectives !== state.objectives || notes !== state.notes;
  return (
    <Card title="Board for the coach">
      <p className="muted small" style={{ marginTop: 0 }}>
        Optional. The coach asks when it needs positions; anything you note here it sees with every question.
      </p>
      <label>
        Objectives
        <input value={objectives} onChange={(e) => setObjectives(e.target.value)} placeholder="e.g. I hold A and C, B contested, they hold D" />
      </label>
      <label>
        Positions & threats
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Hell Pit 8&quot; from my Stonehorn, Jezzails on the left ruin" />
      </label>
      {dirty && (
        <button type="button" className="small primary" onClick={() => update({ objectives, notes })}>
          Save board
        </button>
      )}
    </Card>
  );
}

function LogCard({ game, update }: { game: Game; update: Update }) {
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    update({}, text.trim());
    setText("");
  };
  return (
    <Card title="Game log">
      <p className="muted small" style={{ marginTop: 0 }}>
        Rounds, scoring, damage and destroyed units are logged automatically. Add anything else worth remembering for the review.
      </p>
      <div className="row">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="e.g. Failed a 6&quot; charge with the Stonehorn" />
        <button type="button" onClick={add}>
          Add
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
