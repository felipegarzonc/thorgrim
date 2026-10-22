// The chess clock: each player's thinking time. The time used so far is kept
// per side; while it runs, `since` says when the active player's time started,
// so every phone (both players of a shared game) shows the same running clock.

import type { GameState } from "./types.ts";

type Side = "me" | "opponent";
export type Clock = NonNullable<GameState["clock"]>;

/** Time used by each side at `now` (ms), counting the running stretch. */
export function clockTimes(s: Pick<GameState, "clock" | "activePlayer">, now = Date.now()): Record<Side, number> {
  const c = s.clock ?? { me: 0, opponent: 0 };
  const run = c.since ? Math.max(0, now - Date.parse(c.since)) : 0;
  return { me: c.me + (s.activePlayer === "me" ? run : 0), opponent: c.opponent + (s.activePlayer === "opponent" ? run : 0) };
}

/** Start or pause the clock. */
export function toggleClock(s: GameState, now = Date.now()): GameState {
  const c = s.clock ?? { me: 0, opponent: 0 };
  if (c.since) return { ...s, clock: { ...clockTimes(s, now) } };
  return { ...s, clock: { me: c.me, opponent: c.opponent, since: new Date(now).toISOString() } };
}

/** When the turn passes, the time so far goes to the player who just finished, and the other player's time starts. */
export function passClock(before: GameState, after: GameState, now = Date.now()): GameState {
  if (!before.clock?.since || before.activePlayer === after.activePlayer) return after;
  return { ...after, clock: { ...clockTimes(before, now), since: new Date(now).toISOString() } };
}

/** 1:05:09 or 5:09. */
export function formatClock(ms: number): string {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
