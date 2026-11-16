// A game, step by step like a scoresheet app: players, setup, battleplan,
// battle tactics, one screen per battle round, then the results. Each round
// screen also runs the live turn (phases) with Thorgrim's plan for it.

import { useEffect, useRef, useState } from "react";
import { derive, result, roundPlayed } from "../../../shared/scoring.ts";
import type { ArmyList, FactionRule, Game } from "../../../shared/types.ts";
import { applyOps, diff } from "../../../shared/patch.ts";
import { passClock, toggleClock } from "../../../shared/clock.ts";
import { api, OFFLINE_EVENT } from "../api.ts";
import { sideInfo } from "../gameView.tsx";
import { Icon, Sheet, useLoad, useMeta } from "../ui.tsx";
import { CoachChat } from "./CoachChat.tsx";
import { BoardInfo, LogCard, OddsCard, other, useUnits, type Army, type Side, type Update } from "./gameTools.tsx";
import { WarscrollCard } from "./Lists.tsx";
import { moment } from "../analytics.tsx";
import { buzz } from "../motion.tsx";
import { useSwipe } from "../gestures.tsx";
import { type Step, ROUND_STEPS, BATTLE_STEPS, STEPS, OLD_STEPS, flowStep, stepTitle, type Mutate, type SheetName, RulesContext, rulesLookup } from "./game/common.tsx";
import { ShareGame, PlayersStep, SetupStep, BcpBanner, BattleplanStep, BothTactics } from "./game/setup.tsx";
import { PlanStep } from "./game/plan.tsx";
import { RoundStep } from "./game/round.tsx";
import { ResultsStep } from "./game/results.tsx";

/** How many changes back Undo can go. */
const UNDO_MAX = 30;
const isCoachWriting = (path: (string | number)[]) => ["plan", "review", "report"].includes(String(path[0])) || (path[0] === "state" && path[1] === "tips");
/** How often an open shared game checks for the other player's changes. */
const SYNC_MS = 2500;

function defaultStep(g: Game): Step {
  if (g.finished) return "results";
  if ((g.state.rounds?.length ?? 0) > 0 && g.state.phase !== "Deployment") return `round-${g.state.round}`;
  return "players";
}

