import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runAs, type UserCtx } from "./context.ts";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aos-clubs-test-"));
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

describe("clubs", async () => {
  const clubs = await import("./clubs.ts");
  const { clubMembers } = await import("./members.ts");
  /** Run as `u` inside the club a request would pick for them. */
  const inClub = async <T>(u: UserCtx, fn: () => Promise<T>, wanted?: string) => runAs({ ...u, club: (await clubs.clubFor(u, wanted)) ?? null }, fn);

  it("before any club, everyone shares the old space", async () => {
    expect(await clubs.clubFor(ben)).toMatchObject({ prefix: "club/" });
  });

  it("only the owner creates clubs; the first keeps the old space", async () => {
    await expect(runAs(ben, () => clubs.createClub("Rogue", "ben"))).rejects.toThrow(/owner/);
    const med = await runAs(ana, () => clubs.createClub("Medhammer", "ana", ["ana", "ben", "cid", "nobody"]));
    expect(med.prefix).toBe("club/");
    expect(med.memberIds).toEqual(["ana", "ben", "cid"]);
    const other = await runAs(ana, () => clubs.createClub("Second", "ben"));
    expect(other.prefix).toBe(`clubs/${other.id}/`);
    expect((await inClub(cid, () => clubMembers())).map((m) => m.id)).toEqual(["ana", "ben", "cid"]);
    expect((await inClub(ben, () => clubMembers(), other.id)).map((m) => m.id)).toEqual(["ben"]);
    // Cid isn't in Second: asking for it lands in Medhammer.
    expect((await clubs.clubFor(cid, other.id))?.id).toBe(med.id);
  });

  it("the leader adds and removes members, and stays in", async () => {
    const second = (await clubs.listClubs())[1];
    await expect(runAs(cid, () => clubs.addMembers(second.id, ["cid"]))).rejects.toThrow(/leader/);
    expect((await runAs(ben, () => clubs.addMembers(second.id, ["cid"]))).memberIds).toEqual(["ben", "cid"]);
    await expect(runAs(ben, () => clubs.removeMember(second.id, "ben"))).rejects.toThrow(/leader stays/);
    expect((await runAs(ben, () => clubs.removeMember(second.id, "cid"))).memberIds).toEqual(["ben"]);
  });

  it("someone in no club can't use club features", async () => {
    const med = (await clubs.listClubs())[0];
    await runAs(ana, () => clubs.removeMember(med.id, "cid"));
    expect(await clubs.clubFor(cid)).toBeUndefined();
    expect(() => runAs({ ...cid, club: null }, () => clubs.clubSpace())).toThrow(/not in a club/);
  });
});
