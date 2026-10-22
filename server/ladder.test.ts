import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { armyStats, headToHead, inSeason, seasonRanges, seasonRecap, standings, type ClubResult } from "../shared/ladder.ts";
import type { Game } from "../shared/types.ts";
import { runAs, type UserCtx } from "./context.ts";

// Isolated storage for this test run.
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aos-ladder-test-"));

vi.mock("./accounts.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounts.ts")>()),
  accountsEnabled: () => true,
  listAccounts: async () => [
    { id: "ana", email: "a@x", name: "Ana", role: "admin", owner: true },
    { id: "ben", email: "b@x", name: "Ben", role: "player" },
    { id: "cid", email: "c@x", name: "Cid", role: "player" },
  ],
}));

const ana: UserCtx = { id: "ana", name: "Ana", isAdmin: true, prefix: "" };
const ben: UserCtx = { id: "ben", name: "Ben", isAdmin: false, prefix: "users/ben/" };
const cid: UserCtx = { id: "cid", name: "Cid", isAdmin: false, prefix: "users/cid/" };

const result = (id: string, a: [string, string, number], b: [string, string, number], conclusion: ClubResult["conclusion"] = "played"): ClubResult => ({
  id,
  date: "2026-10-01",
  battleplan: "",
  conclusion,
  players: [
    { id: a[0], name: a[0], faction: a[1], vp: a[2] },
    { id: b[0], name: b[0], faction: b[1], vp: b[2] },
  ],
  confirmedAt: id,
});

describe("ladder maths", () => {
  const rs = [
    result("1", ["ana", "Ogor Mawtribes", 60], ["ben", "Skaven", 40]),
    result("2", ["ben", "Skaven", 50], ["ana", "Ogor Mawtribes", 50]),
    result("3", ["cid", "Lumineth Realm-lords", 70], ["ben", "Skaven", 20]),
    result("4", ["ana", "Ogor Mawtribes - Meatfist", 10], ["cid", "Lumineth Realm-lords", 30], "conceded-opponent"),
  ];

  it("ranks by points, then VP difference", () => {
    const table = standings(rs);
    expect(table.map((s) => `${s.id} ${s.points}pts ${s.won}-${s.drawn}-${s.lost}`)).toEqual(["ana 7pts 2-1-0", "cid 3pts 1-0-1", "ben 1pts 0-1-2"]);
    expect(table[0].faction).toBe("Ogor Mawtribes");
  });

  it("gives each member their record against each opponent, and each army's record", () => {
    expect(headToHead(rs, "ana")).toEqual([
      { id: "ben", name: "ben", won: 1, drawn: 1, lost: 0 },
      { id: "cid", name: "cid", won: 1, drawn: 0, lost: 0 },
    ]);
    expect(armyStats(rs).find((a) => a.faction === "Ogor Mawtribes")).toEqual({ faction: "Ogor Mawtribes", played: 3, won: 2, rate: 2 / 3 });
  });
});

describe("seasons", () => {
  it("splits results by season and sums up a season", () => {
    const ranges = seasonRanges([
      { id: "s2", name: "Winter", start: "2026-12-01" },
      { id: "s1", name: "Autumn", start: "2026-09-01" },
    ]);
    expect(ranges.map((r) => [r.name, r.end])).toEqual([
      ["Winter", undefined],
      ["Autumn", "2026-12-01"],
    ]);
    const rs = [
      { ...result("1", ["ana", "Ogor Mawtribes", 60], ["ben", "Skaven", 10]), date: "2026-10-01" },
      { ...result("2", ["ben", "Skaven", 30], ["cid", "Seraphon", 20]), date: "2026-11-30" },
      { ...result("3", ["cid", "Seraphon", 50], ["ana", "Ogor Mawtribes", 10]), date: "2026-12-01" },
    ];
    const autumn = inSeason(rs, ranges[1]);
    expect(autumn.map((r) => r.id)).toEqual(["1", "2"]);
    const recap = seasonRecap(autumn);
    expect(recap).toMatchObject({ games: 2, champion: { id: "ana" }, mostGames: { name: "ben", played: 2 }, biggestWin: { winner: "ana", score: "60-10", margin: 50 } });
    expect(recap.mostPlayedArmy?.faction).toBe("Skaven");
  });
});

