// Games two players share. A game stays in its creator's space; the creator
// makes a join link, and each player with an account who opens it gets a
// pointer to the game in their own space. Both then see and edit the same
// game (scores, CP, fury, rounds), each from their own side, while the
// coach's plan, turn tips and post-game review stay each player's own.

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

/**
 * A photo of this game, where the photo upload puts it. Anything else is
 * refused: the report and the coach read these paths, so a game edited to
 * point at other files (settings, someone's data) would leak them.
 */
export const isGamePhoto = (prefix: string, gameId: string, path: unknown): path is string =>
  typeof path === "string" && path.startsWith(`${prefix}game-photos/${gameId}/`) && /^\d+\.jpg$/.test(path.slice(`${prefix}game-photos/${gameId}/`.length));

/** Fields the page can't change: identity and sharing are handled here. */
const FIXED = new Set(["id", "createdAt", "version", "share", "viewers", "listSpaces", "access", "confirmations", "event", "confirmReminder"]);

/** The final result in the creator's terms; a confirmation counts only while the result is unchanged. */
export const resultKey = (g: Game) => `${g.state.vp.me}:${g.state.vp.opponent}:${g.finished?.conclusion ?? ""}`;

/** The two sides of a shared game for the ladder: its creator and the first player who joined. */
export function ladderSides(o: OpenGame): { ownerId?: string; playerId?: string } {
  return { ownerId: o.game.share?.ownerId ?? (o.role === "owner" ? currentUser().id : undefined), playerId: o.game.share?.players[0]?.id };
}
const confirmedBy = (g: Game, id?: string) => !!id && g.confirmations?.[id]?.result === resultKey(g);

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
  const { share, viewers, listSpaces: _spaces, confirmations: _c, ...g } = game;
  const { ownerId, playerId } = ladderSides({ game, role, prefix: "" });
  const sides = { owner: confirmedBy(game, ownerId), player: confirmedBy(game, playerId) };
  const confirmed = role === "owner" ? { me: sides.owner, opponent: sides.player } : { me: sides.player, opponent: sides.owner };
  const access = {
    role,
    ownerName: share?.ownerName ?? "",
    players: share?.players.map((p) => p.name) ?? [],
    ...(role === "owner" && share?.token ? { token: share.token } : {}),
    ...(share?.players.length ? { confirmed } : {}),
  };
  if (role === "owner") return { ...g, access };
  const mine = viewers?.[currentUser().id];
  const flipped = flipGame(g);
  const view: Game = { ...flipped, state: { ...flipped.state }, access };
  delete view.plan;
  delete view.review;
  delete view.state.tips;
  if (mine?.plan) view.plan = mine.plan;
  if (mine?.review) view.review = mine.review;
  if (mine?.tips) view.state.tips = mine.tips;
  return view;
}

/** Back from a joined player's view to the stored game (their plan and tips kept apart). */
function unviewGame(view: Game, stored: Game): Game {
  const { access: _a, plan, review, ...rest } = view;
  const { tips, ...state } = rest.state;
  const back = flipGame({ ...rest, state } as Game);
  const out: Game = { ...back, state: { ...back.state } };
  delete out.plan;
  delete out.review;
  delete out.state.tips;
  if (stored.plan) out.plan = stored.plan;
  if (stored.review) out.review = stored.review;
  if (stored.state.tips) out.state.tips = stored.state.tips;
  out.viewers = { ...stored.viewers, [currentUser().id]: { plan, tips, review } };
  return out;
}

const save = (o: OpenGame, game: Game) => gamesIn(o.prefix).save({ ...game, version: (o.game.version ?? 0) + 1 });

