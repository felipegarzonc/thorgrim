// Small pieces of motion that answer what happens at the table: numbers
// that count to their new value, a "+5" that floats up when points are
// scored, a short buzz on Android, brass sparks for a victory, and shimmering
// shapes while a screen loads. All of it stays still when the phone asks for
// reduced motion.

import { useEffect, useRef, useState } from "react";

export const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A short vibration (Android; iPhones ignore it). */
export function buzz(ms = 12) {
  if (reducedMotion()) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not allowed here: fine */
  }
}

/** A number that counts to its new value, and pulses when it changes. `from` makes the first show count up too. */
export function CountUp({ value, from, ms = 600, className = "" }: { value: number; from?: number; ms?: number; className?: string }) {
  const [shown, setShown] = useState(from ?? value);
  const [bump, setBump] = useState(0);
  const last = useRef(from ?? value);
  useEffect(() => {
    const start = last.current;
    last.current = value;
    if (start === value) return;
    setBump((b) => b + 1);
    if (reducedMotion()) return setShown(value);
    const t0 = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <span key={bump} className={`count-up ${bump ? "bump" : ""} ${className}`.trim()}>
      {shown}
    </span>
  );
}

/** "+5" floating up from a number whenever it goes up. */
export function Gain({ value }: { value: number }) {
  const [gains, setGains] = useState<{ id: number; n: number }[]>([]);
  const last = useRef(value);
  useEffect(() => {
    const diff = value - last.current;
    last.current = value;
    if (diff <= 0 || reducedMotion()) return;
    const id = Date.now() + Math.random();
    setGains((g) => [...g, { id, n: diff }]);
    const t = setTimeout(() => setGains((g) => g.filter((x) => x.id !== id)), 1300);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <>
      {gains.map((g) => (
        <span key={g.id} className="gain" aria-hidden="true">
          +{g.n}
        </span>
      ))}
    </>
  );
}

/** Brass sparks bursting out once (a victory). */
export function Sparks({ count = 18 }: { count?: number }) {
  if (reducedMotion()) return null;
  return (
    <span className="sparks" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
        const dist = 70 + ((i * 37) % 60);
        return <i key={i} style={{ ["--dx" as string]: `${Math.cos(angle) * dist}px`, ["--dy" as string]: `${Math.sin(angle) * dist}px`, ["--d" as string]: `${(i % 5) * 40}ms` }} />;
      })}
    </span>
  );
}

/** Shimmering shapes while a screen loads. */
export function Skeleton({ cards = 2, label = "Loading…" }: { cards?: number; label?: string }) {
  return (
    <div className="skeleton-list" role="status" aria-label={label}>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="skeleton-card">
          <span className="sk sk-title" />
          <span className="sk sk-line" />
          <span className="sk sk-line short" />
        </div>
      ))}
    </div>
  );
}
