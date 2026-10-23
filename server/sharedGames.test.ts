import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { applyOps, diff } from "../shared/patch.ts";
import { flipGame } from "../shared/perspective.ts";
import { emptyRound } from "../shared/scoring.ts";
import type { ArmyList, Game } from "../shared/types.ts";
import { runAs, type UserCtx } from "./context.ts";

// Isolated storage for this test run.
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aos-shared-test-"));
// Accounts, so notices reach the players.
vi.mock("./accounts.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounts.ts")>()),
  accountsEnabled: () => true,
  listAccounts: async () => [
    { id: "ana", email: "a@example.com", name: "Ana", role: "admin", owner: true },
    { id: "ben", email: "b@example.com", name: "Ben", role: "player" },
    { id: "cid", email: "c@example.com", name: "Cid", role: "player" },
  ],
}));

const ana: UserCtx = { id: "ana", name: "Ana", isAdmin: true, prefix: "" };
const ben: UserCtx = { id: "ben", name: "Ben", isAdmin: false, prefix: "users/ben/" };
const cid: UserCtx = { id: "cid", name: "Cid", isAdmin: false, prefix: "users/cid/" };

const newGame = (): Game => ({
  id: "g1",
  name: "",
  myName: "Ana",
  myListId: "ana-list",
  opponentListId: "",
  battleplan: "",
  battleplanNotes: "",
  references: [],
  log: [],
  createdAt: "2026-10-21T00:00:00.000Z",
  state: {
    round: 1,
    attacker: "me",
    firstThisRound: "me",
    activePlayer: "me",
    phase: "Deployment",
    cp: { me: 4, opponent: 4 },
    vp: { me: 0, opponent: 0 },
    fury: { me: 1, opponent: 2 },
    rage: { me: 0, opponent: 0 },
    tactics: [{ card: "Smokescreen", affray: false, strike: false, domination: false }],
    opponentTactics: [],
    units: { "me:a": { damage: 2, destroyed: false } },
    objectives: "",
    notes: "",
    rounds: [{ ...emptyRound(), first: "me" }],
  },
});
const list = (id: string): ArmyList => ({ id, name: id, owner: "me", rawText: "", createdAt: "", faction: "Skaven", units: [], unmatched: [] });

describe("small edits", () => {
  it("adds counters up, keeps both log lines, and sets other fields", () => {
    const start = newGame();
    const mine = { ...start, state: { ...start.state, cp: { me: 5, opponent: 4 } }, log: [{ at: "1", text: "mine" }] };
    const theirs = { ...start, state: { ...start.state, cp: { me: 6, opponent: 4 }, round: 2 }, log: [{ at: "2", text: "theirs" }] };
    const merged = applyOps(applyOps(start, diff(start, mine)), diff(start, theirs));
    expect(merged.state.cp.me).toBe(7);
    expect(merged.state.round).toBe(2);
    expect(merged.log.map((l) => l.text)).toEqual(["mine", "theirs"]);
  });

  it("does not count the round twice when both players move on", () => {
    const start = newGame();
    const next = { ...start, state: { ...start.state, round: 2 } };
    expect(applyOps(applyOps(start, diff(start, next)), diff(start, next)).state.round).toBe(2);
  });

  it("ignores paths that would reach the object prototype", () => {
    const out = applyOps({}, [{ path: ["__proto__", "x"], set: 1 }]) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(out.x).toBeUndefined();
  });
});

describe("other side", () => {
  it("swaps sides, and flipping twice gives the game back", () => {
    const g = newGame();
    const f = flipGame(g);
    expect(f.opponentName).toBe("Ana");
    expect(f.opponentListId).toBe("ana-list");
    expect(f.state.fury).toEqual({ me: 2, opponent: 1 });
    expect(f.state.attacker).toBe("opponent");
    expect(f.state.units).toEqual({ "opponent:a": { damage: 2, destroyed: false } });
    expect(f.state.opponentTactics?.[0].card).toBe("Smokescreen");
    expect(f.state.rounds?.[0].first).toBe("opponent");
    expect(JSON.parse(JSON.stringify(flipGame(f)))).toEqual(JSON.parse(JSON.stringify(g)));
  });
});

