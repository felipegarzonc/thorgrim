// Club nights and tournaments (shared/events.ts), kept in the club's space.
// Any member can organise one; the organiser (or an admin) pairs the rounds,
// enters results played on paper and closes it. Each table can start a game
// both players share; its result counts once both confirmed it, like any
// game on the club ladder.

import { eventStandings, pairNextRound, type ClubEvent, type EventTable, type TableResult } from "../shared/events.ts";
import type { ClubResult } from "../shared/ladder.ts";
import { waitUntil } from "@vercel/functions";
import { currentUser } from "./context.ts";
import { forgetResult, listResults, saveEventResult } from "./ladder.ts";
import { clubMembers, findMember, me } from "./members.ts";
import { blankGame } from "./newGame.ts";
import { notify } from "./notices.ts";
import { createSharedGame, openGame } from "./sharedGames.ts";
import { Collection, newId } from "./store.ts";
import { FeedError } from "./feed.ts";

const events = new Collection<ClubEvent>("events", "club/");

/** An event as the page sees it: with each table's result and the standings. */
export interface EventView extends ClubEvent {
  results: Record<string, TableResult & { confirmed: boolean }>;
  standings: ReturnType<typeof eventStandings>;
  canManage: boolean;
  joined: boolean;
}

const tableKey = (round: number, table: number) => `${round}:${table}`;
const ladderId = (eventId: string, round: number, table: number) => `ev-${eventId}-${round}-${table}`;

async function load(id: string): Promise<ClubEvent> {
  const e = await events.get(id);
  if (!e) throw new FeedError("That event was removed.", 404);
  return e;
}

const canManage = (e: ClubEvent) => e.organiser.id === currentUser().id || currentUser().isAdmin;
function mustManage(e: ClubEvent) {
  if (!canManage(e)) throw new FeedError("Only the organiser can do that.", 403);
}

/** Results known so far: confirmed games and the organiser's entries; unconfirmed games show their score as it stands. */
async function tableResults(e: ClubEvent): Promise<EventView["results"]> {
  const confirmed = new Map((await listResults()).map((r) => [r.id, r]));
  const out: EventView["results"] = {};
  for (const r of e.pairings) {
    for (const [i, t] of r.tables.entries()) {
      if (t.b === null) continue;
      if (t.manual) {
        out[tableKey(r.round, i)] = { ...t.manual, confirmed: true };
        continue;
      }
      if (!t.gameId) continue;
      const c = confirmed.get(t.gameId);
      if (c) {
        const ia = c.players[0].id === t.a ? 0 : 1;
        out[tableKey(r.round, i)] = { a: scoreOf(c, ia), b: scoreOf(c, ia === 0 ? 1 : 0), confirmed: true };
      }
    }
  }
  return out;
}

/** A player's score in a confirmed game. A concession is a loss whatever the score: 0 for the side that conceded, at least 1 for the other. */
function scoreOf(c: ClubResult, i: 0 | 1): number {
  const conceded = c.conclusion === "conceded-me" ? 0 : c.conclusion === "conceded-opponent" ? 1 : null;
  if (conceded === null) return c.players[i].vp;
  return conceded === i ? 0 : Math.max(1, c.players[i].vp);
}

async function view(e: ClubEvent): Promise<EventView> {
  const results = await tableResults(e);
  const resultOf = (t: EventTable) => {
    for (const r of e.pairings) {
      const i = r.tables.indexOf(t);
      if (i >= 0) {
        const x = results[tableKey(r.round, i)];
        return x?.confirmed ? x : undefined;
      }
    }
    return undefined;
  };
  return { ...e, results, standings: eventStandings(e, resultOf), canManage: canManage(e), joined: e.players.some((p) => p.id === currentUser().id) };
}

export async function listEvents(): Promise<EventView[]> {
  const all = await events.list();
  // Upcoming first (soonest first), then past ones (latest first).
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = all.filter((e) => !e.finishedAt && e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = all.filter((e) => !upcoming.includes(e)).sort((a, b) => b.date.localeCompare(a.date));
  return Promise.all([...upcoming, ...past].map(view));
}

export const getEvent = async (id: string) => view(await load(id));

const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);

