import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { CalculatorPage } from "./pages/Calculator.tsx";
import { CoachChat } from "./pages/CoachChat.tsx";
import { GamePage } from "./pages/Game.tsx";
import { GamesPage } from "./pages/Games.tsx";
import { LibraryPage } from "./pages/Library.tsx";
import { ListsPage } from "./pages/Lists.tsx";
import { MetaContext, type Meta } from "./ui.tsx";

const TABS = [
  ["games", "Games"],
  ["lists", "Lists"],
  ["library", "Rules"],
  ["calc", "Calculator"],
  ["ask", "Ask"],
] as const;

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
  const [tab = "games", id] = route;

  useEffect(() => {
    api<Meta>("/meta").then(setMeta).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <MetaContext.Provider value={meta}>
      <header className="topbar">
        <a className="brand" href="#/games">
          AoS Coach
        </a>
        <nav>
          {TABS.map(([key, label]) => (
            <a key={key} href={`#/${key}`} className={tab === key ? "active" : ""}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        {error && <p className="error">Server error: {error}. Is the server running and `npm run data` done?</p>}
        {meta && !meta.coachReady && tab !== "ask" && (
          <p className="warning small">
            The coach is off until you add your Claude API key — <a href="#/ask">set it up</a>.
          </p>
        )}
        {tab === "games" && !id && <GamesPage />}
        {tab === "games" && id && <GamePage id={id} />}
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
      {meta && (
        <footer className="footer">
          Army data: BSData {meta.commit} ({meta.builtAt.slice(0, 10)}). Rules text belongs to Games Workshop — personal use only.
        </footer>
      )}
    </MetaContext.Provider>
  );
}

function AskIntro() {
  return (
    <div className="ask-intro">
      <p>
        Ask anything outside a game: rules, list building, matchups, the meta. For advice <em>during</em> a game, open the game and use its Coach tab, so
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
