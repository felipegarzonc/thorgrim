// A game, step by step like a scoresheet app: players, setup, battleplan,
// battle tactics, one screen per battle round, then the results. Each round
// screen also runs the live turn (phases) with Thorgrim's plan for it.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { baseFaction, BATTLE_ROUNDS, CORE_COMMANDS, isBattleplanDoc, SEASON_ABILITIES, NUMBERED_BATTLEPLANS, scoringFor, SEASON_TACTICS, SEIZE_EXCEPTION_LEAD, TACTIC_VP } from "../../../shared/season.ts";
import { derive, emptyRound, nextTacticStep, planBasis, result, sideRoundVp, startRound, tacticSteps } from "../../../shared/scoring.ts";
import { PHASES, type ArmyList, type FactionRule, type Game, type GamePlan, type GameState, type GlossaryEntry, type LibraryDoc, type Phase, type SideRound, type TacticProgress, type TacticStep, type TurnTips, type Unit } from "../../../shared/types.ts";
import { applyOps, diff } from "../../../shared/patch.ts";
import { clockTimes, formatClock, passClock, toggleClock } from "../../../shared/clock.ts";
import { applyVoice, describeChange, type VoiceChange } from "../../../shared/voice.ts";
import { rivalRecord } from "../../../shared/stats.ts";
import { api, pendingJob, runJob, waitForJob, withKey } from "../api.ts";
import { gameDate, sideInfo } from "../gameView.tsx";
import { shrinkPhoto, VoiceButton } from "../media.tsx";
import { armyColor, Avatar, Counter, FactionPicker, Group, Icon, RulesText, Seg, Sheet, useLoad, useMeta } from "../ui.tsx";
import { CoachChat } from "./CoachChat.tsx";
import { BoardInfo, LogCard, OddsCard, other, PhaseChecklist, UnitsCard, useUnits, type Army, type Side, type Update } from "./gameTools.tsx";
import { battleplanInfo } from "../../../shared/battleplans.ts";
import { BattleplanCard } from "../battleplanView.tsx";
import { drawResult, shareImage, type ShareRow } from "../shareImage.ts";
import { WarscrollCard } from "./Lists.tsx";
import { BattleReportCard, ReviewCard } from "./report.tsx";
import { shareText, shareUrl } from "../links.ts";
import { moment } from "../analytics.tsx";
import { buzz, CountUp, Gain, Sparks } from "../motion.tsx";
import { BCP_HOME, bcpUrl } from "../../../shared/bcp.ts";
import { translate } from "../../../shared/i18n/index.ts";
import { currentLang } from "../i18n.ts";
import { VpLines } from "../vpChart.tsx";
import { ScoreSheet } from "../scoreSheet.tsx";
import { doubleTurns, gameBadges, reportSides, runningScore } from "../../../shared/report.ts";

type Step = string;
const ROUND_STEPS = Array.from({ length: BATTLE_ROUNDS }, (_, i) => `round-${i + 1}`);
// Every screen of a game (the menu lists them all)...
const STEPS: Step[] = ["players", "setup", "battleplan", "tactics", "plan", ...ROUND_STEPS, "results"];
// ...and the quick way through it: game details and Thorgrim's plan are optional, so Next skips them.
const FLOW: Step[] = STEPS.filter((s) => s !== "setup" && s !== "plan");
/** Older links to the two tactics screens open the combined one. */
const OLD_STEPS: Record<string, Step> = { "tactics-me": "tactics", "tactics-opponent": "tactics" };
const STEP_TITLE: Record<string, string> = {
  players: "Players",
  setup: "Game details (optional)",
  battleplan: "Battleplan",
  tactics: "Battle Tactics",
  plan: "Game plan (optional)",
  results: "Results",
};
/** The quick-flow step before / after any step (optional ones sit between their neighbours). */
const flowStep = (current: Step, dir: 1 | -1): Step | undefined => {
  const i = STEPS.indexOf(current);
  const around = dir === 1 ? STEPS.slice(i + 1) : STEPS.slice(0, i).reverse();
  return around.find((s) => FLOW.includes(s));
};
const stepTitle = (s: Step) => STEP_TITLE[s] ?? `Round ${s.split("-")[1]}`;
const cap = (k: string) => k[0].toUpperCase() + k.slice(1);
const PLAY_PHASES: Phase[] = PHASES.filter((p) => p !== "Deployment");
const SHORT: Record<Phase, string> = {
  Deployment: "Deploy",
  "Start of Turn": "Start",
  Hero: "Hero",
  Movement: "Move",
  Shooting: "Shoot",
  Charge: "Charge",
  Combat: "Combat",
  "End of Turn": "End",
};