export async function createEvent(b: Partial<ClubEvent>): Promise<EventView> {
  const name = clean(b.name, 80);
  const date = clean(b.date, 10);
  if (!name) throw new FeedError("Give the event a name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new FeedError("Pick the date.");
  const u = me();
  const e: ClubEvent = {
    id: newId(),
    kind: b.kind === "tournament" ? "tournament" : "night",
    name,
    date,
    time: clean(b.time, 5) || undefined,
    place: clean(b.place, 120) || undefined,
    notes: clean(b.notes, 1000) || undefined,
    points: Number(b.points) > 0 ? Math.min(5000, Math.round(Number(b.points))) : 2000,
    rounds: b.kind === "tournament" ? Math.max(1, Math.min(8, Math.round(Number(b.rounds) || 3))) : undefined,
    organiser: { id: u.id, name: u.name || "The organiser" },
    createdAt: new Date().toISOString(),
    players: [],
    pairings: [],
  };
  await events.save(e);
  // Tell the club, without making the organiser wait for everyone's phones.
  const members = (await clubMembers()).map((m) => m.id);
  const [, m, d] = e.date.split("-");
  const when = `${Number(d)}/${Number(m)}${e.time ? ` ${e.time}` : ""}`;
  waitUntil(notify(members, `${u.name || "A member"} organised ${e.kind === "tournament" ? "a tournament" : "a club night"}: ${e.name}, ${when}. Sign up in the club.`, `#/club/event/${e.id}`).catch(() => undefined));
  return view(e);
}

export async function editEvent(id: string, b: Partial<ClubEvent>): Promise<EventView> {
  const e = await load(id);
  mustManage(e);
  const next: ClubEvent = { ...e };
  if (b.name !== undefined) next.name = clean(b.name, 80) || e.name;
  if (b.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(clean(b.date, 10))) next.date = clean(b.date, 10);
  if (b.time !== undefined) next.time = clean(b.time, 5) || undefined;
  if (b.place !== undefined) next.place = clean(b.place, 120) || undefined;
  if (b.notes !== undefined) next.notes = clean(b.notes, 1000) || undefined;
  if (b.points !== undefined && Number(b.points) > 0) next.points = Math.min(5000, Math.round(Number(b.points)));
  if (b.rounds !== undefined && e.kind === "tournament") next.rounds = Math.max(e.pairings.length || 1, Math.min(8, Math.round(Number(b.rounds) || 3)));
  return view(await events.save(next));
}

export async function deleteEvent(id: string) {
  const e = await load(id);
  mustManage(e);
  await events.delete(id);
}

export async function joinEvent(id: string, faction?: string): Promise<EventView> {
  const e = await load(id);
  if (e.finishedAt) throw new FeedError("This event is over.");
  const u = me();
  const players = e.players.filter((p) => p.id !== u.id);
  players.push({ id: u.id, name: u.name || "Player", faction: clean(faction, 80) || undefined });
  const saved = await events.save({ ...e, players });
  if (!e.players.some((p) => p.id === u.id)) await notify([e.organiser.id], `${u.name || "A member"} signed up for ${e.name}.`, `#/club/event/${e.id}`);
  return view(saved);
}

export async function leaveEvent(id: string): Promise<EventView> {
  const e = await load(id);
  const u = currentUser().id;
  if (e.pairings.some((r) => r.tables.some((t) => t.a === u || t.b === u))) throw new FeedError("You're already paired: ask the organiser to sort it out.");
  return view(await events.save({ ...e, players: e.players.filter((p) => p.id !== u) }));
}

/** Pair the next round and tell each player who they play. */
export async function pairRound(id: string): Promise<EventView> {
  const e = await load(id);
  mustManage(e);
  if (e.finishedAt) throw new FeedError("This event is over.");
  if (e.players.length < 2) throw new FeedError("At least two players need to sign up.");
  const current = await view(e);
  const last = e.pairings[e.pairings.length - 1];
  if (last && e.kind === "tournament" && last.tables.some((t, i) => t.b !== null && !current.results[tableKey(last.round, i)]?.confirmed))
    throw new FeedError(`Round ${last.round} isn't finished: every table needs a confirmed result first.`);
  const round = (last?.round ?? 0) + 1;
  // Players who signed up after the last round join in with no points.
  const tables = pairNextRound(current.standings, round);
  const saved = await events.save({ ...e, pairings: [...e.pairings, { round, tables }] });
  const name = (pid: string | null) => e.players.find((p) => p.id === pid)?.name ?? "?";
  waitUntil(
    (async () => {
      for (const [i, t] of tables.entries()) {
        const href = `#/club/event/${e.id}`;
        if (t.b === null) await notify([t.a], `${e.name}, round ${round}: you have a bye (a win).`, href);
        else {
          await notify([t.a], `${e.name}, round ${round}: you play ${name(t.b)} at table ${i + 1}.`, href);
          await notify([t.b], `${e.name}, round ${round}: you play ${name(t.a)} at table ${i + 1}.`, href);
        }
      }
    })().catch(() => undefined),
  );
  return view(saved);
}

/** Undo the latest round's pairings (before any game was started on it). */
export async function unpairRound(id: string): Promise<EventView> {
  const e = await load(id);
  mustManage(e);
  const last = e.pairings[e.pairings.length - 1];
  if (!last) return view(e);
  if (last.tables.some((t) => t.gameId || t.manual)) throw new FeedError("Games already started in this round: enter or fix their results instead.");
  return view(await events.save({ ...e, pairings: e.pairings.slice(0, -1) }));
}

/** Start (or open) the shared game of a table. Either player can. Returns the game's id. */
export async function tableGame(id: string, round: number, table: number): Promise<string> {
  const e = await load(id);
  const t = e.pairings.find((r) => r.round === round)?.tables[table];
  if (!t || t.b === null) throw new FeedError("That table doesn't exist.", 404);
  const u = currentUser().id;
  if (u !== t.a && u !== t.b) throw new FeedError("Only the two players of this table can start its game.", 403);
  if (t.gameId && (await openGame(t.gameId))) return t.gameId;
  const [a, b] = await Promise.all([findMember(t.a), findMember(t.b)]);
  if (!a || !b) throw new FeedError("Both players need an account to play this game in the app. The organiser can enter the result instead.");
  const faction = (pid: string) => e.players.find((p) => p.id === pid)?.faction;
  const game = blankGame({ date: e.date, points: e.points, myFaction: faction(a.id), opponentFaction: faction(b.id) });
  const saved = await createSharedGame(a, b, { ...game, event: { id: e.id, name: e.name, round, table: table + 1 } });
  const pairings = e.pairings.map((r) => (r.round === round ? { ...r, tables: r.tables.map((x, i) => (i === table ? { ...x, gameId: saved.id } : x)) } : r));
  await events.save({ ...e, pairings });
  await notify([u === a.id ? b.id : a.id], `Your ${e.name} game (round ${round}) is ready: open it from Games.`, `#/games/${saved.id}`);
  return saved.id;
}

/** The organiser enters a table's result (a game played on paper, a no-show). It counts on the ladder straight away. */
export async function setTableResult(id: string, round: number, table: number, score: TableResult | null): Promise<EventView> {
  const e = await load(id);
  mustManage(e);
  const r = e.pairings.find((x) => x.round === round);
  const t = r?.tables[table];
  if (!r || !t || t.b === null) throw new FeedError("That table doesn't exist.", 404);
  if (t.gameId && (await listResults()).some((x) => x.id === t.gameId)) throw new FeedError("Both players already confirmed this table's game: its result counts as it is.");
  if (score && (!Number.isInteger(score.a) || !Number.isInteger(score.b) || score.a < 0 || score.b < 0 || score.a > 200 || score.b > 200)) throw new FeedError("Enter both scores.");
  const pairings = e.pairings.map((x) =>
    x.round === round ? { ...x, tables: x.tables.map((y, i) => (i === table ? { ...y, manual: score ?? undefined } : y)) } : x,
  );
  const saved = await events.save({ ...e, pairings });
  const name = (pid: string) => e.players.find((p) => p.id === pid)?.name ?? "Player";
  const faction = (pid: string) => e.players.find((p) => p.id === pid)?.faction ?? "";
  if (score)
    await saveEventResult({
      id: ladderId(e.id, round, table),
      date: e.date,
      battleplan: "",
      conclusion: "played",
      players: [
        { id: t.a, name: name(t.a), faction: faction(t.a), vp: score.a },
        { id: t.b, name: name(t.b), faction: faction(t.b), vp: score.b },
      ],
      confirmedAt: new Date().toISOString(),
    });
  else await forgetResult(ladderId(e.id, round, table));
  return view(saved);
}

/** Close the event: the winner is announced to everyone who played. */
export async function finishEvent(id: string): Promise<EventView> {
  const e = await load(id);
  mustManage(e);
  const v = await view({ ...e, finishedAt: new Date().toISOString() });
  await events.save({ ...e, finishedAt: v.finishedAt });
  const winner = v.standings[0];
  if (winner && e.pairings.length)
    waitUntil(notify(e.players.map((p) => p.id), `${e.name} is over: ${winner.name} wins with ${winner.points} points!`, `#/club/event/${e.id}`).catch(() => undefined));
  return v;
}