/** Apply a player's edits (made on their own view) to the latest stored game. */
export async function changeGame(o: OpenGame, ops: Op[]): Promise<OpenGame> {
  const allowed = ops.filter((op) => Array.isArray(op?.path) && !FIXED.has(String(op.path[0])));
  const changed = o.role === "owner" ? applyOps(o.game, allowed) : unviewGame(applyOps(viewGame(o), allowed), o.game);
  const game: Game = { ...changed, id: o.game.id, createdAt: o.game.createdAt, share: o.game.share, confirmations: o.game.confirmations, listSpaces: await listSpaces(o, changed) };
  if (!game.share) delete game.share;
  if (!game.confirmations) delete game.confirmations;
  if (!game.listSpaces) delete game.listSpaces;
  if (game.report) game.report = { ...game.report, photos: (game.report.photos ?? []).filter((p) => isGamePhoto(o.prefix, game.id, p)) };
  if (game.state.tablePhoto && !isGamePhoto(o.prefix, game.id, game.state.tablePhoto.path)) delete game.state.tablePhoto;
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

/** Confirm the final result for the club ladder (the game's creator or the opponent who joined). */
export async function confirmResult(o: OpenGame): Promise<OpenGame> {
  const me = currentUser().id;
  const { ownerId, playerId } = ladderSides(o);
  if (!o.game.finished) throw new Error("Finish the game first.");
  if (!playerId || !ownerId) throw new Error("Only games played together count on the ladder: share the game with your opponent first.");
  if (me !== ownerId && me !== playerId) throw new Error("Only the two players can confirm the result.");
  const confirmations = { ...o.game.confirmations, [me]: { result: resultKey(o.game), at: new Date().toISOString() } };
  return { ...o, game: await save(o, { ...o.game, confirmations }) };
}

/** Both players confirmed the result as it stands now. */
export const bothConfirmed = (o: OpenGame) => {
  const { ownerId, playerId } = ladderSides(o);
  return !!o.game.finished && confirmedBy(o.game, ownerId) && confirmedBy(o.game, playerId);
};

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

/**
 * A game the two players share from the start (an event's table, an accepted
 * challenge): it lives in `owner`'s space and `opponent` gets a pointer to it.
 */
export async function createSharedGame(owner: { id: string; name: string; prefix: string }, opponent: { id: string; name: string; prefix: string }, game: Game): Promise<Game> {
  const share = { ownerId: owner.id, ownerName: owner.name, players: [{ id: opponent.id, name: opponent.name, prefix: opponent.prefix }] };
  const saved = await gamesIn(owner.prefix).save({ ...game, myName: owner.name, opponentName: opponent.name, share, version: 1 });
  await linksIn(opponent.prefix).save({ id: game.id, ownerPrefix: owner.prefix });
  return saved;
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

/**
 * Finished shared games one player confirmed for the ladder a day ago and the
 * other hasn't: remind that one, once per result. `spaces` are the members'.
 */
export async function remindConfirmations(spaces: string[], now = Date.now()): Promise<number> {
  let n = 0;
  for (const prefix of spaces) {
    for (const game of await gamesIn(prefix).list()) {
      if (!game.finished || !game.share?.players.length || game.confirmReminder === resultKey(game)) continue;
      const o: OpenGame = { game, prefix, role: "owner" };
      const { ownerId, playerId } = ladderSides(o);
      const owner = confirmedBy(game, ownerId);
      const player = confirmedBy(game, playerId);
      if (owner === player) continue;
      const confirmedAt = Object.values(game.confirmations ?? {}).map((c) => c.at).sort().pop() ?? "";
      if (now - Date.parse(confirmedAt) < 86_400_000) continue;
      const waiting = owner ? playerId : ownerId;
      const who = owner ? game.myName || game.share.ownerName : game.opponentName || game.share.players[0]?.name;
      if (!waiting) continue;
      await notify(
        [waiting],
        (lang) =>
          lang === "es"
            ? `${who || "Tu rival"} ya confirmó el resultado de vuestra partida: confírmalo tú para que cuente en la liga.`
            : `${who || "Your opponent"} confirmed the result of your game: confirm it too so it counts on the ladder.`,
        `#/games/${game.id}/results`,
      );
      await gamesIn(prefix).save({ ...game, confirmReminder: resultKey(game) });
      n++;
    }
  }
  return n;
}

// ---------- linking games to a club member ----------
//
// Without a link: a member proposes games they recorded (one, or every game
// against a name they typed) to the club member who was their opponent; that
// member accepts in the app, and each game becomes shared like a joined one.
// Proposing confirms the result of a finished game for the sender, accepting
// for the other player, so linked past games count on the club ladder at once.

/** Games a member proposes to link to the recipient. Kept in the recipient's space, one per sender. */
export interface GameOffer {
  id: string; // the sender's id
  fromId: string;
  fromName: string;
  fromPrefix: string;
  gameIds: string[];
  createdAt: string;
}
const offersIn = (prefix: string) => new Collection<GameOffer>("game-offers", prefix);

/** A game no member is linked to yet. */
const linkable = (g: Game | undefined): g is Game => !!g && !g.share?.players.length;

const confirmNow = (g: Game, id: string): Game["confirmations"] =>
  g.finished ? { ...g.confirmations, [id]: { result: resultKey(g), at: new Date().toISOString() } } : g.confirmations;

/** Propose some of the signed-in player's games to the member who was their opponent. */
export async function offerGames(to: { id: string; name: string; prefix: string }, gameIds: string[]): Promise<{ offered: number }> {
  const me = currentUser();
  if (to.id === me.id) throw new Error("Pick your opponent, not yourself.");
  const mine = gamesIn(me.prefix);
  const games = (await Promise.all([...new Set(gameIds)].slice(0, 200).map((id) => mine.get(id)))).filter(linkable);
  if (!games.length) throw new Error("None of these games can be linked: they're not yours, or another player is already in them.");
  for (const g of games) {
    const confirmations = confirmNow(g, me.id);
    if (confirmations !== g.confirmations) await gamesIn(me.prefix).save({ ...g, confirmations, version: (g.version ?? 0) + 1 });
  }
  const offers = offersIn(to.prefix);
  const had = await offers.get(me.id);
  const ids = [...new Set([...(had?.gameIds ?? []), ...games.map((g) => g.id)])];
  await offers.save({ id: me.id, fromId: me.id, fromName: me.name, fromPrefix: me.prefix, gameIds: ids, createdAt: new Date().toISOString() });
  const who = me.name || null;
  const one = games.length === 1 ? games[0] : undefined;
  const against = one ? undefined : [...new Set(games.map((g) => g.opponentName?.trim()).filter(Boolean))];
  await notify(
    [to.id],
    (lang) =>
      lang === "es"
        ? one
          ? `${who ?? "Un miembro"} te propone asociar a tu cuenta su partida${one.battleplan ? ` (${one.battleplan})` : ""}. Acéptala en Partidas.`
          : `${who ?? "Un miembro"} te propone asociar a tu cuenta ${games.length} partidas${against?.length === 1 ? ` que registró contra "${against[0]}"` : ""}. Acéptalas en Partidas.`
        : one
          ? `${who ?? "A member"} wants to link their game${one.battleplan ? ` (${one.battleplan})` : ""} to your account. Accept it in Games.`
          : `${who ?? "A member"} wants to link ${games.length} games${against?.length === 1 ? ` they recorded against "${against[0]}"` : ""} to your account. Accept them in Games.`,
    "#/games",
  );
  return { offered: games.length };
}

/** The proposals waiting for the signed-in player, with each game as they would see it (their side is "me"). */
export async function myOffers() {
  const me = currentUser();
  const out = [];
  for (const offer of await offersIn(me.prefix).list()) {
    const games = (await Promise.all(offer.gameIds.map((id) => gamesIn(offer.fromPrefix).get(id)))).filter(linkable);
    if (!games.length) {
      await offersIn(me.prefix).delete(offer.id);
      continue;
    }
    out.push({
      id: offer.id,
      fromName: offer.fromName,
      createdAt: offer.createdAt,
      games: games
        .map((g) => {
          const v = flipGame(g);
          return { id: g.id, date: g.date ?? g.createdAt.slice(0, 10), battleplan: g.battleplan, recordedAs: g.opponentName ?? "", myFaction: v.myFaction ?? "", opponentFaction: v.opponentFaction ?? "", vp: v.state.vp, finished: !!g.finished };
        })
        .sort((a, b) => b.date.localeCompare(a.date)),
    });
  }
  return out;
}

/** Accept a proposal (all its games, or some): each becomes a game played together. Returns the linked games. */
export async function acceptOffer(offerId: string, only?: string[]): Promise<OpenGame[]> {
  const me = currentUser();
  const offer = await offersIn(me.prefix).get(offerId);
  if (!offer) throw new Error("That proposal isn't there any more.");
  const linked: OpenGame[] = [];
  for (const id of offer.gameIds) {
    if (only && !only.includes(id)) continue;
    const game = await gamesIn(offer.fromPrefix).get(id);
    if (!linkable(game)) continue;
    const share = { ownerName: game.myName || offer.fromName, ownerId: offer.fromId, ...game.share, players: [{ id: me.id, name: me.name, prefix: me.prefix }] };
    const o: OpenGame = { game, prefix: offer.fromPrefix, role: "owner" };
    const saved = await save(o, { ...game, share, opponentName: game.opponentName || me.name, confirmations: confirmNow(game, me.id) });
    await linksIn(me.prefix).save({ id, ownerPrefix: offer.fromPrefix });
    linked.push({ game: saved, prefix: offer.fromPrefix, role: "player" });
  }
  const rest = only ? offer.gameIds.filter((id) => !only.includes(id)) : [];
  if (rest.length) await offersIn(me.prefix).save({ ...offer, gameIds: rest });
  else await offersIn(me.prefix).delete(offer.id);
  if (linked.length)
    await notify(
      [offer.fromId],
      (lang) =>
        lang === "es"
          ? `${me.name || "Tu rival"} aceptó: ${linked.length === 1 ? "la partida quedó asociada" : `${linked.length} partidas quedaron asociadas`} a su cuenta.`
          : `${me.name || "Your opponent"} accepted: ${linked.length === 1 ? "the game is linked" : `${linked.length} games are linked`} to their account.`,
      linked.length === 1 ? `#/games/${linked[0].game.id}` : "#/games",
    );
  return linked;
}

/** Turn a proposal down. */
export async function declineOffer(offerId: string) {
  await offersIn(currentUser().prefix).delete(offerId);
}
