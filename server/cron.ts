// Scheduled work (vercel.json "crons"): Vercel calls these routes with the
// CRON_SECRET; they run as Thorgrim himself, not as any member.
// - daily: reminders (an event tomorrow, a ladder result waiting for its
//   second confirmation, an unanswered challenge) and tidying up.
// - weekly: the club's week in a few lines, for every member.
// - and the tournament meta (server/metaWatch.ts): Monday's chronicle and
//   army alerts, and a daily look at Omnissiah.

import { inSeason, seasonRanges, standings } from "../shared/ladder.ts";
import type { Lang } from "../shared/i18n/index.ts";
import { forgetOldRequests } from "./access.ts";
import { listInvites, saveInvites } from "./accounts.ts";
import { remindOpen } from "./challenges.ts";
import type { UserCtx } from "./context.ts";
import { remindTomorrow, upcoming } from "./events.ts";
import { postsSince } from "./feed.ts";
import { listResults, listSeasons } from "./ladder.ts";
import { allAccounts, clubMembers } from "./members.ts";
import { eachClub } from "./clubs.ts";
import { notify } from "./notices.ts";
import { remindConfirmations } from "./sharedGames.ts";
import { factionAlerts, watchOmnissiah, weeklyChronicle } from "./metaWatch.ts";

/** Who scheduled work runs as: nobody's space, so every member hears it. */
export const CRON_USER: UserCtx = { id: "thorgrim", name: "Thorgrim", isAdmin: true, prefix: "" };

/** The CRON_SECRET Vercel sends; without one set, scheduled routes stay shut. */
export const cronAllowed = (authorization: string | undefined) => {
  const secret = process.env.CRON_SECRET?.trim();
  return !!secret && secret.length >= 16 && authorization === `Bearer ${secret}`;
};

export async function daily(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const spaces = [...new Set((await allAccounts()).map((m) => m.prefix))];
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const report = {
    eventReminders: sum(await eachClub(() => remindTomorrow(today))),
    confirmationReminders: await remindConfirmations(spaces, now.getTime()),
    challengeReminders: sum(await eachClub(() => remindOpen(now.getTime()))),
    expiredInvites: 0,
    oldRequests: await forgetOldRequests(now.getTime()),
  };
  // Invites a week past their end are of no use to anyone.
  const invites = await listInvites();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const keep = invites.filter((i) => i.usedBy || i.expiresAt > weekAgo);
  if (keep.length !== invites.length) {
    report.expiredInvites = invites.length - keep.length;
    await saveInvites(keep);
  }
  Object.assign(report, { omnissiah: await watchOmnissiah(now).catch((e: Error) => ({ error: e.message })) });
  return report;
}

export interface Digest {
  games: number;
  reports: number;
  topReport?: { title: string; reactions: number; id: string };
  leader?: { name: string; points: number };
  next?: { name: string; date: string };
}

/** The club's week, for the digest. Nothing happened: undefined. */
export async function weekOf(now = new Date()): Promise<Digest | undefined> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [results, seasons, posts, events] = await Promise.all([listResults(), listSeasons(), postsSince(since), upcoming(now.toISOString().slice(0, 10))]);
  const games = results.filter((r) => r.confirmedAt >= since).length;
  const current = seasonRanges(seasons)[0];
  const table = standings(current ? inSeason(results, current) : results);
  const reacted = posts
    .map((p) => ({ title: p.title, id: p.id, reactions: Object.values(p.reactions).reduce((n, ids) => n + ids.length, 0) }))
    .sort((a, b) => b.reactions - a.reactions)[0];
  if (!games && !posts.length && !events.length) return undefined;
  return {
    games,
    reports: posts.length,
    topReport: reacted && reacted.reactions > 0 ? reacted : undefined,
    leader: table[0] && { name: table[0].name, points: table[0].points },
    next: events[0] && { name: events[0].name, date: events[0].date },
  };
}

/** The digest in a few lines, in one language. */
export function digestText(d: Digest, lang: Lang): string {
  const es = lang === "es";
  const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
  const parts = [
    es ? "Esta semana en el club:" : "This week at the club:",
    d.games ? (es ? `${d.games} partida${d.games > 1 ? "s" : ""} en la liga` : `${d.games} game${d.games > 1 ? "s" : ""} on the ladder`) : "",
    d.reports ? (es ? `${d.reports} crónica${d.reports > 1 ? "s" : ""}` : `${d.reports} battle report${d.reports > 1 ? "s" : ""}`) : "",
  ].filter(Boolean);
  let text = parts.length > 1 ? `${parts[0]} ${parts.slice(1).join(" · ")}.` : parts[0];
  if (d.topReport) text += es ? ` La más aclamada: "${d.topReport.title}".` : ` Most acclaimed: "${d.topReport.title}".`;
  if (d.leader) text += es ? ` Lidera la liga ${d.leader.name} (${d.leader.points} pts).` : ` ${d.leader.name} leads the ladder (${d.leader.points} pts).`;
  if (d.next) text += es ? ` Próximo evento: ${d.next.name}, el ${dm(d.next.date)}.` : ` Next up: ${d.next.name} on ${dm(d.next.date)}.`;
  return text;
}

/** Each club hears about its own week. */
export async function weekly(now = new Date()) {
  const clubs = await eachClub(async (club) => {
    const digest = await weekOf(now);
    if (!digest) return { club: club.name, sent: 0 };
    const members = await clubMembers();
    await notify(
      members.map((m) => m.id),
      (lang) => digestText(digest, lang),
      "#/club",
    );
    return { club: club.name, sent: members.length, digest };
  });
  // The meta: never let it hold up the club's own digest.
  const meta = {
    chronicle: await weeklyChronicle(now).catch((e: Error) => ({ error: e.message })),
    alerts: await factionAlerts(now).catch((e: Error) => ({ error: e.message })),
  };
  return { sent: clubs.reduce((s, c) => s + c.sent, 0), clubs, meta };
}
