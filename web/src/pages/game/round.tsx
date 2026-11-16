// One battle round: who goes first, the scoreboard, the live turn with
// Thorgrim's plan for it, each side's scoring, and ending the turn or round.

import { useEffect, useRef, useState } from "react";
import { baseFaction, BATTLE_ROUNDS, scoringFor, SEIZE_EXCEPTION_LEAD, TACTIC_VP } from "../../../../shared/season.ts";
import { emptyRound, nextTacticStep, sideRoundVp, startRound, tacticSteps } from "../../../../shared/scoring.ts";
import type { Game, GameState, SideRound, TacticStep, TurnTips, Unit } from "../../../../shared/types.ts";
import { clockTimes, formatClock, toggleClock } from "../../../../shared/clock.ts";
import { applyVoice, describeChange, type VoiceChange } from "../../../../shared/voice.ts";
import { api, runJob } from "../../api.ts";
import { VoiceButton } from "../../media.tsx";
import { armyColor, Avatar, Counter, Group, Icon, Seg, useMeta } from "../../ui.tsx";
import { OddsCard, other, PhaseChecklist, UnitsCard, type Army, type Side, type Update } from "../gameTools.tsx";
import { battleplanInfo } from "../../../../shared/battleplans.ts";
import { BattleplanCard } from "../../battleplanView.tsx";
import { moment } from "../../analytics.tsx";
import { CountUp, Gain } from "../../motion.tsx";
import { feedback } from "../../sound.ts";
import { type Step, cap, PLAY_PHASES, SHORT, type Mutate, Explained } from "./common.tsx";
import { AttackerQuestion } from "./setup.tsx";
import { WhatHappened, Replan } from "./plan.tsx";

// ---------- a battle round ----------

