// The club's members (a Club tab) and a member's page (#/club/member/<id>):
// their club record, how you've done against them, and their reports.

import { useState } from "react";
import { headToHead, standings, type ClubResult } from "../../../shared/ladder.ts";
import type { FeedPostView } from "../../../shared/types.ts";
import { api, withKey } from "../api.ts";
import { moment } from "../analytics.tsx";
import { shrinkPhoto } from "../media.tsx";
import { Avatar, FactionPicker, Icon, Sheet, useLoad, useMeta, useRefreshOnReturn } from "../ui.tsx";
import { Carousel } from "./Club.tsx";
import { Skeleton } from "../motion.tsx";

export interface ClubMember {
  id: string;
  name: string;
}

export interface Challenge {
  id: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  message?: string;
  date?: string;
  points: number;
  status: "open" | "accepted" | "declined" | "cancelled";
  gameId?: string;
  createdAt: string;
}

/** Challenges sent and received: accept (opens the game), decline or withdraw. */
export function Challenges({ compact }: { compact?: boolean }) {
  const meta = useMeta();
  const [list, reload] = useLoad<Challenge[]>("/challenges");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const shown = (list ?? []).filter((c) => c.status === "open" && (!compact || c.to.id === meta?.user?.id));
  if (!shown.length) return null;
  const act = async (c: Challenge, fn: () => Promise<unknown>) => {
    setBusy(c.id);
    setError(undefined);
    try {
      await fn();
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <section className="challenges">
      {!compact && <h2 className="section-title">Challenges</h2>}
      {shown.map((c) => {
        const received = c.to.id === meta?.user?.id;
        return (
          <div key={c.id} className={`card challenge ${received ? "received" : ""}`}>
            <Icon name="swords" />
            <div className="grow">
              <b>{received ? `${c.from.name} challenges you` : `You challenged ${c.to.name}`}</b>
              <small className="muted">
                {c.points} pts{c.date ? ` · ${new Date(`${c.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}` : ""}
                {c.message ? ` · “${c.message}”` : ""}
              </small>
              <div className="row">
                {received ? (
                  <>
                    <button
                      type="button"
                      className="primary small"
                      disabled={busy === c.id}
                      onClick={() =>
                        act(c, async () => {
                          const { id } = await api<{ id: string }>(`/challenges/${c.id}/accept`, { method: "POST" });
                          window.location.hash = `#/games/${id}/players`;
                        })
                      }
                    >
                      Accept
                    </button>
                    <button type="button" className="ghost small" disabled={busy === c.id} onClick={() => act(c, () => api(`/challenges/${c.id}/decline`, { method: "POST" }))}>
                      Not this time
                    </button>
                  </>
                ) : (
                  <button type="button" className="ghost small" disabled={busy === c.id} onClick={() => act(c, () => api(`/challenges/${c.id}`, { method: "DELETE" }))}>
                    Withdraw
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

function ChallengeSheet({ member, onClose }: { member: ClubMember; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [date, setDate] = useState("");
  const [points, setPoints] = useState("2000");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const send = async () => {
    setError(undefined);
    try {
      await api("/challenges", { method: "POST", json: { to: member.id, message, date, points: Number(points) } });
      moment("Challenge sent");
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Sheet title={`Challenge ${member.name}`} onClose={onClose}>
      {sent ? (
        <div className="stack">
          <p>Challenge sent! {member.name} gets a notification; when they accept, the game appears in your Games, ready to set up.</p>
          <button type="button" className="primary wide" onClick={onClose}>
            OK
          </button>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="field">
            <span className="field-label">Message</span>
            <span className="field-box">
              <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} placeholder="e.g. Rematch? My Gutbusters want revenge." />
            </span>
          </label>
          <div className="two-fields">
            <label className="field">
              <span className="field-label">When (optional)</span>
              <span className="field-box">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </span>
            </label>
            <label className="field">
              <span className="field-label">Points</span>
              <span className="field-box">
                <input type="number" inputMode="numeric" min={500} step={500} value={points} onChange={(e) => setPoints(e.target.value)} />
              </span>
            </label>
          </div>
          {error && <p className="error small">{error}</p>}
          <button type="submit" className="primary wide">
            <Icon name="swords" /> Send the challenge
          </button>
        </form>
      )}
    </Sheet>
  );
}

export function MembersList() {
  const meta = useMeta();
  const [members, reloadMembers] = useLoad<ClubMember[]>("/club/members");
  const [ladder, reloadLadder] = useLoad<{ me: string; results: ClubResult[] }>("/club/ladder");
  // Admins also see who is invited and hasn't joined yet.
  const [invites, reloadInvites] = useLoad<{ id: string; note: string; expiresAt: string }[]>(meta?.user?.isAdmin ? "/admin/invites" : null);
  useRefreshOnReturn(reloadMembers, reloadLadder, reloadInvites);
  if (!members) return <Skeleton />;
  const table = ladder ? standings(ladder.results) : [];
  const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="stack">
    <Challenges />
    <div className="card rivals members">
      {sorted.map((m) => {
        const s = table.find((x) => x.id === m.id);
        return (
          <a key={m.id} className="rival rival-link" href={`#/club/member/${m.id}`}>
            <Avatar faction={s?.faction} size={1.8} />
            <span className="grow">
              <b>{m.name}</b>
              <small className="muted">{s ? `${s.faction || "—"} · ${s.won}-${s.drawn}-${s.lost} on the ladder` : "No ladder games yet"}</small>
            </span>
            <Icon name="right" />
          </a>
        );
      })}
    </div>
    {invites && invites.length > 0 && (
      <section>
        <h2 className="section-title">Invited, not joined yet ({invites.length})</h2>
        <div className="card rivals">
          {invites.map((i) => (
            <div key={i.id} className="rival">
              <span className="grow">
                {i.note || "Invite"}
                <small className="muted">Invite valid until {new Date(i.expiresAt).toLocaleDateString()}</small>
              </span>
            </div>
          ))}
        </div>
        <p className="small muted">They become members when they open their invite and create their account. Manage invites in your Profile.</p>
      </section>
    )}
    </div>
  );
}

export function MemberPage({ id }: { id: string }) {
  const meta = useMeta();
  const [members, reloadMembers] = useLoad<ClubMember[]>("/club/members");
  const [ladder, reloadLadder] = useLoad<{ me: string; results: ClubResult[] }>("/club/ladder");
  const [posts, reloadPosts] = useLoad<FeedPostView[]>("/feed");
  useRefreshOnReturn(reloadMembers, reloadLadder, reloadPosts);
  const [challenging, setChallenging] = useState(false);
  const [showcase] = useLoad<ShowcaseArmy[]>(`/club/members/${id}/showcase`);
  if (!members || !ladder) return <Skeleton />;
  const member = members.find((m) => m.id === id);
  if (!member) return <p className="muted">That member isn't in the club any more.</p>;
  const isMe = id === meta?.user?.id;
  const table = standings(ladder.results);
  const rank = table.findIndex((s) => s.id === id);
  const s = table[rank];
  const vsMe = isMe ? undefined : headToHead(ladder.results, ladder.me).find((h) => h.id === id);
  const theirPosts = (posts ?? []).filter((p) => p.sides[0] && p.authorId === id).slice(0, 5);

  return (
    <div className="stack member-page">
      <a className="small" href="#/club/members">
        ← Members
      </a>
      <section className="card member-head">
        <Avatar faction={s?.faction || showcase?.[0]?.faction} size={3.2} />
        <div className="grow">
          <h1>{member.name}</h1>
          <p className="muted small">{s ? `${s.faction || "No army yet"} · #${rank + 1} on the ladder` : "No ladder games yet"}</p>
        </div>
        {!isMe && (
          <button type="button" className="primary small" onClick={() => setChallenging(true)}>
            <Icon name="swords" /> Challenge
          </button>
        )}
      </section>
      {challenging && <ChallengeSheet member={member} onClose={() => setChallenging(false)} />}

      {s && (
        <div className="stat-grid">
          <div className="stat-tile">
            <b>{s.played}</b>
            <span>ladder games</span>
          </div>
          <div className="stat-tile">
            <b>
              {s.won}-{s.drawn}-{s.lost}
            </b>
            <span>wins · draws · losses</span>
          </div>
          <div className="stat-tile">
            <b>{s.points}</b>
            <span>ladder points</span>
          </div>
          <div className="stat-tile">
            <b>
              {s.vpFor - s.vpAgainst >= 0 ? "+" : ""}
              {s.vpFor - s.vpAgainst}
            </b>
            <span>VP difference</span>
          </div>
        </div>
      )}

      {vsMe && (
        <div className="rivalry-line">
          <Icon name="swords" />
          <span className="grow">
            You vs {member.name}: <b>{vsMe.won}</b> won · <b>{vsMe.drawn}</b> drawn · <b>{vsMe.lost}</b> lost
          </span>
        </div>
      )}

      <Showcase memberId={id} name={member.name} isMe={isMe} />

      {theirPosts.length > 0 && (
        <section>
          <h2 className="section-title">Battle reports</h2>
          <div className="card rivals">
            {theirPosts.map((p) => (
              <a key={p.id} className="rival rival-link" href={`#/club/${p.id}`}>
                <Avatar faction={p.sides[0]?.faction} size={1.6} />
                <span className="grow">
                  {p.title}
                  <small className="muted">
                    {p.sides.map((x) => `${x.name} ${x.vp}`).join(" – ")}
                    {p.date ? ` · ${p.date}` : ""}
                  </small>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

interface ShowcaseArmy {
  id: string;
  faction: string;
  name: string;
  note?: string;
  photos: string[];
}

/** A member's armies with photos of their painted models. On your own page you add, edit and remove them. */
function Showcase({ memberId, name, isMe }: { memberId: string; name: string; isMe: boolean }) {
  const [loaded] = useLoad<ShowcaseArmy[]>(`/club/members/${memberId}/showcase`);
  const [armies, setArmies] = useState<ShowcaseArmy[]>();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const list = armies ?? loaded;
  if (!list) return null;
  if (!list.length && !isMe) return null;

  const act = async (key: string, fn: () => Promise<ShowcaseArmy[]>) => {
    setBusy(key);
    setError(undefined);
    try {
      setArmies(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const addArmy = (faction: string) => {
    const armyName = prompt("A name for this army (optional):", "") ?? "";
    void act("new", () => api<ShowcaseArmy[]>("/showcase/armies", { method: "POST", json: { faction, name: armyName } }));
  };
  const addPhotos = (a: ShowcaseArmy, files: FileList | null) =>
    act(a.id, async () => {
      let out = list;
      for (const f of [...(files ?? [])].slice(0, 12 - a.photos.length)) {
        const body = await shrinkPhoto(f);
        out = await api<ShowcaseArmy[]>(`/showcase/armies/${a.id}/photos`, { method: "POST", body, headers: { "content-type": "image/jpeg" } });
        setArmies(out);
      }
      return out;
    });
  const photoUrl = (a: ShowcaseArmy, p: string) => withKey(`/api/showcase/${memberId}/${a.id}/${p}`);

  return (
    <section className="showcase">
      <h2 className="section-title">{isMe ? "Your armies" : `${name}'s armies`}</h2>
      {!list.length && <p className="muted small">Show the club your painted armies: add an army, then photos of your models.</p>}
      {list.map((a) => (
        <article key={a.id} className="card showcase-army">
          <header className="showcase-head">
            <Avatar faction={a.faction} size={2} />
            <span className="grow">
              <b>{a.name}</b>
              {a.name !== a.faction && <small className="muted">{a.faction}</small>}
            </span>
            {isMe && (
              <button
                type="button"
                className="icon small-icon"
                aria-label={`Remove ${a.name}`}
                disabled={!!busy}
                onClick={() => confirm(`Remove ${a.name} and its photos?`) && act(a.id, () => api<ShowcaseArmy[]>(`/showcase/armies/${a.id}`, { method: "DELETE" }))}
              >
                <Icon name="trash" />
              </button>
            )}
          </header>
          {a.photos.length > 0 && (
            <Carousel
              slides={a.photos.map((p) => (
                <a key={p} href={photoUrl(a, p)} target="_blank" rel="noreferrer" className="showcase-photo">
                  <img src={photoUrl(a, p)} alt={`${a.name}, photo`} loading="lazy" />
                  {isMe && (
                    <button
                      type="button"
                      className="photo-remove"
                      aria-label="Remove this photo"
                      onClick={(e) => {
                        e.preventDefault();
                        if (confirm("Remove this photo?")) void act(a.id, () => api<ShowcaseArmy[]>(`/showcase/armies/${a.id}/photos/${p}`, { method: "DELETE" }));
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  )}
                </a>
              ))}
            />
          )}
          {a.note && <p className="small">{a.note}</p>}
          {isMe && (
            <div className="row">
              <label className={`button small ${busy === a.id ? "disabled" : ""}`}>
                <Icon name="camera" /> {busy === a.id ? "Uploading…" : "Add photos"}
                <input type="file" accept="image/*" multiple hidden disabled={busy === a.id || a.photos.length >= 12} onChange={(e) => void addPhotos(a, e.target.files)} />
              </label>
              <button
                type="button"
                className="ghost small"
                onClick={() => {
                  const note = prompt("A few words about this army (paint scheme, lore, favourite unit):", a.note ?? "");
                  if (note !== null) void act(a.id, () => api<ShowcaseArmy[]>(`/showcase/armies/${a.id}`, { method: "PATCH", json: { faction: a.faction, name: a.name, note } }));
                }}
              >
                <Icon name="pencil" /> {a.note ? "Edit note" : "Add a note"}
              </button>
            </div>
          )}
        </article>
      ))}
      {isMe && list.length < 8 && (
        <button type="button" className="outline wide" disabled={busy === "new"} onClick={() => setPicking(true)}>
          <Icon name="plus" /> Add an army
        </button>
      )}
      {error && <p className="error small">{error}</p>}
      {picking && (
        <FactionPicker
          onPick={(f) => {
            setPicking(false);
            addArmy(f);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  );
}
