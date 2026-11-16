// The landing page: what visitors who aren't signed in see first (and
// #/welcome for anyone). Its buttons lead to sign-in; invite and join links
// skip it.

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { publicApi } from "../api.ts";
import { currentLang } from "../i18n.ts";
import { moment } from "../analytics.tsx";
import { useReveals, Embers, SIGN_IN, jump, ThorgrimSeal, Quote, Eyebrow, Feature } from "./landing/common.tsx";
import { PhoneRound, ClubPost, Chat, GloryDemo } from "./landing/demos.tsx";

// ---------- motion ----------
// Sections and cards rise in as they scroll into view (class "lp-reveal",
// staggered with --d); the phone plays a turn; the report fills its score
// sheet; the chat types. All still when the visitor asks for reduced motion.

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