export function RoundStep(props: {
  game: Game;
  n: number;
  mutate: Mutate;
  update: Update;
  saved: () => Promise<unknown>;
  armies: Record<Side, Army>;
  units: Parameters<typeof UnitsCard>[0]["units"];
  names: Record<Side, string>;
  go: (s: Step) => void;
  openCoach: () => void;
}) {
  const { game, n, mutate, update, armies, units, names, go } = props;
  const s = game.state;
  const rounds = s.rounds ?? [];
  const rec = rounds[n - 1];
  const liveRound = s.phase === "Deployment" ? 0 : s.round;
  const isLive = n === liveRound;
  const canStart = !rec?.first && n === liveRound + 1;
  const prevFirst = n > 1 ? rounds[n - 2]?.first : undefined;

  const setRec = (patch: Partial<NonNullable<typeof rec>>) =>
    mutate((g) => {
      const rs = [...(g.state.rounds ?? [])];
      while (rs.length < n) rs.push(emptyRound());
      rs[n - 1] = { ...rs[n - 1], ...patch };
      return { ...g, state: { ...g.state, rounds: rs } };
    });

  const setFirst = (side: Side) => {
    const label = `Battle round ${n}: ${side === "me" ? "I go" : "opponent goes"} first`;
    if (canStart || isLive) {
      void mutate((g) => {
        let state = g.state;
        if (isLive) {
          // Re-picking first in the live round: recompute the CP from scratch.
          const rs = [...(state.rounds ?? [])];
          rs[n - 1] = { ...rs[n - 1], me: { ...rs[n - 1].me, cpGained: 0 }, opponent: { ...rs[n - 1].opponent, cpGained: 0 } };
          state = { ...state, rounds: rs };
        }
        const next = startRound({ battleplan: g.battleplan, state }, n, side);
        return { ...g, state: next };
      }, `${label}${n > 1 && prevFirst && side !== prevFirst ? "" : ""}.`);
    } else setRec({ first: side });
  };
  const seizeNote = (side: Side) => {
    if (n === 1 || !prevFirst || side === prevFirst) return "";
    const vp = s.vp;
    return vp[other(side)] - vp[side] >= SEIZE_EXCEPTION_LEAD ? "double turn (11+ VP behind: tactics allowed)" : "double turn: seizes the initiative";
  };
  const future = n > liveRound + 1;
  const [editOrder, setEditOrder] = useState(false);
  const orderKnown = !!rec?.first && (n === 1 || !!rec?.priority);
  const factions: Record<Side, string> = {
    me: armies.me.list?.faction || game.myFaction || "",
    opponent: armies.opponent.list?.faction || game.opponentFaction || "",
  };

  return (
    <div className="stack">
      <Scoreboard
        game={game}
        names={names}
        factions={factions}
        isLive={isLive}
        switchTurn={(side) => (feedback("turn"), update({ activePlayer: side, phase: "Start of Turn" }, `${names[side]}'s turn.`))}
      />
      {n === 1 && !rec?.first && <AttackerQuestion game={game} mutate={mutate} />}
      {orderKnown && !editOrder ? (
        <button type="button" className="order-summary" onClick={() => setEditOrder(true)}>
          <span className="grow">
            {n > 1 && rec?.priority ? `${names[rec.priority]} won priority · ` : ""}
            {names[rec!.first!]} went first
          </span>
          <span className="order-change">Change</span>
        </button>
      ) : (
      <Group className={`priority ${canStart ? "round-waiting" : ""}`}>
        {canStart && (
          <div className="round-start">
            <b>Start round {n}</b>
            <span className="muted small">{n > 1 ? "Roll off for priority: the winner picks who takes the first turn." : "Pick who takes the first turn."}</span>
          </div>
        )}
        {n > 1 && (
          <div className="question">
            <span>Who won priority this battle round?</span>
            <Seg label="Priority" value={rec?.priority} options={[["me", "You"], ["opponent", "Opponent"]]} onChange={(v) => setRec({ priority: v })} />
          </div>
        )}
        <div className="question">
          <span>Who went first this battle round?</span>
          <Seg label="First turn" value={rec?.first} options={[["me", "You"], ["opponent", "Opponent"]]} onChange={setFirst} />
        </div>
        {!rec?.first && (seizeNote("me") || seizeNote("opponent")) && (
          <p className="small warning" style={{ margin: "0.3rem 0 0" }}>
            {seizeNote("me") ? `You going first: ${seizeNote("me")}.` : `Opponent going first: ${seizeNote("opponent")}.`} No battle tactics in that turn.
          </p>
        )}
        {canStart && <p className="small accent-text" style={{ margin: "0.3rem 0 0" }}>The round starts when you pick who went first: then the turn tracker, CP and rage dice appear.</p>}
        {future && !rec?.first && <p className="small muted" style={{ margin: "0.3rem 0 0" }}>Finish round {liveRound || 1} first; you can still fill this in.</p>}
      </Group>
      )}

      {n === 1 && !game.plan && (
        <button type="button" className="order-summary plan-offer" onClick={() => go("plan")}>
          <Icon name="spark" />
          <span className="grow">Want Thorgrim's game plan for this battle?</span>
          <span className="order-change">Get it</span>
        </button>
      )}
      {game.plan?.rounds.find((r) => r.round === n) && (
        <div className="round-plan">
          <Icon name="spark" />
          <span className="grow">
            <b>Plan for round {n}:</b> {game.plan.rounds.find((r) => r.round === n)!.plan}
          </span>
          {isLive && <Replan game={game} mutate={mutate} saved={props.saved} />}
        </div>
      )}

      {(isLive || rec?.first) && <VoiceScore game={game} n={n} mutate={mutate} names={names} saved={props.saved} />}

      {isLive && <TurnCard {...props} color={armyColor(factions[s.activePlayer])} />}

      {(["me", "opponent"] as const).map((side) => (
        <SideBlock
          key={`${side}-${isLive && side !== s.activePlayer}`}
          side={side}
          game={game}
          n={n}
          mutate={mutate}
          isLive={isLive}
          showFury={isLive || canStart}
          name={names[side]}
          faction={factions[side]}
        />
      ))}

      {isLive && <EndTurn game={game} n={n} update={update} names={names} go={go} />}

      {(isLive || (game.battleplan && battleplanInfo(game.battleplan)?.map)) && (
        <h2 className="reference-title">
          <Icon name="rules" /> Reference & tools
        </h2>
      )}
      <div className="reference">
      {game.battleplan && battleplanInfo(game.battleplan)?.map && (
        <details className="card collapsible">
          <summary>
            <h2>{game.battleplan}: map & twist</h2>
            <Icon name="down" />
          </summary>
          <BattleplanCard name={game.battleplan} attacker={game.state.attacker} compact />
        </details>
      )}
      {isLive && (
        <details className="card collapsible">
          <summary>
            <h2>Unit damage</h2>
            <Icon name="down" />
          </summary>
          <UnitsCard game={game} armies={armies} units={units} update={update} />
        </details>
      )}
      {isLive && (
        <div className="collapsible-plain">
          <OddsCard game={game} armies={armies} units={units} />
        </div>
      )}
      </div>
      {!rec?.first && n === liveRound && <p className="muted small">Pick who went first to start the turn tracker.</p>}
    </div>
  );
}

