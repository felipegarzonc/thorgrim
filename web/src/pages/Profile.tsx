// Your profile (name, password, coach usage) and, for the admin, the players:
// invite links, monthly coach limits, switching accounts off, new passwords.

import { useState } from "react";
import { accessKey, api, signOut } from "../api.ts";
import { Card, Seg, useLoad, useMeta } from "../ui.tsx";
import { langSetting, setLangSetting } from "../i18n.ts";
import { Setup } from "./Auth.tsx";
import { Skeleton } from "../motion.tsx";
import { type Me, type Player, UsageBar } from "./profile/common.tsx";
import { PhoneNotifications, SoundSettings } from "./profile/device.tsx";
import { UsageByMonth, BackupCard, ClubsAdmin, PlayersAdmin, AccessRequests } from "./profile/admin.tsx";

export function ProfilePage() {
  const meta = useMeta();
  const [me, reload] = useLoad<Me>("/me");
  const [setupStatus] = useLoad<{ accounts: boolean; setupNeeded: boolean }>("/auth/status");
  const [name, setName] = useState<string>();
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();
  if (!me) return <Skeleton />;

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
          <a className="small tap-link" href={`#/club/member/${meta.user.id}`}>
            Your club page and army showcase →
          </a>
        )}
      </section>

      <Card title="Language">
        <Seg
          label="Language"
          value={langSetting()}
          options={[
            ["auto", "Automatic"],
            ["en", "English"],
            ["es", "Español"],
          ]}
          onChange={setLangSetting}
        />
      </Card>
      <SoundSettings />
      <PhoneNotifications />
      <Card title="Thorgrim usage">
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

      {meta?.canCreateClubs && me.accounts && <ClubsAdmin />}
      {meta?.canCreateClubs && me.accounts && <BackupCard />}
      {meta?.user?.isAdmin && me.accounts && <UsageByMonth />}
      {meta?.user?.isAdmin && me.accounts && <AccessRequests />}
      {meta?.user?.isAdmin && me.accounts && <PlayersAdmin selfId={me.user.id} />}
    </div>
  );
}