type Mutate = (fn: (g: Game) => Game, log?: string) => Promise<void>;
type SheetName = "menu" | "coach" | "armies" | "odds" | "log" | "share";
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

  // Open the game; changes this phone made but couldn't send (no signal) go back on top.
  useEffect(() => {
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
    ref.current = next;
    setGame(next);
    queueSend();
    return saving.current.then(() => undefined);
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
        {current === "tactics" && (
          <div className="stack">
            <TacticsStep game={game} side="me" mutate={mutate} />
            <TacticsStep game={game} side="opponent" mutate={mutate} />
          </div>
        )}
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
        {current === "results" && <ResultsStep game={game} lists={lists} mutate={mutate} saved={() => saving.current} openCoach={() => setSheet("coach")} serverChanged={shareChanged} />}
      </div>

      <footer className="step-bar">
        <button type="button" className="icon" aria-label="Previous step" disabled={!prevStep} onClick={() => prevStep && go(prevStep)}>
          <Icon name="left" />
        </button>
        <span className="step-title">{stepTitle(current)}</span>
      </footer>
      {!(current === `round-${game.state.round}` && game.state.phase !== "Deployment" && game.state.rounds?.[game.state.round - 1]?.first) && (
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

/** The join link for a shared game, and who joined. */
function ShareGame({ game, changed }: { game: Game; changed: (g: Game) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const access = game.access;
  const players = access?.players ?? [];
  const run = async (fn: () => Promise<Game>) => {
    setBusy(true);
    try {
      await changed(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (access?.role === "player")
    return (
      <div className="stack">
        <p>
          <b>{access.ownerName || "Your opponent"}</b> shared this game with you. You both see the same score, CP, fury and rounds, and either of you can change them.
        </p>
        <p className="small muted">Your plan, turn tips and chat with Thorgrim stay yours. To leave the game, use Leave game in the menu.</p>
      </div>
    );
  const link = access?.token ? shareUrl("play", access.token) : "";
  const shareLink = async () => {
    if (navigator.share) return navigator.share({ text: shareText("Join my game on Thorgrim:", link) }).catch(() => undefined);
    await navigator.clipboard?.writeText(link);
    setCopied(true);
  };
  return (
    <div className="stack">
      <p>Send your opponent a link. Once they open it (they need a Thorgrim account), you both see the same score, CP, fury and rounds, and either of you can change them.</p>
      <p className="small muted">Each of you keeps your own plan, turn tips and chat with Thorgrim.</p>
      {!link ? (
        <button type="button" className="primary wide" disabled={busy} onClick={() => run(() => api<Game>(`/games/${game.id}/share`, { method: "POST" }))}>
          <Icon name="share" /> {busy ? "Making the link…" : "Make a join link"}
        </button>
      ) : (
        <>
          <input readOnly value={link} aria-label="Join link" onFocus={(e) => e.target.select()} />
          <button type="button" className="primary wide" onClick={shareLink}>
            <Icon name="share" /> {copied ? "Link copied" : "Send the link"}
          </button>
          <p className="small">{players.length ? `Playing with: ${players.join(", ")}` : "Nobody has joined yet."}</p>
          <button
            type="button"
            className="ghost danger"
            disabled={busy}
            onClick={() => {
              if (confirm("Stop sharing? The link stops working and the players who joined lose this game.")) void run(() => api<Game>(`/games/${game.id}/share`, { method: "DELETE" }));
            }}
          >
            Stop sharing
          </button>
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

// ---------- explaining abilities Thorgrim names ----------

interface RuleText {
  name: string;
  from: string;
  text: string;
}
const RulesContext = createContext<(name: string) => RuleText | undefined>(() => undefined);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Find an ability, spell, prayer or command by name in both armies and the core rules. */
function rulesLookup(armies: Record<Side, Army>, units: Record<string, Unit>) {
  const index = new Map<string, RuleText>();
  const add = (name: string, from: string, text: string) => {
    if (!index.has(norm(name))) index.set(norm(name), { name, from, text });
  };
  for (const side of ["me", "opponent"] as const) {
    for (const lu of armies[side].list?.units ?? []) {
      for (const a of units[lu.unitId]?.abilities ?? []) add(a.name, lu.name, [a.timing && `*${a.timing}*`, a.declare && `**Declare:** ${a.declare}`, a.effect].filter(Boolean).join("\n\n"));
    }
    for (const r of armies[side].rules) add(r.ability.name, r.group || r.entry, [r.ability.timing && `*${r.ability.timing}*`, r.ability.declare && `**Declare:** ${r.ability.declare}`, r.ability.effect].filter(Boolean).join("\n\n"));
  }
  for (const c of [...CORE_COMMANDS, ...SEASON_ABILITIES]) add(c.name, c.cost ? `Command · ${c.cost} CP` : "Season rule", c.summary);
  return (name: string) => index.get(norm(name));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Coach text with the abilities it names made tappable: what it does, and the full rule. */
function Explained({ text, glossary = [] }: { text: string; glossary?: GlossaryEntry[] }) {
  const lookup = useContext(RulesContext);
  const [open, setOpen] = useState<string | null>(null);
  const terms = glossary.filter((g) => g.name.trim().length > 2).sort((a, b) => b.name.length - a.name.length);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => escapeRe(t.name)).join("|")})`, "gi");
  const parts = text.split(re);
  const entry = open ? terms.find((t) => t.name.toLowerCase() === open.toLowerCase()) : undefined;
  const full = entry ? lookup(entry.name) : undefined;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <button key={i} type="button" className={`term ${open?.toLowerCase() === part.toLowerCase() ? "on" : ""}`} onClick={() => setOpen(open?.toLowerCase() === part.toLowerCase() ? null : part)}>
            {part}
          </button>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
      {entry && (
        <span className="term-card" role="note">
          <b>{entry.name}</b>
          {full?.from && <small className="muted"> · {full.from}</small>}
          <span className="term-effect">{entry.effect}</span>
          {full && (
            <details>
              <summary>Full rule</summary>
              <RulesText text={full.text} />
            </details>
          )}
        </span>
      )}
    </>
  );
}

// ---------- players ----------

function PlayersStep({
  game,
  lists,
  mutate,
  reloadLists,
  shareChanged,
}: {
  game: Game;
  lists?: ArmyList[];
  mutate: Mutate;
  reloadLists: () => void;
  /** Set when accounts are on: invite the opponent to play on their own phone. */
  shareChanged?: (g: Game) => Promise<void>;
}) {
  return (
    <div className="stack">
      {(["me", "opponent"] as const).map((side) => (
        <PlayerBlock key={side} side={side} game={game} lists={lists} mutate={mutate} reloadLists={reloadLists} />
      ))}
      {shareChanged && (
        <section>
          <h1 className="step-heading">Play together</h1>
          <ShareGame game={game} changed={shareChanged} />
        </section>
      )}
    </div>
  );
}

function PlayerBlock({ side, game, lists, mutate, reloadLists }: { side: Side; game: Game; lists?: ArmyList[]; mutate: Mutate; reloadLists: () => void }) {
  const info = sideInfo(game, lists, side);
  const nameKey = side === "me" ? "myName" : "opponentName";
  const listKey = side === "me" ? "myListId" : "opponentListId";
  const factionKey = side === "me" ? "myFaction" : "opponentFaction";
  const tacticsKey = side === "me" ? "tactics" : "opponentTactics";
  const [name, setName] = useState(game[nameKey] ?? "");
  const typing = useRef(false);
  // Follow name changes from the other player (or their account name once they join).
  useEffect(() => {
    if (!typing.current) setName(game[nameKey] ?? "");
  }, [game[nameKey]]);
  const [picking, setPicking] = useState(false);
  const [pasting, setPasting] = useState(false);

  const chooseList = (id: string, fresh?: ArmyList) => {
    const list = fresh ?? lists?.find((l) => l.id === id);
    mutate(
      (g) => {
        const current = (side === "me" ? g.state.tactics : g.state.opponentTactics) ?? [];
        const fromList: TacticProgress[] = (list?.tacticCards ?? []).slice(0, 2).map((card) => ({ card, affray: false, strike: false, domination: false }));
        return { ...g, [listKey]: id, state: { ...g.state, [tacticsKey]: current.length || !fromList.length ? current : fromList } };
      },
      list ? `${side === "me" ? "My" : "Opponent's"} list: ${list.name}.` : undefined,
    );
  };
  const ordered = [...(lists ?? [])].sort((a, b) => Number(b.owner === side) - Number(a.owner === side) || b.createdAt.localeCompare(a.createdAt));

  return (
    <section>
      <h1 className="step-heading">{side === "me" ? "You" : "Opponent"}</h1>
      <label className="field">
        <span className="field-label">{side === "me" ? "Your name" : "Opponent's name"}</span>
        <span className="field-box">
          <Icon name="user" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={() => (typing.current = true)}
            onBlur={() => {
              typing.current = false;
              if (name !== (game[nameKey] ?? "")) void mutate((g) => ({ ...g, [nameKey]: name.trim() }));
            }}
            placeholder={side === "me" ? "Your name" : "Opponent's name"}
          />
        </span>
      </label>
      <div className="list-row">
        <Icon name="lists" />
        <select value={game[listKey]} onChange={(e) => chooseList(e.target.value)} aria-label={`${side === "me" ? "Your" : "Opponent's"} army list`}>
          <option value="">Add an army list…</option>
          {ordered.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.faction || "?"})
            </option>
          ))}
        </select>
        <button type="button" className="small" onClick={() => setPasting(true)}>
          Paste
        </button>
      </div>
      <button type="button" className="ghost faction-row" onClick={() => setPicking(true)} disabled={!!info.list}>
        {info.faction ? <Avatar faction={info.faction} /> : <span className="avatar-space" />}
        <span className="grow">
          {info.faction ? info.base : "Select a faction…"}
          {info.sub && <small className="muted">{info.sub}</small>}
          {info.list && <small className="muted">From the army list</small>}
        </span>
      </button>
      {picking && (
        <FactionPicker
          onClose={() => setPicking(false)}
          onPick={(f) => {
            setPicking(false);
            mutate((g) => ({ ...g, [factionKey]: f }));
          }}
        />
      )}
      {pasting && (
        <PasteList
          side={side}
          onClose={() => setPasting(false)}
          onSaved={(l) => {
            setPasting(false);
            reloadLists();
            chooseList(l.id, l);
          }}
        />
      )}
    </section>
  );
}

function PasteList({ side, onClose, onSaved }: { side: Side; onClose: () => void; onSaved: (l: ArmyList) => void }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await api<ArmyList>("/lists", { method: "POST", json: { name: name || (side === "me" ? "My list" : "Opponent's list"), owner: side, rawText: text } }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Paste an army list" onClose={onClose}>
      <p className="muted small">From the GW app, New Recruit or Listhammer. Units are matched to warscrolls; the list is saved under Lists.</p>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Beastclaw Hunt" />
      </label>
      <label>
        List text
        <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="button" className="primary wide" disabled={!text.trim() || busy} onClick={save}>
        {busy ? "Saving…" : "Save list"}
      </button>
    </Sheet>
  );
}

// ---------- setup ----------

function SetupStep({ game, mutate }: { game: Game; mutate: Mutate }) {
  const isPlayer = game.access?.role === "player";
  const [name, setName] = useState(game.name);
  return (
    <div className="stack">
      <label className="field">
        <span className="field-label">Game date</span>
        <span className="field-box">
          <Icon name="calendar" />
          <input type="date" value={game.date ?? game.createdAt.slice(0, 10)} onChange={(e) => mutate((g) => ({ ...g, date: e.target.value }))} />
        </span>
      </label>
      <label className="field">
        <span className="field-label">Game description</span>
        <span className="field-box">
          <Icon name="pencil" />
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== game.name && mutate((g) => ({ ...g, name }))} placeholder="e.g. Club night, Tuesday league" />
        </span>
      </label>

      <BcpSetup game={game} mutate={mutate} />

      <h3>Mission pack</h3>
      <div className="card list-card">
        <div className="list-item">
          <Icon name="castle" />
          <span className="grow">
            Pitched Battles 2026-27
            <small className="muted">General's Handbook · Matched Play</small>
          </span>
        </div>
        <label className="list-item">
          <Icon name="rules" />
          <select value={game.points ?? 2000} onChange={(e) => mutate((g) => ({ ...g, points: Number(e.target.value) }))} aria-label="Points">
            {[1000, 1500, 2000, 2500].map((p) => (
              <option key={p} value={p}>
                {p}pts
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        className="card danger delete-game"
        onClick={async () => {
          if (!confirm(isPlayer ? "Leave this game? It stays with the player who shared it." : "Delete this game and its conversation with Thorgrim?")) return;
          await api(`/games/${game.id}`, { method: "DELETE" });
          window.location.hash = "#/games";
        }}
      >
        {isPlayer ? "Leave game" : "Delete game"}
      </button>
    </div>
  );
}

/** A Best Coast Pairings tournament game: where it is played, and its BCP page for the result. */
function BcpSetup({ game, mutate }: { game: Game; mutate: Mutate }) {
  const bcp = game.bcp;
  const [draft, setDraft] = useState({ event: bcp?.event ?? "", round: bcp?.round ? String(bcp.round) : "", table: bcp?.table ? String(bcp.table) : "", url: bcp?.url ?? "" });
  const [error, setError] = useState<string>();
  const save = (d = draft) => {
    if (d.url.trim() && !bcpUrl(d.url)) return setError("That isn't a Best Coast Pairings link.");
    setError(undefined);
    const num = (v: string) => (Number(v) > 0 ? Math.round(Number(v)) : undefined);
    void mutate((g) => ({ ...g, bcp: { event: d.event.trim(), round: num(d.round), table: num(d.table), url: bcpUrl(d.url) } }));
  };
  const field = (k: keyof typeof draft) => ({
    value: draft[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value })),
    onBlur: () => save(),
  });
  return (
    <section className="bcp-setup">
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={!!bcp}
          onChange={(e) => void mutate((g) => (e.target.checked ? { ...g, bcp: { event: draft.event.trim() } } : { ...g, bcp: undefined }))}
        />
        <span className="grow">
          Best Coast Pairings tournament
          <small>Score it here; at the end, the result is ready to enter in BCP.</small>
        </span>
      </label>
      {bcp && (
        <div className="stack">
          <label className="field">
            <span className="field-label">Tournament</span>
            <span className="field-box">
              <Icon name="trophy" />
              <input {...field("event")} placeholder="e.g. Iberian Masters" maxLength={80} />
            </span>
          </label>
          <div className="two-fields">
            <label className="field">
              <span className="field-label">Round</span>
              <span className="field-box">
                <input type="number" inputMode="numeric" min={1} {...field("round")} />
              </span>
            </label>
            <label className="field">
              <span className="field-label">Table</span>
              <span className="field-box">
                <input type="number" inputMode="numeric" min={1} {...field("table")} />
              </span>
            </label>
          </div>
          <label className="field">
            <span className="field-label">BCP link (optional)</span>
            <span className="field-box">
              <Icon name="share" />
              <input type="url" inputMode="url" {...field("url")} placeholder="https://www.bestcoastpairings.com/event/…" />
            </span>
          </label>
          {error && <p className="error small">{error}</p>}
        </div>
      )}
    </section>
  );
}

/** The tournament this game belongs to, with its BCP page. */
function BcpBanner({ bcp }: { bcp: NonNullable<Game["bcp"]> }) {
  const url = bcpUrl(bcp.url) ?? BCP_HOME;
  return (
    <a className="event-banner bcp-banner" href={url} target="_blank" rel="noreferrer">
      <Icon name="trophy" />
      <span className="grow">{[`BCP · ${bcp.event || "Tournament"}`, bcp.round && `Round ${bcp.round}`, bcp.table && `Table ${bcp.table}`].filter(Boolean).join(" · ")}</span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}

/** At the end of a BCP game: the result as BCP asks for it, to copy and enter there. */
function BcpResult({ game, names }: { game: Game; names: Record<Side, string> }) {
  const [copied, setCopied] = useState(false);
  const s = game.state;
  const rounds = s.rounds ?? [];
  const tacticPts = (side: Side) => (((side === "me" ? s.tactics : s.opponentTactics) ?? []).reduce((n, t) => n + tacticSteps(rounds, side, t.card).size, 0) * TACTIC_VP);
  const r = result(game);
  const outcome = r === "win" ? "Victory" : r === "loss" ? "Defeat" : r === "draw" ? "Draw" : "";
  const t = (x: string) => translate(x, currentLang());
  const text = [
    `${names.me} ${s.vp.me} – ${s.vp.opponent} ${names.opponent}${outcome ? ` (${t(outcome)})` : ""}`,
    `${t("Battle tactics")}: ${tacticPts("me")} – ${tacticPts("opponent")}`,
    game.battleplan && `${t("Battleplan")}: ${game.battleplan}`,
  ]
    .filter(Boolean)
    .join("\n");
  const url = bcpUrl(game.bcp?.url) ?? BCP_HOME;
  return (
    <section className="card bcp-result">
      <h2>Enter the result in BCP</h2>
      <p className="small muted">Best Coast Pairings is where the tournament keeps its standings: enter this there (both players usually confirm it in the BCP app).</p>
      <div className="bcp-score">
        <span>
          <small>{names.me}</small>
          <b>{s.vp.me}</b>
        </span>
        <span className="bcp-dash">–</span>
        <span>
          <small>{names.opponent}</small>
          <b>{s.vp.opponent}</b>
        </span>
      </div>
      <p className="small bcp-detail">
        Battle tactics: {tacticPts("me")} – {tacticPts("opponent")}
        {game.battleplan ? ` · ${game.battleplan}` : ""}
      </p>
      <div className="row">
        <a className="button primary small" href={url} target="_blank" rel="noreferrer">
          Open BCP ↗
        </a>
        <button
          type="button"
          className="small"
          onClick={() =>
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            })
          }
        >
          {copied ? "Copied" : "Copy the result"}
        </button>
      </div>
    </section>
  );
}

// ---------- battleplan ----------

function BattleplanStep({ game, mutate }: { game: Game; mutate: Mutate }) {
  const [docs] = useLoad<LibraryDoc[]>("/library");
  const [notes, setNotes] = useState(game.battleplanNotes);
  const pick = (name: string) => mutate((g) => ({ ...g, battleplan: name }), `Battleplan: ${name}.`);
  // The battleplan card / map from the rules library, matched by title: nothing to set up.
  const images = (docs ?? []).filter((d) => d.kind === "image" && isBattleplanDoc(d, game.battleplan));
  const setAttacker = (a: Side) =>
    mutate((g) => ({
      ...g,
      state: { ...g.state, attacker: a, ...(g.state.phase === "Deployment" ? { fury: { me: a === "me" ? 1 : 2, opponent: a === "opponent" ? 1 : 2 } } : {}) },
    }));
  return (
    <div className="stack">
      <h1 className="step-heading">Battleplan</h1>
      <button type="button" className="outline wide" onClick={() => pick(NUMBERED_BATTLEPLANS[Math.floor(Math.random() * NUMBERED_BATTLEPLANS.length)].name)}>
        <Icon name="games" /> Randomize
      </button>
      <ul className="plan-list" role="radiogroup" aria-label="Battleplan">
        {NUMBERED_BATTLEPLANS.map((b) => {
          const on = game.battleplan.toLowerCase() === b.name.toLowerCase();
          return (
            <li key={b.number}>
              <button type="button" role="radio" aria-checked={on} className={`ghost ${on ? "on" : ""}`} onClick={() => pick(b.name)}>
                <span className="plan-no">{b.number}</span>
                <span className="grow">{b.name}</span>
                <span className="radio" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      <h3>Attacker</h3>
      <div className="question">
        <span>Who is the attacker?</span>
        <Seg label="Attacker" value={game.state.attacker} options={[["me", "You"], ["opponent", "Opponent"]]} onChange={setAttacker} />
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Starting fury: attacker 1, defender 2.
      </p>

      {game.battleplan && (
        <>
          <h3>{game.battleplan}</h3>
          <BattleplanCard name={game.battleplan} attacker={game.state.attacker} />
        </>
      )}

      <h3>Card photo</h3>
      {images.length ? (
        <div className="map-grid">
          {images.map((d) => (
            <figure key={d.id}>
              <a href={withKey(`/api/library/${d.id}/file`)} target="_blank" rel="noreferrer">
                <img src={withKey(`/api/library/${d.id}/file`)} alt={d.title} loading="lazy" />
              </a>
              <figcaption>{d.title}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="map-empty muted small">{game.battleplan ? `No photo of the ${game.battleplan} card in the rules library yet.` : "Pick a battleplan to see its map and rules."}</p>
      )}
      <label>
        Notes for Thorgrim
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== game.battleplanNotes && mutate((g) => ({ ...g, battleplanNotes: notes }))} placeholder="Objective positions, terrain, deployment zones…" />
      </label>
    </div>
  );
}

// ---------- battle tactics ----------

function TacticsStep({ game, side, mutate }: { game: Game; side: Side; mutate: Mutate }) {
  const meta = useMeta();
  const key = side === "me" ? "tactics" : "opponentTactics";
  const chosen = (side === "me" ? game.state.tactics : game.state.opponentTactics) ?? [];
  const isOn = (c: string) => chosen.some((t) => t.card === c);
  const toggle = (c: string) =>
    mutate(
      (g) => {
        const cur = (side === "me" ? g.state.tactics : g.state.opponentTactics) ?? [];
        const next = cur.some((t) => t.card === c) ? cur.filter((t) => t.card !== c) : [...cur, { card: c, affray: false, strike: false, domination: false }];
        return { ...g, state: { ...g.state, [key]: next } };
      },
      `${side === "me" ? "My" : "Opponent's"} battle tactics: ${isOn(c) ? "removed" : "picked"} ${c}.`,
    );
  const season = SEASON_TACTICS.filter((c) => meta?.battleTactics.some((b) => b.name === c));
  const others = (meta?.battleTactics ?? []).map((b) => b.name).filter((c) => !SEASON_TACTICS.includes(c));
  const row = (c: string, i: number) => {
    const card = meta?.battleTactics.find((b) => b.name === c);
    const on = isOn(c);
    return (
      <div key={c} className="tactic-pick">
        {i >= 0 && <span className="tactic-no">Tactic Card {i + 1}</span>}
        <label className="inline tactic-check">
          <input type="checkbox" checked={on} disabled={!on && chosen.length >= 2} onChange={() => toggle(c)} />
          <span className="grow">{c}</span>
        </label>
        <details className="card-rules">
          <summary>Card rules</summary>
          {card?.Card && <RulesText text={card.Card} />}
          {(["Affray", "Strike", "Domination"] as const).map((k) => (card?.[k] ? <RulesText key={k} text={`**${k}** — ${card[k]}`} /> : null))}
        </details>
      </div>
    );
  };
  return (
    <div className="stack">
      <div>
        <h1 className="step-heading">{side === "me" ? "Your Battle Tactics" : "Opponent's Battle Tactics"}</h1>
        <p className="muted small" style={{ margin: "0.3rem 0 0" }}>
          Pick 2 cards. Each has Affray, Strike and Domination, completed in that order for {TACTIC_VP} VP each.
        </p>
      </div>
      {season.map((c, i) => row(c, i))}
      {others.length > 0 && (
        <details>
          <summary className="muted small" style={{ cursor: "pointer", padding: "0.5rem 0" }}>
            Other cards in the army data ({others.length})
          </summary>
          {others.map((c) => row(c, -1))}
        </details>
      )}
    </div>
  );
}

// ---------- what happened (mid-turn input) ----------

const QUICK_EVENTS = ["Failed a charge", "Lost a unit", "Destroyed a unit", "Objective changed hands", "Opponent did something unexpected"];

/** Tell Thorgrim what happened (typed, dictated or as a photo of the table); it re-plans the rest of the turn. */
function WhatHappened(props: {
  game: Game;
  n: number;
  mutate: Mutate;
  update: Update;
  saved: () => Promise<unknown>;
  coachReady: boolean;
  onBusy: (b: boolean) => void;
  onTips: (t: TurnTips) => Promise<void>;
}) {
  const { game, n, mutate, update, saved, coachReady, onBusy, onTips } = props;
  const s = game.state;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState<string | false>(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!photo) return setPreview(undefined);
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const add = (t: string) => setText((cur) => (cur ? `${cur.replace(/\s+$/, "")}. ${t}` : t));

  // Note and photo are saved first; if the call to Thorgrim then fails, "Try again" only repeats that call.
  const [pending, setPending] = useState<string | null>(null);
  const replan = async (note: string) => {
    setBusy("Re-planning the rest of the turn…");
    await saved();
    const key = `${n}:${s.activePlayer}`;
    const t = await runJob<TurnTips>(`/games/${game.id}/tips`, { round: n, side: s.activePlayer, event: note, phase: s.phase, previous: s.tips?.[key] });
    await onTips(t);
  };
  const run = async (fn: () => Promise<void>) => {
    setError(undefined);
    onBusy(true);
    try {
      await fn();
      setPending(null);
      setDone(true);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      const note = text.trim();
      if (!note && !photo) return;
      if (photo) {
        setBusy("Sending the photo…");
        const body = await shrinkPhoto(photo);
        const { path } = await api<{ path: string }>(`/games/${game.id}/photo`, { method: "POST", body, headers: { "content-type": "image/jpeg" } });
        // The latest photo is Thorgrim's view of the table; every photo also joins the game's battle photos (report and club post).
        await mutate(
          (g) => ({
            ...g,
            state: { ...g.state, tablePhoto: { path, at: new Date().toISOString(), round: n, phase: g.state.phase } },
            report: { ...(g.report ?? { title: "", story: "", tone: "saga" as const, photos: [] }), photos: [...(g.report?.photos ?? []), path].slice(-8) },
          }),
          "Photo of the table.",
        );
        setPhoto(null);
      }
      if (note) update({}, `What happened: ${note}`);
      setText("");
      const event = note || "New photo of the table: check positions.";
      setPending(event);
      if (coachReady) await replan(event);
    });

  if (!open)
    return (
      <div className="happened-bar">
        <button type="button" className="outline" onClick={() => (setOpen(true), setDone(false))}>
          <Icon name="pencil" /> What happened?
        </button>
        {done && <span className="small muted">{coachReady ? "Plan updated." : "Noted in the log."}</span>}
      </div>
    );

  return (
    <div className="happened">
      <div className="row spread" style={{ margin: 0 }}>
        <b>What happened?</b>
        <button type="button" className="icon small-icon" aria-label="Close" onClick={() => setOpen(false)}>
          <Icon name="close" />
        </button>
      </div>
      <div className="chips">
        {QUICK_EVENTS.map((q) => (
          <button key={q} type="button" className="chip" onClick={() => add(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="happened-input">
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder='e.g. "Failed the 7" charge with the Stonehorn, they killed my Gnoblars and hold the centre"' />
        <VoiceButton label="Dictate what happened" onText={add} />
      </div>
      <div className="happened-actions">
        <label className="button ghost photo-btn">
          <Icon name="camera" /> {photo ? "Change photo" : "Photo of the table"}
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        {preview && <img className="photo-thumb" src={preview} alt="Table photo to send" />}
        <span className="grow" />
        <button type="button" className="primary" disabled={!!busy || (!text.trim() && !photo)} onClick={send}>
          <Icon name="send" /> {coachReady ? "Update plan" : "Save"}
        </button>
      </div>
      {busy && <p className="small muted thinking">{busy}</p>}
      {error && (
        <p className="small error">
          {error}{" "}
          {pending && coachReady && (
            <button type="button" className="small" onClick={() => run(() => replan(pending))}>
              Try again
            </button>
          )}
        </p>
      )}
      {pending && !busy && <p className="small muted" style={{ margin: 0 }}>Saved in the game log.</p>}
      {s.tablePhoto && !photo && (
        <p className="small muted" style={{ margin: 0 }}>
          Thorgrim has your photo from round {s.tablePhoto.round} ({s.tablePhoto.phase}).
        </p>
      )}
    </div>
  );
}

// ---------- the game plan ----------

function PlanStep({ game, mutate, saved, go }: { game: Game; mutate: Mutate; saved: () => Promise<unknown>; go: (s: Step) => void }) {
  const meta = useMeta();
  const plan = game.plan;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const asked = useRef(false);
  const ready = !!game.battleplan && !!(game.myListId || game.myFaction) && !!(game.opponentListId || game.opponentFaction);
  const stale = !!plan && plan.basis !== planBasis(game);

  const make = async () => {
    asked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await saved(); // the server reads the saved game
      const basis = planBasis(game);
      const started = (game.state.rounds?.length ?? 0) > 0 && game.state.phase !== "Deployment";
      const p = await runJob<Omit<GamePlan, "basis">>(`/games/${game.id}/plan`, { replan: started }, `plan:${game.id}`);
      await mutate((g) => ({ ...g, plan: { ...p, basis } }), "Thorgrim wrote the game plan.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // A plan still being written (page reloaded, phone locked): pick it up.
  const resume = async (id: string) => {
    asked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const p = await waitForJob<Omit<GamePlan, "basis">>(id, `plan:${game.id}`);
      await mutate((g) => ({ ...g, plan: { ...p, basis: planBasis(g) } }), "Thorgrim wrote the game plan.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const pending = pendingJob(`plan:${game.id}`);
    if (pending && !asked.current) void resume(pending);
    else if (!plan && ready && meta?.coachReady && !asked.current) void make();
  }, [meta?.coachReady]);

  const section = (title: string, items: string[], tone = "") =>
    items.length > 0 && (
      <section className={`plan-section ${tone}`}>
        <h3>{title}</h3>
        <ul>
          {items.map((t, i) => (
            <li key={i}>
              <Explained text={t} glossary={plan?.glossary} />
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="stack">
      <div className="row spread" style={{ margin: 0 }}>
        <h1 className="step-heading">Game Plan</h1>
        {plan && (
          <button type="button" className="small ghost accent" disabled={busy} onClick={make}>
            <Icon name="refresh" /> {busy ? "Writing…" : "New plan"}
          </button>
        )}
      </div>

      {!meta?.coachReady ? (
        <p className="notice">
          Add your Claude API key on the <a href="#/ask">Thorgrim</a> page and Thorgrim writes a plan for this game here.
        </p>
      ) : !ready && !plan ? (
        <p className="notice">Pick both armies and the battleplan first: the plan is built from them (and from the battle tactics and the map).</p>
      ) : busy && !plan ? (
        <div className="card plan-wait">
          <Icon name="spark" />
          <p className="thinking">Studying both armies, the battleplan and your battle tactics…</p>
          <p className="muted small">About a minute or two. You can lock the phone or leave this page: the plan keeps being written and shows up when you come back.</p>
        </div>
      ) : error ? (
        <p className="error">
          {error}{" "}
          <button type="button" className="small" onClick={make}>
            Try again
          </button>
        </p>
      ) : !plan ? (
        <button type="button" className="primary wide" onClick={make}>
          <Icon name="spark" /> Write the game plan
        </button>
      ) : null}

      {plan && (
        <>
          {stale && (
            <p className="notice small">
              The armies, battleplan or tactics changed since this plan was written.{" "}
              <button type="button" className="small ghost accent" disabled={busy} onClick={make}>
                Update it
              </button>
            </p>
          )}
          <section className="card plan-summary">
            <Icon name="spark" />
            <p>
              <Explained text={plan.summary} glossary={plan.glossary} />
            </p>
          </section>
          <div className="plan-two">
            {section("Our strengths", plan.ourStrengths, "me")}
            {section("Their threats", plan.theirThreats, "opponent")}
          </div>
          {section("Deployment", plan.deployment)}
          <section className="plan-section">
            <h3>Round by round</h3>
            <ol className="plan-rounds">
              {plan.rounds.map((r) => (
                <li key={r.round}>
                  <span className="plan-round-no">{r.round}</span>
                  <span>
                    <Explained text={r.plan} glossary={plan.glossary} />
                  </span>
                </li>
              ))}
            </ol>
          </section>
          {section("Battle tactics", plan.tactics)}
          {section("Priority & double turns", plan.priority)}
          {section("Don't lose it by", plan.avoid, "warn")}
        </>
      )}

      <button type="button" className="primary wide start-game" onClick={() => go("round-1")}>
        Start the game: Round 1 <Icon name="right" />
      </button>
    </div>
  );
}

/** Rewrite the game plan from the current round when the game has turned. */
function Replan({ game, mutate, saved }: { game: Game; mutate: Mutate; saved: () => Promise<unknown> }) {
  const meta = useMeta();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!meta?.coachReady) return null;
  const run = async () => {
    if (!confirm("Rewrite the game plan from this round, using the score, the log and the table photo?")) return;
    setBusy(true);
    setError(undefined);
    try {
      await saved();
      const basis = planBasis(game);
      const p = await runJob<Omit<GamePlan, "basis">>(`/games/${game.id}/plan`, { replan: true }, `plan:${game.id}`);
      await mutate((g) => ({ ...g, plan: { ...p, basis } }), `Thorgrim re-planned the game in round ${game.state.round}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="replan">
      <button type="button" className="small ghost accent" disabled={busy} onClick={run}>
        <Icon name="refresh" /> {busy ? "Re-planning…" : "Re-plan"}
      </button>
      {error && <span className="small error">{error}</span>}
    </span>
  );
}

// ---------- a battle round ----------

function RoundStep(props: {
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
      <Scoreboard game={game} names={names} factions={factions} isLive={isLive} />
      {orderKnown && !editOrder ? (
        <button type="button" className="order-summary" onClick={() => setEditOrder(true)}>
          <span className="grow">
            {n > 1 && rec?.priority ? `${names[rec.priority]} won priority · ` : ""}
            {names[rec!.first!]} went first
          </span>
          <span className="order-change">Change</span>
        </button>
      ) : (
      <Group className="priority">
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
          name={names[side]}
          faction={factions[side]}
          folded={isLive && side !== s.activePlayer}
        />
      ))}

      {isLive && s.phase === PLAY_PHASES[PLAY_PHASES.length - 1] && <EndTurn game={game} n={n} update={update} names={names} go={go} />}

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
      {n === BATTLE_ROUNDS && liveRound === n && s.activePlayer !== s.firstThisRound && s.phase === "End of Turn" && (
        <button type="button" className="primary wide" onClick={() => go("results")}>
          See the results
        </button>
      )}
    </div>
  );
}

/** Both armies at a glance: VP, command points as coins, fury as flames, and whose turn it is. */
function Scoreboard({ game, names, factions, isLive }: { game: Game; names: Record<Side, string>; factions: Record<Side, string>; isLive: boolean }) {
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
        return (
          <div key={side} className={`score-card ${active ? "active" : ""}`} style={{ ["--army" as string]: armyColor(factions[side]) }}>
            <div className="score-card-head">
              <Avatar faction={factions[side]} size={2.1} />
              <span>
                <b>{names[side]}</b>
                <small>{factions[side] ? baseFaction(factions[side]) : "No army yet"}</small>
              </span>
            </div>
            {isLive && <span className={`turn-tag ${active ? "on" : ""}`}>{active ? (side === "me" ? "YOUR TURN" : "THEIR TURN") : "WAITING"}</span>}
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
function TacticSeals({ done, next }: { done: Set<TacticStep>; next?: TacticStep }) {
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

/** The live turn: phases, Thorgrim's plan for this phase, and what not to forget. */
function TurnCard(props: Parameters<typeof RoundStep>[0] & { color: string }) {
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
  useEffect(() => {
    void fetchTips();
  }, [key, meta?.coachReady]);

  const lastPhase = phaseIndex === PLAY_PHASES.length - 1;
  const phaseTips = tips?.phases[s.phase] ?? [];

  return (
    <section className={`turn-card ${active}`} style={{ ["--army" as string]: props.color }}>
      <div className="turn-head turn-in" key={`${n}:${active}`}>
        <span className="turn-label">
          Turn {turnNo} · <b>{active === "me" ? "Your turn" : `${names.opponent}'s turn`}</b>
        </span>
        <span className="muted small">{s.cp[active]} CP</span>
      </div>
      <nav className="phase-chips" aria-label="Phases">
        {PLAY_PHASES.map((p, i) => (
          <button key={p} type="button" className={i < phaseIndex ? "past" : i === phaseIndex ? "current" : ""} aria-current={i === phaseIndex ? "step" : undefined} onClick={() => update({ phase: p })}>
            {SHORT[p]}
          </button>
        ))}
      </nav>
      {s.seizedInitiative === active && <p className="small warning">Seized the initiative: no battle tactics this turn.</p>}
      <ChessClock state={s} names={names} toggle={() => mutate((g) => ({ ...g, state: toggleClock(g.state) }))} />

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
        ) : busy && !tips ? (
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
        <button type="button" className="small ghost accent" onClick={openCoach}>
          Ask Thorgrim
        </button>
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

      {lastPhase ? (
        <button type="button" className="score-below" onClick={() => document.getElementById("end-turn")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
          Score the turn below, then end it <Icon name="down" />
        </button>
      ) : (
        <button type="button" className="primary wide" onClick={() => (buzz(8), update({ phase: PLAY_PHASES[phaseIndex + 1] }))}>
          {`Next: ${PLAY_PHASES[phaseIndex + 1]}`} <Icon name="right" />
        </button>
      )}
    </section>
  );
}

/** After the scoring: end the turn, the round or the game. */
function EndTurn({ game, n, update, names, go }: Pick<Parameters<typeof RoundStep>[0], "game" | "n" | "update" | "names" | "go">) {
  const s = game.state;
  const active = s.activePlayer;
  const turnNo = active === s.firstThisRound ? 1 : 2;
  const end = () => {
    buzz(8);
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
function VoiceScore({ game, n, mutate, names, saved }: { game: Game; n: number; mutate: Mutate; names: Record<Side, string>; saved: () => Promise<unknown> }) {
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
function ChessClock({ state, names, toggle }: { state: GameState; names: Record<Side, string>; toggle: () => void }) {
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

function SideBlock({
  side,
  game,
  n,
  mutate,
  isLive,
  name,
  faction,
  folded,
}: {
  side: Side;
  game: Game;
  n: number;
  mutate: Mutate;
  isLive: boolean;
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
        {isLive && (
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
                  buzz(e.target.checked ? 18 : 8);
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
                    buzz(24);
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

// ---------- results ----------

/** Both players confirm the final result, so the game counts on the club ladder. */
function LadderConfirm({ game, saved, changed, names }: { game: Game; saved: () => Promise<unknown>; changed: (g: Game) => Promise<void>; names: Record<Side, string> }) {
  const meta = useMeta();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!meta?.accounts || !game.finished) return null;
  const c = game.access?.confirmed;
  if (!c)
    return (
      <p className="ladder-note small muted">
        <Icon name="flag" /> Results count on the club ladder when you play together: share the game with your opponent (menu › Play together).
      </p>
    );
  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await saved();
      await changed(await api<Game>(`/games/${game.id}/confirm`, { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`card ladder-confirm ${c.me && c.opponent ? "done" : ""}`} aria-label="Club ladder">
      <div className="ladder-confirm-head">
        <Icon name="flag" />
        <b className="grow">{c.me && c.opponent ? "Counts on the club ladder" : "Confirm the result for the club ladder"}</b>
      </div>
      <div className="ladder-who">
        <span className={c.me ? "ok" : ""}>
          {c.me ? <Icon name="check" /> : <span className="dot" />} {names.me}
        </span>
        <span className={c.opponent ? "ok" : ""}>
          {c.opponent ? <Icon name="check" /> : <span className="dot" />} {names.opponent}
        </span>
      </div>
      {!c.me && (
        <button type="button" className="primary wide" disabled={busy} onClick={confirm}>
          {busy ? "Confirming…" : `Confirm ${game.state.vp.me}–${game.state.vp.opponent}`}
        </button>
      )}
      {c.me && !c.opponent && <p className="small muted">Waiting for {names.opponent} to confirm. Changing the score resets both confirmations.</p>}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

/** Each side's VP round by round (see vpChart.tsx). */
function VpChart({ game, names, colors }: { game: Game; names: Record<Side, string>; colors: Record<Side, string> }) {
  return <VpLines totals={runningScore(game)} doubles={doubleTurns(game)} names={names} colors={colors} />;
}

const CONCLUSIONS = [
  ["played", "Played to end of game"],
  ["time", "Ran out of time"],
  ["conceded-opponent", "Opponent conceded"],
  ["conceded-me", "I conceded"],
] as const;

function ResultsStep({
  game,
  lists,
  mutate,
  saved,
  openCoach,
  serverChanged,
}: {
  game: Game;
  lists?: ArmyList[];
  mutate: Mutate;
  saved: () => Promise<unknown>;
  openCoach: () => void;
  serverChanged: (g: Game) => Promise<void>;
}) {
  const [conclusion, setConclusion] = useState<NonNullable<Game["finished"]>["conclusion"]>(game.finished?.conclusion ?? "played");
  const s = game.state;
  const rounds = s.rounds ?? [];
  const r = result({ state: s, finished: { conclusion, at: "" } });
  const me = sideInfo(game, lists, "me");
  const opp = sideInfo(game, lists, "opponent");
  const status = r === "win" ? "VICTORY" : r === "loss" ? "DEFEAT" : "DRAW";

  const change = (c: typeof conclusion) => {
    setConclusion(c);
    if (game.finished) void mutate((g) => ({ ...g, finished: { conclusion: c, at: g.finished!.at } }));
  };
  const summary = `${me.name} ${s.vp.me} - ${s.vp.opponent} ${opp.name} · ${status} · ${game.battleplan || "Age of Sigmar"}`;

  // The image is drawn ahead of time, so tapping Share opens the share sheet straight away (iPhone needs that).
  const shareRows = (side: Side): ShareRow[] => {
    const tactics = (side === "me" ? s.tactics : s.opponentTactics) ?? [];
    const pad = <T,>(xs: T[]) => Array.from({ length: BATTLE_ROUNDS }, (_, i) => xs[i] ?? null);
    const obj = rounds.map((rec, i) => (rec.first ? sideRoundVp({ ...rec[side], tactics: [] }, game.battleplan, i + 1) : null));
    return [
      { label: "Objectives", cells: pad(obj), total: String(obj.reduce<number>((x, v) => x + (v ?? 0), 0)) },
      ...tactics.map((t) => ({
        label: t.card,
        cells: pad(rounds.map((rec) => (rec[side].tactics.some((x) => x.card === t.card) ? TACTIC_VP : rec.first ? 0 : null))),
        total: `${tacticSteps(rounds, side, t.card).size * TACTIC_VP}/15`,
      })),
    ];
  };
  const shareKey = JSON.stringify([s.vp, s.rounds, conclusion, me.name, opp.name, me.faction, opp.faction, game.battleplan]);
  const [image, setImage] = useState<{ file: File; url: string }>();
  const [shareMsg, setShareMsg] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    let url = "";
    void drawResult({
      date: gameDate(game),
      status,
      me: { name: me.name, faction: me.faction, sub: me.sub, vp: s.vp.me, rows: shareRows("me") },
      opponent: { name: opp.name, faction: opp.faction, sub: opp.sub, vp: s.vp.opponent, rows: shareRows("opponent") },
      footer: `Age of Sigmar 4e · Pitched Battles 2026-27 · ${game.battleplan || "battleplan not set"} · ${game.points ?? 2000}pts`,
    }).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setImage({ file: new File([blob], `${me.name}-vs-${opp.name}.png`.replace(/[^\w.-]+/g, "-"), { type: "image/png" }), url });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [shareKey]);
  const share = async () => {
    if (!image) return;
    try {
      const how = await shareImage(image.file, summary);
      setShareMsg(how === "downloaded" ? "Image saved: send it from your photos or downloads." : undefined);
    } catch {
      /* cancelled */
    }
  };

  const badges = gameBadges(game, reportSides(game, me.list, opp.list));
  // All-time record against this opponent, this game included as it stands now.
  const [allGames] = useLoad<Game[]>("/games");
  const rivalry = allGames && opp.name && rivalRecord([...allGames.filter((x) => x.id !== game.id), { ...game, finished: { conclusion, at: "" } }], opp.name);

  return (
    <div className="stack">
      <section className="victory" aria-label="Result">
        <div className="victory-ornament" aria-hidden="true">
          <span />
          <Icon name="flag" />
          <span />
        </div>
        <h1 className={`victory-title reveal ${r ?? ""}`} key={status}>
          {status}
          {r === "win" && <Sparks />}
        </h1>
        <div className="victory-score">
          <span className="right">
            <b>{me.name}</b>
            <small style={{ color: armyColor(me.faction) }}>{me.base}</small>
          </span>
          <span className="big-score">
            <CountUp value={s.vp.me} from={0} ms={900} />
            <span className="score-dot">·</span>
            <CountUp value={s.vp.opponent} from={0} ms={900} />
          </span>
          <span>
            <b>{opp.name}</b>
            <small style={{ color: armyColor(opp.faction) }}>{opp.base}</small>
          </span>
        </div>
      </section>
      {rivalry && rivalry.played > 1 && (
        <a className="rivalry-line" href="#/stats">
          <Icon name="swords" />
          <span className="grow">
            You vs {opp.name}, all time: <b>{rivalry.won}</b> won · <b>{rivalry.drawn}</b> drawn · <b>{rivalry.lost}</b> lost
          </span>
          <Icon name="right" />
        </a>
      )}
      {rounds.some((x) => x.first) && <VpChart game={game} names={{ me: me.name, opponent: opp.name }} colors={{ me: armyColor(me.faction), opponent: armyColor(opp.faction) }} />}
      {badges.length > 0 && (
        <div className="post-badges">
          {badges.map((b) => (
            <span key={b} className="badge">
              {b}
            </span>
          ))}
        </div>
      )}
      {game.bcp && <BcpResult game={{ ...game, finished: { conclusion, at: "" } }} names={{ me: me.name, opponent: opp.name }} />}
      <LadderConfirm game={game} saved={saved} changed={serverChanged} names={{ me: me.name, opponent: opp.name }} />
      <label className="field">
        <span className="field-label">Game conclusion</span>
        <span className="field-box">
          <Icon name="flag" />
          <select value={conclusion} onChange={(e) => change(e.target.value as typeof conclusion)}>
            {CONCLUSIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </span>
      </label>
      <ScoreSheet
        date={gameDate(game)}
        status={status}
        tone={r ?? ""}
        sides={[
          { name: me.name, base: me.base, sub: me.sub, vp: s.vp.me, rows: shareRows("me") },
          { name: opp.name, base: opp.base, sub: opp.sub, vp: s.vp.opponent, rows: shareRows("opponent") },
        ]}
        footer={`Age of Sigmar 4e · Pitched Battles 2026-27 · ${game.battleplan || "battleplan not set"} · ${game.points ?? 2000}pts`}
      />
      <div className="two-buttons">
        <button type="button" className="primary" disabled={!image} onClick={share}>
          <Icon name="share" /> {image ? "Share image" : "Preparing…"}
        </button>
        <button type="button" className="outline" onClick={openCoach}>
          <Icon name="coach" /> Review with Thorgrim
        </button>
      </div>
      {shareMsg && <p className="small muted">{shareMsg}</p>}
      {image && (
        <details className="share-preview">
          <summary>Preview the image</summary>
          <img src={image.url} alt={`Result image: ${summary}`} />
        </details>
      )}
      <ReviewCard game={game} mutate={mutate} saved={saved} />
      <BattleReportCard game={game} mutate={mutate} saved={saved} />
    </div>
  );
}