/** Both armies at a glance: VP, command points as coins, fury as flames, and whose turn it is. */
/** In a live round, tapping the waiting player's card makes it their turn. */
export function Scoreboard({ game, names, factions, isLive, switchTurn }: { game: Game; names: Record<Side, string>; factions: Record<Side, string>; isLive: boolean; switchTurn?: (side: Side) => void }) {
  const s = game.state;
  const ref = useRef<HTMLElement>(null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setAway(!e.isIntersecting), { rootMargin: "-60px 0px 0px 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return (
    <>
    {away && (
      <div className="mini-score" aria-hidden="true">
        {(["me", "opponent"] as const).map((side) => (
          <span key={side} className={`mini-side ${isLive && s.activePlayer === side ? "on" : ""}`} style={{ ["--army" as string]: armyColor(factions[side]) }}>
            <b>{names[side]}</b> <CountUp value={s.vp[side]} className="mini-vp" /> <small>{s.cp[side]} CP</small>
          </span>
        ))}
        {isLive && <span className="mini-phase">{s.phase}</span>}
      </div>
    )}
    <section ref={ref} className="scoreboard" aria-label="Scoreboard">
      {(["me", "opponent"] as const).map((side) => {
        const active = isLive && s.activePlayer === side;
        const cp = s.cp[side];
        const fury = s.fury[side];
        const canSwitch = isLive && !active && !!switchTurn;
        return (
          <div
            key={side}
            className={`score-card ${active ? "active" : ""} ${canSwitch ? "tappable" : ""}`}
            style={{ ["--army" as string]: armyColor(factions[side]) }}
            {...(canSwitch
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": side === "me" ? "Make it your turn" : `Make it ${names[side]}'s turn`,
                  onClick: () => switchTurn!(side),
                  onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), switchTurn!(side)),
                }
              : {})}
          >
            <div className="score-card-head">
              <Avatar faction={factions[side]} size={2.1} />
              <span>
                <b>{names[side]}</b>
                <small>{factions[side] ? baseFaction(factions[side]) : "No army yet"}</small>
                <small className="role-tag">{s.attacker === side ? "Attacker" : "Defender"}</small>
              </span>
            </div>
            {isLive && <span className={`turn-tag ${active ? "on" : ""}`}>{active ? (side === "me" ? "YOUR TURN" : "THEIR TURN") : canSwitch ? "WAITING · TAP" : "WAITING"}</span>}
            <div className="score-vp">
              <span className="big-score">
                <CountUp value={s.vp[side]} />
              </span>
              <Gain value={s.vp[side]} />
              <small>VP</small>
            </div>
            <div className="pips" role="img" aria-label={`${cp} command points`}>
              <span className="pips-label">CP</span>
              {Array.from({ length: Math.max(cp, 4) }, (_, i) => (
                <span key={i} className={`coin ${i < cp ? "on" : ""}`} />
              ))}
            </div>
            <div className="pips" role="img" aria-label={`Fury ${fury}`}>
              <span className="pips-label">Fury</span>
              {Array.from({ length: Math.min(7, Math.max(fury, 3)) }, (_, i) => (
                <svg key={i} className={`flame ${i < fury ? "on" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 2 1 3 2 3 0-3 0-5 1-8z" />
                </svg>
              ))}
            </div>
          </div>
        );
      })}
    </section>
    </>
  );
}

/** A battle tactic card's three steps as seals: done, next, later. */
export function TacticSeals({ done, next }: { done: Set<TacticStep>; next?: TacticStep }) {
  const steps: TacticStep[] = ["affray", "strike", "domination"];
  // Seals done since this was first shown get stamped.
  const seen = useRef(new Set(done));
  const fresh = steps.filter((st) => done.has(st) && !seen.current.has(st));
  useEffect(() => {
    seen.current = new Set(done);
  });
  return (
    <span className="seals" role="img" aria-label={steps.map((st) => `${cap(st)} ${done.has(st) ? "done" : st === next ? "next" : "open"}`).join(", ")}>
      {steps.map((st) => (
        <span key={`${st}-${done.has(st)}`} className={`seal ${done.has(st) ? "done" : st === next ? "next" : ""} ${fresh.includes(st) ? "stamp" : ""}`}>
          {st[0].toUpperCase()}
        </span>
      ))}
    </span>
  );
}

const AUTO_TIPS_KEY = "thorgrim-auto-tips";
const AUTO_TIPS_WAIT_MS = 1500;
function autoTips(): boolean {
  try {
    return localStorage.getItem(AUTO_TIPS_KEY) !== "off";
  } catch {
    return true;
  }
}

/** The live turn: phases, Thorgrim's plan for this phase, and what not to forget. */
export function TurnCard(props: Parameters<typeof RoundStep>[0] & { color: string }) {
  const { game, n, mutate, update, saved, armies, units, names, openCoach } = props;
  const meta = useMeta();
  const s = game.state;
  const active = s.activePlayer;
  const turnNo = active === s.firstThisRound ? 1 : 2;
  const phaseIndex = PLAY_PHASES.indexOf(s.phase);
  const key = `${n}:${active}`;
  const tips = s.tips?.[key];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const asked = useRef(new Set<string>());

  const fetchTips = async (force = false) => {
    if (!meta?.coachReady || (!force && (tips || asked.current.has(key)))) return;
    asked.current.add(key);
    setBusy(true);
    setError(undefined);
    try {
      await saved(); // the server reads the saved game
      const t = await runJob<TurnTips>(`/games/${game.id}/tips`, { round: n, side: active });
      await mutate((g) => ({ ...g, state: { ...g.state, tips: { ...(g.state.tips ?? {}), [key]: t } } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // A plan for every turn is asked for by itself unless the player turned that off on this phone
  // (each plan is a request to Claude). It waits a moment first, so a turn switched by mistake
  // and switched straight back doesn't ask for a plan nobody reads.
  const [auto, setAuto] = useState(autoTips);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!auto || !meta?.coachReady || tips || asked.current.has(key)) return;
    setWaiting(true);
    const t = setTimeout(() => {
      setWaiting(false);
      void fetchTips();
    }, AUTO_TIPS_WAIT_MS);
    return () => {
      clearTimeout(t);
      setWaiting(false);
    };
  }, [key, meta?.coachReady, auto]);
  const toggleAuto = () => {
    const on = !auto;
    setAuto(on);
    try {
      localStorage.setItem(AUTO_TIPS_KEY, on ? "on" : "off");
    } catch {
      /* stays for this visit only */
    }
  };

  const phaseTips = tips?.phases[s.phase] ?? [];

  return (
    <section className={`turn-card ${active}`} style={{ ["--army" as string]: props.color }}>
      <div className="turn-head turn-in" key={`${n}:${active}`}>
        <span className="turn-label">
          Turn {turnNo} · <b>{active === "me" ? "Your turn" : `${names.opponent}'s turn`}</b>
        </span>
        <span className="muted small">{s.cp[active]} CP</span>
      </div>
      <nav className="phase-chips" aria-label="Phases: tap one to see its plan">
        {PLAY_PHASES.map((p, i) => (
          <button key={p} type="button" className={i < phaseIndex ? "past" : i === phaseIndex ? "current" : ""} aria-current={i === phaseIndex ? "step" : undefined} onClick={() => update({ phase: p })}>
            {SHORT[p]}
          </button>
        ))}
      </nav>
      {s.seizedInitiative === active && <p className="small warning">Seized the initiative: no battle tactics this turn.</p>}
      <ChessClock state={s} names={names} toggle={() => (feedback(s.clock?.since ? "clockPause" : "clockStart"), mutate((g) => ({ ...g, state: toggleClock(g.state) })))} />

      <div className="tips">
        <div className="tips-head">
          <Icon name="spark" />
          <b>{active === "me" ? `Thorgrim · ${s.phase}` : `Thorgrim · their ${s.phase}`}</b>
          {tips && (
            <button type="button" className="icon small-icon" aria-label="New plan for this turn" disabled={busy} onClick={() => fetchTips(true)}>
              <Icon name="refresh" />
            </button>
          )}
        </div>
        {!meta?.coachReady ? (
          <p className="muted small">
            Add your Claude API key on the <a href="#/ask">Thorgrim</a> page to get a plan for every turn.
          </p>
        ) : (busy || waiting) && !tips ? (
          <p className="muted small thinking">Planning this turn…</p>
        ) : error ? (
          <p className="error small">
            {error}{" "}
            <button type="button" className="small" onClick={() => fetchTips(true)}>
              Try again
            </button>
          </p>
        ) : tips ? (
          <>
            <p className="tips-headline">{tips.headline}</p>
            {phaseTips.length ? (
              <ul className="tips-list">
                {phaseTips.map((t, i) => (
                  <li key={i}>
                    <Explained text={t} glossary={tips.glossary} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing special this phase.</p>
            )}
          </>
        ) : (
          <button type="button" className="small primary" onClick={() => fetchTips(true)}>
            <Icon name="spark" /> Get the plan for this turn
          </button>
        )}
        <div className="tips-foot">
          <button type="button" className="small ghost accent" onClick={openCoach}>
            Ask Thorgrim
          </button>
          {meta?.coachReady && (
            <button type="button" className="small ghost" role="switch" aria-checked={auto} onClick={toggleAuto}>
              {auto ? "A plan every turn: on" : "A plan every turn: off"}
            </button>
          )}
        </div>
      </div>

      <WhatHappened
        game={game}
        n={n}
        mutate={mutate}
        update={update}
        saved={saved}
        coachReady={!!meta?.coachReady}
        onBusy={setBusy}
        onTips={async (t) => {
          // Keep the earlier phases of this turn, take the new plan from the current phase on.
          await mutate((g) => {
            const old = g.state.tips?.[key];
            const phases = { ...(old?.phases ?? {}) };
            PLAY_PHASES.forEach((p, i) => {
              if (i >= phaseIndex) phases[p] = t.phases[p] ?? [];
            });
            return { ...g, state: { ...g.state, tips: { ...(g.state.tips ?? {}), [key]: { ...t, phases } } } };
          });
        }}
      />

      <PhaseChecklist game={game} armies={armies} units={units} update={update} />

    </section>
  );
}

/** After the scoring: end the turn, the round or the game. */
export function EndTurn({ game, n, update, names, go }: Pick<Parameters<typeof RoundStep>[0], "game" | "n" | "update" | "names" | "go">) {
  const s = game.state;
  const active = s.activePlayer;
  const turnNo = active === s.firstThisRound ? 1 : 2;
  const end = () => {
    feedback(turnNo === 1 ? "turn" : n < BATTLE_ROUNDS ? "round" : "tap");
    if (turnNo === 1) return update({ activePlayer: other(active), phase: "Start of Turn" }, `${names[other(active)]}'s turn.`);
    go(n < BATTLE_ROUNDS ? `round-${n + 1}` : "results");
  };
  const label = turnNo === 1 ? `End turn → ${active === "me" ? names.opponent : names.me}` : n < BATTLE_ROUNDS ? `End round → Round ${n + 1}` : "End game → Results";
  return (
    <button id="end-turn" type="button" className="primary wide end-turn" onClick={end}>
      {label} <Icon name="right" />
    </button>
  );
}

/** Say (or type) what was scored; Thorgrim turns it into changes, the player checks them, then they're applied. */
export function VoiceScore({ game, n, mutate, names, saved }: { game: Game; n: number; mutate: Mutate; names: Record<Side, string>; saved: () => Promise<unknown> }) {
  const meta = useMeta();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ said: string; changes: VoiceChange[]; unclear?: string }>();
  const [error, setError] = useState<string>();
  if (!meta?.coachReady) return null;

  const ask = async (said: string) => {
    if (!said.trim()) return;
    setBusy(true);
    setError(undefined);
    setFound(undefined);
    try {
      await saved();
      const r = await api<{ changes: VoiceChange[]; unclear?: string }>(`/games/${game.id}/voice`, { method: "POST", json: { round: n, text: said } });
      setFound({ said, ...r });
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!found) return;
    const lines = found.changes.map((c) => describeChange(c, names, game, n));
    setFound(undefined);
    feedback("score");
    await mutate((g) => applyVoice(g, n, found.changes), `Scored by voice: ${lines.join("; ")}.`);
    moment("Scored by voice");
  };

  return (
    <section className="voice-score">
      <form
        className="voice-row"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <VoiceButton label="Say the score" onText={(t) => void ask(t)} />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say or type the score…" aria-label="Say or type what was scored" disabled={busy} />
        {text.trim() && (
          <button type="submit" className="small" disabled={busy}>
            Go
          </button>
        )}
      </form>
      {busy && <p className="muted small thinking">Working out the score…</p>}
      {error && <p className="error small">{error}</p>}
      {found && (
        <div className="voice-found">
          <p className="small muted">“{found.said}”</p>
          {found.changes.length ? (
            <>
              <ul>
                {found.changes.map((c, i) => (
                  <li key={i}>{describeChange(c, names, game, n)}</li>
                ))}
              </ul>
              <div className="row">
                <button type="button" className="primary small" onClick={apply}>
                  <Icon name="check" /> Apply
                </button>
                <button type="button" className="ghost small" onClick={() => setFound(undefined)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <p className="small">
              {found.unclear || "Nothing to score in that."}{" "}
              <button type="button" className="ghost small" onClick={() => setFound(undefined)}>
                OK
              </button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Each player's time, ticking for whoever's turn it is. Tap to start or pause. */
export function ChessClock({ state, names, toggle }: { state: GameState; names: Record<Side, string>; toggle: () => void }) {
  const running = !!state.clock?.since;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const times = clockTimes(state);
  return (
    <button type="button" className={`chess-clock ${running ? "running" : ""}`} onClick={toggle} aria-label={running ? "Pause the clock" : "Start the clock"}>
      {(["me", "opponent"] as const).map((side) => (
        <span key={side} className={`clock-side ${running && state.activePlayer === side ? "on" : ""}`}>
          <small>{side === "me" ? "You" : names.opponent}</small>
          <b>{formatClock(times[side])}</b>
        </span>
      ))}
      <span className="clock-ctl">
        <Icon name={running ? "pause" : "clock"} />
        {running ? "Pause" : state.clock ? "Resume" : "Start clock"}
      </span>
    </button>
  );
}

export function SideBlock({
  side,
  game,
  n,
  mutate,
  isLive,
  showFury,
  name,
  faction,
  folded,
}: {
  side: Side;
  game: Game;
  n: number;
  mutate: Mutate;
  isLive: boolean;
  /** Fury and rage carry over between rounds: shown in the round in play and the next one, before it starts. */
  showFury?: boolean;
  name: string;
  faction: string;
  /** The player waiting for their turn: one line until opened. */
  folded?: boolean;
}) {
  const meta = useMeta();
  const s = game.state;
  const rounds = s.rounds ?? [];
  const rec = rounds[n - 1] ?? emptyRound();
  const sr = rec[side];
  const lines = scoringFor(game.battleplan, n);
  const tactics = (side === "me" ? s.tactics : s.opponentTactics) ?? [];
  const who = side === "me" ? "I" : "They";

  const setSr = (patch: Partial<SideRound>, log?: string) =>
    mutate((g) => {
      const rs = [...(g.state.rounds ?? [])];
      while (rs.length < n) rs.push(emptyRound());
      rs[n - 1] = { ...rs[n - 1], [side]: { ...rs[n - 1][side], ...patch } };
      return { ...g, state: { ...g.state, rounds: rs } };
    }, log);

  const objectiveVp = sideRoundVp({ ...sr, tactics: [] }, game.battleplan, n);
  const roundVp = sideRoundVp(sr, game.battleplan, n);
  const blocked = isLive && s.seizedInitiative === side;

  const body = (
    <>
      <div className="side-name">
        <Avatar faction={faction} size={2} />
        <h1>{name}</h1>
        {isLive && s.underdog === side && <span className="badge">Underdog</span>}
        {rec.first && <span className="muted small">Turn {rec.first === side ? 1 : 2}</span>}
        <span className="grow" />
        <span className="round-vp">+{roundVp} pts</span>
      </div>

      <Group label="Command points">
        <div className="cp-row">
          <Counter label="Gained" value={sr.cpGained} onChange={(v) => setSr({ cpGained: v })} />
          <Counter label="Spent" value={sr.cpSpent} onChange={(v) => setSr({ cpSpent: v })} />
          <span className="cp-total">
            <b>{Math.max(0, sr.cpGained - sr.cpSpent)}</b>
            <small>cp</small>
          </span>
        </div>
        {showFury && (
          <div className="cp-row two">
            <Counter label="Fury" value={s.fury[side]} onChange={(v) => mutate((g) => ({ ...g, state: { ...g.state, fury: { ...g.state.fury, [side]: Math.min(7, v) } } }))} />
            <Counter label="Rage dice" value={s.rage[side]} onChange={(v) => mutate((g) => ({ ...g, state: { ...g.state, rage: { ...g.state.rage, [side]: v } } }))} />
          </div>
        )}
      </Group>

      <Group label="Objectives">
        <div className="score-row">
          <span className="grow">{lines ? "Objective control" : "Objective VP"}</span>
          <span className="muted">{objectiveVp} pts</span>
        </div>
        {lines?.map((l) => {
          const on = sr.scored.includes(l.label);
          return (
            <label key={l.label} className={`toggle-row ${on ? "on" : ""}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => {
                  feedback(e.target.checked ? "score" : "tap");
                  void setSr(
                    { scored: e.target.checked ? [...sr.scored, l.label] : sr.scored.filter((x) => x !== l.label) },
                    e.target.checked ? `${who} scored "${l.label}" (+${l.vp}).` : undefined,
                  );
                }}
              />
              <span className="grow">
                {l.label}
                <small>{l.vp}pts</small>
              </span>
            </label>
          );
        })}
        {!lines && (
          <p className="muted small">{game.battleplan ? `No scoring card for "${game.battleplan}": add the VP below.` : "Pick the battleplan to get its scoring."}</p>
        )}
        <div className="score-row">
          <span className="grow">{lines ? "Other VP" : "VP this turn"}</span>
          <Counter label="pts" value={sr.extraVp} min={-50} onChange={(v) => setSr({ extraVp: v })} />
        </div>
      </Group>

      <Group label={`Battle tactics: ${tactics.reduce((sum, t) => sum + tacticSteps(rounds, side, t.card).size, 0) * TACTIC_VP}/${tactics.length * 15 || 30}`}>
        {!tactics.length && <p className="muted small">No cards picked. Choose them in the Battle Tactics steps.</p>}
        {tactics.map((t) => {
          const doneHere = sr.tactics.find((x) => x.card === t.card);
          const total = tacticSteps(rounds, side, t.card).size * TACTIC_VP;
          const laterDone = tacticSteps(rounds, side, t.card).size > tacticSteps(rounds, side, t.card, n).size;
          const step = doneHere?.step ?? nextTacticStep(rounds, side, t.card);
          const card = meta?.battleTactics.find((b) => b.name === t.card);
          const goal = step ? card?.[cap(step) as "Affray" | "Strike" | "Domination"]?.split("\n")[0].replace(/:\s*$/, "").replace(/\*+/g, "") : undefined;
          return (
            <div key={t.card} className="score-row tactic-row">
              <span className="grow">
                {t.card}
                <small className="muted">{step ? `${cap(step)}${goal ? `: ${goal}` : ""}` : "All done"}</small>
                <span className="tactic-progress">
                  <TacticSeals done={tacticSteps(rounds, side, t.card)} next={nextTacticStep(rounds, side, t.card)} />
                  <span className="muted tactic-total">{total}/15</span>
                </span>
              </span>
              {doneHere ? (
                <button
                  type="button"
                  className="score-btn on"
                  disabled={laterDone}
                  aria-label={`Undo ${cap(doneHere.step)} of ${t.card}`}
                  onClick={() => setSr({ tactics: sr.tactics.filter((x) => x.card !== t.card) }, `${who} undid ${cap(doneHere.step)} of ${t.card}.`)}
                >
                  <Icon name="check" /> {cap(doneHere.step)}
                </button>
              ) : (
                <button
                  type="button"
                  className="score-btn"
                  disabled={!step || blocked || laterDone}
                  onClick={() => {
                    if (!step) return;
                    feedback("tactic");
                    void setSr({ tactics: [...sr.tactics, { card: t.card, step }] }, `${who} completed ${cap(step)} of ${t.card} (+${TACTIC_VP}).`);
                  }}
                >
                  +{TACTIC_VP}pts
                </button>
              )}
            </div>
          );
        })}
      </Group>
    </>
  );
  if (folded)
    return (
      <details className="side-block side-fold">
        <summary>
          <Avatar faction={faction} size={1.8} />
          <b className="grow">{name}</b>
          <span className="muted small">
            +{roundVp} VP · {Math.max(0, sr.cpGained - sr.cpSpent)} CP
          </span>
          <Icon name="down" />
        </summary>
        {body}
      </details>
    );
  return <section className="side-block">{body}</section>;
}
