// The landing page: what visitors who aren't signed in see first (and
// #/welcome for anyone). Its buttons lead to sign-in; invite and join links
// skip it.

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { publicApi } from "../api.ts";
import { currentLang } from "../i18n.ts";
import { moment } from "../analytics.tsx";
import { CountUp, reducedMotion } from "../motion.tsx";

// ---------- motion ----------
// Sections and cards rise in as they scroll into view (class "lp-reveal",
// staggered with --d); the phone plays a turn; the report fills its score
// sheet; the chat types. All still when the visitor asks for reduced motion.

/** True once the element has been on screen (it stays true). */
function useSeen<T extends Element>(threshold = 0.35): [React.RefObject<T | null>, boolean] {
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
function useVisible<T extends Element>(): [React.RefObject<T | null>, boolean] {
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
function useReveals() {
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
function Embers() {
  if (reducedMotion()) return null;
  return (
    <div className="lp-embers" aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 0.73) % 9}s`, animationDuration: `${8 + ((i * 1.7) % 6)}s`, ["--drift" as string]: `${((i % 5) - 2) * 18}px` }} />
      ))}
    </div>
  );
}

const SIGN_IN = "#/signin";

/** In-page links scroll; they must not touch the hash, which is the app's route. */
const jump = (e: MouseEvent<HTMLAnchorElement>) => {
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
function Quote({ children }: { children: ReactNode }) {
  return (
    <figure className="lp-quote">
      <blockquote>{children}</blockquote>
      <figcaption>Thorgrim</figcaption>
    </figure>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="lp-eyebrow">{children}</p>;
}

function Feature({ icon, title, children, i = 0 }: { icon: ReactNode; title: string; children: ReactNode; i?: number }) {
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

const PHASES = ["Start", "Hero", "Move", "Charge", "Combat"];
const TIPS = [
  "Count your command points before you spend one: two for Counter-charge, always.",
  "Gorger Mawpack behind the ruins. Unseen until they bite.",
  "Mournfangs to the edge of objective B. Not one inch further.",
  "Mournfangs into objective B, now. Hold it and the round is yours. Keep the Stonehorn back: they'll counter-charge, mark my words.",
  "Gluttons into the Sentinels first. Pile in towards the objective.",
];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The round screen, drawn as a phone, playing a turn: phases go by, the clock runs, Thorgrim writes. */
function PhoneRound() {
  const [ref, on] = useVisible<HTMLDivElement>();
  const still = reducedMotion();
  const [phase, setPhase] = useState(3);
  const [vp, setVp] = useState(38);
  const [secs, setSecs] = useState(41 * 60 + 7);
  const [typed, setTyped] = useState(TIPS[3].length);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!on || still) return;
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 45 * 60)), 1000);
    const p = setInterval(() => {
      setPhase((x) => {
        const next = (x + 1) % PHASES.length;
        if (next === 0) setVp((v) => (v >= 58 ? 38 : v + 5 + (v % 3)));
        setTyped(0);
        return next;
      });
    }, 4200);
    return () => {
      clearInterval(t);
      clearInterval(p);
    };
  }, [on, still]);
  useEffect(() => {
    if (still || typed >= TIPS[phase].length) return;
    const t = setTimeout(() => setTyped((n) => Math.min(TIPS[phase].length, n + 2)), 22);
    return () => clearTimeout(t);
  }, [typed, phase, still]);
  const lean = (e: PointerEvent<HTMLDivElement>) => {
    if (still || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    setTilt({ x: ((e.clientY - r.top) / r.height - 0.5) * -8, y: ((e.clientX - r.left) / r.width - 0.5) * 10 });
  };
  return (
    <div
      ref={ref}
      className="lp-phone"
      role="img"
      aria-label="The round screen: both armies' score, command points and fury, the chess clock and Thorgrim's plan for the turn"
      onPointerMove={lean}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      style={{ ["--rx" as string]: `${tilt.x}deg`, ["--ry" as string]: `${tilt.y}deg` }}
    >
      <div className="lp-phone-screen">
        <div className="lp-ph-top">
          <b>
            <CountUp value={vp} />
            -20 Goy vs Diego
          </b>
          <span>Round 3</span>
        </div>
        <div className="lp-ph-scores">
          <div className="lp-ph-side active">
            <b>Goy</b>
            <small>Ogor Mawtribes</small>
            <span className="lp-ph-tag">YOUR TURN</span>
            <span className="lp-ph-vp">
              <CountUp value={vp} />
            </span>
            <span className="lp-ph-cp">
              CP <i className="on" /> <i className="on" /> <i />
            </span>
          </div>
          <div className="lp-ph-side">
            <b>Diego</b>
            <small>Lumineth Realm-lords</small>
            <span className="lp-ph-tag waiting">WAITING</span>
            <span className="lp-ph-vp">20</span>
            <span className="lp-ph-cp">
              CP <i className="on" /> <i className="on" /> <i className="on" />
            </span>
          </div>
        </div>
        <div className="lp-ph-phases">
          {PHASES.map((p, i) => (
            <span key={p} className={i === phase ? "on" : i < phase ? "past" : ""}>
              {p}
            </span>
          ))}
        </div>
        <div className="lp-ph-clock">
          <span>
            <small>You</small>
            <b className="on">{clock(secs)}</b>
          </span>
          <span>
            <small>Diego</small>
            <b>38:52</b>
          </span>
          <em>Pause</em>
        </div>
        <div className="lp-ph-tip">
          <b>{`Thorgrim · ${PHASES[phase]}`}</b>
          <p>
            {TIPS[phase].slice(0, typed)}
            {typed < TIPS[phase].length && <span className="lp-caret" />}
          </p>
        </div>
        <div className="lp-ph-next">{phase < PHASES.length - 1 ? `Next: ${PHASES[phase + 1]}` : "End turn → Diego"}</div>
      </div>
    </div>
  );
}

const cells = (xs: number[], row: number) => (
  <span className="lp-cells">
    {xs.map((x, i) => (
      <span key={i} style={{ ["--d" as string]: `${(row * 5 + i) * 90}ms` }}>
        {x}
      </span>
    ))}
  </span>
);

/** A battle report as it shows in the club feed: its score counts up and its sheet fills in when it comes into view. */
function ClubPost() {
  const [ref, seen] = useSeen<HTMLElement>();
  return (
    <article ref={ref} className={`lp-post ${seen ? "lp-played" : ""}`} role="img" aria-label="A battle report in the club feed: the score, the score sheet and the start of the story">
      <div className="lp-post-head">
        <div className="lp-post-author">
          <span className="lp-avatar">G</span>
          <span>
            <b>Goy</b>
            <small>2 h ago · Into the Fire</small>
          </span>
        </div>
        <h4>Goy's Gorging Tide Crushes Diego's Radiant Realm</h4>
        <div className="lp-post-stats">
          <span>
            <small>Score</small>
            <b>
              <CountUp value={seen ? 66 : 0} ms={1400} />–<CountUp value={seen ? 11 : 0} ms={1400} />
            </b>
          </span>
          <span>
            <small>Result</small>
            <b className="brass lp-victory">Victory</b>
          </span>
          <span>
            <small>Tactics</small>
            <b>20/30</b>
          </span>
        </div>
      </div>
      <div className="lp-sheet">
        <b>Goy</b>
        <div className="lp-sheet-row">
          <span className="grow">Objectives</span>
          {cells([10, 10, 6, 10, 10], 0)}
          <b>46</b>
        </div>
        <div className="lp-sheet-row">
          <span className="grow">Blazing Onslaught</span>
          {cells([0, 0, 5, 0, 5], 1)}
          <b>10/15</b>
        </div>
        <b>Diego</b>
        <div className="lp-sheet-row">
          <span className="grow">Objectives</span>
          {cells([0, 3, 3, 0, 0], 2)}
          <b>6</b>
        </div>
      </div>
      <p className="lp-post-story">
        Under a sky of smoke and ash, two armies met upon a field of two thousand points to fight for the sigils of Into the Fire. On one side marched the Lumineth of
        Diego, cold and radiant…
      </p>
    </article>
  );
}

const CHAT: { who: "me" | "coach"; text: ReactNode }[] = [
  { who: "me", text: "When can I use Counter-charge and what does it cost?" },
  {
    who: "coach",
    text: (
      <>
        Hrm. In your foe's charge phase, one of your units that isn't already in combat can charge them back. Costs 2 command points, so keep two in your purse.{" "}
        <span className="brass">Core rules · Commands</span>
      </>
    ),
  },
  { who: "me", text: 'I failed a 3" charge with my Stonehorn.' },
  { who: "coach", text: "By my beard. That one goes in the Book of Grudges. Now: next turn, it charges first." },
];

/** The chat with Thorgrim, typed out once it comes into view. */
function Chat() {
  const [ref, seen] = useSeen<HTMLDivElement>(0.4);
  const still = reducedMotion();
  const [shown, setShown] = useState(still ? CHAT.length : 0);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!seen || still || shown >= CHAT.length) return;
    const next = CHAT[shown];
    if (next.who === "coach" && !typing) {
      const t = setTimeout(() => setTyping(true), 500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => {
        setTyping(false);
        setShown((n) => n + 1);
      },
      next.who === "coach" ? 1300 : 700,
    );
    return () => clearTimeout(t);
  }, [seen, shown, typing, still]);
  return (
    <div ref={ref} className="lp-chat" aria-label="A chat with Thorgrim">
      {CHAT.slice(0, shown).map((m, i) => (
        <p key={i} className={`lp-bubble ${m.who} lp-pop`}>
          {m.text}
        </p>
      ))}
      {typing && (
        <p className="lp-bubble coach lp-typing" aria-label="Thorgrim is typing">
          <i />
          <i />
          <i />
        </p>
      )}
    </div>
  );
}

/** Glory: a level's bar filling, missions ticking off, achievements unlocking. */
function GloryDemo() {
  const [ref, seen] = useSeen<HTMLDivElement>(0.35);
  const missions = ["Play a club game", "Post a battle report with a photo", "Predict 2 battles"];
  const badges: [string, string][] = [
    ["Epic Comeback", "M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 2 1 3 2 3 0-3 0-5 1-8z"],
    ["Kingslayer", "M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z M9 12h.01 M15 12h.01"],
    ["Master Tactician", "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"],
    ["Army of the Month", "M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  ];
  return (
    <div ref={ref} className={`lp-glory ${seen ? "lp-played" : ""}`} role="img" aria-label="A member's glory: level, experience, weekly missions and achievements">
      <div className="lp-glory-head">
        <span className="lp-level">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z" />
          </svg>
          <b>5</b>
        </span>
        <div className="grow">
          <b className="lp-display">Champion</b>
          <small>
            <CountUp value={seen ? 1240 : 0} ms={1600} /> XP · 60 to level 6
          </small>
          <span className="lp-xp">
            <span />
          </span>
        </div>
      </div>
      <p className="lp-eyebrow">Weekly missions</p>
      {missions.map((m, i) => (
        <div key={m} className="lp-mission" style={{ ["--d" as string]: `${700 + i * 450}ms` }}>
          <span className="lp-check" />
          <span>{m}</span>
          <small>+50 XP</small>
        </div>
      ))}
      <div className="lp-badges">
        {badges.map(([name, d], i) => (
          <span key={name} className="lp-badge" style={{ ["--d" as string]: `${2200 + i * 250}ms` }}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={d} />
            </svg>
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The private beta's door: a short form; an admin approves it and the invite goes out by email. */
export function RequestAccess() {
  const [form, setForm] = useState({ name: "", email: "", club: "", message: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string>();
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(undefined);
    try {
      await publicApi("/public/access-requests", { ...form, lang: currentLang() });
      moment("Access requested");
      setState("sent");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  };
  if (state === "sent")
    return (
      <div className="lp-request lp-request-done" role="status">
        <ThorgrimSeal size={40} />
        <p>
          <b>Request received.</b> Thorgrim will send word to {form.email} when your access is approved.
        </p>
      </div>
    );
  return (
    <form className="lp-request" onSubmit={send}>
      <div className="lp-fields">
        <label>
          <span>Your name</span>
          <input value={form.name} onChange={set("name")} required maxLength={60} autoComplete="name" />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={form.email} onChange={set("email")} required maxLength={254} autoComplete="email" />
        </label>
      </div>
      <label>
        <span>Your club or gaming group (optional)</span>
        <input value={form.club} onChange={set("club")} maxLength={80} />
      </label>
      <label>
        <span>Anything you'd like to tell us (optional)</span>
        <textarea data-gramm="false" rows={3} value={form.message} onChange={set("message")} maxLength={500} placeholder="e.g. We play every Thursday, about 10 of us." />
      </label>
      {/* Only bots fill this in. */}
      <input className="lp-honey" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={set("website")} name="website" />
      {error && <p className="error small">{error}</p>}
      <button type="submit" className="lp-btn primary" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Request access"}
      </button>
    </form>
  );
}

export function Landing() {
  useReveals();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <div className="landing">
      <header className={`lp-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="lp-wrap lp-nav-row">
          <a href="#/welcome" className="lp-brand">
            <span className="lp-brand-mark">
              <ThorgrimSeal size={24} />
            </span>
            <span className="lp-brand-name">THORGRIM</span>
          </a>
          <nav aria-label="Sections" className="lp-links">
            <a href="#lp-table" onClick={jump}>At the table</a>
            <a href="#lp-after" onClick={jump}>After the battle</a>
            <a href="#lp-club" onClick={jump}>Your club</a>
            <a href="#lp-glory" onClick={jump}>Glory</a>
            <a href="#lp-coach" onClick={jump}>Thorgrim</a>
          </nav>
          <a href={SIGN_IN} className="lp-btn primary small">
            Sign in
          </a>
        </div>
      </header>

      <section className="lp-wrap lp-hero">
        <Embers />
        <div className="lp-hero-copy lp-enter">
          <Eyebrow>Warhammer Age of Sigmar · tracker &amp; coach</Eyebrow>
          <h1>Every battle remembered. Every turn coached.</h1>
          <p className="lp-lead">
            Score your games round by round on your phone, get a plan from Thorgrim every turn, and turn each battle into a legend your club can read, react to and
            rank on the ladder.
          </p>
          <Quote>Measure your charges twice, commander. I've seen more armies lost to a failed charge than to any daemon.</Quote>
          <div className="lp-actions">
            <a href="#lp-request" className="lp-btn primary" onClick={jump}>
              Request access
            </a>
            <a href="#lp-table" className="lp-btn outline" onClick={jump}>
              See how it works
            </a>
          </div>
          <p className="lp-small">Private beta · in English and Español · keeps working without signal at the table</p>
        </div>
        <div className="lp-hero-art">
          <PhoneRound />
        </div>
      </section>

      <div className="lp-strip">
        <div className="lp-marquee">
          {[0, 1].map((copy) => (
            <div key={copy} className="lp-strip-row" aria-hidden={copy === 1 ? "true" : undefined}>
              <span>Age of Sigmar 4th edition</span>
              <span>General's Handbook 2026-27 battleplans and battle tactics</span>
              <span>Every faction's warscrolls and points</span>
              <span>Shared games on two phones</span>
              <span>Levels, achievements and weekly missions</span>
              <span>Live tournament meta</span>
            </div>
          ))}
        </div>
      </div>

      <section id="lp-table" className="lp-wrap lp-section">
        <div className="lp-intro lp-reveal">
          <Eyebrow>At the table</Eyebrow>
          <h2>Less bookkeeping. More rolling dice.</h2>
          <p className="lp-lead">Thorgrim keeps the score sheet so you can keep your eyes on the board.</p>
          <Quote>A general who forgets his command points deserves to lose them.</Quote>
        </div>
        <div className="lp-grid">
          <Feature i={0} title="Score every round" icon={<path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8 8h8 M8 12h8 M8 16h5" />}>
            Objectives, battle tactic steps, command points, fury and rage dice, with the battleplan's scoring built in. Priority, double turns and the underdog are
            worked out for you.
          </Feature>
          <Feature i={1} title="Say the score" icon={<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3" />}>
            “I held both objectives and did Strike of Siege of Ashes, Diego spent two command points.” Check the changes, tap Apply, done.
          </Feature>
          <Feature i={2} title="Chess clock" icon={<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2" />}>
            Each player's time, switching when the turn passes. Great for tournament practice, and for that one friend who measures everything twice.
          </Feature>
          <Feature i={3} title="Don't forget this phase" icon={<path d="M5 12l5 5 9-10" />}>
            The abilities and commands both armies can use right now, from their warscrolls. Mark once-per-battle abilities as used and they drop out.
          </Feature>
        </div>
        <div className="lp-grid two">
          <article className="lp-card lp-reveal">
            <h3>Play together, on two phones</h3>
            <p>
              Share a game with your opponent: you both see and edit the same score, command points and rounds, each from your own side. No signal in the club
              basement? It saves on the phone and syncs later.
            </p>
          </article>
          <article className="lp-card lp-reveal" style={{ ["--d" as string]: "120ms" }}>
            <h3>A plan for every turn</h3>
            <p>
              Before the game, Thorgrim studies both lists, the battleplan and your tactic cards. During it, each turn gets a short plan phase by phase, and you can
              tell it what just happened to re-plan.
            </p>
          </article>
        </div>
      </section>

      <section id="lp-after" className="lp-wrap lp-section lp-split">
        <div className="lp-split-copy lp-reveal">
          <Eyebrow>After the battle</Eyebrow>
          <h2>Your game, told as a legend.</h2>
          <p className="lp-lead">
            Snap the battlefield and your best models. Thorgrim turns what you recorded into an epic battle report: true to the score, grim and glorious in the
            telling. Post it to your club with the score sheet as the cover.
          </p>
          <Quote>Every battle deserves its saga. Even the ones you lose. Especially those.</Quote>
          <ul className="lp-list">
            <li>
              <b>Thorgrim's review:</b> how it was won or lost, where the points went, and one thing to try next game.
            </li>
            <li>
              <b>Your stats:</b> win rate by army and battleplan, your best and weakest battle tactics, points per round, double turns.
            </li>
            <li>
              <b>Rivalries:</b> your all-time record against every opponent, on the results and on club posts.
            </li>
          </ul>
        </div>
        <div className="lp-split-art lp-reveal">
          <ClubPost />
        </div>
      </section>

      <section id="lp-club" className="lp-wrap lp-section">
        <div className="lp-intro lp-reveal">
          <Eyebrow>Your club</Eyebrow>
          <h2>A home for your gaming group.</h2>
          <p className="lp-lead">
            Battle reports with reactions and comments, a ladder of confirmed results, club nights and tournaments, and everyone's painted armies, all in one place.
          </p>
          <Quote>A grudge settled at the table is worth ten in the book.</Quote>
        </div>
        <div className="lp-club">
          <article className="lp-card lp-event lp-reveal">
            <div className="lp-event-head">
              <span className="lp-event-date">
                <b>30</b>
                <small>OCT</small>
              </span>
              <span>
                <b className="lp-event-name">October Cup</b>
                <small>Tournament · 3 rounds · 2000 pts</small>
              </span>
            </div>
            <p className="lp-event-round">ROUND 2</p>
            <div className="lp-tables">
              <div>
                <span className="lp-table-no">T1</span>
                <span className="grow brass strong">Goy</span>
                <b className="lp-display">40-12</b>
                <span className="grow right">Diego</span>
              </div>
              <div>
                <span className="lp-table-no">T2</span>
                <span className="grow">Felipe</span>
                <span className="lp-muted">playing</span>
                <span className="grow right">Leo</span>
              </div>
              <div>
                <span className="lp-table-no">Bye</span>
                <span className="grow">Marta</span>
                <span className="lp-muted">wins by bye</span>
              </div>
            </div>
            <p>
              Members sign up with their army. The organiser pairs each round: at random first, then by standing with no rematches. Each table starts a game both
              players share, and its result goes straight to the standings.
            </p>
          </article>
          <div className="lp-club-side">
            <article className="lp-card lp-reveal" style={{ ["--d" as string]: "0ms" }}>
              <h3>Ladder &amp; seasons</h3>
              <p>Results count when both players confirm them. Start a new season whenever you like; the old one gets its recap and its champion.</p>
            </article>
            <article className="lp-card lp-reveal" style={{ ["--d" as string]: "110ms" }}>
              <h3>Challenges</h3>
              <p>“Rematch? My Gutbusters want revenge.” Accept, and the game is waiting on both your phones.</p>
            </article>
            <article className="lp-card lp-reveal" style={{ ["--d" as string]: "220ms" }}>
              <h3>Army showcase</h3>
              <p>Every member's page shows their painted armies, their ladder record and how you've done against them.</p>
            </article>
          </div>
        </div>
      </section>

      <section id="lp-glory" className="lp-wrap lp-section lp-split">
        <div className="lp-split-copy lp-reveal">
          <Eyebrow>Glory</Eyebrow>
          <h2>Every game earns you glory.</h2>
          <p className="lp-lead">
            Climb from Recruit to Legend of the Realms. Three new missions every Monday, achievements to collect (some of them secret), and a bounty on whoever leads
            the ladder.
          </p>
          <Quote>Glory is earned at the table, commander. And lost there too.</Quote>
          <ul className="lp-list">
            <li>
              <b>Who will win?</b> Predict your club's battles and follow the ones being played right now, cheering from your phone.
            </li>
            <li>
              <b>Club votes:</b> battle of the week and army of the month.
            </li>
            <li>
              <b>Your season, wrapped:</b> your nemesis, your best win and the title Thorgrim gives you, ready to share.
            </li>
          </ul>
        </div>
        <div className="lp-split-art lp-reveal">
          <GloryDemo />
        </div>
      </section>

      <section id="lp-coach" className="lp-wrap lp-section">
        <div className="lp-coach lp-reveal">
          <div className="lp-split-copy">
            <div className="lp-meet">
              <ThorgrimSeal size={72} />
              <div>
                <Eyebrow>Your coach</Eyebrow>
                <h2>Meet Thorgrim.</h2>
              </div>
            </div>
            <p className="lp-lead">
              Four centuries old, a thousand battles behind him and one very long Book of Grudges. He knows every faction's warscrolls and points, searches the core
              rules, the General's Handbook and battletomes and cites the page, runs the dice maths, and checks what is winning tournaments right now.
            </p>
            <p className="lp-small">Gruff, blunt, never wrong about a rule without saying so. Powered by Claude.</p>
          </div>
          <Chat />
        </div>
      </section>

      <section id="lp-request" className="lp-wrap lp-final lp-reveal">
        <ThorgrimSeal size={56} />
        <h2>Gather your warband.</h2>
        <p className="lp-lead">Thorgrim is in private beta. Ask for access: when it's approved, your invite arrives by email.</p>
        <Quote>The dice are waiting, commander. So am I.</Quote>
        <RequestAccess />
        <p className="lp-small">
          Already have an account or an invite? <a href={SIGN_IN}>Sign in</a>
        </p>
      </section>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-row">
          <span className="lp-brand-name">THORGRIM</span>
          <span>
            An unofficial fan-made tool, not affiliated with Games Workshop. Warhammer Age of Sigmar and its rules text belong to Games Workshop; army data from
            BSData, for personal use.
          </span>
        </div>
      </footer>
    </div>
  );
}
