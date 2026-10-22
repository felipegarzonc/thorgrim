// Challenges: a member challenges another to a game. Accepting makes a game
// both already share (in the challenger's space), so they just open it.

import { currentUser } from "./context.ts";
import { FeedError } from "./feed.ts";
import { findMember, me } from "./members.ts";
import { blankGame } from "./newGame.ts";
import { notify } from "./notices.ts";
import { createSharedGame } from "./sharedGames.ts";
import { Collection, newId } from "./store.ts";

export interface Challenge {
  id: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  message?: string;
  /** YYYY-MM-DD, when they'd like to play. */
  date?: string;
  points: number;
  status: "open" | "accepted" | "declined" | "cancelled";
  gameId?: string;
  createdAt: string;
  answeredAt?: string;
  /** When the challenged member was reminded (server/cron.ts), so once only. */
  remindedAt?: string;
}

const challenges = new Collection<Challenge>("challenges", "club/");

/** The signed-in member's challenges, sent and received; finished ones only for a month. */
export async function myChallenges(): Promise<Challenge[]> {
  const u = currentUser().id;
  const month = new Date(Date.now() - 30 * 86400_000).toISOString();
  return (await challenges.list())
    .filter((c) => (c.from.id === u || c.to.id === u) && (c.status === "open" || (c.answeredAt ?? c.createdAt) > month))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function challenge(b: { to?: string; message?: string; date?: string; points?: number }): Promise<Challenge> {
  const from = me();
  const to = await findMember(String(b.to ?? ""));
  if (!to) throw new FeedError("That member isn't in the club.");
  if (to.id === from.id) throw new FeedError("You can't challenge yourself.");
  const open = (await challenges.list()).find((c) => c.status === "open" && c.from.id === from.id && c.to.id === to.id);
  if (open) throw new FeedError(`You already challenged ${to.name}: wait for their answer.`);
  const date = String(b.date ?? "").slice(0, 10);
  const c: Challenge = {
    id: newId(),
    from: { id: from.id, name: from.name || "A member" },
    to: { id: to.id, name: to.name },
    message: String(b.message ?? "").trim().slice(0, 300) || undefined,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    points: Number(b.points) > 0 ? Math.min(5000, Math.round(Number(b.points))) : 2000,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  await challenges.save(c);
  await notify([to.id], `⚔️ ${c.from.name} challenges you to a ${c.points}-point game${c.message ? `: "${c.message}"` : "."}`, "#/club/members");
  return c;
}

async function load(id: string) {
  const c = await challenges.get(id);
  if (!c) throw new FeedError("That challenge was withdrawn.", 404);
  return c;
}

/** Accept: the game is made for both. Returns its id. */
export async function accept(id: string): Promise<string> {
  const c = await load(id);
  if (c.to.id !== currentUser().id) throw new FeedError("Only the challenged member can accept.", 403);
  if (c.status === "accepted" && c.gameId) return c.gameId;
  if (c.status !== "open") throw new FeedError("This challenge is closed.");
  const [from, to] = await Promise.all([findMember(c.from.id), findMember(c.to.id)]);
  if (!from || !to) throw new FeedError("The challenger isn't in the club any more.");
  const game = await createSharedGame(from, to, blankGame({ date: c.date, points: c.points, name: "Challenge" }));
  await challenges.save({ ...c, status: "accepted", gameId: game.id, answeredAt: new Date().toISOString() });
  await notify([from.id], `${to.name} accepted your challenge! The game is ready in Games.`, `#/games/${game.id}/players`);
  return game.id;
}

export async function decline(id: string): Promise<Challenge> {
  const c = await load(id);
  if (c.to.id !== currentUser().id) throw new FeedError("Only the challenged member can decline.", 403);
  if (c.status !== "open") return c;
  const next = await challenges.save({ ...c, status: "declined", answeredAt: new Date().toISOString() });
  await notify([c.from.id], `${c.to.name} can't take your challenge this time.`, "#/club/members");
  return next;
}

export async function withdraw(id: string): Promise<Challenge> {
  const c = await load(id);
  if (c.from.id !== currentUser().id) throw new FeedError("Only the challenger can withdraw it.", 403);
  if (c.status !== "open") return c;
  return challenges.save({ ...c, status: "cancelled", answeredAt: new Date().toISOString() });
}

/** Challenges unanswered for two days: remind the challenged member once. */
export async function remindOpen(now = Date.now()): Promise<number> {
  let n = 0;
  for (const c of await challenges.list()) {
    if (c.status !== "open" || c.remindedAt || now - Date.parse(c.createdAt) < 2 * 86_400_000) continue;
    await notify(
      [c.to.id],
      (lang) => (lang === "es" ? `${c.from.name} sigue esperando tu respuesta a su desafío.` : `${c.from.name} is still waiting for your answer to their challenge.`),
      "#/club/members",
    );
    await challenges.save({ ...c, remindedAt: new Date(now).toISOString() });
    n++;
  }
  return n;
}
