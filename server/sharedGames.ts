// Games two players share. A game stays in its creator's space; the creator
// makes a join link, and each player with an account who opens it gets a
// pointer to the game in their own space. Both then see and edit the same
// game (scores, CP, fury, rounds), each from their own side, while the
// coach's plan and turn tips stay each player's own.

import crypto from "node:crypto";
import { applyOps, type Op } from "../shared/patch.ts";
import { flipGame } from "../shared/perspective.ts";
import { derive } from "../shared/scoring.ts";
import type { ArmyList, Game } from "../shared/types.ts";
import { currentUser } from "./context.ts";
import { notify } from "./notices.ts";
import { Collection } from "./store.ts";

interface GameLink {
  id: string; // the game's id
  ownerPrefix: string;
}
interface GameInvite {
  id: string; // the token
  gameId: string;
  ownerPrefix: string;
}

const gamesIn = (prefix: string) => new Collection<Game>("games", prefix);
const linksIn = (prefix: string) => new Collection<GameLink>("game-links", prefix);
const invites = new Collection<GameInvite>("game-invites", "");

/** A game as found for the signed-in player: where it lives and whose it is. */
export interface OpenGame {
  game: Game;
  /** Storage space of the game (its creator's). */
  prefix: string;
  role: "owner" | "player";
}

/** Fields the page can't change: identity and sharing are handled here. */
const FIXED = new Set(["id", "createdAt", "version", "share", "viewers", "listSpaces", "access"]);

export async function openGame(id: string): Promise<OpenGame | undefined> {
  const me = currentUser();
  const own = await gamesIn(me.prefix).get(id);
  if (own) return { game: own, prefix: me.prefix, role: "owner" };
  const link = await linksIn(me.prefix).get(id);
  if (!link) return undefined;
  const game = await gamesIn(link.ownerPrefix).get(id);
  if (!game?.share?.players.some((p) => p.id === me.id)) return undefined;
  return { game, prefix: link.ownerPrefix, role: "player" };
}

/** The game as the signed-in player sees it: their side is "me". */
export function viewGame({ game, role }: OpenGame): Game {
  const { share, viewers, listSpaces: _spaces, ...g } = game;
  const access = { role, ownerName: share?.ownerName ?? "", players: share?.players.map((p) => p.name) ?? [], ...(role === "owner" && share?.token ? { token: share.token } : {}) };
  if (role === "owner") return { ...g, access };
  const mine = viewers?.[currentUser().id];
  const flipped = flipGame(g);
  const view: Game = { ...flipped, state: { ...flipped.state }, access };
  delete view.plan;
  delete view.state.tips;
  if (mine?.plan) view.plan = mine.plan;
  if (mine?.tips) view.state.tips = mine.tips;
  return view;
}

/** Back from a joined player's view to the stored game (their plan and tips kept apart). */
function unviewGame(view: Game, stored: Game): Game {
  const { access: _a, plan, ...rest } = view;
  const { tips, ...state } = rest.state;
  const back = flipGame({ ...rest, state } as Game);
  const out: Game = { ...back, state: { ...back.state } };
  delete out.plan;
  delete out.state.tips;
  if (stored.plan) out.plan = stored.plan;
  if (stored.state.tips) out.state.tips = stored.state.tips;
  out.viewers = { ...stored.viewers, [currentUser().id]: { plan, tips } };
  return out;
}

const save = (o: OpenGame, game: Game) => gamesIn(o.prefix).save({ ...game, version: (o.game.version ?? 0) + 1 });

/** Apply a player's edits (made on their own view) to the latest stored game. */
export async function changeGame(o: OpenGame, ops: Op[]): Promise<OpenGame> {
  const allowed = ops.filter((op) => Array.isArray(op?.path) && !FIXED.has(String(op.path[0])));
  const changed = o.role === "owner" ? applyOps(o.game, allowed) : unviewGame(applyOps(viewGame(o), allowed), o.game);
  const game: Game = { ...changed, id: o.game.id, createdAt: o.game.createdAt, share: o.game.share, listSpaces: await listSpaces(o, changed) };
  if (!game.share) delete game.share;
  if (!game.listSpaces) delete game.listSpaces;
  game.state = derive(game);
  return { ...o, game: await save(o, game) };
}

