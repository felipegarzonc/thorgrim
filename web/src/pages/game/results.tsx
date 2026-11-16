// After the battle: the result, the ladder, the score chart and the report.

import { useEffect, useState } from "react";
import { BATTLE_ROUNDS, TACTIC_VP } from "../../../../shared/season.ts";
import { result, roundPlayed, sideRoundVp, tacticSteps } from "../../../../shared/scoring.ts";
import type { ArmyList, Game } from "../../../../shared/types.ts";
import { rivalRecord } from "../../../../shared/stats.ts";
import { api } from "../../api.ts";
import { gameDate, sideInfo } from "../../gameView.tsx";
import { armyColor, Icon, useLoad, useMeta } from "../../ui.tsx";
import type { Side } from "../gameTools.tsx";
import { drawResult, shareImageAndLink, type ShareRow } from "../../shareImage.ts";
import { BattleReportCard, ReviewCard } from "../report.tsx";
import { shareUrl } from "../../links.ts";
import { CountUp, Sparks } from "../../motion.tsx";
import { feedbackOnce } from "../../sound.ts";
import { VpLines } from "../../vpChart.tsx";
import { ScoreSheet } from "../../scoreSheet.tsx";
import { doubleTurns, gameBadges, reportSides, runningScore } from "../../../../shared/report.ts";
import { type Mutate } from "./common.tsx";
import { BcpResult } from "./setup.tsx";

// ---------- results ----------

