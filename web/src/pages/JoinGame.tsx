// Opening a shared game's link (#/play/<token>): join it, then open it.
// Signing in first, if needed, comes back here (see Auth.tsx).

import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Shell } from "./Auth.tsx";

export function JoinGame({ token }: { token: string }) {
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<{ id: string }>("/games/join", { method: "POST", json: { token } })
      .then(({ id }) => window.location.replace(`#/games/${id}`))
      .catch((e: Error) => setError(e.message));
  }, [token]);
  if (!error) return <Shell title="Joining the game…">{null}</Shell>;
  return (
    <Shell title="Can't join this game" sub={error}>
      <a className="button primary wide" href="#/games">
        Go to your games
      </a>
    </Shell>
  );
}