describe("shared games", () => {
  let sg: typeof import("./sharedGames.ts");
  let store: typeof import("./store.ts");
  beforeAll(async () => {
    sg = await import("./sharedGames.ts");
    store = await import("./store.ts");
    await runAs(ana, async () => {
      await new store.Collection<Game>("games").save(newGame());
      await new store.Collection<ArmyList>("lists").save(list("ana-list"));
    });
    await runAs(ben, () => new store.Collection<ArmyList>("lists").save(list("ben-list")));
  });

  it("lets the opponent join, see their side and edit together", async () => {
    const token = await runAs(ana, async () => (await sg.shareGame((await sg.openGame("g1"))!)).game.share!.token!);
    expect(await runAs(cid, () => sg.joinGame("0".repeat(32)).catch((e: Error) => e.message))).toMatch(/doesn't work/);
    expect(await runAs(ben, () => sg.joinGame(token))).toBe("g1");

    // Ben sees the game from his side, with his name filled in.
    const benView = await runAs(ben, async () => sg.viewGame((await sg.openGame("g1"))!));
    expect(benView.access?.role).toBe("player");
    expect(benView.myName).toBe("Ben");
    expect(benView.opponentName).toBe("Ana");
    expect(benView.state.fury.me).toBe(2);
    expect(benView.share).toBeUndefined();

    // Both edit from the same starting copy: nothing is lost.
    const anaBase = await runAs(ana, async () => sg.viewGame((await sg.openGame("g1"))!));
    await runAs(ben, async () => {
      const o = (await sg.openGame("g1"))!;
      const edited = { ...benView, myListId: "ben-list", plan: { summary: "Ben's plan" } as Game["plan"], review: { verdict: "Ben's review" } as Game["review"], state: { ...benView.state, cp: { me: 3, opponent: 4 }, fury: { me: 3, opponent: 1 } } };
      await sg.changeGame(o, diff(benView, edited));
    });
    await runAs(ana, async () => {
      const o = (await sg.openGame("g1"))!;
      await sg.changeGame(o, diff(anaBase, { ...anaBase, state: { ...anaBase.state, cp: { me: 2, opponent: 4 } } }));
    });

    const anaNow = await runAs(ana, async () => sg.viewGame((await sg.openGame("g1"))!));
    expect(anaNow.state.cp).toEqual({ me: 2, opponent: 3 });
    expect(anaNow.state.fury).toEqual({ me: 1, opponent: 3 });
    expect(anaNow.opponentListId).toBe("ben-list");
    expect(anaNow.plan).toBeUndefined(); // Ben's plan is his own
    expect(anaNow.review).toBeUndefined(); // and so is his review
    expect(anaNow.access?.players).toEqual(["Ben"]);
    expect(anaNow.version).toBeGreaterThan(anaBase.version ?? 0);

    // Each player gets both lists, wherever they are kept.
    const anaLists = await runAs(ana, async () => (await sg.gameLists((await sg.openGame("g1"))!)).map((l) => l?.id));
    const benLists = await runAs(ben, async () => (await sg.gameLists((await sg.openGame("g1"))!)).map((l) => l?.id));
    expect(anaLists).toEqual(["ana-list", "ben-list"]);
    expect(benLists).toEqual(["ben-list", "ana-list"]);
    expect((await runAs(ben, async () => sg.viewGame((await sg.openGame("g1"))!))).plan?.summary).toBe("Ben's plan");
    expect((await runAs(ben, async () => sg.viewGame((await sg.openGame("g1"))!))).review?.verdict).toBe("Ben's review");

    // The game shows in both players' lists of games.
    expect((await runAs(ben, () => sg.myGames())).map((g) => g.id)).toEqual(["g1"]);
  });

  it("can't be reached by players who didn't join, and is left cleanly", async () => {
    expect(await runAs(cid, () => sg.openGame("g1"))).toBeUndefined();
    await runAs(ben, async () => sg.leaveGame((await sg.openGame("g1"))!));
    expect(await runAs(ben, () => sg.openGame("g1"))).toBeUndefined();
    const left = await runAs(ana, async () => sg.viewGame((await sg.openGame("g1"))!));
    expect(left.access?.players).toEqual([]);
  });

  it("stops sharing: the link stops working", async () => {
    const token = await runAs(ana, async () => (await sg.openGame("g1"))!.game.share!.token!);
    await runAs(ana, async () => sg.stopSharing((await sg.openGame("g1"))!));
    expect(await runAs(ben, () => sg.joinGame(token).catch((e: Error) => e.message))).toMatch(/doesn't work/);
  });
});

describe("linking past games to a club member", () => {
  let sg: typeof import("./sharedGames.ts");
  let store: typeof import("./store.ts");
  let notices: typeof import("./notices.ts");
  beforeAll(async () => {
    sg = await import("./sharedGames.ts");
    store = await import("./store.ts");
    notices = await import("./notices.ts");
  });
  const past = (id: string, opponentName: string, vp: [number, number]): Game => {
    const g = newGame();
    return { ...g, id, opponentName, date: `2026-09-${id.slice(-1).padStart(2, "0")}`, state: { ...g.state, vp: { me: vp[0], opponent: vp[1] } }, finished: { conclusion: "played", at: "2026-09-30T00:00:00Z" } };
  };

  it("proposes games, the member accepts them, and both have confirmed the results", async () => {
    const cids = new store.Collection<Game>("games", cid.prefix);
    await runAs(cid, async () => {
      await cids.save(past("p1", "Diego", [60, 40]));
      await cids.save(past("p2", "Diego", [30, 70]));
      await cids.save(past("p3", "Someone else", [50, 50]));
    });
    const benMember = { id: ben.id, name: ben.name, prefix: ben.prefix };
    expect(await runAs(cid, () => sg.offerGames({ id: cid.id, name: "Cid", prefix: cid.prefix }, ["p1"]).catch((e: Error) => e.message))).toMatch(/not yourself/);
    expect(await runAs(cid, () => sg.offerGames(benMember, ["p1", "p2", "nope"]))).toEqual({ offered: 2 });
    expect((await runAs(ben, () => notices.myNotices())).some((n) => /Cid wants to link 2 games they recorded against "Diego"/.test(n.text))).toBe(true);

    // Ben sees them from his side: his score first.
    const [offer] = await runAs(ben, () => sg.myOffers());
    expect(offer).toMatchObject({ id: "cid", fromName: "Cid" });
    expect(offer.games.map((g) => [g.id, g.vp.me, g.vp.opponent])).toEqual([
      ["p2", 70, 30],
      ["p1", 40, 60],
    ]);

    const linked = await runAs(ben, () => sg.acceptOffer("cid"));
    expect(linked.map((o) => o.game.id).sort()).toEqual(["p1", "p2"]);
    expect(await runAs(ben, () => sg.myOffers())).toEqual([]);
    // Ben has them now, from his side, and both players' confirmations count.
    const p1 = (await runAs(ben, () => sg.openGame("p1")))!;
    expect(p1.role).toBe("player");
    expect(sg.viewGame(p1).state.vp).toEqual({ me: 40, opponent: 60 });
    expect(sg.bothConfirmed(p1)).toBe(true);
    expect((await runAs(cid, () => notices.myNotices())).some((n) => /Ben accepted: 2 games are linked/.test(n.text))).toBe(true);
    // A linked game can't be offered again.
    expect(await runAs(cid, () => sg.offerGames(benMember, ["p1"]).catch((e: Error) => e.message))).toMatch(/can be linked/);
  });

  it("drops a declined proposal", async () => {
    await runAs(ana, async () => new store.Collection<Game>("games", ana.prefix).save(past("p4", "Cid", [10, 20])));
    await runAs(ana, () => sg.offerGames({ id: cid.id, name: "Cid", prefix: cid.prefix }, ["p4"]));
    expect((await runAs(cid, () => sg.myOffers())).length).toBe(1);
    await runAs(cid, () => sg.declineOffer("ana"));
    expect(await runAs(cid, () => sg.myOffers())).toEqual([]);
    expect(await runAs(cid, () => sg.acceptOffer("ana").catch((e: Error) => e.message))).toMatch(/isn't there/);
  });
});
