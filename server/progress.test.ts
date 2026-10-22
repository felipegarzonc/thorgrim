import { describe, expect, it } from "vitest";
import type { ClubResult } from "../shared/ladder.ts";
import {
  ACHIEVEMENTS,
  bountiesFrom,
  bountyClaims,
  closedWinners,
  levelOf,
  memberStats,
  missionProgress,
  missionsFor,
  weekOf,
  weekRange,
  wrapped,
  xpFrom,
  type ClubData,
  type PostLite,
} from "../shared/progress.ts";

let n = 0;
const game = (date: string, a: [string, string, number], b: [string, string, number]): ClubResult => ({
  id: `g${++n}`,
  date,
  battleplan: "Into the Fire",
  conclusion: "played",
  players: [
    { id: a[0], name: a[0].toUpperCase(), faction: a[1], vp: a[2] },
    { id: b[0], name: b[0].toUpperCase(), faction: b[1], vp: b[2] },
  ],
  confirmedAt: `${date}T20:00:00Z`,
});
const post = (p: Partial<PostLite> & { id: string; authorId: string; createdAt: string }): PostLite => ({
  kind: "report",
  playerIds: [p.authorId],
  photos: 0,
  result: null,
  totals: [],
  tactics: [],
  comments: [],
  reactors: [],
  ...p,
});
const empty: ClubData = { results: [], posts: [], armies: [], events: [], challenges: [], predictions: [], ballots: [] };

describe("weeks", () => {
  it("names ISO weeks and their Monday-to-Monday range", () => {
    expect(weekOf("2026-10-22")).toBe("2026-W43");
    expect(weekRange("2026-W43")).toEqual({ from: "2026-10-19", to: "2026-10-26" });
    expect(weekOf("2026-01-01")).toBe("2026-W01");
  });
});

describe("a member's numbers, experience and achievements", () => {
  const results = [
    game("2026-10-01", ["ana", "Ogor Mawtribes", 70], ["ben", "Skaven", 40]),
    game("2026-10-03", ["ana", "Ogor Mawtribes", 50], ["cid", "Sylvaneth", 48]),
    game("2026-10-08", ["dee", "Seraphon", 30], ["ana", "Lumineth Realm-lords", 31]),
    game("2026-10-10", ["ana", "Ogor Mawtribes", 40], ["ben", "Skaven", 40]),
  ];
  const data: ClubData = {
    ...empty,
    results,
    posts: [
      post({ id: "p1", authorId: "ana", createdAt: "2026-10-03T21:00:00Z", photos: 2, result: "win", totals: [{ me: 10, opponent: 15 }, { me: 50, opponent: 48 }], tactics: [{ card: "Siege of Ashes", done: ["affray", "strike", "domination"] }], reactors: ["ben", "cid"] }),
      post({ id: "p2", authorId: "ben", createdAt: "2026-10-04T10:00:00Z", comments: [{ authorId: "ana", at: "2026-10-04T11:00:00Z" }], reactors: ["ana"] }),
    ],
    armies: [{ memberId: "ana", armyId: "x", name: "Gutbusters", faction: "Ogor Mawtribes", photos: 3, createdAt: "2026-09-01T00:00:00Z" }],
  };

  it("counts games, streaks, margins, opponents, reports and club life", () => {
    const s = memberStats(data, "ana");
    expect(s).toMatchObject({ games: 4, wins: 3, draws: 1, losses: 0, bestStreak: 3, crushingWins: 1, closeWins: 2, comebacks: 1, tacticsMastered: 1, tacticSteps: 3, reports: 1, reportsWithPhotos: 1, postsCommented: 1, reactionsGiven: 1, reactionsReceived: 2, armies: 1, paintedArmies: 1 });
    expect(s.opponents.sort()).toEqual(["ben", "cid", "dee"]);
    expect(s.factionsPlayed.sort()).toEqual(["Lumineth Realm-lords", "Ogor Mawtribes"]);
    // A window: only October's second week.
    expect(memberStats(data, "ana", { from: "2026-10-05", to: "2026-10-12" })).toMatchObject({ games: 2, wins: 1, draws: 1, newOpponents: 1 });
  });

  it("turns them into experience, a level and achievements", () => {
    const s = memberStats(data, "ana");
    const xp = xpFrom(s).reduce((t, x) => t + x.xp, 0);
    expect(xp).toBe(4 * 40 + 3 * 30 + 15 + (3 * 2 + 10) + (25 + 10) + (3 + 1) + (30 + 3 * 5));
    expect(levelOf(xp)).toMatchObject({ level: 3, name: "Veteran", floor: 250, next: 500 });
    expect(levelOf(0).name).toBe("Recruit");
    expect(levelOf(99999)).toMatchObject({ level: 10, next: null });
    const unlocked = ACHIEVEMENTS.filter((a) => a.done(s, { perfectWeeks: 0 })).map((a) => a.id);
    expect(unlocked).toEqual(expect.arrayContaining(["first-blood", "first-victory", "comeback", "crushing", "close-call", "unstoppable", "dead-even", "tactician", "first-chronicle", "steady-brush"]));
    expect(unlocked).not.toContain("undefeated");
  });

  it("gives three steady missions a week and measures them in that week", () => {
    const m = missionsFor("ana", "2026-W41");
    expect(m).toHaveLength(3);
    expect(new Set(m.map((x) => x.id)).size).toBe(3);
    expect(missionsFor("ana", "2026-W41").map((x) => x.id)).toEqual(m.map((x) => x.id));
    const progress = missionProgress(data, "ana", "2026-W41");
    const play = progress[0];
    expect(play.value).toBeGreaterThan(0);
  });

  it("puts bounties on the leader and on streaks, and pays whoever beats them", () => {
    expect(bountiesFrom(results)).toEqual([{ id: "ana", name: "ANA", reason: "leader" }]);
    const slayed = [...results, game("2026-10-15", ["cid", "Sylvaneth", 60], ["ana", "Ogor Mawtribes", 20])];
    expect(bountyClaims(slayed)).toEqual([{ winnerId: "cid", targetId: "ana", targetName: "ANA", date: "2026-10-15", resultId: slayed[4].id }]);
    expect(memberStats({ ...data, results: slayed }, "cid").bountiesClaimed).toBe(1);
  });

  it("wraps up a season with a title", () => {
    const w = wrapped(data, { id: "ana", name: "Ana" }, { name: "Autumn", start: "2026-10-01" });
    expect(w).toMatchObject({ games: 4, wins: 3, draws: 1, favouriteArmy: { faction: "Ogor Mawtribes", games: 3 }, biggestWin: { opponent: "BEN", score: "70-40" }, title: "The Unstoppable" });
    expect(w.nemesis).toBeUndefined();
  });
});

describe("votes", () => {
  it("closes a week's ballot after the week, most votes winning", () => {
    const data: ClubData = { ...empty, ballots: [{ id: "battle:2026-W42", kind: "battle", period: "2026-W42", votes: { a: "p1", b: "p2", c: "p2" } }, { id: "battle:2026-W43", kind: "battle", period: "2026-W43", votes: { a: "p9" } }] };
    expect(closedWinners(data, new Date("2026-10-22T12:00:00Z"))).toEqual([{ kind: "battle", period: "2026-W42", winner: "p2" }]);
  });
});