export function GamePage({ id, step }: { id: string; step?: string }) {
  const [game, setGame] = useState<Game>();
  // `ref` is the game on screen; `base` the last copy from the server. What
  // differs between them is still to be sent, as small edits (shared/patch.ts).
  const ref = useRef<Game | undefined>(undefined);
  const base = useRef<Game | undefined>(undefined);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const [ownLists, reloadOwnLists] = useLoad<ArmyList[]>("/lists");
  const [gameLists, reloadGameLists] = useLoad<{ list: ArmyList; rules: FactionRule[] }[]>(game ? `/games/${id}/lists?ids=${game.myListId},${game.opponentListId}` : null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const meta = useMeta();
  const [sync, setSync] = useState<{ state: SyncState; error?: string }>({ state: "saved" });
  // The last changes made on this phone, newest last, so a mistaken tap can be taken back.
  const undoable = useRef<{ before: Game; after: Game }[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  // Open the game; changes this phone made but couldn't send (no signal) go back on top.
  useEffect(() => {
    undoable.current = [];
    setCanUndo(false);
    const pending = readPending(id);
    api<Game>(`/games/${id}`)
      .then((g) => {
        base.current = g;
        const later = pending ? diff(pending.base, pending.local) : [];
        const merged = later.length ? applyOps(g, later) : g;
        ref.current = later.length ? { ...merged, state: derive(merged) } : g;
        setGame(ref.current);
        if (later.length) queueSend();
      })
      .catch((e: Error) => {
        if (!pending) return setSync({ state: "error", error: e.message });
        // No signal: carry on from what this phone has, and send it later.
        base.current = pending.base;
        ref.current = pending.local;
        setGame(pending.local);
        setSync({ state: "offline" });
      });
  }, [id]);

  // Take the server's copy, keeping the changes made here since `seen` on top.
  const adopt = (server: Game, seen: Game) => {
    const later = diff(seen, ref.current);
    base.current = server;
    const next = later.length ? applyOps(server, later) : server;
    ref.current = later.length ? { ...next, state: derive(next) } : next;
    setGame(ref.current);
  };
  // Send what changed. Without signal the changes stay (on screen and on this phone) and go later.
  const send = async () => {
    const from = base.current;
    const sent = ref.current;
    if (!from || !sent) return;
    const ops = diff(from, sent);
    if (!ops.length) {
      writePending(id, undefined);
      return setSync({ state: "saved" });
    }
    writePending(id, { base: from, local: sent });
    setSync({ state: "saving" });
    try {
      adopt(await api<Game>(`/games/${sent.id}`, { method: "PATCH", json: { ops } }), sent);
      const left = base.current && ref.current ? diff(base.current, ref.current).length : 0;
      writePending(id, left ? { base: base.current!, local: ref.current! } : undefined);
      setSync({ state: left ? "saving" : "saved" });
    } catch (e) {
      setSync(isNetworkError(e) ? { state: "offline" } : { state: "error", error: (e as Error).message });
    }
  };
  const queueSend = () => {
    saving.current = saving.current.then(send);
  };
  // Opened from what this phone kept (no signal, see api.ts): say so in the badge; back online, it syncs.
  useEffect(() => {
    const kept = () => setSync((s) => (s.state === "saved" ? { state: "offline" } : s));
    window.addEventListener(OFFLINE_EVENT, kept);
    return () => window.removeEventListener(OFFLINE_EVENT, kept);
  }, []);
  // Not saved yet: try again every few seconds, and as soon as the phone is back online.
  useEffect(() => {
    if (sync.state !== "offline" && sync.state !== "error") return;
    const t = setInterval(() => navigator.onLine && queueSend(), 8000);
    window.addEventListener("online", queueSend);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", queueSend);
    };
  }, [sync.state]);

  // A shared game checks for the other player's changes while it is on screen.
  const shared = !!game && (game.access?.role === "player" || !!game.access?.token || !!game.access?.players.length);
  useEffect(() => {
    if (!shared) return;
    let busy = false;
    const t = setInterval(() => {
      if (busy || document.hidden) return;
      busy = true;
      saving.current = saving.current
        .then(async () => {
          // A few bytes to ask if anything changed; the whole game only when it did.
          const { version } = await api<{ version: number }>(`/games/${id}/version`);
          if (!base.current || version === (base.current.version ?? 0)) return;
          const server = await api<Game>(`/games/${id}`);
          if (base.current && server.version !== base.current.version) adopt(server, base.current);
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, SYNC_MS);
    return () => clearInterval(t);
  }, [id, shared]);

  const reloadLists = () => {
    reloadOwnLists();
    reloadGameLists();
  };
  // Your own lists, plus the other player's list in a shared game.
  const lists = ownLists && [...ownLists, ...(gameLists ?? []).map((g) => g.list).filter((l) => !ownLists.some((o) => o.id === l.id))];
  const rulesOf = (listId?: string) => gameLists?.find((g) => g.list.id === listId)?.rules;
  const myList = lists?.find((l) => l.id === game?.myListId);
  const oppList = lists?.find((l) => l.id === game?.opponentListId);
  const units = useUnits([myList, oppList]);
  const myRules = rulesOf(myList?.id);
  const oppRules = rulesOf(oppList?.id);

  // In the battle, a sideways swipe moves between the rounds and the result (like the bottom bar).
  const battleAt = BATTLE_STEPS.indexOf(OLD_STEPS[step ?? ""] ?? step ?? "");
  useSwipe((dir) => {
    const to = BATTLE_STEPS[battleAt + dir];
    if (!to) return;
    buzz(8);
    window.location.hash = `#/games/${id}/${to}`;
    window.scrollTo(0, 0);
  }, !!game && battleAt >= 0 && !sheet);
  // Playing together: when the round in play moves on (the other phone started it), a phone still on the
  // previous round's page follows. Opening the game, or a phone on another page, stays where it is.
  const liveRound = game ? (game.state.phase === "Deployment" ? 0 : game.state.round) : 0;
  const lastLive = useRef(liveRound);
  useEffect(() => {
    const was = lastLive.current;
    lastLive.current = liveRound;
    if (was > 0 && liveRound > was && (OLD_STEPS[step ?? ""] ?? step) === `round-${was}`) {
      window.location.hash = `#/games/${id}/round-${liveRound}`;
      window.scrollTo(0, 0);
    }
  }, [liveRound]);
  if (!game) return <p className="muted game-loading">{sync.state === "error" ? `Could not open the game: ${sync.error}` : "Loading…"}</p>;
  const isPlayer = game.access?.role === "player";
  // After making or stopping the join link: take the server's copy.
  const shareChanged = async (g: Game) => {
    await saving.current;
    adopt(g, ref.current!);
  };

  // Every change goes through here: derive totals, add a log line, save in order.
  const mutate: Mutate = (fn, log) => {
    const cur = ref.current!;
    let next = fn(cur);
    next = { ...next, state: passClock(cur.state, next.state) };
    next = { ...next, state: derive(next) };
    if (log) {
      const s = cur.state;
      // In a shared game both players write the log: say whose turn by name.
      const whose = shared ? `${(s.activePlayer === "me" ? me : opp).name}'s` : s.activePlayer === "me" ? "my" : "their";
      const prefix = log.startsWith("Battle round") || s.phase === "Deployment" ? "" : `R${s.round} ${whose} ${s.phase}: `;
      next = { ...next, log: [...next.log, { at: new Date().toISOString(), text: prefix + log }] };
    }
    // What Thorgrim wrote (plan, tips, review, report) isn't a move to take back.
    if (diff(cur, next).some((op) => !isCoachWriting(op.path))) {
      undoable.current = [...undoable.current.slice(-(UNDO_MAX - 1)), { before: cur, after: next }];
      setCanUndo(true);
    }
    ref.current = next;
    setGame(next);
    queueSend();
    return saving.current.then(() => undefined);
  };
  // Take back the last change: only what it changed goes back, so anything changed since
  // (by the other player too) stays.
  const undo = () => {
    const last = undoable.current.pop();
    setCanUndo(undoable.current.length > 0);
    if (!last || !ref.current) return;
    const back = applyOps(ref.current, diff(last.after, last.before));
    const next = { ...back, state: passClock(ref.current.state, derive(back)) };
    ref.current = next;
    setGame(next);
    buzz(12);
    queueSend();
  };
  const update: Update = (patch, log) => void mutate((g) => ({ ...g, state: { ...g.state, ...patch } }), log);

  const current = OLD_STEPS[step ?? ""] ?? (STEPS.includes(step ?? "") ? step! : defaultStep(game));
  const prevStep = flowStep(current, -1);
  const nextStep = flowStep(current, 1);
  const go = (s: Step) => {
    window.location.hash = `#/games/${game.id}/${s}`;
    window.scrollTo(0, 0);
  };

  const armies: Record<Side, Army> = {
    me: { side: "me", list: myList, rules: myRules ?? [] },
    opponent: { side: "opponent", list: oppList, rules: oppRules ?? [] },
  };
  const me = sideInfo(game, lists, "me");
  const opp = sideInfo(game, lists, "opponent");
  const lookup = rulesLookup(armies, units);

  // Closing a new game that was never filled in deletes it, so + then X leaves nothing behind.
  const close = async () => {
    const g = ref.current!;
    const untouched =
      !shared &&
      !g.myListId && !g.opponentListId && !g.battleplan && !g.opponentName && !g.myFaction && !g.opponentFaction && !g.state.rounds?.length && !g.log.length;
    await saving.current;
    if (untouched) await api(`/games/${g.id}`, { method: "DELETE" }).catch(() => undefined);
    window.location.hash = untouched ? "#/home" : "#/games";
  };
  const finish = async () => {
    await mutate(
      (g) => ({
        ...g,
        state: g.state.clock?.since ? toggleClock(g.state) : g.state,
        finished: g.finished ?? { conclusion: "played", at: new Date().toISOString() },
      }),
      "Game finished.",
    );
    moment("Game finished");
    // Played together: finishing confirms the result for the club ladder, and the page stays to show who still has to.
    if (game.access?.players.length || game.access?.role === "player") {
      await saving.current;
      const confirmed = await api<Game>(`/games/${game.id}/confirm`, { method: "POST" }).catch(() => undefined);
      if (confirmed) adopt(confirmed, ref.current!);
      if (current !== "results") go("results");
      else window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.location.hash = "#/games";
  };

  return (
    <RulesContext.Provider value={lookup}>
    <div className="game-screen">
      <header className="game-head">
        <button type="button" className="icon" aria-label="Close game" onClick={close}>
          <Icon name="close" />
        </button>
        <span className="game-head-title">
          {game.state.vp.me}-{game.state.vp.opponent} {me.name} vs {opp.name}
        </span>
        {canUndo && (
          <button type="button" className="icon" aria-label="Undo the last change" onClick={undo}>
            <Icon name="undo" />
          </button>
        )}
        <SyncBadge sync={sync} retry={queueSend} />
        <button type="button" className="icon" aria-label="Ask Thorgrim" onClick={() => setSheet("coach")}>
          <Icon name="coach" />
        </button>
        <button type="button" className="icon" aria-label="More" onClick={() => setSheet("menu")}>
          <Icon name="more" />
        </button>
      </header>

      <div className="step-body">
        {game.bcp && (current === "players" || current === "results" || current.startsWith("round-")) && <BcpBanner bcp={game.bcp} />}
        {game.event && (current === "players" || current === "results") && (
          <a className="event-banner" href={`#/club/event/${game.event.id}`}>
            <Icon name="trophy" /> {game.event.name} · Round {game.event.round} · Table {game.event.table}
          </a>
        )}
        {current === "players" && <PlayersStep game={game} lists={lists} mutate={mutate} reloadLists={reloadLists} shareChanged={meta?.accounts ? shareChanged : undefined} />}
        {current === "setup" && <SetupStep game={game} mutate={mutate} />}
        {current === "battleplan" && <BattleplanStep game={game} mutate={mutate} />}
        {current === "tactics" && <BothTactics game={game} mutate={mutate} names={{ me: me.name, opponent: opp.name }} />}
        {current === "plan" && <PlanStep game={game} mutate={mutate} saved={() => saving.current} go={go} />}
        {current.startsWith("round-") && (
          <RoundStep
            key={current}
            game={game}
            n={Number(current.split("-")[1])}
            mutate={mutate}
            update={update}
            saved={() => saving.current}
            armies={armies}
            units={units}
            names={{ me: me.name, opponent: opp.name }}
            go={go}
            openCoach={() => setSheet("coach")}
          />
        )}
        {current === "results" && <ResultsStep game={game} lists={lists} mutate={mutate} saved={() => saving.current} openCoach={() => setSheet("coach")} serverChanged={shareChanged} finish={finish} />}
      </div>

      <footer className="step-bar">
        <button type="button" className="icon" aria-label="Previous step" disabled={!prevStep} onClick={() => prevStep && go(prevStep)}>
          <Icon name="left" />
        </button>
        {current.startsWith("round-") || current === "results" ? (
          // In the battle: every round and the result one tap away.
          <nav className="round-strip" aria-label="Battle rounds">
            {[...ROUND_STEPS, "results"].map((s, i) => {
              const played = s !== "results" && roundPlayed(game.state.rounds?.[i]);
              const live = s === `round-${game.state.round}` && !game.finished;
              return (
                <button
                  key={s}
                  type="button"
                  className={`round-chip ${s === current ? "on" : ""} ${played ? "played" : ""} ${live ? "live" : ""}`}
                  aria-current={s === current ? "step" : undefined}
                  aria-label={stepTitle(s)}
                  onClick={() => go(s)}
                >
                  {s === "results" ? <Icon name="flag" /> : `R${i + 1}`}
                </button>
              );
            })}
          </nav>
        ) : (
          <span className="step-title grow">{stepTitle(current)}</span>
        )}
        {/* Elsewhere the round button does it. */}
        {current.startsWith("round-") && (
          <button type="button" className="icon" aria-label="Next step" disabled={!nextStep} onClick={() => nextStep && go(nextStep)}>
            <Icon name="right" />
          </button>
        )}
      </footer>
      {current !== "results" && !current.startsWith("round-") && (
      <button
        type="button"
        className="fab step-fab"
        aria-label={current === "results" || !nextStep ? "Finish game" : `Next: ${stepTitle(nextStep)}`}
        onClick={() => (current === "results" || !nextStep ? finish() : go(nextStep))}
      >
        <Icon name={current === "results" ? "check" : "right"} />
      </button>
      )}

      {sheet === "menu" && (
        <Sheet title="Game" onClose={() => setSheet(null)}>
          <ul className="pick-list">
            {(
              [
                ["coach", "coach", "Ask Thorgrim", "Questions, pre-game brief, post-game review"],
                ["armies", "shield", "Armies & warscrolls", "Both lists, unit by unit"],
                ["odds", "calc", "Attack odds", "Who can kill what, with current damage"],
                ["log", "log", "Board notes & game log", "Objectives, positions, what happened"],
                ...(meta?.accounts ? ([["share", "share", "Play together", isPlayer ? `Shared by ${game.access?.ownerName || "your opponent"}` : "Both players see and edit this game"]] as const) : []),
              ] as const
            ).map(([s, icon, title, sub]) => (
              <li key={s}>
                <button type="button" className="ghost" onClick={() => setSheet(s)}>
                  <Icon name={icon} />
                  <span className="grow">
                    {title}
                    <small className="muted">{sub}</small>
                  </span>
                  <Icon name="right" />
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="ghost danger"
                onClick={async () => {
                  const question = isPlayer
                    ? "Leave this game? It stays with the player who shared it."
                    : `Delete this game and its conversation with Thorgrim?${shared ? " The players you shared it with lose it too." : ""} This can't be undone.`;
                  if (!confirm(question)) return;
                  await saving.current;
                  await api(`/games/${game.id}`, { method: "DELETE" });
                  window.location.hash = "#/games";
                }}
              >
                <Icon name="trash" />
                <span className="grow">{isPlayer ? "Leave game" : "Delete game"}</span>
              </button>
            </li>
            {STEPS.map((s) => (
              <li key={s} className="step-link">
                <button
                  type="button"
                  className={`ghost ${s === current ? "on" : ""}`}
                  onClick={() => {
                    setSheet(null);
                    go(s);
                  }}
                >
                  <span className="grow">{stepTitle(s)}</span>
                  {s === current && <Icon name="check" />}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
      {sheet === "coach" && (
        <Sheet title="Thorgrim" onClose={() => setSheet(null)}>
          <CoachChat
            convoId={game.id}
            title="Thorgrim"
            placeholder="e.g. Should I take the double turn? Who should my Stonehorn charge?"
            presets={[
              ["Pre-game brief", "pregame"],
              ["Post-game review", "review"],
            ]}
            quick={[
              "What should I do this phase?",
              "I won the priority roll. Should I go first or second?",
              "Which battle tactic should I go for this turn?",
              "What can my opponent do to punish me right now?",
            ]}
          />
        </Sheet>
      )}
      {sheet === "armies" && (
        <Sheet title="Armies" onClose={() => setSheet(null)}>
          {[myList, oppList].map(
            (l) =>
              l && (
                <section key={l.id} className="stack" style={{ marginBottom: "1.5rem" }}>
                  <h2>
                    {l.owner === "me" ? me.name : opp.name}: {l.name}
                  </h2>
                  {l.units.map((u) => (
                    <WarscrollCard key={u.key} unitId={u.unitId} title={`${u.name}${u.reinforced ? " (Reinforced)" : ""}`} notes={u.notes} />
                  ))}
                </section>
              ),
          )}
          {!myList && !oppList && <p className="muted">Add army lists in the Players step to see warscrolls here.</p>}
        </Sheet>
      )}
      {sheet === "odds" && (
        <Sheet title="Attack odds" onClose={() => setSheet(null)}>
          <OddsCard game={game} armies={armies} units={units} />
        </Sheet>
      )}
      {sheet === "log" && (
        <Sheet title="Board & log" onClose={() => setSheet(null)}>
          <div className="stack">
            <BoardInfo state={game.state} update={update} />
            <LogCard game={game} update={update} />
          </div>
        </Sheet>
      )}
      {sheet === "share" && (
        <Sheet title="Play together" onClose={() => setSheet(null)}>
          <ShareGame game={game} changed={shareChanged} />
        </Sheet>
      )}
    </div>
    </RulesContext.Provider>
  );
}

type SyncState = "saved" | "saving" | "offline" | "error";
const PENDING = (id: string) => `thorgrim-pending:${id}`;

/** Changes not sent yet, kept on this phone so a reload without signal doesn't lose them. */
function readPending(id: string): { base: Game; local: Game } | undefined {
  try {
    return JSON.parse(localStorage.getItem(PENDING(id)) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}
function writePending(id: string, value: { base: Game; local: Game } | undefined) {
  try {
    if (value) localStorage.setItem(PENDING(id), JSON.stringify(value));
    else localStorage.removeItem(PENDING(id));
  } catch {
    /* private mode or full: the changes still live on screen */
  }
}
/** fetch fails with a TypeError when there is no connection at all. */
const isNetworkError = (e: unknown) => !navigator.onLine || e instanceof TypeError || /took too long|HTTP 50[234]/.test((e as Error)?.message ?? "");

/** Is the game saved? Quiet when it is; says so when it isn't, with a retry. */
function SyncBadge({ sync, retry }: { sync: { state: SyncState; error?: string }; retry: () => void }) {
  if (sync.state === "saved") return <span className="sync-badge saved" role="status" aria-label="Saved"><Icon name="check" /></span>;
  if (sync.state === "saving") return <span className="sync-badge" role="status">Saving…</span>;
  return (
    <button type="button" className={`sync-badge ${sync.state}`} onClick={retry} title={sync.error}>
      {sync.state === "offline" ? "Offline · will sync" : "Not saved · retry"}
    </button>
  );
}
