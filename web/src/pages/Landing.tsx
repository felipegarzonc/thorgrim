// The landing page: what visitors who aren't signed in see first (and
// #/welcome for anyone). Its buttons lead to sign-in; invite and join links
// skip it.

import type { MouseEvent, ReactNode } from "react";

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

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <article className="lp-card">
      <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="lp-icon">
        {icon}
      </svg>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}

/** The round screen, drawn as a phone. */
function PhoneRound() {
  return (
    <div className="lp-phone" role="img" aria-label="The round screen: both armies' score, command points and fury, the chess clock and Thorgrim's plan for the turn">
      <div className="lp-phone-screen">
        <div className="lp-ph-top">
          <b>38-20 Goy vs Diego</b>
          <span>Round 3</span>
        </div>
        <div className="lp-ph-scores">
          <div className="lp-ph-side active">
            <b>Goy</b>
            <small>Ogor Mawtribes</small>
            <span className="lp-ph-tag">YOUR TURN</span>
            <span className="lp-ph-vp">38</span>
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
          <span>Start</span>
          <span>Hero</span>
          <span>Move</span>
          <span className="on">Charge</span>
          <span>Combat</span>
        </div>
        <div className="lp-ph-clock">
          <span>
            <small>You</small>
            <b className="on">41:07</b>
          </span>
          <span>
            <small>Diego</small>
            <b>38:52</b>
          </span>
          <em>Pause</em>
        </div>
        <div className="lp-ph-tip">
          <b>Thorgrim · Charge</b>
          <p>Mournfangs into objective B, now. Hold it and the round is yours. Keep the Stonehorn back: they'll counter-charge, mark my words.</p>
        </div>
        <div className="lp-ph-next">Next: Combat</div>
      </div>
    </div>
  );
}

const cells = (xs: number[]) => (
  <span className="lp-cells">
    {xs.map((x, i) => (
      <span key={i}>{x}</span>
    ))}
  </span>
);

