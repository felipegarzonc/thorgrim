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

export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("Thorgrim hit an error:", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main>
        <section className="card crash">
          <h1>Something went wrong</h1>
          <p className="muted">Your games are saved. Reload to carry on.</p>
          <p className="small muted" translate="no">
            {this.state.error.message}
          </p>
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </section>
      </main>
    );
  }
}
