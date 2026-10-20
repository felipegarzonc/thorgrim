import { useEffect, useState } from "react";
import { api, LOGIN_EVENT, setAccessKey } from "./api.ts";
import { CalculatorPage } from "./pages/Calculator.tsx";
import { CoachChat } from "./pages/CoachChat.tsx";
import { GamePage } from "./pages/Game.tsx";
import { GamesPage } from "./pages/Games.tsx";
import { LibraryPage } from "./pages/Library.tsx";
import { ListsPage } from "./pages/Lists.tsx";
import { HomePage } from "./pages/Home.tsx";
import { Icon, MetaContext, type IconName, type Meta } from "./ui.tsx";

const TABS: [string, string, IconName][] = [
  ["home", "Home", "home"],
  ["games", "Games", "games"],
  ["lists", "Lists", "lists"],
  ["library", "Rules", "rules"],
  ["ask", "Coach", "coach"],
];
const TITLES: Record<string, string> = { lists: "Army lists", library: "Rules library", calc: "Calculator", ask: "Coach" };

function useHashRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string>();
  const route = useHashRoute();
  const [tab = "home", id, step] = route;

  const [needLogin, setNeedLogin] = useState(false);

  useEffect(() => {
    const on = () => setNeedLogin(true);
    window.addEventListener(LOGIN_EVENT, on);
    api<Meta>("/meta").then(setMeta).catch((e: Error) => setError(e.message));
    return () => window.removeEventListener(LOGIN_EVENT, on);
  }, []);

  if (needLogin) return <Login />;

  // A game has its own top and bottom bars, like a scoresheet.
  if (tab === "games" && id)
    return (
      <MetaContext.Provider value={meta}>
        <GamePage key={id} id={id} step={step} />
      </MetaContext.Provider>
    );

  return (
    <MetaContext.Provider value={meta}>
      <main>
        {error && <p className="error">Server error: {error}. Is the server running and `npm run data` done?</p>}
        {TITLES[tab] && (
          <div className="page-head">
            <h1>{TITLES[tab]}</h1>
          </div>
        )}
        {meta && !meta.coachReady && (tab === "library" || tab === "calc") && (
          <p className="notice small">
            The coach is off until you add your Claude API key. <a href="#/ask">Set it up</a>
          </p>
        )}
        {tab === "home" && <HomePage />}
        {tab === "games" && <GamesPage />}
        {tab === "lists" && <ListsPage selectedId={id} />}
        {tab === "library" && <LibraryPage />}
        {tab === "calc" && <CalculatorPage />}
        {tab === "ask" && (
          <CoachChat
            convoId="general"
            title="Ask the coach"
            placeholder="Rules questions, list building, matchups…"
            intro={<AskIntro />}
            quick={[
              "Which 2026-27 battle tactic cards suit an Ogor Mawtribes army, and why?",
              "How should Ogor Mawtribes play into Skaven?",
              "When can I use Counter-charge and what does it cost?",
              "Build me a 2000-point Ogor list for the current season.",
              "What's winning tournaments right now? Check Listhammer.",
            ]}
          />
        )}
      </main>
      {meta && tab !== "home" && (
        <footer className="footer">
          Army data: BSData {meta.commit} ({meta.builtAt.slice(0, 10)}). Rules text belongs to Games Workshop — personal use only.
        </footer>
      )}
      <nav className="bottom-nav" aria-label="Sections">
        {TABS.map(([key, label, icon]) => (
          <a key={key} href={`#/${key}`} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined}>
            <span className="ico-wrap">
              <Icon name={icon} />
            </span>
            {label}
          </a>
        ))}
      </nav>
    </MetaContext.Provider>
  );
}

function AskIntro() {
  return (
    <div className="ask-intro">
      <p>
        Ask anything outside a game: rules, list building, matchups, the meta. For advice <em>during</em> a game, open the game and tap the coach button at the top, so
        the coach sees both lists, the battleplan and the score.
      </p>
      <ul className="small muted">
        <li>Knows every faction's warscrolls and points (army data).</li>
        <li>Searches the books you uploaded under Rules and cites pages.</li>
        <li>Runs the numbers with the calculator, and can check Wahapedia, Listhammer and Woehammer.</li>
      </ul>
      <p className="small muted">Try one of these:</p>
    </div>
  );
}

function Login() {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const res = await fetch("/api/meta", { headers: { "x-access-key": key } });
    if (res.ok) {
      setAccessKey(key);
      window.location.reload();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError((data as { error?: string }).error === "Password required" ? "Wrong password." : ((data as { error?: string }).error ?? "Could not sign in."));
    setBusy(false);
  };
  return (
    <main className="login">
      <form className="card" onSubmit={submit}>
        <span className="brand">Thorgrim</span>
        <h1>Sign in</h1>
        <p className="muted small">Enter the app password you chose when you set it up.</p>
        <label>
          Password
          <input type="password" autoComplete="current-password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        {error && <p className="error small">{error}</p>}
        <button type="submit" className="primary" disabled={!key || busy} style={{ width: "100%" }}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
