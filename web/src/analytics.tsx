// Vercel Web Analytics (cookieless page views). The app routes with the hash
// (#/games/<id>/round-3), and some of those hold secrets (invite, join and
// public report tokens), so Vercel only ever gets the screen with every id
// replaced (/games/[id]/round) and never the hash itself.

import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/react";

const CLUB_TABS = new Set(["reports", "events", "ladder", "members"]);

/** The screen a hash route shows, with no ids or tokens in it. */
export function screenOf(hash: string): string {
  const [tab = "home", id, step] = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  switch (tab) {
    case "games":
      return id ? `/games/[id]${step ? `/${step.replace(/^round-\d+$/, "round")}` : ""}` : "/games";
    case "club":
      if (!id) return "/club";
      if (CLUB_TABS.has(id)) return `/club/${id}`;
      if (id === "event" || id === "member") return `/club/${id}/[id]`;
      return "/club/post/[id]";
    case "lists":
      return id ? "/lists/[id]" : "/lists";
    case "r":
    case "join":
    case "play":
      return `/${tab}/[token]`;
    default:
      return /^[a-z]+$/.test(tab) ? `/${tab}` : "/other";
  }
}

export function PageAnalytics() {
  const read = () => (!window.location.hash && window.location.pathname === "/welcome" ? "/welcome" : screenOf(window.location.hash));
  const [screen, setScreen] = useState(read);
  useEffect(() => {
    const on = () => setScreen(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return (
    <Analytics
      route={screen}
      path={screen}
      beforeSend={(event) => {
        // Belt and braces: never the hash or query (tokens), only the clean screen.
        const url = new URL(event.url);
        url.hash = "";
        url.search = "";
        url.pathname = screen;
        return { ...event, url: url.toString() };
      }}
    />
  );
}
