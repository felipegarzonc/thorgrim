// The moving examples on the landing page: a round on a phone, a club post, a chat with Thorgrim, and glory.

import { useEffect, useState, type PointerEvent, type ReactNode } from "react";
import { CountUp, reducedMotion } from "../../motion.tsx";
import { useSeen, useVisible } from "./common.tsx";

export const PHASES = ["Start", "Hero", "Move", "Charge", "Combat"];
export const TIPS = [
  "Count your command points before you spend one: two for Counter-charge, always.",
  "Gorger Mawpack behind the ruins. Unseen until they bite.",
  "Mournfangs to the edge of objective B. Not one inch further.",
  "Mournfangs into objective B, now. Hold it and the round is yours. Keep the Stonehorn back: they'll counter-charge, mark my words.",
  "Gluttons into the Sentinels first. Pile in towards the objective.",
];
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The round screen, drawn as a phone, playing a turn: phases go by, the clock runs, Thorgrim writes. */
export function PhoneRound() {
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

export const cells = (xs: number[], row: number) => (
  <span className="lp-cells">
    {xs.map((x, i) => (
      <span key={i} style={{ ["--d" as string]: `${(row * 5 + i) * 90}ms` }}>
        {x}
      </span>
    ))}
  </span>
);

/** A battle report as it shows in the club feed: its score counts up and its sheet fills in when it comes into view. */
export function ClubPost() {
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

export const CHAT: { who: "me" | "coach"; text: ReactNode }[] = [
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
export function Chat() {
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
export function GloryDemo() {
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
