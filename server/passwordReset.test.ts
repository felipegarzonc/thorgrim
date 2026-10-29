import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "thorgrim-reset-"));

// Background work (the email) is collected, so each test can wait for it.
const background: Promise<unknown>[] = [];
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void background.push(p) }));
const settle = async () => {
  await Promise.all(background.splice(0));
};

const passwords = new Map<string, string>();
vi.mock("./accounts.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounts.ts")>()),
  accountsEnabled: () => true,
  listAccounts: async () => [
    { id: "ana", email: "Ana@Example.com", name: "Ana", role: "admin", owner: true },
    { id: "ben", email: "ben@example.com", name: "Ben", role: "player", disabled: true },
  ],
  setLoginPassword: async (id: string, pw: string) => {
    if (pw.length < 8) throw new Error("short");
    passwords.set(id, pw);
  },
}));

let mailOn = true;
const sent: { to: string; subject: string; text: string; html: string }[] = [];
vi.mock("./mail.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mail.ts")>()),
  mailReady: () => mailOn,
  sendMail: async (m: (typeof sent)[number]) => {
    sent.push(m);
    return true;
  },
}));

const { finishReset, requestReset, resetValid } = await import("./passwordReset.ts");
const linkToken = (text: string) => /#\/reset\/([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";
let ip = 0;
const nextIp = () => `10.0.0.${++ip}`;

describe("forgotten passwords", () => {
  beforeEach(() => {
    sent.length = 0;
    mailOn = true;
  });
  afterEach(() => vi.useRealTimers());

  it("emails a one-time link that sets the new password", async () => {
    expect(await requestReset(" ana@example.COM ", "en", "https://thorgrim.co", nextIp())).toEqual({ mail: true });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("Ana@Example.com");
    expect(sent[0].text).toContain("https://thorgrim.co/#/reset/");
    const token = linkToken(sent[0].text);
    expect(await resetValid(token)).toBe(true);
    expect(await finishReset(token, "new-secret-1")).toEqual({ userId: "ana", email: "Ana@Example.com" });
    expect(passwords.get("ana")).toBe("new-secret-1");
    // Used up.
    expect(await resetValid(token)).toBe(false);
    expect(await finishReset(token, "another-one")).toBeUndefined();
  });

  it("answers the same for an email without an account, or a switched-off one, and sends nothing", async () => {
    expect(await requestReset("nobody@example.com", "en", "https://thorgrim.co", nextIp())).toEqual({ mail: true });
    expect(await requestReset("ben@example.com", "en", "https://thorgrim.co", nextIp())).toEqual({ mail: true });
    await settle();
    expect(sent).toEqual([]);
  });

  it("sends one email per account every few minutes, and writes in the asker's language", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T10:00:00Z"));
    await requestReset("ana@example.com", "es", "https://thorgrim.co", nextIp());
    await settle();
    await requestReset("ana@example.com", "es", "https://thorgrim.co", nextIp());
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Tu contraseña nueva de Thorgrim");
    vi.setSystemTime(new Date("2026-10-29T10:06:00Z"));
    await requestReset("ana@example.com", "en", "https://thorgrim.co", nextIp());
    await settle();
    expect(sent).toHaveLength(2);
    // A link lasts an hour; using one ends the others too.
    const [first, second] = sent.map((m) => linkToken(m.text));
    vi.setSystemTime(new Date("2026-10-29T11:01:00Z"));
    expect(await resetValid(first)).toBe(false);
    expect(await resetValid(second)).toBe(true);
    vi.setSystemTime(new Date("2026-10-29T10:30:00Z"));
    expect(await finishReset(second, "fresh-pass-2")).toBeTruthy();
    expect(await resetValid(first)).toBe(false);
  });

  it("refuses made-up links and slows down repeated asking", async () => {
    expect(await resetValid("x".repeat(43))).toBe(false);
    expect(await resetValid("../../settings/users")).toBe(false);
    const same = nextIp();
    for (let i = 0; i < 5; i++) await requestReset("nobody@example.com", "en", "https://thorgrim.co", same);
    await expect(requestReset("nobody@example.com", "en", "https://thorgrim.co", same)).rejects.toMatchObject({ status: 429 });
  });

  it("tells the player to ask an admin when this Thorgrim can't send email", async () => {
    mailOn = false;
    expect(await requestReset("ana@example.com", "en", "https://thorgrim.co", nextIp())).toEqual({ mail: false });
    await settle();
    expect(sent).toEqual([]);
  });
});
