// What a battle report is built from: the facts the game recorded (who went
// first, the score round by round, tactics completed, units destroyed, the
// log), and the highlights shown as badges on a club feed post. The coach
// writes the story from these facts only (server/coach.ts, battleReport).

import { baseFaction } from "./season.ts";
import { result, sideRoundVp } from "./scoring.ts";
import type { ArmyList, Game } from "./types.ts";

type Side = "me" | "opponent";
const other = (s: Side): Side => (s === "me" ? "opponent" : "me");

export interface ReportSides {
  me: { name: string; faction: string; list?: ArmyList };
  opponent: { name: string; faction: string; list?: ArmyList };
}

export function reportSides(game: Game, myList?: ArmyList, opponentList?: ArmyList): ReportSides {
  return {
    me: { name: game.myName || "Player 1", faction: myList?.faction || game.myFaction || "", list: myList },
    opponent: { name: game.opponentName || "Player 2", faction: opponentList?.faction || game.opponentFaction || "", list: opponentList },
  };
}

/** VP each side had at the end of each round played. */
export function runningScore(game: Game): { me: number; opponent: number }[] {
  const out: { me: number; opponent: number }[] = [];
  let me = 0;
  let opponent = 0;
  (game.state.rounds ?? []).forEach((rec, i) => {
    if (!rec.first) return;
    me += sideRoundVp(rec.me, game.battleplan, i + 1);
    opponent += sideRoundVp(rec.opponent, game.battleplan, i + 1);
    out.push({ me, opponent });
  });
  return out;
}

/** Who took a double turn in which round (went first right after going second). */
export function doubleTurns(game: Game): { round: number; side: Side }[] {
  const rounds = game.state.rounds ?? [];
  return rounds.flatMap((rec, i) => (i > 0 && rec.first && rounds[i - 1].first && rec.first === other(rounds[i - 1].first!) ? [{ round: i + 1, side: rec.first }] : []));
}

/** The game as plain facts, for the coach to tell as a story. */
export function reportFacts(game: Game, sides: ReportSides): string {
  const name = (s: Side) => sides[s].name;
  const s = game.state;
  const rounds = s.rounds ?? [];
  const totals = runningScore(game);
  const lines: string[] = [
    `Players: ${name("me")} (${sides.me.faction || "unknown faction"}) vs ${name("opponent")} (${sides.opponent.faction || "unknown faction"}).`,
    `Battleplan: ${game.battleplan || "not recorded"}. ${game.points ?? 2000} points. Date: ${game.date ?? game.createdAt.slice(0, 10)}.`,
    `Attacker: ${name(s.attacker)}.`,
  ];
  rounds.forEach((rec, i) => {
    if (!rec.first) return;
    const parts = [`Round ${i + 1}: ${rec.priority ? `${name(rec.priority)} won priority, ` : ""}${name(rec.first)} took the first turn.`];
    for (const side of ["me", "opponent"] as const) {
      const sr = rec[side];
      const vp = sideRoundVp(sr, game.battleplan, i + 1);
      const bits = [`${vp} VP`];
      if (sr.scored.length) bits.push(`scored ${sr.scored.join(", ")}`);
      for (const t of sr.tactics) bits.push(`completed the ${t.step} tactic of ${t.card}`);
      if (sr.cpSpent) bits.push(`spent ${sr.cpSpent} CP`);
      parts.push(`${name(side)}: ${bits.join("; ")}.`);
    }
    if (totals[i]) parts.push(`Score after round ${i + 1}: ${name("me")} ${totals[i].me}, ${name("opponent")} ${totals[i].opponent}.`);
    lines.push(parts.join(" "));
  });
  for (const d of doubleTurns(game)) lines.push(`${name(d.side)} took a double turn in round ${d.round}.`);
  for (const side of ["me", "opponent"] as const) {
    const fallen = (sides[side].list?.units ?? []).filter((u) => s.units[`${side}:${u.key}`]?.destroyed).map((u) => u.name);
    const hurt = (sides[side].list?.units ?? []).filter((u) => !s.units[`${side}:${u.key}`]?.destroyed && (s.units[`${side}:${u.key}`]?.damage ?? 0) > 0).map((u) => u.name);
    if (fallen.length) lines.push(`${name(side)} lost: ${fallen.join(", ")}.`);
    if (hurt.length) lines.push(`${name(side)}'s wounded survivors: ${hurt.join(", ")}.`);
    const army = (sides[side].list?.units ?? []).map((u) => u.name);
    if (army.length) lines.push(`${name(side)}'s army: ${army.join(", ")}.`);
  }
  if (s.objectives) lines.push(`Board notes: ${s.objectives}`);
  if (s.notes) lines.push(`Notes: ${s.notes}`);
  if (game.log.length) lines.push(`Game log:\n${game.log.slice(-60).map((l) => `- ${l.text}`).join("\n")}`);
  const r = result(game);
  const conclusion = game.finished?.conclusion;
  const how = conclusion === "conceded-me" ? `${name("me")} conceded.` : conclusion === "conceded-opponent" ? `${name("opponent")} conceded.` : conclusion === "time" ? "The game ended on time." : "";
  lines.push(
    `Final score: ${name("me")} ${s.vp.me}, ${name("opponent")} ${s.vp.opponent}. ${how} ${r === "win" ? `${name("me")} won.` : r === "loss" ? `${name("opponent")} won.` : r === "draw" ? "A draw." : "The game is not finished yet."}`,
  );
  return lines.join("\n");
}

/** Highlights of one game, e.g. "Comeback win" or "Double turn". */
export function gameBadges(game: Game, sides: ReportSides): string[] {
  const badges: string[] = [];
  const r = result(game);
  const winner: Side | null = r === "win" ? "me" : r === "loss" ? "opponent" : null;
  const { me, opponent } = game.state.vp;
  if (winner) {
    const margin = Math.abs(me - opponent);
    const behind = runningScore(game).some((t) => (winner === "me" ? t.opponent - t.me : t.me - t.opponent) >= 10);
    if (behind) badges.push(`Comeback win for ${sides[winner].name}`);
    else if (margin >= 25) badges.push(`Crushing victory for ${sides[winner].name}`);
    if (margin <= 3) badges.push("Nail-biter");
  } else if (r === "draw") badges.push("Dead even");
  if (doubleTurns(game).length) badges.push("Double turn");
  for (const side of ["me", "opponent"] as const) {
    for (const t of (side === "me" ? game.state.tactics : game.state.opponentTactics) ?? []) {
      if (t.affray && t.strike && t.domination) badges.push(`${sides[side].name} mastered ${t.card}`);
    }
  }
  return badges;
}

/** Highlights for the player posting, from their own games (finished, oldest first). */
export function playerBadges(game: Game, myFaction: string, history: { game: Game; faction: string }[]): string[] {
  const badges: string[] = [];
  const done = history.filter((h) => h.game.finished).sort((a, b) => (a.game.date ?? a.game.createdAt).localeCompare(b.game.date ?? b.game.createdAt));
  const base = myFaction ? baseFaction(myFaction) : "";
  if (base && game.finished && done.filter((h) => h.faction && baseFaction(h.faction) === base).length === 1) badges.push(`First game with ${base}`);
  let streak = 0;
  for (const h of [...done].reverse()) {
    if (result(h.game) !== "win") break;
    streak++;
  }
  if (result(game) === "win" && streak >= 3) badges.push(`${streak} wins in a row`);
  return badges;
}
