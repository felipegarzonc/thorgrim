import { describe, expect, it } from "vitest";
import { derive } from "../shared/scoring.ts";
import type { Game } from "../shared/types.ts";
import { applyVoice, cleanChanges, describeChange } from "../shared/voice.ts";

const game = {
  battleplan: "Into the Fire",
  state: {
    round: 2,
    phase: "Hero",
    activePlayer: "me",
    cp: { me: 0, opponent: 0 },
    vp: { me: 0, opponent: 0 },
    fury: { me: 0, opponent: 0 },
    rage: { me: 0, opponent: 0 },
    tactics: [{ card: "Siege of Ashes", affray: false, strike: false, domination: false }],
    opponentTactics: [{ card: "Smokescreen", affray: false, strike: false, domination: false }],
    units: {},
    objectives: "",
    notes: "",
    rounds: [],
  },
} as unknown as Pick<Game, "battleplan" | "state">;

describe("scoring by voice", () => {
  it("keeps only changes that fit the game", () => {
    const kept = cleanChanges(game, 2, [
      { side: "me", kind: "objective", label: "Control at least 1 objective" },
      { side: "me", kind: "objective", label: "Hold the moon" },
      { side: "me", kind: "tactic", label: "Smokescreen" },
      { side: "opponent", kind: "tactic", label: "Smokescreen" },
      { side: "opponent", kind: "cpSpent", amount: 2 },
      { side: "opponent", kind: "extraVp", amount: 999 },
    ]);
    expect(kept.map((c) => c.label ?? c.kind)).toEqual(["Control at least 1 objective", "Smokescreen", "cpSpent"]);
  });

  it("applies them to the round", () => {
    const g = applyVoice(game, 2, [
      { side: "me", kind: "objective", label: "Control at least 1 objective" },
      { side: "me", kind: "objective", label: "Control at least 2 objectives" },
      { side: "me", kind: "tactic", label: "Siege of Ashes" },
      { side: "opponent", kind: "cpSpent", amount: 2 },
      { side: "opponent", kind: "fury", amount: 9 },
    ]);
    const s = derive(g);
    expect(s.vp.me).toBe(11);
    expect(g.state.rounds![1].me.tactics).toEqual([{ card: "Siege of Ashes", step: "affray" }]);
    expect(g.state.rounds![1].opponent.cpSpent).toBe(2);
    expect(g.state.fury.opponent).toBe(7);
    expect(describeChange({ side: "me", kind: "tactic", label: "Siege of Ashes" }, { me: "Goy", opponent: "Diego" }, game, 2)).toBe("Goy: Affray of Siege of Ashes (+5)");
  });
});
