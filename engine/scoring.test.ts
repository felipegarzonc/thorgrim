import { describe, expect, it } from "vitest";
import { allianceOf, NUMBERED_BATTLEPLANS } from "../shared/season.ts";
import { derive, emptyRound, nextTacticStep, result, startRound, totalVp } from "../shared/scoring.ts";
import type { GameState } from "../shared/types.ts";

const baseState = (): GameState => ({
  round: 1,
  attacker: "me",
  firstThisRound: "me",
  activePlayer: "me",
  phase: "Deployment",
  cp: { me: 0, opponent: 0 },
  vp: { me: 0, opponent: 0 },
  fury: { me: 1, opponent: 2 },
  rage: { me: 0, opponent: 0 },
  tactics: [{ card: "Blazing Onslaught", affray: false, strike: false, domination: false }],
  opponentTactics: [],
  units: {},
  objectives: "",
  notes: "",
  rounds: [],
});

describe("round records", () => {
  it("VP come from battleplan lines, tactics and extra points", () => {
    const r1 = emptyRound();
    r1.me.scored = ["Control at least 1 objective", "Control more objectives than your opponent"];
    r1.me.tactics = [{ card: "Blazing Onslaught", step: "affray" }];
    r1.opponent.extraVp = 2;
    expect(totalVp([r1], "Into the Fire", "me")).toBe(3 + 4 + 5);
    expect(totalVp([r1], "Into the Fire", "opponent")).toBe(2);
  });

  it("first-round-only lines don't count in later rounds", () => {
    const r1 = emptyRound();
    const r2 = emptyRound();
    r1.me.scored = r2.me.scored = ["Control more objectives than your opponent"];
    expect(totalVp([r1, r2], "Bloodstained Coasts", "me")).toBe(4);
  });

  it("derive syncs tactic progress and the next step", () => {
    const state = baseState();
    state.rounds = [emptyRound(), emptyRound()];
    state.rounds[0].me.tactics = [{ card: "Blazing Onslaught", step: "affray" }];
    state.rounds[1].me.tactics = [{ card: "Blazing Onslaught", step: "strike" }];
    const d = derive({ battleplan: "Into the Fire", state });
    expect(d.tactics[0]).toMatchObject({ affray: true, strike: true, domination: false });
    expect(d.vp.me).toBe(10);
    expect(nextTacticStep(state.rounds, "me", "Blazing Onslaught")).toBe("domination");
  });

  it("starting round 1 gives 4 CP each and the first turn", () => {
    const s = startRound({ battleplan: "Into the Fire", state: baseState() }, 1, "opponent");
    expect(s.round).toBe(1);
    expect(s.activePlayer).toBe("opponent");
    expect(s.phase).toBe("Start of Turn");
    expect(s.cp).toEqual({ me: 4, opponent: 4 });
    expect(s.rounds?.[0].first).toBe("opponent");
  });

  it("a double turn in round 2 seizes the initiative; the other player gets the underdog CP", () => {
    let s = startRound({ battleplan: "Into the Fire", state: baseState() }, 1, "opponent");
    s.rounds![0].me.cpSpent = 3;
    s = startRound({ battleplan: "Into the Fire", state: s }, 2, "me", "me");
    expect(s.seizedInitiative).toBe("me");
    expect(s.underdog).toBe("opponent");
    expect(s.cp).toEqual({ me: 4, opponent: 5 });
    expect(s.rounds?.[1].priority).toBe("me");
  });

  it("result counts concessions", () => {
    const state = { ...baseState(), vp: { me: 30, opponent: 40 } };
    expect(result({ state, finished: { conclusion: "played", at: "" } })).toBe("loss");
    expect(result({ state, finished: { conclusion: "conceded-opponent", at: "" } })).toBe("win");
    expect(result({ state })).toBeNull();
  });
});

describe("season lookups", () => {
  it("numbers battleplans 11-16 and 21-26", () => {
    expect(NUMBERED_BATTLEPLANS[0]).toEqual({ number: 11, name: "Into the Fire" });
    expect(NUMBERED_BATTLEPLANS[6]).toEqual({ number: 21, name: "Warped Ruins" });
    expect(NUMBERED_BATTLEPLANS).toHaveLength(12);
  });
  it("finds the grand alliance of sub-factions", () => {
    expect(allianceOf("Ogor Mawtribes - Beastclaw Alfrostun")).toBe("Destruction");
    expect(allianceOf("Bonesplitterz [LEGENDS]")).toBe("Destruction");
    expect(allianceOf("Helsmiths of Hashut")).toBe("Chaos");
  });
});
