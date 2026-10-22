import { describe, expect, it } from "vitest";
import { clockTimes, formatClock, passClock, toggleClock } from "../shared/clock.ts";
import { flipState } from "../shared/perspective.ts";
import type { GameState } from "../shared/types.ts";

const state = (patch: Partial<GameState> = {}) => ({ activePlayer: "me", ...patch }) as GameState;
const T0 = Date.parse("2026-10-22T10:00:00Z");

describe("chess clock", () => {
  it("runs for the active player and pauses", () => {
    const running = toggleClock(state(), T0);
    expect(clockTimes(running, T0 + 65_000)).toEqual({ me: 65_000, opponent: 0 });
    const paused = toggleClock(running, T0 + 65_000);
    expect(paused.clock).toEqual({ me: 65_000, opponent: 0 });
    expect(clockTimes(paused, T0 + 999_999)).toEqual({ me: 65_000, opponent: 0 });
  });

  it("switches to the other player when the turn passes", () => {
    const running = toggleClock(state(), T0);
    const passed = passClock(running, { ...running, activePlayer: "opponent" }, T0 + 30_000);
    expect(clockTimes(passed, T0 + 50_000)).toEqual({ me: 30_000, opponent: 20_000 });
    // A paused clock stays paused.
    expect(passClock(state(), state({ activePlayer: "opponent" }), T0).clock).toBeUndefined();
  });

  it("shows the same times to the player who joined", () => {
    const s = state({ clock: { me: 1000, opponent: 2000, since: new Date(T0).toISOString() }, used: { "me:Rampage": 2 } } as Partial<GameState>);
    const flipped = flipState({ ...s, cp: { me: 0, opponent: 0 }, vp: { me: 0, opponent: 0 }, fury: { me: 0, opponent: 0 }, rage: { me: 0, opponent: 0 }, tactics: [], units: {} } as GameState);
    expect(clockTimes(flipped, T0 + 500)).toEqual({ me: 2000, opponent: 1500 });
    expect(flipped.used).toEqual({ "opponent:Rampage": 2 });
  });

  it("formats", () => {
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
});
