// Signing in: email + password (accounts), the first admin account, joining
// with an invite link, and the old app password as the owner's master key.

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { publicApi, setAccessKey, setSession, type Session } from "../api.ts";
import { moment } from "../analytics.tsx";

interface Status {
  accounts: boolean;
  setupNeeded: boolean;
  password: boolean;
}
type SignedIn = { session: Session };

const done = (r: SignedIn) => {
  setSession(r.session);
  setAccessKey("");
  // A shared game's link opened before signing in still joins the game after.
  if (!window.location.hash.startsWith("#/play/")) window.location.hash = "#/home";
  window.location.reload();
};

export function Shell({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <main className="login">
      <div className="card">
        <span className="brand wordmark">THORGRIM</span>
        <span className="brand-sub">Age of Sigmar tracker &amp; coach</span>
        <h1>{title}</h1>
        {sub && <p className="muted small">{sub}</p>}
        {children}
      </div>
      <a className="small login-about" href="#/welcome">
        What is Thorgrim?
      </a>
    </main>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

export function Login() {
  const [status, setStatus] = useState<Status>();
  const [master, setMaster] = useState(false);
  useEffect(() => {
    publicApi<Status>("/auth/status")
      .then(setStatus)
      .catch(() => setStatus({ accounts: false, setupNeeded: false, password: true }));
  }, []);
  if (!status) return <Shell title="Sign in">{null}</Shell>;
  if (!status.accounts || master) return <MasterLogin back={status.accounts ? () => setMaster(false) : undefined} />;
  if (status.setupNeeded) return <Setup />;
  return <AccountLogin onMaster={status.password ? () => setMaster(true) : undefined} />;
}

function AccountLogin({ onMaster }: { onMaster?: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useSubmit();
  return (
    <Shell title="Sign in" sub="With the email and password of your Thorgrim account.">
      <form onSubmit={submit(async () => done(await publicApi<SignedIn>("/auth/login", { email, password })))}>
        <label>
          Email
          <input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error small">{error}</p>}
        <button type="submit" className="primary wide" disabled={!email || !password || busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="muted small">New here? Ask the admin for an invite link. Forgot your password? The admin can give you a new one.</p>
      {onMaster && (
        <button type="button" className="small ghost" onClick={onMaster}>
          Use the app password
        </button>
      )}
    </Shell>
  );
}

function MasterLogin({ back }: { back?: () => void }) {
  const [key, setKey] = useState("");
  const { busy, error, submit } = useSubmit();
  return (
    <Shell title="Sign in" sub="Enter the app password you chose when you set it up.">
      <form
        onSubmit={submit(async () => {
          const res = await fetch("/api/meta", { headers: { "x-access-key": key } });
          if (!res.ok) throw new Error(res.status === 401 ? "Wrong password." : "Could not sign in.");
          setAccessKey(key);
          window.location.reload();
        })}
      >
        <label>
          Password
          <input type="password" autoComplete="current-password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        {error && <p className="error small">{error}</p>}
        <button type="submit" className="primary wide" disabled={!key || busy}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
      {back && (
        <button type="button" className="small ghost" onClick={back}>
          Sign in with email instead
        </button>
      )}
    </Shell>
  );
}

/** Account form shared by setup and joining. */
function AccountFields(props: { name: string; email: string; password: string; set: (k: "name" | "email" | "password", v: string) => void }) {
  return (
    <>
      <label>
        Your name
        <input autoComplete="name" value={props.name} onChange={(e) => props.set("name", e.target.value)} placeholder="Shown on your games" />
      </label>
      <label>
        Email
        <input type="email" autoComplete="email" value={props.email} onChange={(e) => props.set("email", e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" autoComplete="new-password" value={props.password} onChange={(e) => props.set("password", e.target.value)} placeholder="At least 8 characters" />
      </label>
    </>
  );
}

function useAccountForm() {
  const [f, setF] = useState({ name: "", email: "", password: "" });
  return { f, set: (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v })), ok: !!f.name && !!f.email && f.password.length >= 8 };
}

/** The first account: the owner, with the app password as proof. */
export function Setup({ appPassword }: { appPassword?: string }) {
  const { f, set, ok } = useAccountForm();
  const [key, setKey] = useState(appPassword ?? "");
  const { busy, error, submit } = useSubmit();
  return (
    <Shell title="Create your admin account" sub="You're the first: this account becomes the admin and keeps the games, lists and books already in the app.">
      <form onSubmit={submit(async () => done(await publicApi<SignedIn>("/auth/setup", { ...f, accessKey: key })))}>
        {!appPassword && (
          <label>
            App password
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="APP_ACCESS_KEY" />
          </label>
        )}
        <AccountFields {...f} set={set} />
        {error && <p className="error small">{error}</p>}
        <button type="submit" className="primary wide" disabled={!ok || !key || busy}>
          {busy ? "Creating…" : "Create admin account"}
        </button>
      </form>
    </Shell>
  );
}

export function Join({ token }: { token: string }) {
  const [invite, setInvite] = useState<{ valid: boolean; note?: string }>();
  const { f, set, ok } = useAccountForm();
  const { busy, error, submit } = useSubmit();
  useEffect(() => {
    publicApi<{ valid: boolean; note?: string }>(`/auth/invite/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch(() => setInvite({ valid: false }));
  }, [token]);
  if (!invite) return <Shell title="Join Thorgrim">{null}</Shell>;
  if (!invite.valid)
    return (
      <Shell title="This invite doesn't work" sub="It was already used or it expired (invites last 14 days). Ask the admin for a new link.">
        <a className="button primary wide" href="#/home">
          Go to sign in
        </a>
      </Shell>
    );
  return (
    <Shell title="Join Thorgrim" sub="Your Age of Sigmar coach: track your games and get advice every turn. Create your account to start.">
      <form
        onSubmit={submit(async () => {
          const signedIn = await publicApi<SignedIn>("/auth/join", { ...f, token });
          moment("Account created");
          done(signedIn);
        })}
      >
        <AccountFields {...f} set={set} />
        {error && <p className="error small">{error}</p>}
        <button type="submit" className="primary wide" disabled={!ok || busy}>
          {busy ? "Creating…" : "Create my account"}
        </button>
      </form>
    </Shell>
  );
}
