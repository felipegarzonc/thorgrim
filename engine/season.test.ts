import { describe, expect, it } from "vitest";
import { CORE_COMMANDS, newBattleRound, usableBy } from "../shared/season.ts";

describe("newBattleRound", () => {
  it("taking the double turn seizes the initiative and makes the opponent underdog", () => {
    const r = newBattleRound({ firstThisRound: "opponent", vp: { me: 10, opponent: 8 } }, "me");
    expect(r.seized).toBe("me");
    expect(r.underdog).toBe("opponent");
    expect(r.cp).toEqual({ me: 4, opponent: 5 });
  });
  it("no seizing when the opponent leads by 11 or more", () => {
    const r = newBattleRound({ firstThisRound: "opponent", vp: { me: 5, opponent: 16 } }, "me");
    expect(r.seized).toBeNull();
    expect(r.underdog).toBe("me");
    expect(r.cp).toEqual({ me: 5, opponent: 4 });
  });
  it("alternating turns (same player first again): underdog is whoever has fewer VP", () => {
    const r = newBattleRound({ firstThisRound: "me", vp: { me: 3, opponent: 7 } }, "me");
    expect(r.seized).toBeNull();
    expect(r.underdog).toBe("me");
  });
  it("tied VP: no underdog, 4 CP each", () => {
    expect(newBattleRound({ firstThisRound: "me", vp: { me: 6, opponent: 6 } }, "me")).toEqual({ seized: null, underdog: null, cp: { me: 4, opponent: 4 } });
  });
});

describe("commands", () => {
  const cmd = (n: string) => CORE_COMMANDS.find((c) => c.name === n)!;
  it("Counter-charge is for the player whose turn it isn't, in the charge phase", () => {
    expect(usableBy(cmd("Counter-charge"), "Charge", "opponent", "me")).toBe(true);
    expect(usableBy(cmd("Counter-charge"), "Charge", "me", "me")).toBe(false);
    expect(cmd("Counter-charge").cost).toBe(2);
  });
  it("All-out Defence works for either player in combat", () => {
    expect(usableBy(cmd("All-out Defence"), "Combat", "me", "opponent")).toBe(true);
    expect(usableBy(cmd("All-out Defence"), "Combat", "me", "me")).toBe(true);
  });
});
