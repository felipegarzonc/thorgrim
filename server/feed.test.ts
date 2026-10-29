import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { diff } from "../shared/patch.ts";
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
    const { reportFacts, reportSides } = await import("../shared/report.ts");
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
    const { gameBadges, playerBadges, reportSides } = await import("../shared/report.ts");
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
    // The full battle travels with the post, from the poster's side.
    expect(post.detail?.rounds.map((r) => `${r.round} ${r.first} +${r.me.vp}/+${r.opponent.vp}`)).toEqual(["1 opponent +2/+14", "2 me +19/+4", "3 me +14/+4"]);
    expect(post.detail?.armies.me).toEqual([{ name: "Frostlord on Stonehorn", destroyed: true, damage: 0 }]);
    expect(post.detail?.tactics.me[0]).toEqual({ card: "Smokescreen", done: ["affray"] });
    expect((await runAs(ana, () => feed.readPostPhoto(post.id, 0)))?.toString()).toBe("jpeg!");
    // The game remembers its post, for both players.
    expect((await runAs(ben, async () => sg.viewGame((await sg.openGame("g2"))!))).report?.postId).toBe(post.id);
    // Ben hears about it, and sees one new post.
    expect((await runAs(ben, () => notices.myNotices()))[0].text).toBe("Ana posted the report of your game: Fire and Frost");
    expect(await runAs(ben, () => feed.unread())).toEqual({ notices: 1, posts: 1 });
    await runAs(ben, () => feed.markFeedSeen());
    await runAs(ben, () => notices.markNoticesRead());
    expect(await runAs(ben, () => feed.unread())).toEqual({ notices: 0, posts: 0 });
    // Posting again keeps the same post, still from the poster's side.
    const again = await runAs(ben, async () => feed.publishReport((await sg.openGame("g2"))!));
    expect(again.id).toBe(post.id);
    expect(again.sides[0].name).toBe("Ana");
  });

  it("follows the game: score, report and photos, whoever changes them", async () => {
    const [post] = await runAs(ana, () => feed.feed());
    // Ben corrects his last round's VP and retitles the report, from his own (flipped) view.
    const updated = await runAs(ben, async () => {
      const o = (await sg.openGame("g2"))!;
      const view = sg.viewGame(o);
      const edited = structuredClone(view);
      edited.state.rounds![2].me.extraVp += 5;
      edited.report!.title = "Fire, Frost and Fury";
      return feed.syncPost(await sg.changeGame(o, diff(view, edited)));
    });
    expect(updated?.id).toBe(post.id);
    expect(updated?.title).toBe("Fire, Frost and Fury");
    // Totals are worked out from the rounds (Ana's round 2 tactic adds 5): still Ana's side first.
    expect(updated?.sides.map((s) => `${s.name} ${s.vp}`)).toEqual(["Ana 35", "Ben 27"]);
    expect(updated?.updatedAt).toBeTruthy();
    expect(updated?.photos).toBe(1);
    // The post's own highlights about Ana are kept.
    expect(updated?.badges).toEqual(expect.arrayContaining((await runAs(ana, () => feed.getPost(post.id))).playerBadges ?? []));
    // Nothing changed: nothing saved.
    const same = await runAs(ana, async () => feed.syncPost((await sg.openGame("g2"))!));
    expect(same?.updatedAt).toBe(updated?.updatedAt);
    // A removed photo goes from the post too.
    const fewer = await runAs(ana, async () => {
      const o = (await sg.openGame("g2"))!;
      return feed.syncPost(await sg.changeGame(o, [{ path: ["report", "photos"], set: [] }]));
    });
    expect(fewer?.photos).toBe(0);
    expect(await blobs.blobs().read(`club/post-photos/${post.id}/0.jpg`)).toBeUndefined();
  });

  it("rebuilds an old post whose sheet doesn't add up to its score, when a player opens the club", async () => {
    // As posted before rounds without a priority roll counted: the last round is missing from the sheet.
    const postsHere = new store.Collection<import("../shared/types.ts").FeedPost>("posts", "club/");
    const [stored] = await postsHere.list();
    const full = stored.detail!.rounds.length;
    await postsHere.save({ ...stored, detail: { ...stored.detail!, rounds: stored.detail!.rounds.slice(0, -1) } });
    // A member who isn't in the game can't open it: their view stays as it is.
    expect((await runAs(cid, () => feed.feed()))[0].detail?.rounds).toHaveLength(full - 1);
    // One of its players opens the club: the sheet comes back whole, for everyone.
    expect((await runAs(ben, () => feed.feed()))[0].detail?.rounds).toHaveLength(full);
    expect((await postsHere.get(stored.id))?.detail?.rounds).toHaveLength(full);
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
    expect((await runAs(ana, () => notices.myNotices()))[0].text).toBe('Cid commented on "Fire, Frost and Fury": What a comeback!');
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
    expect(found?.view.title).toBe("Fire, Frost and Fury");
    expect(Object.keys(found!.view)).not.toContain("comments");
    expect(await feed.publicPost("f".repeat(32))).toBeUndefined();
    await runAs(ben, () => feed.unsharePost(post.id));
    expect(await feed.publicPost(token)).toBeUndefined();
  });

  it("never copies files other than the game's own photos (no reading secrets through a report)", async () => {
    await blobs.blobs().write("settings/secrets.json", Buffer.from('{"ANTHROPIC_API_KEY":"sk-secret"}'), "application/json");
    // Ben edits the shared game's report and table photo to point at other files, then posts.
    const o = await runAs(ben, async () => (await sg.openGame("g2"))!);
    const changed = await runAs(ben, () =>
      sg.changeGame(o, [
        { path: ["report", "photos"], set: ["settings/secrets.json", "game-photos/g2/1.jpg", "game-photos/g2/../../settings/users.json"] },
        { path: ["state", "tablePhoto"], set: { path: "settings/secrets.json", at: "x", round: 1, phase: "Hero" } },
      ]),
    );
    expect(changed.game.report?.photos).toEqual(["game-photos/g2/1.jpg"]);
    expect(changed.game.state.tablePhoto).toBeUndefined();
    const post = await runAs(ben, () => feed.syncPost(changed));
    for (let n = 0; n < (post?.photos ?? 0); n++) expect((await feed.readPostPhoto(post!.id, n))?.toString()).not.toContain("sk-secret");
  });

  it("is removed only by its players or the admin, photos and all", async () => {
    const [post] = await runAs(ana, () => feed.feed());
    await expect(runAs(cid, () => feed.deletePost(post.id))).rejects.toThrow(/players/);
    await runAs(ana, () => feed.deletePost(post.id));
    expect(await runAs(ana, () => feed.feed())).toEqual([]);
    expect(await runAs(ana, () => feed.readPostPhoto(post.id, 0))).toBeUndefined();
  });
});

