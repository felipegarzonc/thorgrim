// Keeping the app on screen when something goes wrong.
//
// Browser extensions (Grammarly, page translators) move or wrap text that
// React drew, and React then fails to remove or insert a node and takes the
// whole page down, leaving it black. The DOM patch lets React carry on in
// that case (the fix suggested on React's tracker), and the boundary shows a
// message with a reload button for anything else.

import { Component, type ReactNode } from "react";

export function tolerateExtensions() {
  if (typeof Node === "undefined") return;
  const remove = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child;
    return remove.call(this, child) as T;
  };
  const insert = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) return insert.call(this, node, null) as T;
    return insert.call(this, node, ref) as T;
  };
}

/**
 * A screen's code that didn't download (Chrome, Firefox, Safari word it differently):
 * no signal and the phone hadn't kept it yet, or an app open since before a new version.
 */
export const missingScreen = (e: Error | undefined) =>
  !!e && /dynamically imported module|Importing a module script failed|Loading chunk|Unable to preload/i.test(e.message);

const RELOADED = "thorgrim-reloaded-for-screen";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("Thorgrim hit an error:", error);
    if (!missingScreen(error)) return;
    // The browser won't try the same file again without a reload. With signal, reload at
    // once (once: a second failure shows the message); without it, as soon as it's back.
    if (navigator.onLine && !recentlyReloaded()) reload();
    else window.addEventListener("online", reload, { once: true });
  }
  render() {
    const error = this.state.error;
    if (!error) return this.props.children;
    const screen = missingScreen(error);
    return (
      <main>
        <section className="card crash">
          <h1>{screen ? "This screen isn't on the phone yet" : "Something went wrong"}</h1>
          <p className="muted">
            {screen ? "It needs the signal once to download. It opens by itself when the signal is back; your games are saved." : "Your games are saved. Reload to carry on."}
          </p>
          {!screen && (
            <p className="small muted" translate="no">
              {error.message}
            </p>
          )}
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </section>
      </main>
    );
  }
}

function recentlyReloaded(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOADED) ?? 0) < 30_000;
  } catch {
    return true;
  }
}
function reload() {
  try {
    sessionStorage.setItem(RELOADED, String(Date.now()));
  } catch {
    /* reload anyway */
  }
  window.location.reload();
}
