import { describe, expect, it } from "vitest";
import { allianceOf, isBattleplanDoc, NUMBERED_BATTLEPLANS } from "../shared/season.ts";
import { derive, emptyRound, nextTacticStep, result, setAttacker, startingFury, startRound, totalVp } from "../shared/scoring.ts";
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

  it("correcting who went first mid-round uses the score from before the round, and keeps spent rage dice", () => {
    // Round 1: I go first and score 6; the opponent scores nothing.
    let s = startRound({ battleplan: "Into the Fire", state: baseState() }, 1, "me");
    s.rounds![0].me.scored = ["Control at least 1 objective", "Control at least 2 objectives"];
    // Round 2: I go first again (no double turn): the opponent is behind, so the underdog.
    s = startRound({ battleplan: "Into the Fire", state: s }, 2, "me", "me");
    expect(s.underdog).toBe("opponent");
    // During round 2 the opponent scores 10 and takes the lead, and I spend a rage die.
    s.rounds![1].opponent.scored = ["Control at least 1 objective", "Control at least 2 objectives", "Control more objectives than your opponent"];
    s = { ...s, rage: { ...s.rage, me: s.rage.me - 1 } };
    const rageBefore = s.rage;
    // Picking the same first player again (a correction) must not treat me as the underdog,
    // because the underdog is decided by the score when the round began.
    const cleared = { ...s, rounds: s.rounds!.map((r, i) => (i === 1 ? { ...r, me: { ...r.me, cpGained: 0 }, opponent: { ...r.opponent, cpGained: 0 } } : r)) };
    const again = startRound({ battleplan: "Into the Fire", state: cleared }, 2, "me", "me");
    expect(again.underdog).toBe("opponent");
    expect(again.cp).toEqual({ me: 4, opponent: 5 });
    expect(again.rage).toEqual(rageBefore);
  });

  it("starting a new round refills the rage dice from the fury level", () => {
    let s = startRound({ battleplan: "Into the Fire", state: { ...baseState(), fury: { me: 3, opponent: 2 }, rage: { me: 0, opponent: 0 } } }, 1, "me");
    expect(s.rage).toEqual({ me: 3, opponent: 2 });
    s = { ...s, rage: { me: 1, opponent: 0 } };
    s = startRound({ battleplan: "Into the Fire", state: s }, 2, "me", "me");
    expect(s.rage).toEqual({ me: 3, opponent: 2 });
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
  it("matches battleplan cards and maps by title", () => {
    expect(isBattleplanDoc({ title: "Into the Fire - map", category: "map" }, "Into the Fire")).toBe(true);
    expect(isBattleplanDoc({ title: "What's Yours Is Ours card", category: "battleplan" }, "What's Yours is Ours")).toBe(true);
    expect(isBattleplanDoc({ title: "Into the Fire", category: "battletome" }, "Into the Fire")).toBe(false);
    expect(isBattleplanDoc({ title: "Warped Ruins", category: "map" }, "Into the Fire")).toBe(false);
  });
});

describe("attacker and defender", () => {
  it("gives the attacker fury 1 and the defender fury 2", () => {
    expect(startingFury("me")).toEqual({ me: 1, opponent: 2 });
    expect(startingFury("opponent")).toEqual({ me: 2, opponent: 1 });
  });

  it("moves the starting fury (and who acts first) when the attacker changes before the battle", () => {
    const s = setAttacker(baseState(), "opponent");
    expect(s).toMatchObject({ attacker: "opponent", fury: { me: 2, opponent: 1 }, firstThisRound: "opponent", activePlayer: "opponent" });
    expect(setAttacker(s, "me").fury).toEqual({ me: 1, opponent: 2 });
  });

  it("fixes an attacker set late in round 1, but not fury or rage that play already changed", () => {
    const started = startRound({ battleplan: "", state: baseState() }, 1, "me");
    expect(started.rage).toEqual({ me: 1, opponent: 2 });
    // Set late, nothing spent yet: fury and the round's rage dice follow.
    expect(setAttacker(started, "opponent")).toMatchObject({ attacker: "opponent", fury: { me: 2, opponent: 1 }, rage: { me: 2, opponent: 1 } });
    // Rage already spent: the dice stay as they are, fury still follows.
    const spent = { ...started, rage: { me: 0, opponent: 2 } };
    expect(setAttacker(spent, "opponent")).toMatchObject({ fury: { me: 2, opponent: 1 }, rage: { me: 0, opponent: 2 } });
    // From round 2 only the label changes.
    const r2 = startRound({ battleplan: "", state: started }, 2, "opponent");
    expect(setAttacker(r2, "opponent")).toMatchObject({ attacker: "opponent", fury: r2.fury, rage: r2.rage });
  });
});
