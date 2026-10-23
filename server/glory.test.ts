import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runAs, type UserCtx } from "./context.ts";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aos-glory-test-"));
vi.mock("./accounts.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounts.ts")>()),
  accountsEnabled: () => true,
  listAccounts: async () => [
    { id: "ana", email: "a@example.com", name: "Ana", role: "admin", owner: true },
    { id: "ben", email: "b@example.com", name: "Ben", role: "player" },
    { id: "cid", email: "c@example.com", name: "Cid", role: "player" },
  ],
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));

const ana: UserCtx = { id: "ana", name: "Ana", isAdmin: true, prefix: "" };
const ben: UserCtx = { id: "ben", name: "Ben", isAdmin: false, prefix: "users/ben/" };
const cid: UserCtx = { id: "cid", name: "Cid", isAdmin: false, prefix: "users/cid/" };
const NOW = new Date("2026-10-22T18:00:00Z");

describe("glory in the club", async () => {
  const g = await import("./glory.ts");
  const ch = await import("./challenges.ts");
  const { saveEventResult } = await import("./ladder.ts");
  const { myNotices } = await import("./notices.ts");
  const { Collection } = await import("./store.ts");

  it("keeps quiet the first time, then tells of new achievements and levels", async () => {
    await runAs(ana, () => g.myGlory(NOW));
    await runAs(ben, () => g.myGlory(NOW));
    expect((await runAs(ana, () => myNotices())).length).toBe(0);
    await saveEventResult({ id: "r1", date: "2026-10-21", battleplan: "", conclusion: "played", confirmedAt: "2026-10-21T20:00:00Z", players: [{ id: "ana", name: "Ana", faction: "Ogor Mawtribes", vp: 70 }, { id: "ben", name: "Ben", faction: "Skaven", vp: 30 }] });
    // Ben finds out on his next daily run (a notice); Ana sees it on her own screen.
    const { CRON_USER } = await import("./cron.ts");
    const mine = await runAs(ana, () => g.myGlory(NOW));
    expect(mine.achievements.filter((a) => a.unlocked).map((a) => a.id)).toEqual(expect.arrayContaining(["first-blood", "first-victory", "crushing"]));
    expect(mine.news?.achievements).toEqual(expect.arrayContaining(["First Blood", "Crushing Victory"]));
    expect(mine.missions).toHaveLength(3);
    await runAs(CRON_USER, () => g.settleAll(NOW));
    const texts = (await runAs(ben, () => myNotices())).map((n) => n.text);
    expect(texts).toEqual(expect.arrayContaining(["Achievement unlocked: First Blood"]));
    // Secrets stay hidden from others until unlocked.
    const bens = await runAs(ana, () => g.memberGlory("ben", NOW));
    expect(bens.achievements.find((a) => a.id === "undefeated")).toMatchObject({ name: "???", unlocked: false });
    expect(bens).not.toHaveProperty("missions");
    const board = await runAs(ben, () => g.gloryBoard(NOW));
    expect(board[0]).toMatchObject({ id: "ana" });
  });

  it("opens predictions on accepted challenges, never for the players, and settles them by the result", async () => {
    const c = await runAs(ben, () => ch.challenge({ to: "cid" }));
    const gameId = await runAs(cid, () => ch.accept(c.id));
    const open = await runAs(ana, () => g.listPredictions(NOW));
    expect(open.upcoming).toEqual([expect.objectContaining({ id: `ch-${c.id}`, a: { id: "ben", name: "Ben" }, b: { id: "cid", name: "Cid" }, mine: null, playing: false })]);
    await expect(runAs(ben, () => g.predict(`ch-${c.id}`, "a", NOW))).rejects.toThrow(/your own battle/);
    const after = await runAs(ana, () => g.predict(`ch-${c.id}`, "b", NOW));
    expect(after.upcoming[0]).toMatchObject({ mine: "b", picks: { a: 0, b: 1 } });
    await saveEventResult({ id: gameId, date: "2026-10-22", battleplan: "", conclusion: "played", confirmedAt: "2026-10-22T20:00:00Z", players: [{ id: "ben", name: "Ben", faction: "Skaven", vp: 20 }, { id: "cid", name: "Cid", faction: "Sylvaneth", vp: 60 }] });
    const settled = await runAs(ana, () => g.listPredictions(NOW));
    expect(settled.upcoming).toEqual([]);
    expect(settled.settled[0]).toMatchObject({ outcome: "b", mine: "b" });
  });

  it("votes this week's reports and this month's armies, never your own", async () => {
    const posts = new Collection<Record<string, unknown> & { id: string }>("posts", "club/");
    await runAs(ana, () => posts.save({ id: "post1", kind: "report", createdAt: "2026-10-21T21:00:00Z", authorId: "ben", authorName: "Ben", gameId: "x", playerIds: ["ben"], title: "Ratmen fall", story: "", tone: "saga", photos: 0, sides: [], result: "loss", battleplan: "", badges: [], reactions: {}, comments: [] }));
    await expect(runAs(ben, () => g.voteBattle("post1", NOW))).rejects.toThrow(/your own battle/);
    const v = await runAs(ana, () => g.voteBattle("post1", NOW));
    expect(v.battle).toMatchObject({ week: "2026-W43", counts: { post1: 1 }, mine: "post1" });
    await expect(runAs(ana, () => g.voteBattle("post1", new Date("2026-10-28T10:00:00Z")))).rejects.toThrow(/this week's/);
    // The week over: the winner is announced once.
    const next = new Date("2026-10-27T10:00:00Z");
    expect(await runAs(ana, () => g.announceWinners(next))).toBe(1);
    expect(await runAs(ana, () => g.announceWinners(next))).toBe(0);
    expect((await runAs(cid, () => myNotices()))[0].text).toMatch(/Battle of the week: "Ratmen fall" by Ben/);
    expect((await runAs(ana, () => g.votes(next))).lastBattle).toMatchObject({ postId: "post1", author: "Ben" });
  });

  it("shows games being played to the club, and passes on cheers", async () => {
    const games = new Collection<Record<string, unknown> & { id: string }>("games", ben.prefix);
    await runAs(ben, () => games.save({ id: "live1", name: "Game", createdAt: "2026-10-22T16:00:00Z", opponentName: "Dee", myFaction: "Skaven", opponentFaction: "Seraphon", state: { round: 2, vp: { me: 12, opponent: 9 } }, log: [{ at: "2026-10-22T17:30:00Z", text: "Round 2" }] }));
    const live = await runAs(cid, () => g.liveGames(NOW));
    expect(live).toEqual([expect.objectContaining({ ownerId: "ben", gameId: "live1", round: 2, vp: { me: 12, opponent: 9 } })]);
    const cheered = await runAs(cid, () => g.cheer("ben", "live1", "fire", NOW));
    expect(cheered[0].cheers).toEqual({ fire: 1 });
    // Again within two minutes: not counted twice.
    expect((await runAs(cid, () => g.cheer("ben", "live1", "fire", NOW)))[0].cheers).toEqual({ fire: 1 });
    expect((await runAs(ben, () => myNotices())).some((n) => /Cid cheers your game/.test(n.text))).toBe(true);
    expect(await runAs(cid, () => g.liveGames(new Date("2026-10-23T03:00:00Z")))).toEqual([]);
  });

  it("lets the club back a player of a live game and follow its points", async () => {
    const games = new Collection<Record<string, unknown> & { id: string }>("games", ben.prefix);
    const round = (vp: number[], scored: string[]) => ({ first: "me", me: { scored, tactics: [{ card: "Siege of Ashes", step: "affray" }] }, opponent: { scored: [], tactics: [] }, vp });
    await runAs(ben, () =>
      games.save({
        id: "live2",
        name: "Game",
        createdAt: "2026-10-22T16:00:00Z",
        opponentName: "Dee",
        battleplan: "Into the Fire",
        state: { round: 1, vp: { me: 10, opponent: 0 }, rounds: [round([10, 0], ["Control at least 1 objective", "Control at least 2 objectives"])], tactics: [{ card: "Siege of Ashes" }], opponentTactics: [] },
        log: [{ at: "2026-10-22T17:30:00Z", text: "Round 1" }],
      }),
    );
    const before = (await runAs(cid, () => g.liveGames(NOW))).find((x) => x.gameId === "live2")!;
    expect(before.backers).toEqual({ me: 0, opponent: 0 });
    expect(before.myBack).toBeNull();
    expect(before.detail.rounds[0].me.scored).toEqual(["Control at least 1 objective", "Control at least 2 objectives"]);
    expect(before.detail.tactics.me[0].card).toBe("Siege of Ashes");

    let after = (await runAs(cid, () => g.backSide("ben", "live2", "opponent", NOW))).find((x) => x.gameId === "live2")!;
    expect(after.backers).toEqual({ me: 0, opponent: 1 });
    expect(after.myBack).toBe("opponent");
    expect((await runAs(ben, () => myNotices())).some((n) => /Cid is backing Dee/.test(n.text))).toBe(true);
    // Switching sides moves the backer; the same side again stops backing.
    after = (await runAs(cid, () => g.backSide("ben", "live2", "me", NOW))).find((x) => x.gameId === "live2")!;
    expect(after.backers).toEqual({ me: 1, opponent: 0 });
    after = (await runAs(cid, () => g.backSide("ben", "live2", "me", NOW))).find((x) => x.gameId === "live2")!;
    expect(after.backers).toEqual({ me: 0, opponent: 0 });
    await expect(runAs(cid, () => g.backSide("ben", "live2", "referee", NOW))).rejects.toThrow(/Back one of the two players/);
  });

  it("wraps up a member's season", async () => {
    const w = await runAs(cid, () => g.seasonWrapped("ana", undefined, NOW));
    expect(w).toMatchObject({ season: { name: "All time" }, games: 1, wins: 1, title: "The Conqueror" });
  });
});
