// Thorgrim's game plan, and telling him what happened mid-turn.

import { useEffect, useRef, useState } from "react";
import { planBasis } from "../../../../shared/scoring.ts";
import type { Game, GamePlan, TurnTips } from "../../../../shared/types.ts";
import { api, pendingJob, runJob, waitForJob } from "../../api.ts";
import { shrinkPhoto, VoiceButton } from "../../media.tsx";
import { Icon, useMeta } from "../../ui.tsx";
import type { Update } from "../gameTools.tsx";
import { feedback } from "../../sound.ts";
import { type Step, type Mutate, Explained } from "./common.tsx";

// ---------- what happened (mid-turn input) ----------

export const QUICK_EVENTS = ["Failed a charge", "Lost a unit", "Destroyed a unit", "Objective changed hands", "Opponent did something unexpected"];

/** Tell Thorgrim what happened (typed, dictated or as a photo of the table); it re-plans the rest of the turn. */
export function WhatHappened(props: {
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
        <textarea data-gramm="false" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder='e.g. "Failed the 7" charge with the Stonehorn, they killed my Gnoblars and hold the centre"' />
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

export function PlanStep({ game, mutate, saved, go }: { game: Game; mutate: Mutate; saved: () => Promise<unknown>; go: (s: Step) => void }) {
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

      <button type="button" className="primary wide start-game" onClick={() => (feedback("round"), go("round-1"))}>
        Start the game: Round 1 <Icon name="right" />
      </button>
    </div>
  );
}

/** Rewrite the game plan from the current round when the game has turned. */
export function Replan({ game, mutate, saved }: { game: Game; mutate: Mutate; saved: () => Promise<unknown> }) {
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
