// The club's members (a Club tab) and a member's page (#/club/member/<id>):
// their club record, how you've done against them, and their reports.

import { headToHead, standings, type ClubResult } from "../../../shared/ladder.ts";
import type { FeedPostView } from "../../../shared/types.ts";
import { Avatar, Icon, useLoad, useMeta } from "../ui.tsx";

export interface ClubMember {
  id: string;
  name: string;
}

export function MembersList() {
  const [members] = useLoad<ClubMember[]>("/club/members");
  const [ladder] = useLoad<{ me: string; results: ClubResult[] }>("/club/ladder");
  if (!members) return <p className="muted">Loading…</p>;
  const table = ladder ? standings(ladder.results) : [];
  const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
  return (
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
  );
}

export function MemberPage({ id }: { id: string }) {
  const meta = useMeta();
  const [members] = useLoad<ClubMember[]>("/club/members");
  const [ladder] = useLoad<{ me: string; results: ClubResult[] }>("/club/ladder");
  const [posts] = useLoad<FeedPostView[]>("/feed");
  if (!members || !ladder) return <p className="muted">Loading…</p>;
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
        <Avatar faction={s?.faction} size={3.2} />
        <div className="grow">
          <h1>{member.name}</h1>
          <p className="muted small">{s ? `${s.faction || "No army yet"} · #${rank + 1} on the ladder` : "No ladder games yet"}</p>
        </div>
      </section>

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
