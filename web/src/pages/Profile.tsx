// Your profile (name, password, coach usage) and, for the admin, the players:
// invite links, monthly coach limits, switching accounts off, new passwords.

import { useEffect, useState } from "react";
import { accessKey, api, signOut } from "../api.ts";
import { Card, Icon, useLoad, useMeta } from "../ui.tsx";
import { Setup } from "./Auth.tsx";

interface Usage {
  month: string;
  requests: number;
  costUsd: number;
  limitUsd: number | null;
}
interface Me {
  user: { id: string; email: string; name: string; role: "admin" | "player"; owner: boolean };
  accounts: boolean;
  usage: Usage;
}
interface Player {
  id: string;
  email: string;
  name: string;
  role: "admin" | "player";
  owner: boolean;
  disabled: boolean;
  createdAt: string;
  monthlyLimitUsd?: number | null;
  limitUsd: number | null;
  usage: { requests: number; costUsd: number };
}
interface Invite {
  id: string;
  note: string;
  role: "admin" | "player";
  createdAt: string;
  expiresAt: string;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

function UsageBar({ spent, limit }: { spent: number; limit: number | null }) {
  const pct = limit ? Math.min(100, (spent / limit) * 100) : 0;
  return (
    <div className="usage">
      <div className="usage-line">
        <b>{usd(spent)}</b>
        <span className="muted">{limit === null ? "no limit" : `of ${usd(limit)} this month`}</span>
      </div>
      {limit !== null && (
        <div className="usage-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Coach allowance used">
          <span className={pct >= 90 ? "high" : ""} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** The push key as the browser wants it. */
function keyBytes(base64url: string) {
  const raw = atob((base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Turn phone notifications on or off for this phone. iPhones need the app on the Home Screen first. */
function PhoneNotifications() {
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const [on, setOn] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  useEffect(() => {
    if (!supported) return setOn(false);
    void navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.pushManager.getSubscription())
      .then((sub) => setOn(!!sub && Notification.permission === "granted"));
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site: allow them in the phone's settings.");
      const { key } = await api<{ key: string }>("/push/key");
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      await api("/push/subscribe", { method: "POST", json: { subscription: sub.toJSON() } });
      setOn(true);
      setMsg("On. You'll hear about comments, reports of your games and opponents joining.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (sub) {
        await api("/push/unsubscribe", { method: "POST", json: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setOn(false);
      setMsg("Off for this phone.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Phone notifications">
      {!supported ? (
        <p className="small muted">
          {ios && !installed
            ? "On iPhone, add Thorgrim to your Home Screen first (Share › Add to Home Screen), open it from there, and turn notifications on here."
            : "This browser can't show notifications."}
        </p>
      ) : (
        <>
          <p className="small muted">Comments on your posts, reports of your games and opponents joining your games, on this phone.</p>
          {on ? (
            <div className="two-buttons">
              <button type="button" className="outline" disabled={busy} onClick={() => api("/push/test", { method: "POST" }).then(() => setMsg("Test sent."))}>
                Send a test
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={turnOff}>
                Turn off
              </button>
            </div>
          ) : (
            <button type="button" className="primary wide" disabled={busy || on === undefined} onClick={turnOn}>
              <Icon name="bell" /> {busy ? "Turning on…" : "Turn on notifications"}
            </button>
          )}
        </>
      )}
      {msg && <p className="small muted">{msg}</p>}
    </Card>
  );
}

export function ProfilePage() {
  const meta = useMeta();
  const [me, reload] = useLoad<Me>("/me");
  const [setupStatus] = useLoad<{ accounts: boolean; setupNeeded: boolean }>("/auth/status");
  const [name, setName] = useState<string>();
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();
  if (!me) return <p className="muted">Loading…</p>;

  // Signed in with the app password and no admin account yet: offer to create it.
  if (setupStatus?.setupNeeded && accessKey()) return <Setup appPassword={accessKey()} />;

  const isAccount = me.accounts && !!me.user.email;
  const saveName = async () => {
    setError(undefined);
    try {
      await api("/me", { method: "PATCH", json: { name } });
      setName(undefined);
      setMsg("Name saved.");
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const savePw = async () => {
    setError(undefined);
    try {
      await api("/me/password", { method: "POST", json: { password: pw } });
      setPw("");
      setMsg("Password changed.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Profile</h1>
        <button type="button" className="small" onClick={signOut}>
          Sign out
        </button>
      </div>

      <section className="card profile-card">
        <span className="avatar big">{(me.user.name || "?").slice(0, 1).toUpperCase()}</span>
        <h2>{me.user.name || "You"}</h2>
        {me.user.email && <p className="muted small">{me.user.email}</p>}
        <span className="badge">{me.user.role === "admin" ? "Admin" : "Player"}</span>
        {meta?.user?.id && (
          <a className="small" href={`#/club/member/${meta.user.id}`}>
            Your club page and army showcase →
          </a>
        )}
      </section>

      <PhoneNotifications />
      <Card title="Coach usage">
        <UsageBar spent={me.usage.costUsd} limit={me.usage.limitUsd} />
        <p className="muted small">
          {me.usage.requests} coach requests in {me.usage.month}. Estimated from Claude's prices; the admin's Anthropic bill is the exact figure.
        </p>
      </Card>

      {isAccount && (
        <Card title="Account">
          <label>
            Name
            <span className="row" style={{ margin: 0 }}>
              <input value={name ?? me.user.name} onChange={(e) => setName(e.target.value)} />
              <button type="button" disabled={name === undefined || !name.trim()} onClick={saveName}>
                Save
              </button>
            </span>
          </label>
          <label>
            New password
            <span className="row" style={{ margin: 0 }}>
              <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" />
              <button type="button" disabled={pw.length < 8} onClick={savePw}>
                Change
              </button>
            </span>
          </label>
          {msg && <p className="small" style={{ color: "var(--good)" }}>{msg}</p>}
          {error && <p className="small error">{error}</p>}
        </Card>
      )}

      {meta?.user?.isAdmin && me.accounts && <PlayersAdmin selfId={me.user.id} />}
    </div>
  );
}

function PlayersAdmin({ selfId }: { selfId: string }) {
  const [players, reloadPlayers] = useLoad<Player[]>("/admin/users");
  const [invites, reloadInvites] = useLoad<Invite[]>("/admin/invites");
  const [settings, reloadSettings] = useLoad<{ defaultLimitUsd: number }>("/admin/settings");
  const [note, setNote] = useState("");
  const [role, setRole] = useState<"player" | "admin">("player");
  const [link, setLink] = useState<{ url: string; note: string }>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [temp, setTemp] = useState<{ name: string; password: string }>();
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
      setLink({ url: `${window.location.origin}/#/join/${r.token}`, note: r.invite.note });
      setCopied(false);
      setNote("");
      reloadInvites();
    });
  const share = async () => {
    if (!link) return;
    const text = `Join me on Thorgrim, the Age of Sigmar coach: ${link.url}`;
    try {
      if (navigator.share) await navigator.share({ title: "Thorgrim invite", text, url: link.url });
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
          <span className="small muted">Default coach limit per player per month</span>
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
                        setTemp({ name: p.name, password: r.password });
                      })
                    }
                  >
                    New password
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
