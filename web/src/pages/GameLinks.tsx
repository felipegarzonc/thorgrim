// Linking games to club members without a link (server/sharedGames.ts): a
// player proposes games they recorded to the member who was their opponent,
// one game or every game against a name they typed; that member accepts here.

import { useEffect, useState } from "react";
import type { Game } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { feedback } from "../sound.ts";
import { Icon, useLoad, useMeta } from "../ui.tsx";

interface Offer {
  id: string;
  fromName: string;
  createdAt: string;
  games: { id: string; date: string; battleplan: string; recordedAs: string; vp: { me: number; opponent: number }; finished: boolean }[];
}
interface ClubMember {
  id: string;
  name: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Club members but the signed-in player, to pick an opponent from. */
function useOpponents(): ClubMember[] | undefined {
  const meta = useMeta();
  const [members] = useLoad<ClubMember[]>("/club/members");
  return members?.filter((m) => m.id !== meta?.user?.id);
}

/** A typed name's best match among the members: the same name, or one starting with it. */
const guess = (name: string, members: ClubMember[]) =>
  members.find((m) => norm(m.name) === norm(name)) ?? members.find((m) => norm(m.name).startsWith(norm(name)) || norm(name).startsWith(norm(m.name)));

/** Proposals from other members to link their games to you. */
export function OfferInbox({ onAccepted }: { onAccepted: () => void }) {
  const [offers, reload] = useLoad<Offer[]>("/games/offers");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  if (!offers?.length) return null;
  const act = async (offer: Offer, accept: boolean) => {
    setBusy(offer.id);
    setError(undefined);
    try {
      if (accept) {
        await api(`/games/offers/${offer.id}/accept`, { method: "POST", json: {} });
        feedback("achievement");
        onAccepted();
      } else await api(`/games/offers/${offer.id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <>
      {offers.map((o) => (
        <section key={o.id} className="card link-offer" aria-label="Games to link">
          <p className="link-offer-head">
            <Icon name="share" />
            <span>{o.games.length === 1 ? `${o.fromName} wants to link a game to your account` : `${o.fromName} wants to link ${o.games.length} games to your account`}</span>
          </p>
          <ul className="link-offer-games">
            {o.games.slice(0, 8).map((g) => (
              <li key={g.id}>
                <span className="muted">{g.date}</span>
                <span className="grow">{g.battleplan || "Game"}</span>
                <b>{`${g.vp.me}–${g.vp.opponent}`}</b>
              </li>
            ))}
            {o.games.length > 8 && <li className="muted">{`and ${o.games.length - 8} more`}</li>}
          </ul>
          {o.games[0]?.recordedAs && <p className="small muted">{`Recorded against "${o.games[0].recordedAs}". Your score is shown first.`}</p>}
          {o.games.some((g) => g.finished) && <p className="small muted">Accepting confirms their results for the club ladder.</p>}
          <div className="row-actions">
            <button type="button" className="primary" disabled={busy === o.id} onClick={() => act(o, true)}>
              <Icon name="check" /> {busy === o.id ? "Linking…" : "Accept"}
            </button>
            <button type="button" className="ghost" disabled={busy === o.id} onClick={() => act(o, false)}>
              Decline
            </button>
          </div>
        </section>
      ))}
      {error && <p className="error small">{error}</p>}
    </>
  );
}

/** The player's games no member is in yet, by the opponent's name as typed. */
export function linkableGroups(games: Game[]): { name: string; ids: string[] }[] {
  const by = new Map<string, { name: string; ids: string[] }>();
  for (const g of games) {
    const name = g.opponentName?.trim();
    if (!name || g.access?.role === "player" || g.access?.players.length || g.event) continue;
    const k = norm(name);
    const group = by.get(k) ?? { name, ids: [] };
    group.ids.push(g.id);
    by.set(k, group);
  }
  return [...by.values()].sort((a, b) => b.ids.length - a.ids.length);
}

/** Link past games: each opponent name, the member it was, and a proposal to them. */
export function LinkPastGames({ games, onClose }: { games: Game[]; onClose: () => void }) {
  const opponents = useOpponents();
  const groups = linkableGroups(games);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  // Each name starts on the member it most likely is.
  useEffect(() => {
    if (opponents) setPicked((cur) => Object.fromEntries(groups.map((g) => [g.name, cur[g.name] ?? guess(g.name, opponents)?.id ?? ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opponents]);
  const propose = async (group: { name: string; ids: string[] }) => {
    const memberId = picked[group.name];
    if (!memberId) return;
    setBusy(group.name);
    setError(undefined);
    try {
      await api("/games/offers", { method: "POST", json: { memberId, gameIds: group.ids } });
      feedback("tap");
      setSent((s) => ({ ...s, [group.name]: opponents?.find((m) => m.id === memberId)?.name ?? "" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <section className="card link-past" aria-label="Link games to club members">
      <div className="link-past-head">
        <b className="grow">Link games to club members</b>
        <button type="button" className="icon" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <p className="small muted">Games you recorded against a name. Pick the club member it was: they get a proposal, and once they accept, the games are in their Games too and their results count on the club ladder.</p>
      {!groups.length && <p className="muted">Every game you recorded is already linked.</p>}
      {opponents && !opponents.length && <p className="muted">Nobody else is in the club yet.</p>}
      {groups.map((g) => (
        <div key={g.name} className="link-row">
          <span className="link-name">
            <b translate="no">{g.name}</b>
            <small className="muted">{g.ids.length === 1 ? "1 game" : `${g.ids.length} games`}</small>
          </span>
          {sent[g.name] !== undefined ? (
            <span className="small ok-text">
              <Icon name="check" /> {`Proposed to ${sent[g.name]}`}
            </span>
          ) : (
            <>
              <select aria-label={`Club member for ${g.name}`} value={picked[g.name] ?? ""} onChange={(e) => setPicked((p) => ({ ...p, [g.name]: e.target.value }))}>
                <option value="">Who was it?</option>
                {opponents?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button type="button" className="small" disabled={!picked[g.name] || busy === g.name} onClick={() => propose(g)}>
                {busy === g.name ? "Sending…" : "Propose"}
              </button>
            </>
          )}
        </div>
      ))}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

/** In a game: invite the opponent from the club, no link needed. */
export function InviteMember({ game }: { game: Game }) {
  const opponents = useOpponents();
  const [memberId, setMemberId] = useState("");
  const [sent, setSent] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (opponents && !memberId && game.opponentName) setMemberId(guess(game.opponentName, opponents)?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opponents]);
  if (!opponents?.length) return null;
  const invite = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api("/games/offers", { method: "POST", json: { memberId, gameIds: [game.id] } });
      feedback("tap");
      setSent(opponents.find((m) => m.id === memberId)?.name ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="invite-member">
      <p className="small">Or pick your opponent from the club: they get the invitation in the app.</p>
      {sent !== undefined ? (
        <p className="small ok-text">
          <Icon name="check" /> {`Invitation sent to ${sent}. The game is shared once they accept it.`}
        </p>
      ) : (
        <div className="link-row">
          <select aria-label="Opponent from the club" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Who are you playing?</option>
            {opponents.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button type="button" className="small" disabled={!memberId || busy} onClick={invite}>
            {busy ? "Sending…" : "Invite"}
          </button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
