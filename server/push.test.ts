import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { runAs, type UserCtx } from "./context.ts";

// Isolated storage for this test run.
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aos-push-test-"));

const sent: { endpoint: string; payload: string }[] = [];
let gone = new Set<string>();
vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: () => ({ publicKey: "PUB", privateKey: "PRIV" }),
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      if (gone.has(sub.endpoint)) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, payload });
    },
  },
}));
vi.mock("./accounts.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounts.ts")>()),
  accountsEnabled: () => true,
  listAccounts: async () => [
    { id: "ana", email: "a@x", name: "Ana", role: "admin", owner: true },
    { id: "ben", email: "b@x", name: "Ben", role: "player" },
  ],
}));

const ana: UserCtx = { id: "ana", name: "Ana", isAdmin: true, prefix: "" };
const ben: UserCtx = { id: "ben", name: "Ben", isAdmin: false, prefix: "users/ben/" };
const phone = (n: string) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "p", auth: "a" } });

describe("phone notifications", () => {
  let push: typeof import("./push.ts");
  let notices: typeof import("./notices.ts");
  beforeAll(async () => {
    [push, notices] = await Promise.all([import("./push.ts"), import("./notices.ts")]);
  });

  it("makes and keeps one key pair", async () => {
    expect(await push.publicKey()).toBe("PUB");
  });

  it("only takes real subscriptions", async () => {
    await expect(runAs(ben, () => push.subscribe({ endpoint: "http://insecure", keys: { p256dh: "p", auth: "a" } }))).rejects.toThrow(/push subscription/);
    await expect(runAs(ben, () => push.subscribe({} as never))).rejects.toThrow(/push subscription/);
  });

  it("sends what lands in Activity to the member's phones, and forgets phones that went away", async () => {
    await runAs(ben, () => push.subscribe(phone("ben-phone")));
    await runAs(ben, () => push.subscribe(phone("ben-old-tablet")));
    gone = new Set(["https://push.example/ben-old-tablet"]);
    await runAs(ana, () => notices.notify(["ben", "ana"], "Ana commented on your report", "#/club/p1"));
    expect(sent.map((s) => s.endpoint)).toEqual(["https://push.example/ben-phone"]);
    expect(JSON.parse(sent[0].payload)).toEqual({ title: "Thorgrim", body: "Ana commented on your report", href: "#/club/p1" });
    // The old tablet is forgotten: the next notice goes to the phone only, without trying it.
    sent.length = 0;
    gone = new Set();
    await runAs(ana, () => notices.notify(["ben"], "Again", "#/club"));
    expect(sent.map((s) => s.endpoint)).toEqual(["https://push.example/ben-phone"]);
    // Turned off on the phone: nothing more.
    sent.length = 0;
    await runAs(ben, () => push.unsubscribe("https://push.example/ben-phone"));
    await runAs(ana, () => notices.notify(["ben"], "Quiet", "#/club"));
    expect(sent).toEqual([]);
  });
});
