import { describe, expect, it } from "vitest";
import { eventStandings, pairNextRound, type ClubEvent, type EventTable } from "../shared/events.ts";

const players = ["ana", "ben", "cai", "dee", "eve"].map((id) => ({ id, name: id }));

describe("event pairings", () => {
  it("round 1: everyone plays, the odd one out gets a bye", () => {
    const tables = pairNextRound(eventStandings({ players, pairings: [] }, () => undefined), 1, () => 0.3);
    expect(tables).toHaveLength(3);
    expect(tables.filter((t) => t.b === null)).toHaveLength(1);
    expect(new Set(tables.flatMap((t) => [t.a, t.b]).filter(Boolean)).size).toBe(5);
  });

  it("later rounds: by standing, no rematches, a new player gets the bye", () => {
    const r1: EventTable[] = [
      { a: "ana", b: "ben" },
      { a: "cai", b: "dee" },
      { a: "eve", b: null },
    ];
    const scores: Record<string, { a: number; b: number }> = { ana: { a: 30, b: 10 }, cai: { a: 20, b: 20 } };
    const e: Pick<ClubEvent, "players" | "pairings"> = { players, pairings: [{ round: 1, tables: r1 }] };
    const standing = eventStandings(e, (t) => scores[t.a]);
    expect(standing.map((s) => [s.id, s.points])).toEqual([
      ["ana", 3],
      ["eve", 3],
      ["cai", 1],
      ["dee", 1],
      ["ben", 0],
    ]);
    const r2 = pairNextRound(standing, 2);
    expect(r2.find((t) => t.b === null)?.a).toBe("ben");
    for (const t of r2.filter((x) => x.b)) expect(standing.find((s) => s.id === t.a)!.opponents).not.toContain(t.b);
    // Ana-Eve would leave Cai-Dee, a rematch: so Ana plays Cai and Eve plays Dee.
    expect(r2.slice(0, 2)).toEqual([{ a: "ana", b: "cai" }, { a: "eve", b: "dee" }]);
  });
});

// ---------- the whole flow, on a real (temporary) store ----------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, vi } from "vitest";
import { runAs, type UserCtx } from "./context.ts";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aos-events-test-"));
vi.mock("./accounts.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounts.ts")>()),
  accountsEnabled: () => true,
  listAccounts: async () => [
    { id: "ana", email: "a@x", name: "Ana", role: "admin", owner: true },
    { id: "ben", email: "b@x", name: "Ben", role: "player" },
    { id: "cid", email: "c@x", name: "Cid", role: "player" },
  ],
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));

const ana: UserCtx = { id: "ana", name: "Ana", isAdmin: true, prefix: "" };
const ben: UserCtx = { id: "ben", name: "Ben", isAdmin: false, prefix: "users/ben/" };
const cid: UserCtx = { id: "cid", name: "Cid", isAdmin: false, prefix: "users/cid/" };

