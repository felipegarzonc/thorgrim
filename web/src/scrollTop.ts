// Opening a page at its top, for good. A flick on the last page keeps moving
// for a moment, and on a slow phone its last scroll can land after the next
// page has opened: the new page then sits partway down (and pull-to-refresh,
// which starts at the top, does nothing).

/** How long the last page's leftover scrolling is held back on the page that just opened. */
const SETTLE_MS = 1000;
const TAKES_OVER = ["touchstart", "wheel", "keydown", "pointerdown"];

let stop: (() => void) | undefined;

/**
 * Scroll to the top and stay there while the last page's scrolling dies down.
 * The hold ends as soon as the person touches, wheels or presses a key, or the
 * page itself wants to scroll (letScroll).
 */
export function openAtTop() {
  stop?.();
  window.scrollTo(0, 0);
  const hold = () => window.scrollTo(0, 0);
  const end = () => {
    window.removeEventListener("scroll", hold);
    for (const e of TAKES_OVER) window.removeEventListener(e, end);
    clearTimeout(timer);
    stop = undefined;
  };
  const timer = setTimeout(end, SETTLE_MS);
  window.addEventListener("scroll", hold, { passive: true });
  for (const e of TAKES_OVER) window.addEventListener(e, end, { passive: true });
  stop = end;
}

/** A page about to scroll itself (a chat going to its newest message) calls this first, so it isn't held at the top. */
export function letScroll() {
  stop?.();
}