describe("confirmed results", () => {
  let sg: typeof import("./sharedGames.ts");
  let ladder: typeof import("./ladder.ts");
  let store: typeof import("./store.ts");
  beforeAll(async () => {
    [sg, ladder, store] = await Promise.all([import("./sharedGames.ts"), import("./ladder.ts"), import("./store.ts")]);
    const game: Game = {
      id: "g9",
      name: "",
      myName: "Ana",
      opponentName: "",
      myFaction: "Ogor Mawtribes",
      opponentFaction: "Skaven",
      myListId: "",
      opponentListId: "",
      battleplan: "Into the Fire",
      battleplanNotes: "",
      references: [],
      log: [],
      createdAt: "2026-10-20T00:00:00.000Z",
      date: "2026-10-20",
      state: {
        round: 5,
        attacker: "me",
        firstThisRound: "me",
        activePlayer: "me",
        phase: "End of Turn",
        cp: { me: 0, opponent: 0 },
        vp: { me: 40, opponent: 30 },
        fury: { me: 1, opponent: 2 },
        rage: { me: 0, opponent: 0 },
        tactics: [],
        opponentTactics: [],
        units: {},
        objectives: "",
        notes: "",
      },
    };
    await runAs(ana, () => new store.Collection<Game>("games").save(game));
  });
  const open = (u: UserCtx) => runAs(u, async () => (await sg.openGame("g9"))!);

  it("counts a shared game once both players confirm it, and drops it when the result changes", async () => {
    // Not shared yet: nothing to confirm.
    await expect(runAs(ana, async () => sg.confirmResult(await open(ana)))).rejects.toThrow(/Finish the game first/);
    await runAs(ana, async () => sg.changeGame(await open(ana), [{ path: ["finished"], set: { conclusion: "played", at: "x" } }]));
    await expect(runAs(ana, async () => sg.confirmResult(await open(ana)))).rejects.toThrow(/played together/);

    const token = await runAs(ana, async () => (await sg.shareGame(await open(ana))).game.share!.token!);
    await runAs(ben, () => sg.joinGame(token));
    await expect(runAs(cid, async () => sg.confirmResult({ ...(await open(ana)), role: "owner" as const }))).rejects.toThrow(/two players/);

    // One confirmation is not enough.
    await runAs(ana, async () => ladder.syncResult(await sg.confirmResult(await open(ana))));
    expect(await ladder.listResults()).toEqual([]);
    expect(sg.viewGame(await open(ben)).access?.confirmed).toEqual({ me: false, opponent: true });

    // Both: on the ladder, from the creator's side.
    await runAs(ben, async () => ladder.syncResult(await sg.confirmResult(await open(ben))));
    const [r] = await ladder.listResults();
    expect(r.players.map((p) => `${p.id} ${p.name} ${p.faction} ${p.vp}`)).toEqual(["ana Ana Ogor Mawtribes 40", "ben Ben Skaven 30"]);

    // The page can't write confirmations itself.
    const forged = await runAs(ben, async () => sg.changeGame(await open(ben), [{ path: ["confirmations"], set: {} }]));
    expect(sg.bothConfirmed(forged)).toBe(true);

    // The score changes: off the ladder until both confirm again.
    await runAs(ben, async () => ladder.syncResult(await sg.changeGame(await open(ben), [{ path: ["state", "rounds"], set: [] }, { path: ["state", "vp", "me"], set: 45 }])));
    expect(await ladder.listResults()).toEqual([]);
    expect(sg.viewGame(await open(ana)).access?.confirmed).toEqual({ me: false, opponent: false });
  });
});
