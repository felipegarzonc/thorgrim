// What the landing page is built from: the scroll-in motion and its small pieces.

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { reducedMotion } from "../../motion.tsx";

/** True once the element has been on screen (it stays true). */
export function useSeen<T extends Element>(threshold = 0.35): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current || seen) return;
    if (typeof IntersectionObserver === "undefined") return setSeen(true);
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen];
}

/** Whether the element is on screen right now (to run loops only when watched). */
export function useVisible<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold: 0.2 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return [ref, on];
}

/** Adds "lp-in" to every ".lp-reveal" as it scrolls into view. */
export function useReveals() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".landing .lp-reveal")];
    if (reducedMotion() || typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("lp-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("lp-in");
            io.unobserve(e.target);
          }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/** Embers drifting up behind the hero. */
export function Embers() {
  if (reducedMotion()) return null;
  return (
    <div className="lp-embers" aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 0.73) % 9}s`, animationDuration: `${8 + ((i * 1.7) % 6)}s`, ["--drift" as string]: `${((i % 5) - 2) * 18}px` }} />
      ))}
    </div>
  );
}

export const SIGN_IN = "#/signin";

/** In-page links scroll; they must not touch the hash, which is the app's route. */
export const jump = (e: MouseEvent<HTMLAnchorElement>) => {
  const id = e.currentTarget.getAttribute("href")?.slice(1);
  const target = id ? document.getElementById(id) : null;
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: "smooth", block: "start" });
};

/** Thorgrim's emblem: a horned dwarf helm over a braided beard. */
export function ThorgrimSeal({ size = 64 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="lp-seal">
      <path d="M6 12.5a6 6 0 0 1 12 0v1.5H6z" />
      <path d="M6.2 11.5C4 10.8 2.8 8.3 3.4 5.3c.9 1.8 2.3 2.8 3.9 3.2" />
      <path d="M17.8 11.5c2.2-.7 3.4-3.2 2.8-6.2-.9 1.8-2.3 2.8-3.9 3.2" />
      <path d="M12 6.5v7.5" />
      <path d="M8 14c0 3 1.6 5.6 4 7 2.4-1.4 4-4 4-7" />
      <path d="M10 15.5l2 1.5 2-1.5M10.3 18l1.7 1.3 1.7-1.3" />
    </svg>
  );
}

/** Something Thorgrim says. */
export function Quote({ children }: { children: ReactNode }) {
  return (
    <figure className="lp-quote">
      <blockquote>{children}</blockquote>
      <figcaption>Thorgrim</figcaption>
    </figure>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="lp-eyebrow">{children}</p>;
}

export function Feature({ icon, title, children, i = 0 }: { icon: ReactNode; title: string; children: ReactNode; i?: number }) {
  return (
    <article className="lp-card lp-reveal lp-feature" style={{ ["--d" as string]: `${i * 90}ms` }}>
      <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="lp-icon">
        {icon}
      </svg>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}
