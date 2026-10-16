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
        {meta && !meta.coachReady && <p className="warning">ANTHROPIC_API_KEY is not set on the server: the coach is disabled until you add it to .env.</p>}
        {tab === "games" && !id && <GamesPage />}
        {tab === "games" && id && <GamePage id={id} />}
        {tab === "lists" && <ListsPage selectedId={id} />}
        {tab === "library" && <LibraryPage />}
        {tab === "calc" && <CalculatorPage />}
        {tab === "ask" && <CoachChat convoId="general" title="Ask the coach" placeholder="Rules questions, list building, matchups…" />}
      </main>
      {meta && (
        <footer className="footer">
          Army data: BSData {meta.commit} ({meta.builtAt.slice(0, 10)}). Rules text belongs to Games Workshop — personal use only.
        </footer>
      )}
    </MetaContext.Provider>
  );
}
