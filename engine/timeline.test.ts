import { describe, expect, it } from "vitest";
import { timeline } from "../shared/report.ts";
import { emptyRound } from "../shared/scoring.ts";
import type { GameState, RoundRecord } from "../shared/types.ts";

const state = (rounds: RoundRecord[]) => ({ rounds }) as unknown as GameState;
const round = (first: "me" | "opponent" | undefined, me: Partial<RoundRecord["me"]>, opponent: Partial<RoundRecord["opponent"]>): RoundRecord => ({
  ...emptyRound(),
  ...(first ? { first } : {}),
  me: { ...emptyRound().me, ...me },
  opponent: { ...emptyRound().opponent, ...opponent },
});

describe("the game turn by turn", () => {
  const game = {
    battleplan: "Into the Fire",
    state: state([
      round("me", { scored: ["Control at least 1 objective", "Control at least 2 objectives"], cpSpent: 2 }, { scored: ["Control at least 1 objective"] }),
      // The opponent went second in round 1 and first in round 2: a double turn.
      round("opponent", { tactics: [{ card: "Smokescreen", step: "affray" }], extraVp: -1 }, { scored: ["Control more objectives than your opponent", "Control at least 1 objective"] }),
      emptyRound(), // not played
      // Scored without rolling for priority: still counts, me first.
      round(undefined, { extraVp: 3 }, {}),
    ]),
  };
  const t = timeline(game);

  it("puts each round's turns in the order they were played, with the score after each", () => {
    expect(t.map((x) => [x.round, x.turn, x.side, x.vp, `${x.total.me}-${x.total.opponent}`])).toEqual([
      [1, 1, "me", 6, "6-0"],
      [1, 2, "opponent", 3, "6-3"],
      [2, 1, "opponent", 7, "6-10"],
      [2, 2, "me", 4, "10-10"],
      [4, 1, "me", 3, "13-10"],
      [4, 2, "opponent", 0, "13-10"],
    ]);
  });

  it("says what was scored: battleplan lines in the card's order, tactics, and other points", () => {
    expect(t[2].scored).toEqual([
      { label: "Control at least 1 objective", vp: 3 },
      { label: "Control more objectives than your opponent", vp: 4 },
    ]);
    expect(t[3].scored).toEqual([
      { label: "Affray of Smokescreen", vp: 5 },
      { label: "Other points", vp: -1 },
    ]);
    expect(t[5].scored).toEqual([]);
    expect(t[0].cpSpent).toBe(2);
  });

  it("marks the double turn", () => {
    expect(t.filter((x) => x.doubleTurn).map((x) => [x.round, x.side])).toEqual([[2, "opponent"]]);
  });
});