/** A battle report as it shows in the club feed. */
function ClubPost() {
  return (
    <article className="lp-post" role="img" aria-label="A battle report in the club feed: the score, the score sheet and the start of the story">
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
            <b>66–11</b>
          </span>
          <span>
            <small>Result</small>
            <b className="brass">Victory</b>
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
          {cells([10, 10, 6, 10, 10])}
          <b>46</b>
        </div>
        <div className="lp-sheet-row">
          <span className="grow">Blazing Onslaught</span>
          {cells([0, 0, 5, 0, 5])}
          <b>10/15</b>
        </div>
        <b>Diego</b>
        <div className="lp-sheet-row">
          <span className="grow">Objectives</span>
          {cells([0, 3, 3, 0, 0])}
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

export function Landing() {
  return (
    <div className="landing">
      <header className="lp-nav">
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
            <a href="#lp-coach" onClick={jump}>Thorgrim</a>
          </nav>
          <a href={SIGN_IN} className="lp-btn primary small">
            Sign in
          </a>
        </div>
      </header>

      <section className="lp-wrap lp-hero">
        <div className="lp-hero-copy">
          <Eyebrow>Warhammer Age of Sigmar · tracker &amp; coach</Eyebrow>
          <h1>Every battle remembered. Every turn coached.</h1>
          <p className="lp-lead">
            Score your games round by round on your phone, get a plan from Thorgrim every turn, and turn each battle into a legend your club can read, react to and
            rank on the ladder.
          </p>
          <Quote>Measure your charges twice, commander. I've seen more armies lost to a failed charge than to any daemon.</Quote>
          <div className="lp-actions">
            <a href={SIGN_IN} className="lp-btn primary">
              Start a game
            </a>
            <a href="#lp-table" className="lp-btn outline" onClick={jump}>
              See how it works
            </a>
          </div>
          <p className="lp-small">In English and Español · keeps working without signal at the table · invite-only for your club</p>
        </div>
        <div className="lp-hero-art">
          <PhoneRound />
        </div>
      </section>

      <div className="lp-strip">
        <div className="lp-wrap lp-strip-row">
          <span>Age of Sigmar 4th edition</span>
          <span>General's Handbook 2026-27 battleplans and battle tactics</span>
          <span>Every faction's warscrolls and points</span>
          <span>Shared games on two phones</span>
        </div>
      </div>

      <section id="lp-table" className="lp-wrap lp-section">
        <div className="lp-intro">
          <Eyebrow>At the table</Eyebrow>
          <h2>Less bookkeeping. More rolling dice.</h2>
          <p className="lp-lead">Thorgrim keeps the score sheet so you can keep your eyes on the board.</p>
          <Quote>A general who forgets his command points deserves to lose them.</Quote>
        </div>
        <div className="lp-grid">
          <Feature title="Score every round" icon={<path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8 8h8 M8 12h8 M8 16h5" />}>
            Objectives, battle tactic steps, command points, fury and rage dice, with the battleplan's scoring built in. Priority, double turns and the underdog are
            worked out for you.
          </Feature>
          <Feature title="Say the score" icon={<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3" />}>
            “I held both objectives and did Strike of Siege of Ashes, Diego spent two command points.” Check the changes, tap Apply, done.
          </Feature>
          <Feature title="Chess clock" icon={<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2" />}>
            Each player's time, switching when the turn passes. Great for tournament practice, and for that one friend who measures everything twice.
          </Feature>
          <Feature title="Don't forget this phase" icon={<path d="M5 12l5 5 9-10" />}>
            The abilities and commands both armies can use right now, from their warscrolls. Mark once-per-battle abilities as used and they drop out.
          </Feature>
        </div>
        <div className="lp-grid two">
          <article className="lp-card">
            <h3>Play together, on two phones</h3>
            <p>
              Share a game with your opponent: you both see and edit the same score, command points and rounds, each from your own side. No signal in the club
              basement? It saves on the phone and syncs later.
            </p>
          </article>
          <article className="lp-card">
            <h3>A plan for every turn</h3>
            <p>
              Before the game, Thorgrim studies both lists, the battleplan and your tactic cards. During it, each turn gets a short plan phase by phase, and you can
              tell it what just happened to re-plan.
            </p>
          </article>
        </div>
      </section>

      <section id="lp-after" className="lp-wrap lp-section lp-split">
        <div className="lp-split-copy">
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
        <div className="lp-split-art">
          <ClubPost />
        </div>
      </section>

      <section id="lp-club" className="lp-wrap lp-section">
        <div className="lp-intro">
          <Eyebrow>Your club</Eyebrow>
          <h2>A home for your gaming group.</h2>
          <p className="lp-lead">
            Battle reports with reactions and comments, a ladder of confirmed results, club nights and tournaments, and everyone's painted armies, all in one place.
          </p>
          <Quote>A grudge settled at the table is worth ten in the book.</Quote>
        </div>
        <div className="lp-club">
          <article className="lp-card lp-event">
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
            <article className="lp-card">
              <h3>Ladder &amp; seasons</h3>
              <p>Results count when both players confirm them. Start a new season whenever you like; the old one gets its recap and its champion.</p>
            </article>
            <article className="lp-card">
              <h3>Challenges</h3>
              <p>“Rematch? My Gutbusters want revenge.” Accept, and the game is waiting on both your phones.</p>
            </article>
            <article className="lp-card">
              <h3>Army showcase</h3>
              <p>Every member's page shows their painted armies, their ladder record and how you've done against them.</p>
            </article>
          </div>
        </div>
      </section>

      <section id="lp-coach" className="lp-wrap lp-section">
        <div className="lp-coach">
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
          <div className="lp-chat">
            <p className="lp-bubble me">When can I use Counter-charge and what does it cost?</p>
            <p className="lp-bubble coach">
              Hrm. In your foe's charge phase, one of your units that isn't already in combat can charge them back. Costs 2 command points, so keep two in your purse.{" "}
              <span className="brass">Core rules · Commands</span>
            </p>
            <p className="lp-bubble me">I failed a 3" charge with my Stonehorn.</p>
            <p className="lp-bubble coach">By my beard. That one goes in the Book of Grudges. Now: next turn, it charges first.</p>
          </div>
        </div>
      </section>

      <section className="lp-wrap lp-final">
        <ThorgrimSeal size={56} />
        <h2>Gather your warband.</h2>
        <p className="lp-lead">Thorgrim runs one club at a time. Ask your club's admin for an invite link, then sign in and start your first game.</p>
        <Quote>The dice are waiting, commander. So am I.</Quote>
        <div className="lp-actions center">
          <a href={SIGN_IN} className="lp-btn primary">
            Sign in
          </a>
        </div>
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
