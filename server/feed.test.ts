import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { emptyRound, emptySideRound } from "../shared/scoring.ts";
import type { ArmyList, Game } from "../shared/types.ts";
import { runAs, type UserCtx } from "./context.ts";

// Isolated storage for this test run.
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aos-feed-test-"));

const ana: UserCtx = { id: "ana", name: "Ana", isAdmin: true, prefix: "" };
const ben: UserCtx = { id: "ben", name: "Ben", isAdmin: false, prefix: "users/ben/" };
const cid: UserCtx = { id: "cid", name: "Cid", isAdmin: false, prefix: "users/cid/" };

// Three club members, so notifications have somewhere to go.
vi.mock("./accounts.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounts.ts")>()),
  accountsEnabled: () => true,
  listAccounts: async () => [
    { id: "ana", email: "a@x", name: "Ana", role: "admin", owner: true },
    { id: "ben", email: "b@x", name: "Ben", role: "player" },
    { id: "cid", email: "c@x", name: "Cid", role: "player" },
  ],
}));

const side = (vp: number, extra: Partial<ReturnType<typeof emptySideRound>> = {}) => ({ ...emptySideRound(), extraVp: vp, ...extra });

/** Ana (Ogors) vs Ben (Skaven): Ben leads 14-2 after round 1, Ana takes a double turn and wins 30-22. */
const finishedGame = (): Game => ({
  id: "g2",
  name: "",
  myName: "Ana",
  opponentName: "Ben",
  myListId: "ana-ogors",
  opponentListId: "",
  opponentFaction: "Skaven",
  battleplan: "Into the Fire",
  battleplanNotes: "",
  references: [],
  log: [{ at: "x", text: "R2 my Hero: Tyrant charged the Grey Seer" }],
  createdAt: "2026-10-20T00:00:00.000Z",
  date: "2026-10-20",
  finished: { conclusion: "played", at: "2026-10-20T20:00:00.000Z" },
  state: {
    round: 3,
    attacker: "me",
    firstThisRound: "me",
    activePlayer: "me",
    phase: "End of Turn",
    cp: { me: 0, opponent: 0 },
    vp: { me: 30, opponent: 22 },
    fury: { me: 1, opponent: 2 },
    rage: { me: 0, opponent: 0 },
    tactics: [{ card: "Smokescreen", affray: true, strike: true, domination: true }],
    opponentTactics: [],
    units: { "me:u1": { damage: 0, destroyed: true } },
    objectives: "",
    notes: "",
    rounds: [
      { ...emptyRound(), first: "opponent", me: side(2), opponent: side(14) },
      { ...emptyRound(), first: "me", priority: "me", me: side(14, { tactics: [{ card: "Smokescreen", step: "affray" }] }), opponent: side(4) },
      { ...emptyRound(), first: "me", me: side(14, { cpSpent: 2 }), opponent: side(4) },
    ],
  },
});
const ogors: ArmyList = {
  id: "ana-ogors",
  name: "Ogors",
  owner: "me",
  faction: "Ogor Mawtribes",
  rawText: "",
  units: [{ key: "u1", unitId: "x", name: "Frostlord on Stonehorn", reinforced: false, notes: [] }],
  unmatched: [],
  createdAt: "",
};

describe("report facts and badges", () => {
  it("tells the game round by round, by name", async () => {
    const { reportFacts, reportSides } = await import("./report.ts");
    const facts = reportFacts(finishedGame(), reportSides(finishedGame(), ogors));
    expect(facts).toContain("Ana (Ogor Mawtribes) vs Ben (Skaven)");
    expect(facts).toContain("Round 1: Ben took the first turn.");
    expect(facts).toContain("Score after round 1: Ana 2, Ben 14.");
    expect(facts).toContain("completed the affray tactic of Smokescreen");
    expect(facts).toContain("Ana took a double turn in round 2.");
    expect(facts).toContain("Ana lost: Frostlord on Stonehorn.");
    expect(facts).toContain("Tyrant charged the Grey Seer");
    expect(facts).toContain("Final score: Ana 30, Ben 22.");
    expect(facts).toContain("Ana won.");
  });

  it("finds the highlights", async () => {
    const { gameBadges, playerBadges, reportSides } = await import("./report.ts");
    const g = finishedGame();
    expect(gameBadges(g, reportSides(g, ogors))).toEqual(["Comeback win for Ana", "Double turn", "Ana mastered Smokescreen"]);
    const won = (id: string, date: string): Game => ({ ...finishedGame(), id, date });
    const history = [won("a", "2026-10-01"), won("b", "2026-10-10"), g].map((game) => ({ game, faction: "Ogor Mawtribes" }));
    expect(playerBadges(g, "Ogor Mawtribes", history)).toEqual(["3 wins in a row"]);
    expect(playerBadges(g, "Ogor Mawtribes - Meatfist", [{ game: g, faction: "Ogor Mawtribes - Meatfist" }])).toEqual(["First game with Ogor Mawtribes"]);
  });
});