describe("shared report page", () => {
  it("never echoes a made-up token into the page", async () => {
    const { reportPage } = await import("./feed.ts");
    const html = await reportPage('x"</script><script>alert(document.domain)</script>', "en", "https://thorgrim.co");
    expect(html).not.toContain("alert(document.domain)");
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain('"/#/r/"');
  });
});

describe("rounds scored without a priority roll", () => {
  it("count on the score sheet, the round-by-round totals and the coach's facts", async () => {
    const { scoreDetail } = await import("./feed.ts");
    const { reportFacts, reportSides, runningScore } = await import("../shared/report.ts");
    const g = finishedGame();
    // Round 4: alone on the table, the player scored 10 without saying who went first.
    g.state.rounds = [...g.state.rounds!, { ...emptyRound(), me: side(10, { tactics: [{ card: "Smokescreen", step: "strike" }] }), opponent: side(0) }];
    const d = scoreDetail(g);
    expect(d.rounds.map((r) => r.round)).toEqual([1, 2, 3, 4]);
    expect(d.rounds[3]).toMatchObject({ round: 4, me: { vp: 15 } });
    expect(d.rounds[3].first).toBeUndefined();
    expect(runningScore(g).at(-1)).toEqual({ me: 50, opponent: 22 });
    const facts = reportFacts(g, reportSides(g, undefined, undefined));
    expect(facts).toContain("Round 4: Ana: 15 VP");
    expect(facts).toContain("Score after round 4: Ana 50, Ben 22.");
  });

  it("an empty round with nobody going first still doesn't count", async () => {
    const { roundPlayed } = await import("../shared/scoring.ts");
    expect(roundPlayed(emptyRound())).toBe(false);
    expect(roundPlayed({ ...emptyRound(), first: "me" })).toBe(true);
    expect(roundPlayed({ ...emptyRound(), opponent: side(0, { scored: ["Hold One"] }) })).toBe(true);
  });
});
