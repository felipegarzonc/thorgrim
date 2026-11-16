// Before the battle: players and their lists, game details, the battleplan
// (and who attacks), and both players' battle tactics.

import { useEffect, useRef, useState } from "react";
import { isBattleplanDoc, NUMBERED_BATTLEPLANS, SEASON_TACTICS, TACTIC_VP } from "../../../../shared/season.ts";
import { result, setAttacker, tacticSteps } from "../../../../shared/scoring.ts";
import type { ArmyList, Game, LibraryDoc, TacticProgress } from "../../../../shared/types.ts";
import { api, withKey } from "../../api.ts";
import { sideInfo } from "../../gameView.tsx";
import { Avatar, FactionPicker, Icon, RulesText, Seg, Sheet, useLoad, useMeta } from "../../ui.tsx";
import { other, type Side } from "../gameTools.tsx";
import { BattleplanCard } from "../../battleplanView.tsx";
import { shareText, shareUrl } from "../../links.ts";
import { InviteMember } from "../GameLinks.tsx";
import { BCP_HOME, bcpUrl } from "../../../../shared/bcp.ts";
import { translate } from "../../../../shared/i18n/core.ts";
import { currentLang } from "../../i18n.ts";
import { type Mutate } from "./common.tsx";

/** The join link for a shared game, and who joined. */
export function ShareGame({ game, changed }: { game: Game; changed: (g: Game) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const access = game.access;
  const players = access?.players ?? [];
  const run = async (fn: () => Promise<Game>) => {
    setBusy(true);
    try {
      await changed(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (access?.role === "player")
    return (
      <div className="stack">
        <p>
          <b>{access.ownerName || "Your opponent"}</b> shared this game with you. You both see the same score, CP, fury and rounds, and either of you can change them.
        </p>
        <p className="small muted">Your plan, turn tips and chat with Thorgrim stay yours. To leave the game, use Leave game in the menu.</p>
      </div>
    );
  const link = access?.token ? shareUrl("play", access.token) : "";
  const shareLink = async () => {
    if (navigator.share) return navigator.share({ text: shareText("Join my game on Thorgrim:", link) }).catch(() => undefined);
    await navigator.clipboard?.writeText(link);
    setCopied(true);
  };
  return (
    <div className="stack">
      <p>Send your opponent a link. Once they open it (they need a Thorgrim account), you both see the same score, CP, fury and rounds, and either of you can change them.</p>
      <p className="small muted">Each of you keeps your own plan, turn tips and chat with Thorgrim.</p>
      {!link ? (
        <button type="button" className="primary wide" disabled={busy} onClick={() => run(() => api<Game>(`/games/${game.id}/share`, { method: "POST" }))}>
          <Icon name="share" /> {busy ? "Making the link…" : "Make a join link"}
        </button>
      ) : (
        <>
          <input readOnly value={link} aria-label="Join link" onFocus={(e) => e.target.select()} />
          <button type="button" className="primary wide" onClick={shareLink}>
            <Icon name="share" /> {copied ? "Link copied" : "Send the link"}
          </button>
          <p className="small">{players.length ? `Playing with: ${players.join(", ")}` : "Nobody has joined yet."}</p>
          <button
            type="button"
            className="ghost danger"
            disabled={busy}
            onClick={() => {
              if (confirm("Stop sharing? The link stops working and the players who joined lose this game.")) void run(() => api<Game>(`/games/${game.id}/share`, { method: "DELETE" }));
            }}
          >
            Stop sharing
          </button>
        </>
      )}
      {!players.length && <InviteMember game={game} />}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}


// ---------- players ----------

export function PlayersStep({
  game,
  lists,
  mutate,
  reloadLists,
  shareChanged,
}: {
  game: Game;
  lists?: ArmyList[];
  mutate: Mutate;
  reloadLists: () => void;
  /** Set when accounts are on: invite the opponent to play on their own phone. */
  shareChanged?: (g: Game) => Promise<void>;
}) {
  return (
    <div className="stack">
      {(["me", "opponent"] as const).map((side) => (
        <PlayerBlock key={side} side={side} game={game} lists={lists} mutate={mutate} reloadLists={reloadLists} />
      ))}
      {shareChanged && (
        <section>
          <h1 className="step-heading">Play together</h1>
          <ShareGame game={game} changed={shareChanged} />
        </section>
      )}
    </div>
  );
}

export function PlayerBlock({ side, game, lists, mutate, reloadLists }: { side: Side; game: Game; lists?: ArmyList[]; mutate: Mutate; reloadLists: () => void }) {
  const info = sideInfo(game, lists, side);
  const nameKey = side === "me" ? "myName" : "opponentName";
  const listKey = side === "me" ? "myListId" : "opponentListId";
  const factionKey = side === "me" ? "myFaction" : "opponentFaction";
  const tacticsKey = side === "me" ? "tactics" : "opponentTactics";
  const [name, setName] = useState(game[nameKey] ?? "");
  const typing = useRef(false);
  // Follow name changes from the other player (or their account name once they join).
  useEffect(() => {
    if (!typing.current) setName(game[nameKey] ?? "");
  }, [game[nameKey]]);
  const [picking, setPicking] = useState(false);
  const [pasting, setPasting] = useState(false);

  const chooseList = (id: string, fresh?: ArmyList) => {
    const list = fresh ?? lists?.find((l) => l.id === id);
    mutate(
      (g) => {
        const current = (side === "me" ? g.state.tactics : g.state.opponentTactics) ?? [];
        const fromList: TacticProgress[] = (list?.tacticCards ?? []).slice(0, 2).map((card) => ({ card, affray: false, strike: false, domination: false }));
        return { ...g, [listKey]: id, state: { ...g.state, [tacticsKey]: current.length || !fromList.length ? current : fromList } };
      },
      list ? `${side === "me" ? "My" : "Opponent's"} list: ${list.name}.` : undefined,
    );
  };
  // This side's lists first; for the opponent, the lists kept for this opponent before any other.
  const forThem = (l: ArmyList) => side === "opponent" && !!l.opponentName && !!game.opponentName && l.opponentName.trim().toLowerCase() === game.opponentName.trim().toLowerCase();
  const ordered = [...(lists ?? [])].sort((a, b) => Number(forThem(b)) - Number(forThem(a)) || Number(b.owner === side) - Number(a.owner === side) || b.createdAt.localeCompare(a.createdAt));

  return (
    <section>
      <h1 className="step-heading">{side === "me" ? "You" : "Opponent"}</h1>
      <label className="field">
        <span className="field-label">{side === "me" ? "Your name" : "Opponent's name"}</span>
        <span className="field-box">
          <Icon name="user" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={() => (typing.current = true)}
            onBlur={() => {
              typing.current = false;
              if (name !== (game[nameKey] ?? "")) void mutate((g) => ({ ...g, [nameKey]: name.trim() }));
            }}
            placeholder={side === "me" ? "Your name" : "Opponent's name"}
          />
        </span>
      </label>
      <div className="list-row">
        <Icon name="lists" />
        <select value={game[listKey]} onChange={(e) => chooseList(e.target.value)} aria-label={`${side === "me" ? "Your" : "Opponent's"} army list`}>
          <option value="">Add an army list…</option>
          {ordered.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.faction || "?"}){l.owner === "opponent" && l.opponentName ? ` · ${l.opponentName}` : ""}
            </option>
          ))}
        </select>
        <button type="button" className="small" onClick={() => setPasting(true)}>
          Paste
        </button>
      </div>
      <button type="button" className="ghost faction-row" onClick={() => setPicking(true)} disabled={!!info.list}>
        {info.faction ? <Avatar faction={info.faction} /> : <span className="avatar-space" />}
        <span className="grow">
          {info.faction ? info.base : "Select a faction…"}
          {info.sub && <small className="muted">{info.sub}</small>}
          {info.list && <small className="muted">From the army list</small>}
        </span>
      </button>
      {picking && (
        <FactionPicker
          onClose={() => setPicking(false)}
          onPick={(f) => {
            setPicking(false);
            mutate((g) => ({ ...g, [factionKey]: f }));
          }}
        />
      )}
      {pasting && (
        <PasteList
          side={side}
          onClose={() => setPasting(false)}
          onSaved={(l) => {
            setPasting(false);
            reloadLists();
            chooseList(l.id, l);
          }}
        />
      )}
    </section>
  );
}

export function PasteList({ side, onClose, onSaved }: { side: Side; onClose: () => void; onSaved: (l: ArmyList) => void }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await api<ArmyList>("/lists", { method: "POST", json: { name: name || (side === "me" ? "My list" : "Opponent's list"), owner: side, rawText: text } }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Paste an army list" onClose={onClose}>
      <p className="muted small">From the GW app, New Recruit or Listhammer. Units are matched to warscrolls; the list is saved under Lists.</p>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Beastclaw Hunt" />
      </label>
      <label>
        List text
        <textarea data-gramm="false" rows={12} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="button" className="primary wide" disabled={!text.trim() || busy} onClick={save}>
        {busy ? "Saving…" : "Save list"}
      </button>
    </Sheet>
  );
}

// ---------- setup ----------

export function SetupStep({ game, mutate }: { game: Game; mutate: Mutate }) {
  const isPlayer = game.access?.role === "player";
  const [name, setName] = useState(game.name);
  return (
    <div className="stack">
      <label className="field">
        <span className="field-label">Game date</span>
        <span className="field-box">
          <Icon name="calendar" />
          <input type="date" value={game.date ?? game.createdAt.slice(0, 10)} onChange={(e) => mutate((g) => ({ ...g, date: e.target.value }))} />
        </span>
      </label>
      <label className="field">
        <span className="field-label">Game description</span>
        <span className="field-box">
          <Icon name="pencil" />
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== game.name && mutate((g) => ({ ...g, name }))} placeholder="e.g. Club night, Tuesday league" />
        </span>
      </label>

      <BcpSetup game={game} mutate={mutate} />

      <h3>Mission pack</h3>
      <div className="card list-card">
        <div className="list-item">
          <Icon name="castle" />
          <span className="grow">
            Pitched Battles 2026-27
            <small className="muted">General's Handbook · Matched Play</small>
          </span>
        </div>
        <label className="list-item">
          <Icon name="rules" />
          <select value={game.points ?? 2000} onChange={(e) => mutate((g) => ({ ...g, points: Number(e.target.value) }))} aria-label="Points">
            {[1000, 1500, 2000, 2500].map((p) => (
              <option key={p} value={p}>
                {p}pts
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        className="card danger delete-game"
        onClick={async () => {
          if (!confirm(isPlayer ? "Leave this game? It stays with the player who shared it." : "Delete this game and its conversation with Thorgrim?")) return;
          await api(`/games/${game.id}`, { method: "DELETE" });
          window.location.hash = "#/games";
        }}
      >
        {isPlayer ? "Leave game" : "Delete game"}
      </button>
    </div>
  );
}

/** A Best Coast Pairings tournament game: where it is played, and its BCP page for the result. */
export function BcpSetup({ game, mutate }: { game: Game; mutate: Mutate }) {
  const bcp = game.bcp;
  const [draft, setDraft] = useState({ event: bcp?.event ?? "", round: bcp?.round ? String(bcp.round) : "", table: bcp?.table ? String(bcp.table) : "", url: bcp?.url ?? "" });
  const [error, setError] = useState<string>();
  const save = (d = draft) => {
    if (d.url.trim() && !bcpUrl(d.url)) return setError("That isn't a Best Coast Pairings link.");
    setError(undefined);
    const num = (v: string) => (Number(v) > 0 ? Math.round(Number(v)) : undefined);
    void mutate((g) => ({ ...g, bcp: { event: d.event.trim(), round: num(d.round), table: num(d.table), url: bcpUrl(d.url) } }));
  };
  const field = (k: keyof typeof draft) => ({
    value: draft[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value })),
    onBlur: () => save(),
  });
  return (
    <section className="bcp-setup">
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={!!bcp}
          onChange={(e) => void mutate((g) => (e.target.checked ? { ...g, bcp: { event: draft.event.trim() } } : { ...g, bcp: undefined }))}
        />
        <span className="grow">
          Best Coast Pairings tournament
          <small>Score it here; at the end, the result is ready to enter in BCP.</small>
        </span>
      </label>
      {bcp && (
        <div className="stack">
          <label className="field">
            <span className="field-label">Tournament</span>
            <span className="field-box">
              <Icon name="trophy" />
              <input {...field("event")} placeholder="e.g. Iberian Masters" maxLength={80} />
            </span>
          </label>
          <div className="two-fields">
            <label className="field">
              <span className="field-label">Round</span>
              <span className="field-box">
                <input type="number" inputMode="numeric" min={1} {...field("round")} />
              </span>
            </label>
            <label className="field">
              <span className="field-label">Table</span>
              <span className="field-box">
                <input type="number" inputMode="numeric" min={1} {...field("table")} />
              </span>
            </label>
          </div>
          <label className="field">
            <span className="field-label">BCP link (optional)</span>
            <span className="field-box">
              <Icon name="share" />
              <input type="url" inputMode="url" {...field("url")} placeholder="https://www.bestcoastpairings.com/event/…" />
            </span>
          </label>
          {error && <p className="error small">{error}</p>}
        </div>
      )}
    </section>
  );
}

/** The tournament this game belongs to, with its BCP page. */
export function BcpBanner({ bcp }: { bcp: NonNullable<Game["bcp"]> }) {
  const url = bcpUrl(bcp.url) ?? BCP_HOME;
  return (
    <a className="event-banner bcp-banner" href={url} target="_blank" rel="noreferrer">
      <Icon name="trophy" />
      <span className="grow">{[`BCP · ${bcp.event || "Tournament"}`, bcp.round && `Round ${bcp.round}`, bcp.table && `Table ${bcp.table}`].filter(Boolean).join(" · ")}</span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}

/** At the end of a BCP game: the result as BCP asks for it, to copy and enter there. */
export function BcpResult({ game, names }: { game: Game; names: Record<Side, string> }) {
  const [copied, setCopied] = useState(false);
  const s = game.state;
  const rounds = s.rounds ?? [];
  const tacticPts = (side: Side) => (((side === "me" ? s.tactics : s.opponentTactics) ?? []).reduce((n, t) => n + tacticSteps(rounds, side, t.card).size, 0) * TACTIC_VP);
  const r = result(game);
  const outcome = r === "win" ? "Victory" : r === "loss" ? "Defeat" : r === "draw" ? "Draw" : "";
  const t = (x: string) => translate(x, currentLang());
  const text = [
    `${names.me} ${s.vp.me} – ${s.vp.opponent} ${names.opponent}${outcome ? ` (${t(outcome)})` : ""}`,
    `${t("Battle tactics")}: ${tacticPts("me")} – ${tacticPts("opponent")}`,
    game.battleplan && `${t("Battleplan")}: ${game.battleplan}`,
  ]
    .filter(Boolean)
    .join("\n");
  const url = bcpUrl(game.bcp?.url) ?? BCP_HOME;
  return (
    <section className="card bcp-result">
      <h2>Enter the result in BCP</h2>
      <p className="small muted">Best Coast Pairings is where the tournament keeps its standings: enter this there (both players usually confirm it in the BCP app).</p>
      <div className="bcp-score">
        <span>
          <small>{names.me}</small>
          <b>{s.vp.me}</b>
        </span>
        <span className="bcp-dash">–</span>
        <span>
          <small>{names.opponent}</small>
          <b>{s.vp.opponent}</b>
        </span>
      </div>
      <p className="small bcp-detail">
        Battle tactics: {tacticPts("me")} – {tacticPts("opponent")}
        {game.battleplan ? ` · ${game.battleplan}` : ""}
      </p>
      <div className="row">
        <a className="button primary small" href={url} target="_blank" rel="noreferrer">
          Open BCP ↗
        </a>
        <button
          type="button"
          className="small"
          onClick={() =>
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            })
          }
        >
          {copied ? "Copied" : "Copy the result"}
        </button>
      </div>
    </section>
  );
}

