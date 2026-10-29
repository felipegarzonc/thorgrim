import { describe, expect, it } from "vitest";
import type { Game } from "../shared/types.ts";
import { lessonsFrom } from "./lessons.ts";

let n = 0;
const game = (opponentFaction: string, date: string, tryNext?: string, vp = { me: 70, opponent: 60 }): Game =>
  ({
    id: `g${++n}`,
    name: `Game ${n}`,
    date,
    createdAt: `${date}T10:00:00Z`,
    myFaction: "Ogor Mawtribes",
    opponentFaction,
    opponentName: "Ana",
    state: { vp },
    ...(tryNext ? { review: { verdict: "", lost: ["Lost the centre in round 2."], tryNext, writtenAt: "", basis: "" } } : {}),
  }) as unknown as Game;

describe("lessons from earlier games", () => {
  it("is empty until a game has been reviewed", () => {
    expect(lessonsFrom([game("Skaven", "2026-10-01")])).toBe("");
  });

  it("lists reviewed games newest first, with the result and where the points went", () => {
    const text = lessonsFrom([game("Skaven", "2026-10-01", "Screen the flanks."), game("Stormcast Eternals", "2026-10-08", "Charge first.", { me: 50, opponent: 72 })]);
    const lines = text.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toEqual([
      "- 2026-10-08, Ogor Mawtribes vs Ana, Stormcast Eternals: lost 50-72. Try next: Charge first. (Points went: Lost the centre in round 2.)",
      "- 2026-10-01, Ogor Mawtribes vs Ana, Skaven: won 70-60. Try next: Screen the flanks. (Points went: Lost the centre in round 2.)",
    ]);
  });

  it("puts games against the same army first, leaves out the current game, and keeps the list short", () => {
    const current = game("Skaven - Clans Pestilens", "2026-10-20", "This game's own review.");
    const others = Array.from({ length: 6 }, (_, i) => game("Seraphon", `2026-09-1${i}`, `Other ${i}.`));
    const skaven = [game("Skaven", "2026-08-01", "Old Skaven lesson."), game("Skaven [LEGENDS]", "2026-08-02", "Newer Skaven lesson.")];
    const lines = lessonsFrom([current, ...others, ...skaven], current)
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("Newer Skaven lesson.");
    expect(lines[1]).toContain("Old Skaven lesson.");
    expect(lines.slice(2).map((l) => l.match(/Other \d/)?.[0])).toEqual(["Other 5", "Other 4", "Other 3"]);
    expect(lines.join("\n")).not.toContain("This game's own review.");
  });
});
