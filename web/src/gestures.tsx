// Touch gestures for the phone: pull a page down to refresh it, and swipe
// sideways on the battle screen to move between rounds.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { buzz } from "./motion.tsx";
import { Icon, refreshAll } from "./ui.tsx";

const PULL_AT = 72;

/** Pull down at the top of the page to load it again (Home, the club, games, lists). */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const state = useRef({ y: null as number | null, x: 0, dist: 0, armed: false, busy: false });
  useEffect(() => {
    const s = state.current;
    const start = (e: TouchEvent) => {
      // Only from the very top, and not while a sheet is open over the page.
      if (s.busy || window.scrollY > 0 || document.querySelector("[role=dialog], dialog[open]")) return void (s.y = null);
      s.y = e.touches[0].clientY;
      s.x = e.touches[0].clientX;
      s.dist = 0;
      s.armed = false;
    };
    const move = (e: TouchEvent) => {
      if (s.y === null) return;
      const dy = e.touches[0].clientY - s.y;
      const dx = Math.abs(e.touches[0].clientX - s.x);
      if (dy <= 0 || dx > dy || window.scrollY > 0) {
        s.dist = 0;
        setPull(0);
        return;
      }
      s.dist = Math.min(120, dy * 0.5);
      if (s.dist >= PULL_AT && !s.armed) {
        s.armed = true;
        buzz(10);
      } else if (s.dist < PULL_AT) s.armed = false;
      setPull(s.dist);
    };
    const end = async () => {
      if (s.y === null) return;
      s.y = null;
      if (s.dist < PULL_AT) return setPull(0);
      s.busy = true;
      setBusy(true);
      setPull(56);
      await refreshAll();
      s.busy = false;
      setBusy(false);
      setPull(0);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);
  return (
    <>
      <div className={`ptr ${busy ? "busy" : ""} ${pull ? "" : "rest"}`} style={{ height: pull }} role="status" aria-live="polite">
        <span className={`ptr-seal ${pull >= PULL_AT || busy ? "ready" : ""}`} style={{ opacity: busy ? 1 : Math.min(1, pull / PULL_AT), transform: busy ? undefined : `rotate(${pull * 3}deg)` }}>
          <Icon name="spark" />
        </span>
        {busy && <span className="sr-only">Refreshing…</span>}
      </div>
      {children}
    </>
  );
}

/** Things a sideways swipe must not take over: rows that scroll sideways, sliders, text, maps. */
const NO_SWIPE = "input, textarea, select, .phase-chips, .carousel, .chips, .round-strip, [data-no-swipe], .cells, canvas";

/** A clear sideways swipe on `el` (not a scroll): -1 = to the right (previous), 1 = to the left (next). */
export function useSwipe(onSwipe: (dir: -1 | 1) => void, enabled = true) {
  const latest = useRef(onSwipe);
  latest.current = onSwipe;
  useEffect(() => {
    if (!enabled) return;
    let x0 = 0;
    let y0 = 0;
    let t0 = 0;
    let on = false;
    const start = (e: TouchEvent) => {
      const target = e.target as Element | null;
      on = e.touches.length === 1 && !target?.closest(NO_SWIPE) && !document.querySelector("[role=dialog], dialog[open]");
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      t0 = Date.now();
    };
    const end = (e: TouchEvent) => {
      if (!on) return;
      on = false;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      // Far enough, mostly sideways, and quick: a swipe, not reading or scrolling.
      if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.5 || Date.now() - t0 > 700) return;
      // Not from the screen's edges: the phone uses those to go back.
      if (x0 < 24 || x0 > window.innerWidth - 24) return;
      latest.current(dx < 0 ? 1 : -1);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchend", end);
    };
  }, [enabled]);
}