/** Both players confirm the final result, so the game counts on the club ladder. */
export function LadderConfirm({ game, saved, changed, names }: { game: Game; saved: () => Promise<unknown>; changed: (g: Game) => Promise<void>; names: Record<Side, string> }) {
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
export function VpChart({ game, names, colors }: { game: Game; names: Record<Side, string>; colors: Record<Side, string> }) {
  return <VpLines totals={runningScore(game)} doubles={doubleTurns(game)} names={names} colors={colors} />;
}

export const CONCLUSIONS = [
  ["played", "Played to end of game"],
  ["time", "Ran out of time"],
  ["conceded-opponent", "Opponent conceded"],
  ["conceded-me", "I conceded"],
] as const;

export function ResultsStep({
  game,
  lists,
  mutate,
  saved,
  openCoach,
  serverChanged,
  finish,
}: {
  game: Game;
  lists?: ArmyList[];
  mutate: Mutate;
  saved: () => Promise<unknown>;
  openCoach: () => void;
  serverChanged: (g: Game) => Promise<void>;
  finish: () => Promise<void>;
}) {
  const [finishing, setFinishing] = useState(false);
  const together = !!game.access?.players.length || game.access?.role === "player";
  const [conclusion, setConclusion] = useState<NonNullable<Game["finished"]>["conclusion"]>(game.finished?.conclusion ?? "played");
  const s = game.state;
  const rounds = s.rounds ?? [];
  const r = result({ state: s, finished: { conclusion, at: "" } });
  const me = sideInfo(game, lists, "me");
  const opp = sideInfo(game, lists, "opponent");
  const status = r === "win" ? "VICTORY" : r === "loss" ? "DEFEAT" : "DRAW";
  // Heard when the game reaches its result, not when an old game is opened.
  useEffect(() => {
    if (!game.finished) feedbackOnce(`result-${game.id}`, r === "win" ? "victory" : r === "loss" ? "defeat" : "draw");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (c: typeof conclusion) => {
    setConclusion(c);
    if (game.finished) void mutate((g) => ({ ...g, finished: { conclusion: c, at: g.finished!.at } }));
  };
  const summary = `${me.name} ${s.vp.me} - ${s.vp.opponent} ${opp.name} · ${status} · ${game.battleplan || "Age of Sigmar"}`;

  // The image is drawn ahead of time, so tapping Share opens the share sheet straight away (iPhone needs that).
  const shareRows = (side: Side): ShareRow[] => {
    const tactics = (side === "me" ? s.tactics : s.opponentTactics) ?? [];
    const pad = <T,>(xs: T[]) => Array.from({ length: BATTLE_ROUNDS }, (_, i) => xs[i] ?? null);
    const obj = rounds.map((rec, i) => (roundPlayed(rec) ? sideRoundVp({ ...rec[side], tactics: [] }, game.battleplan, i + 1) : null));
    return [
      { label: "Objectives", cells: pad(obj), total: String(obj.reduce<number>((x, v) => x + (v ?? 0), 0)) },
      ...tactics.map((t) => ({
        label: t.card,
        cells: pad(rounds.map((rec) => (rec[side].tactics.some((x) => x.card === t.card) ? TACTIC_VP : roundPlayed(rec) ? 0 : null))),
        total: `${tacticSteps(rounds, side, t.card).size * TACTIC_VP}/15`,
      })),
    ];
  };
  const shareKey = JSON.stringify([s.vp, s.rounds, conclusion, me.name, opp.name, me.faction, opp.faction, game.battleplan, game.report?.title]);
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
      title: game.report?.title,
      badges: gameBadges(game, reportSides(game, me.list, opp.list)),
    }).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setImage({ file: new File([blob], `${me.name}-vs-${opp.name}.jpg`.replace(/[^\w.-]+/g, "-"), { type: "image/jpeg" }), url });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [shareKey]);
  // With a club report, the picture goes out with the link to the full report (made ahead, so the tap shares at once).
  const postId = game.report?.postId;
  const [reportLink, setReportLink] = useState<string>();
  useEffect(() => {
    if (!postId) return setReportLink(undefined);
    void api<{ shareToken?: string }>(`/feed/${postId}`)
      .then((p) => setReportLink(p.shareToken ? shareUrl("r", p.shareToken) : undefined))
      .catch(() => undefined);
  }, [postId]);
  const share = async () => {
    if (!image) return;
    let link = reportLink;
    if (postId && !link) {
      const p = await api<{ shareToken?: string }>(`/feed/${postId}/share`, { method: "POST" }).catch(() => undefined);
      link = p?.shareToken ? shareUrl("r", p.shareToken) : undefined;
      setReportLink(link);
    }
    const how = await shareImageAndLink(image.file, summary, link);
    setShareMsg(
      how === "tap-again"
        ? "The link to the full report is ready: tap Share image again."
        : how === "saved"
          ? link
            ? "Image saved and the report's link copied."
            : "Image saved: send it from your photos or downloads."
          : undefined,
    );
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
      {!game.finished && (
        <button
          type="button"
          className="primary wide finish-game"
          disabled={finishing}
          onClick={async () => {
            setFinishing(true);
            await finish().finally(() => setFinishing(false));
          }}
        >
          <Icon name="check" /> {finishing ? "Finishing…" : together ? `Finish and confirm ${s.vp.me}–${s.vp.opponent}` : "Finish game"}
        </button>
      )}
      {!game.finished && together && <p className="small muted finish-note">Finishing confirms this result for the club ladder; your opponent confirms it on their phone.</p>}
      <LadderConfirm game={game} saved={saved} changed={serverChanged} names={{ me: me.name, opponent: opp.name }} />
      {rivalry && rivalry.played > 1 && (
        <a className="rivalry-line" href="#/stats">
          <Icon name="swords" />
          <span className="grow">
            You vs {opp.name}, all time: <b>{rivalry.won}</b> won · <b>{rivalry.drawn}</b> drawn · <b>{rivalry.lost}</b> lost
          </span>
          <Icon name="right" />
        </a>
      )}
      {rounds.some(roundPlayed) && <VpChart game={game} names={{ me: me.name, opponent: opp.name }} colors={{ me: armyColor(me.faction), opponent: armyColor(opp.faction) }} />}
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
      <button type="button" className="outline wide print-sheet" onClick={() => window.print()}>
        <Icon name="lists" /> Print the score sheet or save it as PDF
      </button>
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