// ---------- battleplan ----------

/** Attacker or defender: it sets each side's starting fury (attacker 1, defender 2) and their deployment on the map. */
export function AttackerQuestion({ game, mutate }: { game: Game; mutate: Mutate }) {
  const s = game.state;
  const pick = (a: Side) => mutate((g) => ({ ...g, state: setAttacker(g.state, a) }), `Attacker: ${a === "me" ? "me" : "the opponent"}.`);
  return (
    <section className="card attacker-question" aria-label="Attacker and defender">
      <div className="question">
        <span>Who is the attacker?</span>
        <Seg label="Attacker" value={s.attacker} options={[["me", "You"], ["opponent", "Opponent"]]} onChange={pick} />
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        The attacker starts with fury 1, the defender with fury 2. Now: you {s.fury.me}, opponent {s.fury.opponent}.
      </p>
    </section>
  );
}

export function BattleplanStep({ game, mutate }: { game: Game; mutate: Mutate }) {
  const [docs] = useLoad<LibraryDoc[]>("/library");
  const [notes, setNotes] = useState(game.battleplanNotes);
  const pick = (name: string) => mutate((g) => ({ ...g, battleplan: name }), `Battleplan: ${name}.`);
  // The battleplan card / map from the rules library, matched by title: nothing to set up.
  const images = (docs ?? []).filter((d) => d.kind === "image" && isBattleplanDoc(d, game.battleplan));
  return (
    <div className="stack">
      <h1 className="step-heading">Battleplan</h1>
      <AttackerQuestion game={game} mutate={mutate} />

      <h3>Battleplan</h3>
      <button type="button" className="outline wide" onClick={() => pick(NUMBERED_BATTLEPLANS[Math.floor(Math.random() * NUMBERED_BATTLEPLANS.length)].name)}>
        <Icon name="games" /> Randomize
      </button>
      <ul className="plan-list" role="radiogroup" aria-label="Battleplan">
        {NUMBERED_BATTLEPLANS.map((b) => {
          const on = game.battleplan.toLowerCase() === b.name.toLowerCase();
          return (
            <li key={b.number}>
              <button type="button" role="radio" aria-checked={on} className={`ghost ${on ? "on" : ""}`} onClick={() => pick(b.name)}>
                <span className="plan-no">{b.number}</span>
                <span className="grow">{b.name}</span>
                <span className="radio" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      {game.battleplan && (
        <>
          <h3>{game.battleplan}</h3>
          <BattleplanCard name={game.battleplan} attacker={game.state.attacker} />
        </>
      )}

      <h3>Card photo</h3>
      {images.length ? (
        <div className="map-grid">
          {images.map((d) => (
            <figure key={d.id}>
              <a href={withKey(`/api/library/${d.id}/file`)} target="_blank" rel="noreferrer">
                <img src={withKey(`/api/library/${d.id}/file`)} alt={d.title} loading="lazy" />
              </a>
              <figcaption>{d.title}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="map-empty muted small">{game.battleplan ? `No photo of the ${game.battleplan} card in the rules library yet.` : "Pick a battleplan to see its map and rules."}</p>
      )}
      <label>
        Notes for Thorgrim
        <textarea data-gramm="false" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== game.battleplanNotes && mutate((g) => ({ ...g, battleplanNotes: notes }))} placeholder="Objective positions, terrain, deployment zones…" />
      </label>
    </div>
  );
}

// ---------- battle tactics ----------

/** Both players' battle tactics: one list at a time, with a switch on top saying how many each has picked. */
export function BothTactics({ game, mutate, names }: { game: Game; mutate: Mutate; names: Record<Side, string> }) {
  const count = (side: Side) => ((side === "me" ? game.state.tactics : game.state.opponentTactics) ?? []).length;
  const [side, setSide] = useState<Side>(count("me") >= 2 && count("opponent") < 2 ? "opponent" : "me");
  // Two cards picked for you: on to the opponent's.
  const mine = count("me");
  const before = useRef(mine);
  useEffect(() => {
    if (before.current < 2 && mine >= 2 && count("opponent") < 2) {
      setSide("opponent");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    before.current = mine;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);
  return (
    <div className="stack">
      <div className="tactic-sides" role="tablist" aria-label="Whose battle tactics">
        {(["me", "opponent"] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={side === s} className={`tactic-side ${side === s ? "on" : ""} ${count(s) >= 2 ? "done" : ""}`} onClick={() => setSide(s)}>
            <b translate="no">{s === "me" ? "You" : names.opponent || "Opponent"}</b>
            <small>{count(s) >= 2 ? <><Icon name="check" /> 2/2</> : `${count(s)}/2`}</small>
          </button>
        ))}
      </div>
      <TacticsStep key={side} game={game} side={side} mutate={mutate} />
    </div>
  );
}

export function TacticsStep({ game, side, mutate }: { game: Game; side: Side; mutate: Mutate }) {
  const meta = useMeta();
  const key = side === "me" ? "tactics" : "opponentTactics";
  const chosen = (side === "me" ? game.state.tactics : game.state.opponentTactics) ?? [];
  const isOn = (c: string) => chosen.some((t) => t.card === c);
  const toggle = (c: string) =>
    mutate(
      (g) => {
        const cur = (side === "me" ? g.state.tactics : g.state.opponentTactics) ?? [];
        const next = cur.some((t) => t.card === c) ? cur.filter((t) => t.card !== c) : [...cur, { card: c, affray: false, strike: false, domination: false }];
        return { ...g, state: { ...g.state, [key]: next } };
      },
      `${side === "me" ? "My" : "Opponent's"} battle tactics: ${isOn(c) ? "removed" : "picked"} ${c}.`,
    );
  const season = SEASON_TACTICS.filter((c) => meta?.battleTactics.some((b) => b.name === c));
  const others = (meta?.battleTactics ?? []).map((b) => b.name).filter((c) => !SEASON_TACTICS.includes(c));
  const row = (c: string, i: number) => {
    const card = meta?.battleTactics.find((b) => b.name === c);
    const on = isOn(c);
    return (
      <div key={c} className="tactic-pick">
        {i >= 0 && <span className="tactic-no">Tactic Card {i + 1}</span>}
        <label className="inline tactic-check">
          <input type="checkbox" checked={on} disabled={!on && chosen.length >= 2} onChange={() => toggle(c)} />
          <span className="grow">{c}</span>
        </label>
        <details className="card-rules">
          <summary>Card rules</summary>
          {card?.Card && <RulesText text={card.Card} />}
          {(["Affray", "Strike", "Domination"] as const).map((k) => (card?.[k] ? <RulesText key={k} text={`**${k}** — ${card[k]}`} /> : null))}
        </details>
      </div>
    );
  };
  return (
    <div className="stack">
      <div>
        <h1 className="step-heading">{side === "me" ? "Your Battle Tactics" : "Opponent's Battle Tactics"}</h1>
        <p className="muted small" style={{ margin: "0.3rem 0 0" }}>
          Pick 2 cards. Each has Affray, Strike and Domination, completed in that order for {TACTIC_VP} VP each.
        </p>
      </div>
      {season.map((c, i) => row(c, i))}
      {others.length > 0 && (
        <details>
          <summary className="muted small" style={{ cursor: "pointer", padding: "0.5rem 0" }}>
            Other cards in the army data ({others.length})
          </summary>
          {others.map((c) => row(c, -1))}
        </details>
      )}
    </div>
  );
}