describe("club feed", () => {
  let feed: typeof import("./feed.ts");
  let sg: typeof import("./sharedGames.ts");
  let notices: typeof import("./notices.ts");
  let store: typeof import("./store.ts");
  let blobs: typeof import("./blobs.ts");
  beforeAll(async () => {
    [feed, sg, notices, store, blobs] = await Promise.all([import("./feed.ts"), import("./sharedGames.ts"), import("./notices.ts"), import("./store.ts"), import("./blobs.ts")]);
    await runAs(ana, async () => {
      await blobs.blobs().write("game-photos/g2/1.jpg", Buffer.from("jpeg!"), "image/jpeg");
      await new store.Collection<ArmyList>("lists").save(ogors);
      await new store.Collection<Game>("games").save({ ...finishedGame(), report: { title: "Fire and Frost", story: "Para one.\n\nPara two.", tone: "saga", photos: ["game-photos/g2/1.jpg"] } });
    });
  });

  it("tells the creator when the opponent joins their game", async () => {
    const token = await runAs(ana, async () => (await sg.shareGame((await sg.openGame("g2"))!)).game.share!.token!);
    await runAs(ben, () => sg.joinGame(token));
    const anaNotices = await runAs(ana, () => notices.myNotices());
    expect(anaNotices[0].text).toMatch(/^Ben joined your game/);
    expect(anaNotices[0].href).toBe("#/games/g2");
  });

  it("posts a report with its photos, highlights and the game's players", async () => {
    const post = await runAs(ana, async () => feed.publishReport((await sg.openGame("g2"))!));
    expect(post.title).toBe("Fire and Frost");
    expect(post.photos).toBe(1);
    expect(post.playerIds.sort()).toEqual(["ana", "ben"]);
    expect(post.sides.map((s) => `${s.name} ${s.vp}`)).toEqual(["Ana 30", "Ben 22"]);
    expect(post.result).toBe("win");
    expect(post.badges).toContain("Comeback win for Ana");
    expect((await runAs(ana, () => feed.readPostPhoto(post.id, 0)))?.toString()).toBe("jpeg!");
    // The game remembers its post, for both players.
    expect((await runAs(ben, async () => sg.viewGame((await sg.openGame("g2"))!))).report?.postId).toBe(post.id);
    // Ben hears about it, and sees one new post.
    expect((await runAs(ben, () => notices.myNotices()))[0].text).toBe("Ana posted the report of your game: Fire and Frost");
    expect(await runAs(ben, () => feed.unread())).toEqual({ notices: 1, posts: 1 });
    await runAs(ben, () => feed.markFeedSeen());
    await runAs(ben, () => notices.markNoticesRead());
    expect(await runAs(ben, () => feed.unread())).toEqual({ notices: 0, posts: 0 });
    // Posting again updates the same post.
    const again = await runAs(ben, async () => feed.publishReport((await sg.openGame("g2"))!));
    expect(again.id).toBe(post.id);
    expect(again.sides[0].name).toBe("Ben"); // the poster's side first
  });

  it("lets members react and comment, and tells the players", async () => {
    const [post] = await runAs(cid, () => feed.feed());
    expect(post.canEdit).toBe(false);
    const reacted = await runAs(cid, () => feed.react(post.id, "🔥"));
    expect(runAs(cid, () => feed.postView(reacted)).reactions.find((r) => r.emoji === "🔥")).toEqual({ emoji: "🔥", count: 1, mine: true });
    expect(runAs(cid, () => feed.postView(reacted)).shareToken).toBeUndefined();
    await runAs(cid, () => feed.react(post.id, "🔥"));
    expect((await runAs(cid, () => feed.getPost(post.id))).reactions["🔥"]).toEqual([]);
    await expect(runAs(cid, () => feed.react(post.id, "🤡"))).rejects.toThrow(/Unknown reaction/);

    const commented = await runAs(cid, () => feed.addComment(post.id, "  What a comeback!  "));
    expect(commented.comments.map((c) => `${c.authorName}: ${c.text}`)).toEqual(["Cid: What a comeback!"]);
    expect((await runAs(ana, () => notices.myNotices()))[0].text).toBe('Cid commented on "Fire and Frost": What a comeback!');
    expect((await runAs(ben, () => notices.myNotices()))[0].text).toMatch(/^Cid commented/);
    expect(await runAs(cid, () => notices.myNotices())).toEqual([]);

    // Only the commenter, the players or the admin remove a comment.
    const c = commented.comments[0];
    await expect(runAs({ ...cid, id: "dan", name: "Dan" }, () => feed.deleteComment(post.id, c.id))).rejects.toThrow(/own comments/);
    expect((await runAs(ben, () => feed.deleteComment(post.id, c.id))).comments).toEqual([]);
  });

  it("shares one report outside the club, and stops", async () => {
    const [post] = await runAs(ana, () => feed.feed());
    await expect(runAs(cid, () => feed.sharePost(post.id))).rejects.toThrow(/players/);
    const token = (await runAs(ana, () => feed.sharePost(post.id))).shareToken!;
    const found = await feed.publicPost(token);
    expect(found?.view.title).toBe("Fire and Frost");
    expect(Object.keys(found!.view)).not.toContain("comments");
    expect(await feed.publicPost("f".repeat(32))).toBeUndefined();
    await runAs(ben, () => feed.unsharePost(post.id));
    expect(await feed.publicPost(token)).toBeUndefined();
  });

  it("is removed only by its players or the admin, photos and all", async () => {
    const [post] = await runAs(ana, () => feed.feed());
    await expect(runAs(cid, () => feed.deletePost(post.id))).rejects.toThrow(/players/);
    await runAs(ana, () => feed.deletePost(post.id));
    expect(await runAs(ana, () => feed.feed())).toEqual([]);
    expect(await runAs(ana, () => feed.readPostPhoto(post.id, 0))).toBeUndefined();
    expect(await blobs.blobs().read(`club/post-photos/${post.id}/0.jpg`)).toBeUndefined();
  });
});
