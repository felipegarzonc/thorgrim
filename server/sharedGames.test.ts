import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { applyOps, diff } from "../shared/patch.ts";
import { flipGame } from "../shared/perspective.ts";
import { emptyRound } from "../shared/scoring.ts";
import type { ArmyList, Game } from "../shared/types.ts";
import { runAs, type UserCtx } from "./context.ts";

// Isolated storage for this test run.
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aos-shared-test-"));

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
      const edited = { ...benView, myListId: "ben-list", plan: { summary: "Ben's plan" } as Game["plan"], state: { ...benView.state, cp: { me: 3, opponent: 4 }, fury: { me: 3, opponent: 1 } } };
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
    expect(anaNow.access?.players).toEqual(["Ben"]);
    expect(anaNow.version).toBeGreaterThan(anaBase.version ?? 0);

    // Each player gets both lists, wherever they are kept.
    const anaLists = await runAs(ana, async () => (await sg.gameLists((await sg.openGame("g1"))!)).map((l) => l?.id));
    const benLists = await runAs(ben, async () => (await sg.gameLists((await sg.openGame("g1"))!)).map((l) => l?.id));
    expect(anaLists).toEqual(["ana-list", "ben-list"]);
    expect(benLists).toEqual(["ben-list", "ana-list"]);
    expect((await runAs(ben, async () => sg.viewGame((await sg.openGame("g1"))!))).plan?.summary).toBe("Ben's plan");

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
