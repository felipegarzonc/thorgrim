import { describe, expect, it } from "vitest";
import { emptyRound } from "../shared/scoring.ts";
import { playerStats, rivalRecord } from "../shared/stats.ts";
import type { Game, RoundRecord } from "../shared/types.ts";

let n = 0;
function game(opponentName: string, me: number, opponent: number, rounds: RoundRecord[] = [], tactics: string[] = []): Game {
  n++;
  return {
    id: `g${n}`,
    name: "",
    opponentName,
    myFaction: "Ogor Mawtribes",
    opponentFaction: "Skaven",
    battleplan: "Into the Fire",
    date: `2026-10-${String(n).padStart(2, "0")}`,
    createdAt: "",
    myListId: "",
    opponentListId: "",
    battleplanNotes: "",
    references: [],
    log: [],
    finished: { conclusion: "played", at: "" },
    state: { vp: { me, opponent }, rounds, tactics: tactics.map((card) => ({ card, affray: false, strike: false, domination: false })) } as unknown as Game["state"],
  };
}

describe("player stats", () => {
  const r1: RoundRecord = { ...emptyRound(), first: "me", me: { ...emptyRound().me, extraVp: 6, tactics: [{ card: "Smokescreen", step: "affray" }] }, opponent: { ...emptyRound().opponent, extraVp: 2 } };
  const r2: RoundRecord = { ...emptyRound(), first: "opponent", opponent: { ...emptyRound().opponent, extraVp: 4 } };
  const games = [game("Diego", 30, 10, [r1, r2], ["Smokescreen"]), game("diego ", 10, 20), game("Ana", 15, 15)];
  const s = playerStats(games, (g, side) => (side === "me" ? g.myFaction! : g.opponentFaction!));

  it("counts rivals by name, any case", () => {
    expect(s.rivals[0]).toMatchObject({ name: "diego", played: 2, won: 1, lost: 1, armies: ["Skaven"], last: { result: "loss", me: 10, opponent: 20 } });
    expect(rivalRecord(games, "DIEGO")).toEqual({ played: 2, won: 1, drawn: 0, lost: 1 });
  });

  it("works out armies, tactics, rounds and double turns", () => {
    expect(s.armies).toEqual([{ faction: "Ogor Mawtribes", played: 3, won: 1, drawn: 1, lost: 1 }]);
    expect(s.tactics).toEqual([{ card: "Smokescreen", picked: 1, avgVp: 5, full: 0 }]);
    expect(s.perRound[0]).toEqual({ round: 1, me: 11, opponent: 2 });
    expect(s.doubleTurns).toEqual({ taken: 0, wonWhenTaken: 0, suffered: 1, wonWhenSuffered: 1 });
  });
});
