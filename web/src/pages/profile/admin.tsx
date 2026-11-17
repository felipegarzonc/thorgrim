// The admin's cards: the coach's cost, backups and restoring, clubs, players and access requests.

import { useState } from "react";
import { api, apiFile, setCurrentClub } from "../../api.ts";
import { Card, Icon, useLoad, useMeta, useRefreshOnReturn } from "../../ui.tsx";
import { shareText, shareUrl } from "../../links.ts";
import { type Player, type Invite, usd, UsageBar } from "./common.tsx";

export interface MonthUsage {
  month: string;
  requests: number;
  costUsd: number;
  players: { id: string; name: string; requests: number; costUsd: number }[];
}

/** The admin's view of what Thorgrim cost: each month's total, and who used it when a month is opened. */
export function UsageByMonth() {
  const [months] = useLoad<MonthUsage[]>("/admin/usage");
  if (!months) return null;
  const top = Math.max(0.01, ...months.map((m) => m.costUsd));
  return (
    <Card title="Thorgrim's cost by month">
      <p className="small muted">Everyone's coach requests, estimated from Claude's prices. Open a month to see who used it.</p>
      {months.map((m, i) => (
        <details key={m.month} className="usage-month" open={i === 0 && m.players.length > 0}>
          <summary>
            <span className="usage-month-name">{m.month}</span>
            <span className="usage-month-bar" aria-hidden="true">
              <span style={{ width: `${(m.costUsd / top) * 100}%` }} />
            </span>
            <b>{usd(m.costUsd)}</b>
          </summary>
          {m.players.length ? (
            <ul className="usage-players">
              {m.players.map((p) => (
                <li key={p.id}>
                  <span className="grow">{p.name}</span>
                  <span className="muted small">{`${p.requests} requests`}</span>
                  <b>{usd(p.costUsd)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Nobody used Thorgrim this month.</p>
          )}
        </details>
      ))}
    </Card>
  );
}

export interface RestorePlan {
  done: boolean;
  createdAt: string;
  records: number;
  missing: number;
  changed: number;
  same: number;
  newer: number;
  savedFirst?: string;
}
/** Vercel takes request bodies up to about 4 MB. */
export const MAX_RESTORE_UPLOAD = 4 * 1024 * 1024;

/** Put a backup's records back: pick a kept one or the emailed file, read what it would do, then type RESTORE. */
export function RestoreBackup() {
  const [open, setOpen] = useState(false);
  const [kept, reloadKept] = useLoad<string[]>(open ? "/admin/backups" : null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File>();
  const [plan, setPlan] = useState<RestorePlan>();
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pick = (next: { name?: string; file?: File }) => {
    setName(next.name ?? "");
    setFile(next.file);
    setPlan(undefined);
    setWord("");
    setError(undefined);
  };
  const run = async (confirm: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      if (file && file.size > MAX_RESTORE_UPLOAD) throw new Error("That file is too big to upload (over 4 MB). Pick one of the kept backups instead.");
      const query = `${confirm ? "confirm=RESTORE&" : ""}${file ? "" : `name=${encodeURIComponent(name)}`}`;
      const answer = await api<RestorePlan>(`/admin/restore?${query}`, file ? { method: "POST", body: file, headers: { "content-type": "application/gzip" } } : { method: "POST" });
      setPlan(answer);
      // A restore keeps how things were just before as one more backup: show it in the list.
      if (answer.done) reloadKept();
      setWord("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <button type="button" className="small ghost" onClick={() => setOpen(true)}>
        Restore from a backup…
      </button>
    );
  const when = plan?.createdAt ? new Date(plan.createdAt).toLocaleString() : "an unknown date";
  return (
    <div className="stack restore-backup">
      <b>Restore from a backup</b>
      <p className="small muted">For when records were lost or damaged. Records in the backup come back as they were; anything made since stays. Sign-ins and passwords aren't touched.</p>
      <label className="field">
        <span>A kept backup</span>
        <select value={name} onChange={(e) => pick({ name: e.target.value })} aria-label="A kept backup">
          <option value="">{kept ? (kept.length ? "Choose…" : "None kept yet") : "Loading…"}</option>
          {(kept ?? []).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Or the file from the backup email (.json.gz)</span>
        <input type="file" accept=".gz,application/gzip" aria-label="Backup file" onChange={(e) => pick({ file: e.target.files?.[0] })} />
      </label>
      {(name || file) && !plan?.done && (
        <button type="button" className="small" disabled={busy} onClick={() => run(false)}>
          {busy && !plan ? "Reading…" : "See what it would do"}
        </button>
      )}
      {plan && !plan.done && (
        <div className="stack restore-plan">
          <p className="small">{`Backup of ${when}: ${plan.records} records.`}</p>
          <p className="small">{`Restoring brings back ${plan.missing} missing now and puts ${plan.changed} changed since back to how they were. ${plan.same} are the same already; ${plan.newer} made since stay.`}</p>
          <p className="small muted">Today's records are saved as a backup first, so you can take a restore back.</p>
          {plan.missing + plan.changed === 0 ? (
            <p className="small">Nothing to restore: everything in this backup is already as it was.</p>
          ) : (
            <>
              <label className="field">
                <span>Type RESTORE to go ahead</span>
                <input value={word} onChange={(e) => setWord(e.target.value)} aria-label="Type RESTORE to go ahead" autoCapitalize="characters" />
              </label>
              <button type="button" className="small danger" disabled={busy || word.trim() !== "RESTORE"} onClick={() => run(true)}>
                {busy ? "Restoring…" : `Restore ${plan.missing + plan.changed} records`}
              </button>
            </>
          )}
        </div>
      )}
      {plan?.done && (
        <p className="small" role="status">
          {`Restored ${plan.missing + plan.changed} records from the backup of ${when}. How things were just before is kept as ${plan.savedFirst}.`}
        </p>
      )}
      {error && <p className="small error">{error}</p>}
    </div>
  );
}

/** The owner's copy of every record (server/backup.ts): weekly by email, or now. */
export function BackupCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const download = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { blob, name } = await apiFile("/admin/backup");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Backups">
      <p className="small muted">
        Every Monday Thorgrim saves a copy of all records (players, clubs, lists, games, reports; not photos or rule books) to a separate private bucket and emails it to you. It holds
        everyone's data: keep it private.
      </p>
      <button type="button" className="small" disabled={busy} onClick={download}>
        {busy ? "Preparing…" : "Download a backup now"}
      </button>
      {error && <p className="small error">{error}</p>}
      <RestoreBackup />
    </Card>
  );
}

export interface ClubRow {
  id: string;
  name: string;
  leaderId: string;
  members: { id: string; name: string }[];
}

/** The app's owner creates clubs and names their leader. */
export function ClubsAdmin() {
  const meta = useMeta();
  const [clubs] = useLoad<ClubRow[]>("/clubs");
  const [name, setName] = useState("");
  const [everyone, setEveryone] = useState(false);
  const [error, setError] = useState<string>();
  const create = async () => {
    setError(undefined);
    try {
      const c = await api<ClubRow>("/clubs", { method: "POST", json: { name, leaderId: meta?.user?.id, allMembers: everyone } });
      setName("");
      setCurrentClub(c.id);
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card title="Clubs">
      {clubs?.map((c) => (
        <div key={c.id} className="row">
          <span className="grow">
            <b translate="no">{c.name}</b>
            <small className="muted">{` · ${c.members.length} members · leader ${c.members.find((m) => m.id === c.leaderId)?.name ?? "—"}`}</small>
          </span>
          {meta?.club?.id === c.id ? (
            <span className="badge">Open</span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCurrentClub(c.id);
                window.location.reload();
              }}
            >
              Open
            </button>
          )}
        </div>
      ))}
      {clubs && !clubs.length && <p className="small muted">No clubs yet: everyone shares one club space until you create the first one (it keeps what's there).</p>}
      <label>
        New club
        <span className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Club name" maxLength={60} />
          <button type="button" disabled={!name.trim()} onClick={create}>
            Create
          </button>
        </span>
      </label>
      <label className="inline">
        <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Add everyone with an account
      </label>
      <p className="small muted">You lead new clubs; members are added from the club's Members tab.</p>
      {error && <p className="small error">{error}</p>}
    </Card>
  );
}

export function PlayersAdmin({ selfId }: { selfId: string }) {
  const [players, reloadPlayers] = useLoad<Player[]>("/admin/users");
  const [invites, reloadInvites] = useLoad<Invite[]>("/admin/invites");
  const [settings, reloadSettings] = useLoad<{ defaultLimitUsd: number }>("/admin/settings");
  useRefreshOnReturn(reloadPlayers, reloadInvites);
  const [note, setNote] = useState("");
  const [role, setRole] = useState<"player" | "admin">("player");
  const [link, setLink] = useState<{ url: string; note: string }>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [temp, setTemp] = useState<{ name: string; password: string }>();
  const [resetLink, setResetLink] = useState<{ name: string; email: string; link: string; emailed: boolean; copied?: boolean }>();
  const [defLimit, setDefLimit] = useState<string>();

  const run = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const invite = () =>
    run(async () => {
      const r = await api<{ token: string; invite: Invite }>("/admin/invites", { method: "POST", json: { note, role } });
      setLink({ url: shareUrl("join", r.token), note: r.invite.note });
      setCopied(false);
      setNote("");
      reloadInvites();
    });
  const share = async () => {
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ text: shareText("Join me on Thorgrim, the Age of Sigmar tracker & coach:", link.url) });
      else {
        await navigator.clipboard.writeText(link.url);
        setCopied(true);
      }
    } catch {
      /* cancelled */
    }
  };
  const patch = (id: string, body: Record<string, unknown>) =>
    run(async () => {
      await api(`/admin/users/${id}`, { method: "PATCH", json: body });
      reloadPlayers();
    });

  return (
    <>
      <Card title="Invite a player">
        <p className="muted small" style={{ marginTop: 0 }}>
          Create a link and send it (WhatsApp, email…). It works once and lasts 14 days. They choose their own email and password.
        </p>
        <div className="row">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who is it for? e.g. Medina" aria-label="Who the invite is for" />
          <select value={role} onChange={(e) => setRole(e.target.value as "player" | "admin")} aria-label="Role">
            <option value="player">Player</option>
            <option value="admin">Admin</option>
          </select>
          <button type="button" className="primary" onClick={invite}>
            <Icon name="plus" /> Create link
          </button>
        </div>
        {link && (
          <div className="invite-link">
            <span className="small muted">Invite{link.note ? ` for ${link.note}` : ""}: shown only now</span>
            <code>{link.url}</code>
            <button type="button" className="outline" onClick={share}>
              <Icon name="share" /> {copied ? "Copied" : "Share link"}
            </button>
          </div>
        )}
        {!!invites?.length && (
          <>
            <h3>Waiting to join</h3>
            <ul className="rows">
              {invites.map((i) => (
                <li key={i.id}>
                  <span className="grow">
                    {i.note || "Invite"} {i.role === "admin" && <span className="badge">Admin</span>}
                    <small className="muted">expires {i.expiresAt.slice(0, 10)}</small>
                  </span>
                  <button type="button" className="small" onClick={() => run(async () => (await api(`/admin/invites/${i.id}`, { method: "DELETE" }), reloadInvites()))}>
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="Players">
        <div className="row spread" style={{ marginTop: 0 }}>
          <span className="small muted">Default Thorgrim limit per player per month</span>
          <span className="row" style={{ margin: 0, flexWrap: "nowrap" }}>
            <span className="money">
              $<input type="number" min={0} step={1} value={defLimit ?? settings?.defaultLimitUsd ?? 5} onChange={(e) => setDefLimit(e.target.value)} aria-label="Default monthly limit in dollars" />
            </span>
            <button
              type="button"
              className="small"
              disabled={defLimit === undefined}
              onClick={() =>
                run(async () => {
                  await api("/admin/settings", { method: "PUT", json: { defaultLimitUsd: Number(defLimit) } });
                  setDefLimit(undefined);
                  reloadSettings();
                  reloadPlayers();
                })
              }
            >
              Save
            </button>
          </span>
        </div>
        {temp && (
          <p className="notice small">
            New password for <b>{temp.name}</b>: <code>{temp.password}</code> (shown only now; they can change it in their profile).
          </p>
        )}
        {resetLink && (
          <div className="notice small">
            <p>
              Reset link for <b>{resetLink.name}</b>
            </p>
            {resetLink.emailed ? (
              <p>
                Emailed to <b>{resetLink.email}</b>. You can also send it yourself:
              </p>
            ) : (
              <p>This Thorgrim can't send email: send it yourself (WhatsApp, email…):</p>
            )}
            <p translate="no">
              <code style={{ wordBreak: "break-all" }}>{resetLink.link}</code>
            </p>
            <p className="row">
              <button
                type="button"
                className="small"
                onClick={() => void navigator.clipboard?.writeText(resetLink.link).then(() => setResetLink({ ...resetLink, copied: true }))}
              >
                {resetLink.copied ? "Copied" : "Copy link"}
              </button>
              <span className="muted">It works once, for a day. Their current password keeps working until they use it.</span>
            </p>
          </div>
        )}
        {error && <p className="error small">{error}</p>}
        <ul className="players">
          {players?.map((p) => (
            <li key={p.id} className={p.disabled ? "off" : ""}>
              <div className="player-head">
                <span className="avatar">{(p.name || "?").slice(0, 1).toUpperCase()}</span>
                <span className="grow">
                  <b>{p.name}</b> {p.role === "admin" && <span className="badge">Admin</span>} {p.disabled && <span className="badge">Off</span>}
                  <small className="muted">{p.email}</small>
                </span>
              </div>
              <UsageBar spent={p.usage.costUsd} limit={p.limitUsd} />
              {p.role !== "admin" && (
                <div className="row player-limit">
                  <span className="small muted">Monthly limit</span>
                  <select
                    value={p.monthlyLimitUsd === undefined ? "default" : p.monthlyLimitUsd === null ? "none" : "custom"}
                    onChange={(e) => patch(p.id, { monthlyLimitUsd: e.target.value === "none" ? null : e.target.value === "default" ? "default" : (p.limitUsd ?? 5) })}
                    aria-label={`Monthly limit for ${p.name}`}
                  >
                    <option value="default">Default</option>
                    <option value="custom">Custom</option>
                    <option value="none">No limit</option>
                  </select>
                  {typeof p.monthlyLimitUsd === "number" && (
                    <span className="money">
                      $
                      <input type="number" min={0} step={1} defaultValue={p.monthlyLimitUsd} onBlur={(e) => patch(p.id, { monthlyLimitUsd: Number(e.target.value) })} aria-label={`Custom limit for ${p.name}`} />
                    </span>
                  )}
                </div>
              )}
              {p.id !== selfId && !p.owner && (
                <div className="row player-actions">
                  <button type="button" className="small" onClick={() => patch(p.id, { disabled: !p.disabled })}>
                    {p.disabled ? "Switch on" : "Switch off"}
                  </button>
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      run(async () => {
                        if (!confirm(`Give ${p.name} a new password? Their current one stops working.`)) return;
                        const r = await api<{ password: string }>(`/admin/users/${p.id}/password`, { method: "POST" });
                        setResetLink(undefined);
                        setTemp({ name: p.name, password: r.password });
                      })
                    }
                  >
                    New password
                  </button>
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      run(async () => {
                        const r = await api<{ link: string; emailed: boolean }>(`/admin/users/${p.id}/reset-link`, { method: "POST" });
                        setTemp(undefined);
                        setResetLink({ name: p.name, email: p.email, ...r });
                      })
                    }
                  >
                    Send reset link
                  </button>
                  <button type="button" className="small" onClick={() => patch(p.id, { role: p.role === "admin" ? "player" : "admin" })}>
                    {p.role === "admin" ? "Make player" : "Make admin"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export interface AccessRequest {
  id: string;
  name: string;
  email: string;
  club?: string;
  message?: string;
  createdAt: string;
  status: "pending" | "approved" | "declined";
  decidedAt?: string;
  emailed?: boolean;
}

/** Private beta: people who asked for access from the landing page. Approve sends them an invite by email. */
export function AccessRequests() {
  const [data, reload] = useLoad<{ requests: AccessRequest[]; mail: boolean }>("/admin/access-requests");
  useRefreshOnReturn(reload);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  // An approval whose email couldn't go out: the admin sends the link.
  const [toSend, setToSend] = useState<{ request: AccessRequest; link: string; email: { subject: string; text: string } }>();
  if (!data) return null;
  const pending = data.requests.filter((r) => r.status === "pending");
  const decided = data.requests.filter((r) => r.status !== "pending");
  const act = async (r: AccessRequest, what: "approve" | "decline") => {
    if (what === "decline" && !confirm(`Decline ${r.name}'s request?`)) return;
    setBusy(r.id);
    setError(undefined);
    try {
      const out = await api<{ request: AccessRequest; link: string; email: { subject: string; text: string } }>(`/admin/access-requests/${r.id}/${what}`, { method: "POST" });
      if (what === "approve" && !out.request.emailed) setToSend(out);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Card title={pending.length ? `Access requests (${pending.length})` : "Access requests"}>
      {!data.mail && (
        <p className="small muted">
          Invites aren't emailed automatically yet (email isn't set up), so after approving you send the link yourself: one tap opens your email with the message
          written.
        </p>
      )}
      {!pending.length && <p className="small muted">No requests waiting. People ask for access from the landing page.</p>}
      <ul className="access-list">
        {pending.map((r) => (
          <li key={r.id} className="access-item">
            <div className="grow">
              <b>{r.name}</b>
              <small className="muted">
                {r.email}
                {r.club ? ` · ${r.club}` : ""} · {new Date(r.createdAt).toLocaleDateString()}
              </small>
              {r.message && (
                <p className="access-msg" translate="no">
                  {r.message}
                </p>
              )}
            </div>
            <div className="row">
              <button type="button" className="primary small" disabled={busy === r.id} onClick={() => act(r, "approve")}>
                Approve
              </button>
              <button type="button" className="ghost small" disabled={busy === r.id} onClick={() => act(r, "decline")}>
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
      {toSend && (
        <div className="access-send">
          <p className="small">
            <b>{toSend.request.name}</b> is approved. Send them their invite:
          </p>
          <div className="row">
            <a
              className="button primary small"
              href={`mailto:${encodeURIComponent(toSend.request.email)}?subject=${encodeURIComponent(toSend.email.subject)}&body=${encodeURIComponent(toSend.email.text)}`}
            >
              Send by email
            </a>
            <button type="button" className="small" onClick={() => void navigator.clipboard?.writeText(toSend.link)}>
              Copy link
            </button>
            <button type="button" className="ghost small" onClick={() => setToSend(undefined)}>
              Done
            </button>
          </div>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
      {decided.length > 0 && (
        <details>
          <summary className="small muted">Answered in the last month ({decided.length})</summary>
          <ul className="access-list">
            {decided.map((r) => (
              <li key={r.id} className="access-item done">
                <span className="grow">
                  {r.name} <small className="muted">{r.email}</small>
                </span>
                <small className="muted">{r.status === "approved" ? (r.emailed ? "Approved · emailed" : "Approved") : "Declined"}</small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
