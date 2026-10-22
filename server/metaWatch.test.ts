import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runAs, type UserCtx } from "./context.ts";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aos-meta-test-"));
process.env.OMNISSIAH_URL = "https://omni.example";
process.env.OMNISSIAH_KEY = "secret-key-123456789";
vi.mock("./accounts.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounts.ts")>()),
  accountsEnabled: () => true,
  listAccounts: async () => [
    { id: "ana", email: "ana@example.com", name: "Ana", role: "admin", owner: true },
    { id: "ben", email: "b@example.com", name: "Ben", role: "player" },
  ],
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));
const mails: { to: string; subject: string }[] = [];
vi.mock("./mail.ts", () => ({ sendMail: async (m: { to: string; subject: string }) => (mails.push(m), true), mailReady: () => true }));
const chronicles: string[] = [];
vi.mock("./coach.ts", () => ({ metaChronicle: async (_d: unknown, lang: string) => (chronicles.push(lang), { title: lang === "es" ? "Los árboles avanzan" : "The trees march", story: "Sylvaneth rose." }) }));

let omni: Record<string, unknown> = {};
vi.stubGlobal("fetch", async (url: string) => {
  const route = new URL(url).pathname;
  return route in omni ? new Response(JSON.stringify(omni[route])) : new Response(JSON.stringify({ error: "nope" }), { status: 500 });
});

const ana: UserCtx = { id: "ana", name: "Ana", isAdmin: true, prefix: "" };
const ben: UserCtx = { id: "ben", name: "Ben", isAdmin: false, prefix: "users/ben/" };
const NOW = new Date("2026-10-26T08:00:00Z");

describe("the meta, brought to the club", () => {
  it("posts Monday's chronicle in the club's language, and alerts players whose army moved", async () => {
    const { CRON_USER } = await import("./cron.ts");
    const { factionAlerts, weeklyChronicle } = await import("./metaWatch.ts");
    const { feed } = await import("./feed.ts");
    const { myNotices } = await import("./notices.ts");
    const { Collection } = await import("./store.ts");
    const { rememberLang } = await import("./lang.ts");
    for (const u of [ana, ben]) await rememberLang(u.prefix, "es");
    await runAs(ben, () => new Collection("games").save({ id: "g1", createdAt: "2026-10-20T00:00:00Z", myFaction: "Sylvaneth" } as never));
    await runAs(ana, () => new Collection("games").save({ id: "g2", createdAt: "2026-10-20T00:00:00Z", myFaction: "Ogor Mawtribes" } as never));
    omni = {
      "/factions": { factions: [{ faction: "Sylvaneth", winRate: 58, games: 70 }], recentEvents: [] },
      "/trends": { factions: [{ faction: "Sylvaneth", winRate: 58, games: 70, weekChange: 6.2, monthChange: null, ci: [46, 69] }, { faction: "Ogor Mawtribes", winRate: 51, games: 12, weekChange: -8, monthChange: null, ci: null }] },
      "/rules/changes": { changes: [{ date: "2026-10-22", title: "New Battlescroll", url: "u", source: "Spikey Bits" }] },
      "/articles/latest": { articles: [] },
    };

    const posted = await runAs(CRON_USER, () => weeklyChronicle(NOW));
    expect(posted).toMatchObject({ posted: [{ posted: true, lang: "es" }] });
    expect(chronicles).toEqual(["es"]);
    const [post] = await runAs(ben, () => feed());
    expect(post).toMatchObject({ kind: "chronicle", authorName: "Thorgrim", title: "Los árboles avanzan", sides: [] });
    expect((await runAs(ben, () => myNotices()))[0].text).toMatch(/crónica del meta/);

    const alerts = await runAs(CRON_USER, () => factionAlerts(NOW));
    // Ben's Sylvaneth moved 6 points on 70 games; Ana's Ogors moved on only 12 (no alert); both hear of the battlescroll.
    expect(alerts).toEqual({ sent: 3, rulesChange: "New Battlescroll" });
    const benNotices = (await runAs(ben, () => myNotices())).map((n) => n.text);
    expect(benNotices.some((t) => /Sylvaneth subió 6.2 puntos/.test(t))).toBe(true);
    expect(benNotices.some((t) => /Cambio de reglas.*New Battlescroll.*Sylvaneth/.test(t))).toBe(true);
  });

  it("emails the owner when Omnissiah's read failed or went quiet, and stays quiet when it's fine", async () => {
    const { CRON_USER } = await import("./cron.ts");
    const { watchOmnissiah } = await import("./metaWatch.ts");
    omni = { "/status": { finishedAt: "2026-10-26T04:00:00Z", factions: 25, errors: [] } };
    expect(await runAs(CRON_USER, () => watchOmnissiah(NOW))).toEqual({ ok: true });
    expect(mails).toEqual([]);
    omni = { "/status": { finishedAt: "2026-10-23T04:00:00Z", factions: 12, errors: ["stats: HTTP 500"] } };
    const bad = await runAs(CRON_USER, () => watchOmnissiah(NOW));
    expect(bad).toMatchObject({ ok: false, emailed: true });
    expect((bad as { problems: string[] }).problems).toHaveLength(3);
    expect(mails[0]).toMatchObject({ to: "ana@example.com", subject: "Thorgrim: Omnissiah needs a look" });
  });
});
