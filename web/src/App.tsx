import { useEffect, useRef, useState } from "react";
import { api, LOGIN_EVENT, mediaExpiry, setMediaToken } from "./api.ts";
import { CalculatorPage } from "./pages/Calculator.tsx";
import { CLUB_SEEN, ClubPage } from "./pages/Club.tsx";
import { PublicReport } from "./pages/PublicReport.tsx";
import { CoachChat } from "./pages/CoachChat.tsx";
import { GamePage } from "./pages/Game.tsx";
import { GamesPage } from "./pages/Games.tsx";
import { LibraryPage } from "./pages/Library.tsx";
import { ListsPage } from "./pages/Lists.tsx";
import { Join, Login } from "./pages/Auth.tsx";
import { JoinGame } from "./pages/JoinGame.tsx";
import { Landing } from "./pages/Landing.tsx";
import { HomePage } from "./pages/Home.tsx";
import { ProfilePage } from "./pages/Profile.tsx";
import { StatsPage } from "./pages/Stats.tsx";
import { Icon, MetaContext, type IconName, type Meta } from "./ui.tsx";

// Thorgrim sits in the middle, easiest to reach; Rules (developers only) goes last
// so players' five tabs keep their places.
const TABS: [string, string, IconName][] = [
  ["home", "Home", "home"],
  ["games", "Games", "games"],
  ["ask", "Thorgrim", "spark"],
  ["club", "Club", "club"],
  ["lists", "Lists", "lists"],
  ["library", "Rules", "rules"],
];
const TITLES: Record<string, string> = { lists: "Army lists", library: "Rules library", calc: "Calculator", ask: "Ask Thorgrim", stats: "Your stats" };

function useHashRoute(): string[] {
  // thorgrim.vercel.app/welcome (a link to share) opens the landing page too.
  const read = () => {
    const route = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    return !route.length && window.location.pathname === "/welcome" ? ["welcome"] : route;
  };
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
  const [newVersion, setNewVersion] = useState(false);
  const loadedBuild = useRef<string>("");
  const [unread, setUnread] = useState({ notices: 0, posts: 0 });

  // What's new in the club, for the badge on its tab: checked now and then, and when a page says it was seen.
  useEffect(() => {
    if (!meta?.user || tab === "r") return;
    const check = () => void api<typeof unread>("/club/unread").then(setUnread).catch(() => undefined);
    check();
    const t = setInterval(() => !document.hidden && check(), 60_000);
    window.addEventListener(CLUB_SEEN, check);
    return () => {
      clearInterval(t);
      window.removeEventListener(CLUB_SEEN, check);
    };
  }, [meta?.user?.id, tab]);

  useEffect(() => {
    const on = () => setNeedLogin(true);
    window.addEventListener(LOGIN_EVENT, on);
    api<Meta & { media?: string }>("/meta")
      .then((m) => {
        if (m.media) setMediaToken(m.media);
        loadedBuild.current = m.builtAt;
        setMeta(m);
      })
      .catch((e: Error) => setError(e.message));
    // A phone left open for a day: renew the photo pass before it runs out,
    // and notice when a newer version of the app went live.
    const renew = () => {
      if (document.visibilityState !== "visible") return;
      if (mediaExpiry() - Date.now() < 6 * 3600_000) void api<{ media: string }>("/media-token").then((r) => setMediaToken(r.media)).catch(() => undefined);
      void api<{ builtAt: string }>("/version")
        .then((v) => setNewVersion(!!loadedBuild.current && v.builtAt !== loadedBuild.current))
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", renew);
    const poll = setInterval(renew, 10 * 60_000);
    return () => {
      window.removeEventListener(LOGIN_EVENT, on);
      document.removeEventListener("visibilitychange", renew);
      clearInterval(poll);
    };
  }, []);

  // The rules library is for developers only (app password); players never see it.
  const developer = !!meta?.user?.developer;
  const tabs = TABS.filter(([key]) => key !== "library" || developer);
  if (tab === "join" && id) return <Join token={id} />;
  if (tab === "r" && id) return <PublicReport token={id} />;
  if (tab === "welcome") return <Landing />;
  // Not signed in: the landing page first; its buttons (and game links) lead to sign-in.
  if (needLogin) return tab === "signin" || tab === "play" ? <Login /> : <Landing />;
  if (tab === "signin") return <Redirect to="#/home" />;
  if (tab === "play" && id) return <JoinGame token={id} />;
  // Pages wait for /meta: it brings the photo pass their images need.
  if (!meta && !error) return <main><p className="muted page-loading">Loading…</p></main>;

  // A game has its own top and bottom bars, like a scoresheet.
  const update = newVersion && (
    <button type="button" className="update-bar" onClick={() => window.location.reload()}>
      A new version of Thorgrim is ready · <b>Reload</b>
    </button>
  );
  if (tab === "games" && id)
    return (
      <MetaContext.Provider value={meta}>
        {update}
        <GamePage key={id} id={id} step={step} />
      </MetaContext.Provider>
    );

  return (
    <MetaContext.Provider value={meta}>
      {update}
      <main>
        {error && <p className="error">Server error: {error}. Is the server running and `npm run data` done?</p>}
        {TITLES[tab] && (
          <div className="page-head">
            <h1>{TITLES[tab]}</h1>
          </div>
        )}
        {meta && !meta.coachReady && tab === "calc" && (
          <p className="notice small">
            {meta.user?.isAdmin ? (
              <>
                Thorgrim is off until you add your Claude API key. <a href="#/ask">Set it up</a>
              </>
            ) : (
              "Thorgrim is off: the admin needs to add the Claude API key."
            )}
          </p>
        )}
        {tab === "home" && <HomePage unread={unread.notices + unread.posts} />}
        {tab === "games" && <GamesPage />}
        {tab === "club" && <ClubPage postId={id} sub={step} unreadNotices={unread.notices} />}
        {tab === "lists" && <ListsPage selectedId={id} />}
        {tab === "library" && developer && <LibraryPage />}
        {tab === "library" && meta && !developer && <Redirect to="#/home" />}
        {tab === "calc" && <CalculatorPage />}
        {tab === "profile" && <ProfilePage />}
        {tab === "stats" && <StatsPage />}
        {tab === "ask" && (
          <CoachChat
            convoId="general"
            title="Ask Thorgrim"
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
      <nav className="bottom-nav" aria-label="Sections" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map(([key, label, icon]) => (
          <a key={key} href={`#/${key}`} className={[tab === key ? "active" : "", key === "ask" ? "nav-coach" : ""].join(" ").trim()} aria-current={tab === key ? "page" : undefined}>
            <span className="ico-wrap">
              <Icon name={icon} />
              {key === "club" && unread.notices + unread.posts > 0 && <span className="nav-dot">{Math.min(unread.notices + unread.posts, 99)}</span>}
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
        Ask anything outside a game: rules, list building, matchups, the meta. For advice <em>during</em> a game, open the game and tap Thorgrim's button at the top, so
        Thorgrim sees both lists, the battleplan and the score.
      </p>
      <ul className="small muted">
        <li>Knows every faction's warscrolls and points (army data).</li>
        <li>Searches the rules library (core rules, General's Handbook, battletomes) and cites pages.</li>
        <li>Runs the numbers with the calculator, and can check Wahapedia, Listhammer and Woehammer.</li>
      </ul>
      <p className="small muted">Try one of these:</p>
    </div>
  );
}

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return null;
}
