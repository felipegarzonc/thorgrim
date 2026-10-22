// The tournament meta, brought to the club (Omnissiah, server/omnissiah.ts):
// - Mondays: Thorgrim's chronicle of the week's meta in each club's feed,
//   and an alert to each player whose army moved a lot or when a rules
//   change came out;
// - every day: a look at Omnissiah's last read, and an email to the app's
//   owner when it failed or went quiet.
// All of it is skipped when Omnissiah isn't set up.

import { baseFaction } from "../shared/season.ts";
import type { Game } from "../shared/types.ts";
import type { Lang } from "../shared/i18n/index.ts";
import { accountsEnabled, listAccounts } from "./accounts.ts";
import { eachClub } from "./clubs.ts";
import { metaChronicle } from "./coach.ts";
import { postChronicle } from "./feed.ts";
import { langOf } from "./lang.ts";
import { sendMail } from "./mail.ts";
import { allAccounts, clubMembers } from "./members.ts";
import { notify } from "./notices.ts";
import { omnissiahGet, omnissiahReady, omnissiahStatus } from "./omnissiah.ts";
import { Collection } from "./store.ts";

interface Trend {
  faction: string;
  winRate: number;
  games: number;
  ci: [number, number] | null;
  weekChange: number | null;
  monthChange: number | null;
}
interface RulesChange {
  date: string;
  title: string;
  url: string;
  source: string;
}

const daysAgo = (now: Date, n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);

/** What the chronicle is written from: kept small (it goes into a prompt). */
async function weekData(now: Date) {
  const [factions, trends, rules, articles] = await Promise.all([
    omnissiahGet<{ factions: { faction: string; winRate: number; games: number; ci: unknown }[]; recentEvents: unknown[] }>("/factions"),
    omnissiahGet<{ factions: Trend[]; note: string }>("/trends"),
    omnissiahGet<{ changes: RulesChange[] }>("/rules/changes", { limit: 3 }),
    omnissiahGet<{ articles: { source: string; title: string; url: string; date: string; summary: string }[] }>("/articles/latest", { limit: 8 }),
  ]);
  if (!factions) return undefined;
  const ranked = factions.factions;
  return {
    date: now.toISOString().slice(0, 10),
    best: ranked.slice(0, 5),
    worst: ranked.slice(-3),
    movers: (trends?.factions ?? []).filter((t) => t.weekChange !== null && Math.abs(t.weekChange) >= 3).slice(0, 6),
    trendsNote: trends?.note,
    recentEvents: factions.recentEvents.slice(0, 6),
    rulesChangesThisWeek: (rules?.changes ?? []).filter((c) => c.date >= daysAgo(now, 7)),
    articles: (articles?.articles ?? []).filter((a) => a.date >= daysAgo(now, 8)).map((a) => ({ source: a.source, title: a.title, date: a.date, summary: a.summary.slice(0, 200) })),
  };
}

/** The language most of a club's members use. */
async function clubLang(members: { prefix: string }[]): Promise<Lang> {
  const langs = await Promise.all(members.map((m) => langOf(m.prefix)));
  return langs.filter((l) => l === "es").length > langs.length / 2 ? "es" : "en";
}

/** Mondays: the chronicle in each club's feed. */
export async function weeklyChronicle(now = new Date()) {
  if (!omnissiahReady()) return { skipped: "Omnissiah is not set up" };
  const data = await weekData(now);
  if (!data) return { skipped: "Omnissiah had no data" };
  const written = new Map<Lang, { title: string; story: string }>();
  const posted = await eachClub(async (club) => {
    const members = await clubMembers();
    if (!members.length) return { club: club.name, posted: false };
    const lang = await clubLang(members);
    if (!written.has(lang)) written.set(lang, await metaChronicle(data, lang));
    const c = written.get(lang)!;
    await postChronicle(c.title, c.story, members.map((m) => m.id));
    return { club: club.name, posted: true, lang };
  });
  return { posted };
}

