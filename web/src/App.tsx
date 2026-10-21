import { useEffect, useState } from "react";
import { api, LOGIN_EVENT } from "./api.ts";
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
import { HomePage } from "./pages/Home.tsx";
import { ProfilePage } from "./pages/Profile.tsx";
import { Icon, MetaContext, type IconName, type Meta } from "./ui.tsx";

const TABS: [string, string, IconName][] = [
  ["home", "Home", "home"],
  ["games", "Games", "games"],
  ["club", "Club", "club"],
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
    api<Meta>("/meta").then(setMeta).catch((e: Error) => setError(e.message));
    return () => window.removeEventListener(LOGIN_EVENT, on);
  }, []);

  // The rules library is for developers only (app password); players never see it.
  const developer = !!meta?.user?.developer;
  const tabs = TABS.filter(([key]) => key !== "library" || developer);
  if (tab === "join" && id) return <Join token={id} />;
  if (tab === "r" && id) return <PublicReport token={id} />;
  if (needLogin) return <Login />;
  if (tab === "play" && id) return <JoinGame token={id} />;

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
        {meta && !meta.coachReady && tab === "calc" && (
          <p className="notice small">
            {meta.user?.isAdmin ? (
              <>
                The coach is off until you add your Claude API key. <a href="#/ask">Set it up</a>
              </>
            ) : (
              "The coach is off: the admin needs to add the Claude API key."
            )}
          </p>
        )}
        {tab === "home" && <HomePage />}
        {tab === "games" && <GamesPage />}
        {tab === "club" && <ClubPage postId={id} unreadNotices={unread.notices} />}
        {tab === "lists" && <ListsPage selectedId={id} />}
        {tab === "library" && developer && <LibraryPage />}
        {tab === "library" && meta && !developer && <Redirect to="#/home" />}
        {tab === "calc" && <CalculatorPage />}
        {tab === "profile" && <ProfilePage />}
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
      <nav className="bottom-nav" aria-label="Sections" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map(([key, label, icon]) => (
          <a key={key} href={`#/${key}`} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined}>
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
        Ask anything outside a game: rules, list building, matchups, the meta. For advice <em>during</em> a game, open the game and tap the coach button at the top, so
        the coach sees both lists, the battleplan and the score.
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
