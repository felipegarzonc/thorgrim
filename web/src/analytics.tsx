// Vercel Web Analytics (cookieless page views and the beta's key moments)
// and Speed Insights (how fast screens load on players' phones). The app routes with the hash
// (#/games/<id>/round-3), and some of those hold secrets (invite, join and
// public report tokens), so Vercel only ever gets the screen with every id
// replaced (/games/[id]/round) and never the hash itself.

import { useEffect, useState } from "react";
import { Analytics, track } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

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

/** The beta's key moments, counted by name only (no ids, no personal data). */
export type Moment =
  | "Access requested"
  | "Account created"
  | "Password reset"
  | "Game created"
  | "Game finished"
  | "Report posted"
  | "Report shared"
  | "Asked Thorgrim"
  | "Scored by voice"
  | "Event created"
  | "Challenge sent";
export const moment = (name: Moment) => {
  try {
    track(name);
  } catch {
    /* analytics never gets in the way */
  }
};

/** A vital or event's URL with only the clean screen in it. */
const clean = (url: string, screen: string) => {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  u.pathname = screen;
  return u.toString();
};

export function PageAnalytics() {
  const read = () => (!window.location.hash && window.location.pathname === "/welcome" ? "/welcome" : screenOf(window.location.hash));
  const [screen, setScreen] = useState(read);
  useEffect(() => {
    const on = () => setScreen(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // Belt and braces: never the hash or query (tokens), only the clean screen.
  return (
    <>
      <Analytics route={screen} path={screen} beforeSend={(event) => ({ ...event, url: clean(event.url, screen) })} />
      <SpeedInsights route={screen} beforeSend={(event) => ({ ...event, url: clean(event.url, screen), route: screen })} />
    </>
  );
}