/** A player's army: the one they played most in their last games. */
async function armyOf(prefix: string): Promise<string | undefined> {
  const games = (await new Collection<Game>("games", prefix).list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  const count = new Map<string, number>();
  for (const g of games) if (g.myFaction) count.set(baseFaction(g.myFaction), (count.get(baseFaction(g.myFaction)) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Mondays: tell each player when their army's win rate moved 5+ points on 20+ games, or a rules change came out. */
export async function factionAlerts(now = new Date()) {
  if (!omnissiahReady()) return { skipped: "Omnissiah is not set up" };
  const [trends, rules] = await Promise.all([omnissiahGet<{ factions: Trend[] }>("/trends"), omnissiahGet<{ changes: RulesChange[] }>("/rules/changes", { limit: 3 })]);
  const change = (rules?.changes ?? []).find((c) => c.date >= daysAgo(now, 7));
  let sent = 0;
  for (const m of await allAccounts()) {
    const army = await armyOf(m.prefix);
    if (!army) continue;
    const t = trends?.factions.find((f) => f.faction.toLowerCase() === army.toLowerCase());
    if (t && t.weekChange !== null && Math.abs(t.weekChange) >= 5 && t.games >= 20) {
      const up = t.weekChange > 0;
      await notify(
        [m.id],
        (lang) =>
          lang === "es"
            ? `${army} ${up ? "subió" : "bajó"} ${Math.abs(t.weekChange!)} puntos esta semana en torneos: ${t.winRate}% en ${t.games} partidas. Pregúntale a Thorgrim qué está cambiando.`
            : `${army} ${up ? "rose" : "fell"} ${Math.abs(t.weekChange!)} points in tournaments this week: ${t.winRate}% over ${t.games} games. Ask Thorgrim what's changing.`,
        "#/ask",
      );
      sent++;
    }
    if (change) {
      await notify(
        [m.id],
        (lang) => (lang === "es" ? `Cambio de reglas en las noticias (${change.source}): ${change.title}. Revisa tu lista de ${army}.` : `Rules change in the news (${change.source}): ${change.title}. Check your ${army} list.`),
        "#/lists",
      );
      sent++;
    }
  }
  return { sent, rulesChange: change?.title ?? null };
}

/** Every day: is Omnissiah reading? If its last read failed or is over a day and a half old, email the app's owner. */
export async function watchOmnissiah(now = new Date()) {
  if (!omnissiahReady()) return { skipped: "Omnissiah is not set up" };
  const { status, error } = await omnissiahStatus();
  const s = status as { finishedAt?: string; factions?: number; errors?: string[] } | null | undefined;
  const problems: string[] = [];
  if (error) problems.push(`Thorgrim can't reach Omnissiah: ${error}`);
  else if (!s?.finishedAt) problems.push("Omnissiah has no finished read on record.");
  else {
    const hours = (now.getTime() - Date.parse(s.finishedAt)) / 3_600_000;
    if (hours > 36) problems.push(`Omnissiah's last read finished ${Math.round(hours)} hours ago (it should run every day).`);
    if ((s.factions ?? 0) < 20) problems.push(`The last read only got ${s.factions ?? 0} factions from Listhammer (usually 25): its pages may have changed.`);
    if (s.errors?.length) problems.push(`The last read had ${s.errors.length} error(s): ${s.errors.slice(0, 5).join(" | ")}`);
  }
  if (!problems.length) return { ok: true };
  const owner = accountsEnabled() ? (await listAccounts()).find((a) => a.owner) : undefined;
  const text = `Omnissiah needs a look:\n\n- ${problems.join("\n- ")}\n\nIts setup and last read: https://omnissiah.thorgrim.co/ (and /api/admin/omnissiah in Thorgrim).`;
  const emailed = owner?.email ? await sendMail({ to: owner.email, subject: "Thorgrim: Omnissiah needs a look", text, html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>` }) : false;
  if (owner) await notify([owner.id], `Omnissiah needs a look: ${problems[0]}`, "#/profile");
  return { ok: false, problems, emailed };
}