/** A list a joined player picked lives in their space: remember where. */
async function listSpaces(o: OpenGame, next: Game): Promise<Game["listSpaces"]> {
  const spaces = { ...o.game.listSpaces };
  const me = currentUser().prefix;
  for (const id of [next.myListId, next.opponentListId]) {
    if (!id || spaces[id] !== undefined) continue;
    if (me !== o.prefix && !(await new Collection<ArmyList>("lists", o.prefix).get(id)) && (await new Collection<ArmyList>("lists", me).get(id))) spaces[id] = me;
  }
  return Object.keys(spaces).length ? spaces : undefined;
}

/** The game's two lists from the signed-in player's side: [mine, theirs]. */
export async function gameLists(o: OpenGame): Promise<[ArmyList | undefined, ArmyList | undefined]> {
  const get = (id: string) => (id ? new Collection<ArmyList>("lists", o.game.listSpaces?.[id] ?? o.prefix).get(id) : Promise.resolve(undefined));
  const v = viewGame(o);
  return Promise.all([get(v.myListId), get(v.opponentListId)]);
}

/** Every game the signed-in player has: their own and the ones they joined. */
export async function myGames(): Promise<Game[]> {
  const me = currentUser();
  const own = (await gamesIn(me.prefix).list()).map((game) => viewGame({ game, prefix: me.prefix, role: "owner" }));
  const joined = await Promise.all((await linksIn(me.prefix).list()).map((l) => openGame(l.id)));
  return [...own, ...joined.flatMap((o) => (o ? [viewGame(o)] : []))];
}

/** Make (or keep) the game's join link. Creator only. */
export async function shareGame(o: OpenGame): Promise<OpenGame> {
  if (o.game.share?.token) return o;
  const token = crypto.randomBytes(16).toString("hex");
  await invites.save({ id: token, gameId: o.game.id, ownerPrefix: o.prefix });
  const share = { ownerName: o.game.myName || currentUser().name, ownerId: currentUser().id, players: [], ...o.game.share, token };
  return { ...o, game: await save(o, { ...o.game, share }) };
}

/** Stop sharing: the link stops working and the joined players lose the game. */
export async function stopSharing(o: OpenGame): Promise<OpenGame> {
  if (!o.game.share) return o;
  await forgetShares(o);
  const { share: _s, viewers: _v, ...game } = o.game;
  return { ...o, game: await save(o, game) };
}

/** Join a shared game from its link. Returns the game's id. */
export async function joinGame(token: string): Promise<string> {
  const bad = new Error("This game link doesn't work any more. Ask your opponent for a new one.");
  const invite = /^[a-f0-9]{32}$/.test(token) ? await invites.get(token) : undefined;
  if (!invite) throw bad;
  const game = await gamesIn(invite.ownerPrefix).get(invite.gameId);
  if (!game?.share || game.share.token !== token) throw bad;
  const me = currentUser();
  if (me.prefix === invite.ownerPrefix) return game.id; // the creator opened their own link
  if (!game.share.players.some((p) => p.id === me.id)) {
    const first = !game.share.players.length;
    const share = { ...game.share, players: [...game.share.players, { id: me.id, name: me.name, prefix: me.prefix }] };
    // The first player to join is the opponent: use their name if none was typed.
    const opponentName = first && !game.opponentName && me.name ? me.name : game.opponentName;
    await save({ game, prefix: invite.ownerPrefix, role: "owner" }, { ...game, share, opponentName });
    if (game.share.ownerId) await notify([game.share.ownerId], `${me.name || "Your opponent"} joined your game${game.battleplan ? ` (${game.battleplan})` : ""}.`, `#/games/${game.id}`);
  }
  await linksIn(me.prefix).save({ id: game.id, ownerPrefix: invite.ownerPrefix });
  return game.id;
}

/** A joined player leaves: the game stays with its creator. */
export async function leaveGame(o: OpenGame) {
  const me = currentUser();
  await linksIn(me.prefix).delete(o.game.id);
  if (!o.game.share) return;
  const { [me.id]: _mine, ...viewers } = o.game.viewers ?? {};
  await save(o, { ...o.game, share: { ...o.game.share, players: o.game.share.players.filter((p) => p.id !== me.id) }, viewers });
}

/** The creator deletes the game: the joined players' pointers and the link go too. */
export async function forgetShares(o: OpenGame) {
  const share = o.game.share;
  if (share?.token) await invites.delete(share.token);
  for (const p of share?.players ?? []) await linksIn(p.prefix).delete(o.game.id);
}