describe("a tournament", () => {
  let ev: typeof import("./events.ts");
  let sg: typeof import("./sharedGames.ts");
  let ladder: typeof import("./ladder.ts");
  let notices: typeof import("./notices.ts");
  beforeAll(async () => {
    [ev, sg, ladder, notices] = await Promise.all([import("./events.ts"), import("./sharedGames.ts"), import("./ladder.ts"), import("./notices.ts")]);
  });

  it("signs up, pairs, plays shared games and enters paper results", async () => {
    const e = await runAs(ben, () => ev.createEvent({ name: "October Cup", kind: "tournament", date: "2026-10-30", rounds: 2 }));
    expect(e.canManage).toBe(true);
    await new Promise((r) => setTimeout(r, 50)); // the club is told in the background
    expect((await runAs(cid, () => notices.myNotices()))[0].text).toMatch(/Ben organised a tournament: October Cup/);

    await expect(runAs(cid, () => ev.pairRound(e.id))).rejects.toThrow(/organiser/);
    for (const u of [ana, ben, cid]) await runAs(u, () => ev.joinEvent(e.id, "Skaven"));
    const r1 = await runAs(ben, () => ev.pairRound(e.id));
    const tables = r1.pairings[0].tables;
    expect(tables).toHaveLength(2);
    const table = tables.findIndex((t) => t.b !== null);
    const t = tables[table];
    const playerA = [ana, ben, cid].find((u) => u.id === t.a)!;
    const playerB = [ana, ben, cid].find((u) => u.id === t.b)!;
    const outsider = [ana, ben, cid].find((u) => u !== playerA && u !== playerB)!;

    // Round 2 waits for round 1's results.
    await expect(runAs(ben, () => ev.pairRound(e.id))).rejects.toThrow(/isn't finished/);

    // The table's game: shared by both players from the start.
    await expect(runAs(outsider, () => ev.tableGame(e.id, 1, table))).rejects.toThrow(/two players/);
    const gameId = await runAs(playerB, () => ev.tableGame(e.id, 1, table));
    expect(await runAs(playerA, () => ev.tableGame(e.id, 1, table))).toBe(gameId);
    const seenByB = await runAs(playerB, async () => sg.viewGame((await sg.openGame(gameId))!));
    expect(seenByB.event).toMatchObject({ id: e.id, round: 1, table: table + 1 });
    expect(seenByB.myName).toBe(playerB.name);

    // Both confirm: the table has its result and the standings move.
    await runAs(playerA, async () => sg.changeGame((await sg.openGame(gameId))!, [{ path: ["state", "rounds"], set: [{ first: "me", me: { scored: [], extraVp: 30, tactics: [], cpGained: 0, cpSpent: 0 }, opponent: { scored: [], extraVp: 20, tactics: [], cpGained: 0, cpSpent: 0 } }] }, { path: ["finished"], set: { conclusion: "played", at: "x" } }]));
    for (const u of [playerA, playerB]) await runAs(u, async () => ladder.syncResult(await sg.confirmResult((await sg.openGame(gameId))!)));
    const after = await runAs(ben, () => ev.getEvent(e.id));
    expect(after.results[`1:${table}`]).toEqual({ a: 30, b: 20, confirmed: true });
    expect(after.standings[0].points).toBe(3);
    await expect(runAs(ben, () => ev.setTableResult(e.id, 1, table, { a: 1, b: 2 }))).rejects.toThrow(/already confirmed/);

    // Round 2, then a result on paper from the organiser: straight onto the ladder.
    const r2 = await runAs(ben, () => ev.pairRound(e.id));
    const t2 = r2.pairings[1].tables.findIndex((x) => x.b !== null);
    await runAs(ben, () => ev.setTableResult(e.id, 2, t2, { a: 12, b: 25 }));
    expect((await ladder.listResults()).some((x) => x.id === `ev-${e.id}-2-${t2}`)).toBe(true);
    const done = await runAs(ben, () => ev.finishEvent(e.id));
    expect(done.finishedAt).toBeTruthy();
    expect(done.standings.reduce((n, s) => n + s.played, 0)).toBe(4);
  });
});

describe("challenges", () => {
  it("challenge, accept: a game both players share", async () => {
    const ch = await import("./challenges.ts");
    const sg = await import("./sharedGames.ts");
    await expect(runAs(ana, () => ch.challenge({ to: "ana" }))).rejects.toThrow(/yourself/);
    const c = await runAs(ana, () => ch.challenge({ to: "cid", message: "Rematch?", points: 1000 }));
    await expect(runAs(ana, () => ch.challenge({ to: "cid" }))).rejects.toThrow(/already challenged/);
    expect((await runAs(cid, () => ch.myChallenges())).map((x) => x.id)).toContain(c.id);
    expect(await runAs(ben, () => ch.myChallenges())).not.toContainEqual(expect.objectContaining({ id: c.id }));
    await expect(runAs(ana, () => ch.accept(c.id))).rejects.toThrow(/challenged member/);
    const gameId = await runAs(cid, () => ch.accept(c.id));
    const seen = await runAs(cid, async () => sg.viewGame((await sg.openGame(gameId))!));
    expect(seen).toMatchObject({ myName: "Cid", opponentName: "Ana", points: 1000, access: { role: "player" } });
    expect(await runAs(cid, () => ch.accept(c.id))).toBe(gameId);
  });
});

describe("army showcase", () => {
  it("each member edits their own; photos only as listed", async () => {
    const sc = await import("./showcase.ts");
    const [army] = await runAs(ben, () => sc.saveArmy({ faction: "Skaven", name: "Clan Moulder" }));
    const withPhoto = await runAs(ben, () => sc.addPhoto(army.id, Buffer.from("jpeg")));
    const photo = withPhoto[0].photos[0];
    expect(await runAs(cid, () => sc.showcaseOf("ben"))).toHaveLength(1);
    expect((await runAs(cid, () => sc.readPhoto("ben", army.id, photo)))?.toString()).toBe("jpeg");
    expect(await runAs(cid, () => sc.readPhoto("ben", army.id, "nope"))).toBeUndefined();
    expect(await runAs(cid, () => sc.readPhoto("../settings", army.id, photo))).toBeUndefined();
    // Cid can't touch Ben's army: it isn't in Cid's showcase.
    await expect(runAs(cid, () => sc.deleteArmy(army.id))).rejects.toThrow(/removed/);
    expect(await runAs(ben, () => sc.deleteArmy(army.id))).toEqual([]);
  });
});
