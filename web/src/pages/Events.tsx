// Club nights and tournaments: the list (a Club tab) and one event's page
// (#/club/event/<id>): sign up, the rounds' tables, standings, and the
// organiser's controls (pair the next round, enter paper results, finish).

import { useState } from "react";
import type { ClubEvent, EventStanding, TableResult } from "../../../shared/events.ts";
import { baseFaction } from "../../../shared/season.ts";
import { api } from "../api.ts";
import { Avatar, FactionPicker, Icon, Seg, Sheet, useLoad, useMeta } from "../ui.tsx";

export interface EventView extends ClubEvent {
  results: Record<string, TableResult & { confirmed: boolean }>;
  standings: EventStanding[];
  canManage: boolean;
  joined: boolean;
}

const when = (e: Pick<ClubEvent, "date" | "time">) =>
  `${new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}${e.time ? ` · ${e.time}` : ""}`;
const kindLabel = (e: ClubEvent) => (e.kind === "tournament" ? `Tournament · ${e.rounds ?? 3} rounds` : "Club night");

export function EventsList() {
  const [events, reload] = useLoad<EventView[]>("/events");
  const [creating, setCreating] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="stack">
      <button type="button" className="primary wide" onClick={() => setCreating(true)}>
        <Icon name="plus" /> Organise a club night or tournament
      </button>
      {!events && <p className="muted">Loading…</p>}
      {events && !events.length && (
        <section className="card empty">
          <h2>No events yet</h2>
          <p className="muted">Organise a club night or a tournament: members sign up, you pair the rounds, and the results go onto the ladder.</p>
        </section>
      )}
      {events?.map((e) => (
        <a key={e.id} className={`card event-card ${e.finishedAt || e.date < today ? "past" : ""}`} href={`#/club/event/${e.id}`}>
          <span className="event-date">
            <b>{new Date(`${e.date}T12:00:00`).getDate()}</b>
            <small>{new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</small>
          </span>
          <span className="grow">
            <b className="event-name">{e.name}</b>
            <small className="muted">
              {kindLabel(e)}
              {e.time ? ` · ${e.time}` : ""}
              {e.place ? ` · ${e.place}` : ""}
            </small>
            <small className="muted">
              {e.players.length} signed up{e.finishedAt && e.standings[0] ? ` · won by ${e.standings[0].name}` : ""}
            </small>
          </span>
          {e.joined && !e.finishedAt && <span className="badge">You're in</span>}
          <Icon name="right" />
        </a>
      ))}
      {creating && (
        <EventForm
          onClose={() => setCreating(false)}
          onSaved={(e) => {
            setCreating(false);
            reload();
            window.location.hash = `#/club/event/${e.id}`;
          }}
        />
      )}
    </div>
  );
}

function EventForm({ event, onClose, onSaved }: { event?: EventView; onClose: () => void; onSaved: (e: EventView) => void }) {
  const [kind, setKind] = useState<ClubEvent["kind"]>(event?.kind ?? "night");
  const [name, setName] = useState(event?.name ?? "");
  const [date, setDate] = useState(event?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(event?.time ?? "");
  const [place, setPlace] = useState(event?.place ?? "");
  const [points, setPoints] = useState(String(event?.points ?? 2000));
  const [rounds, setRounds] = useState(String(event?.rounds ?? 3));
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const body = { kind, name, date, time, place, points: Number(points), rounds: Number(rounds), notes };
      onSaved(await api<EventView>(event ? `/events/${event.id}` : "/events", { method: event ? "PATCH" : "POST", json: body }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={event ? "Edit event" : "New event"} onClose={onClose}>
      <form
        className="stack event-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {!event && (
          <Seg
            label="Kind"
            value={kind}
            options={[
              ["night", "Club night"],
              ["tournament", "Tournament"],
            ]}
            onChange={setKind}
          />
        )}
        <label className="field">
          <span className="field-label">Name</span>
          <span className="field-box">
            <Icon name="flag" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "tournament" ? "e.g. October Cup" : "e.g. Thursday games"} required />
          </span>
        </label>
        <div className="two-fields">
          <label className="field">
            <span className="field-label">Date</span>
            <span className="field-box">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </span>
          </label>
          <label className="field">
            <span className="field-label">Time</span>
            <span className="field-box">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </span>
          </label>
        </div>
        <label className="field">
          <span className="field-label">Where</span>
          <span className="field-box">
            <Icon name="map" />
            <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. The club, Calle Mayor 3" />
          </span>
        </label>
        <div className="two-fields">
          <label className="field">
            <span className="field-label">Points</span>
            <span className="field-box">
              <input type="number" inputMode="numeric" min={500} step={500} value={points} onChange={(e) => setPoints(e.target.value)} />
            </span>
          </label>
          {kind === "tournament" && (
            <label className="field">
              <span className="field-label">Rounds</span>
              <span className="field-box">
                <input type="number" inputMode="numeric" min={1} max={8} value={rounds} onChange={(e) => setRounds(e.target.value)} />
              </span>
            </label>
          )}
        </div>
        <label className="field">
          <span className="field-label">Notes</span>
          <span className="field-box">
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Missions, list deadline, entry fee…" />
          </span>
        </label>
        {error && <p className="error small">{error}</p>}
        <button type="submit" className="primary wide" disabled={busy || !name.trim()}>
          {busy ? "Saving…" : event ? "Save" : "Create and tell the club"}
        </button>
      </form>
    </Sheet>
  );
}

export function EventPage({ id }: { id: string }) {
  const myId = useMeta()?.user?.id;
  const [loaded, , loadError] = useLoad<EventView>(`/events/${id}`);
  const [event, setEvent] = useState<EventView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scoring, setScoring] = useState<{ round: number; table: number }>();
  const e = event ?? loaded;
  if (loadError) return <p className="muted">{loadError}</p>;
  if (!e) return <p className="muted">Loading…</p>;

  const name = (pid: string | null) => e.players.find((p) => p.id === pid)?.name ?? "?";
  const faction = (pid?: string | null) => e.players.find((p) => p.id === pid)?.faction;
  const act = async (fn: () => Promise<EventView | void>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError(undefined);
    try {
      const v = await fn();
      if (v) setEvent(v);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const join = (f?: string) => act(() => api<EventView>(`/events/${e.id}/join`, { method: "POST", json: { faction: f } }));
  const playGame = (round: number, table: number) =>
    act(async () => {
      const { id: gameId } = await api<{ id: string }>(`/events/${e.id}/tables/${round}/${table}/game`, { method: "POST" });
      window.location.hash = `#/games/${gameId}/players`;
    });
  const last = e.pairings[e.pairings.length - 1];
  const roundsLeft = e.kind === "tournament" ? (e.rounds ?? 3) - e.pairings.length : 1;
  // A tournament's next round waits for every result of the last one.
  const waiting = e.kind === "tournament" && last ? last.tables.filter((t, i) => t.b !== null && !e.results[`${last.round}:${i}`]?.confirmed).length : 0;

  return (
    <div className="stack event-page">
      <a className="small" href="#/club/events">
        ← All events
      </a>
      <section className="card event-head">
        <span className="badge">{kindLabel(e)}</span>
        <h1>{e.name}</h1>
        <p className="event-when">
          <Icon name="calendar" /> {when(e)}
          {e.place && (
            <>
              {" "}
              · <Icon name="map" /> {e.place}
            </>
          )}
        </p>
        <p className="small muted">
          {e.points} pts · organised by {e.organiser.name}
          {e.finishedAt ? " · finished" : ""}
        </p>
        {e.notes && <p className="event-notes">{e.notes}</p>}
        {!e.finishedAt &&
          (e.joined ? (
            <div className="row">
              <span className="badge good">You're signed up{faction(myId) ? ` · ${baseFaction(faction(myId)!)}` : ""}</span>
              <button type="button" className="ghost small" onClick={() => setPicking(true)}>
                Change army
              </button>
              {!e.pairings.length && (
                <button type="button" className="ghost small" disabled={busy} onClick={() => act(() => api<EventView>(`/events/${e.id}/join`, { method: "DELETE" }))}>
                  Leave
                </button>
              )}
            </div>
          ) : (
            <button type="button" className="primary wide" disabled={busy} onClick={() => setPicking(true)}>
              Sign up
            </button>
          ))}
      </section>
      {error && <p className="error">{error}</p>}

      {e.kind === "tournament" && e.pairings.length > 0 && (
        <section>
          <h2 className="section-title">{e.finishedAt ? "Final standings" : "Standings"}</h2>
          <div className="card ladder">
            {e.standings.map((s, i) => (
              <div key={s.id} className={`ladder-row event-row ${s.id === myId ? "me" : ""}`}>
                <span className="ladder-rank">{e.finishedAt && i === 0 ? <Icon name="trophy" /> : i + 1}</span>
                <Avatar faction={faction(s.id)} size={1.6} />
                <span className="ladder-name">
                  <b>{s.name}</b>
                  <small>
                    {s.won}-{s.drawn}-{s.lost}
                    {s.byes ? ` · ${s.byes} bye` : ""} · VP {s.vpFor - s.vpAgainst >= 0 ? "+" : ""}
                    {s.vpFor - s.vpAgainst}
                  </small>
                </span>
                <b className="ladder-pts">{s.points}</b>
              </div>
            ))}
          </div>
        </section>
      )}

      {[...e.pairings].reverse().map((r) => (
        <section key={r.round}>
          <h2 className="section-title">Round {r.round}</h2>
          <div className="card tables">
            {r.tables.map((t, i) => {
              const res = e.results[`${r.round}:${i}`];
              const mine = t.a === myId || t.b === myId;
              return (
                <div key={i} className={`event-table ${mine ? "mine" : ""}`}>
                  <span className="table-no">{t.b === null ? "Bye" : `T${i + 1}`}</span>
                  <span className="table-side">
                    <Avatar faction={faction(t.a)} size={1.4} />
                    <span className={res && res.a > res.b ? "won" : ""}>{name(t.a)}</span>
                  </span>
                  {t.b === null ? (
                    <span className="muted small grow">wins by bye</span>
                  ) : (
                    <>
                      <b className="table-score">{res ? `${res.a}-${res.b}` : "vs"}</b>
                      <span className="table-side right">
                        <span className={res && res.b > res.a ? "won" : ""}>{name(t.b)}</span>
                        <Avatar faction={faction(t.b)} size={1.4} />
                      </span>
                    </>
                  )}
                  {t.b !== null && !res && (mine || e.canManage) && !e.finishedAt && (
                    <span className="table-actions">
                      {mine && (
                        <button type="button" className="small" disabled={busy} onClick={() => playGame(r.round, i)}>
                          {t.gameId ? "Open game" : "Play"}
                        </button>
                      )}
                      {e.canManage && (
                        <button type="button" className="small ghost" onClick={() => setScoring({ round: r.round, table: i })}>
                          Result
                        </button>
                      )}
                    </span>
                  )}
                  {t.b !== null && !res && t.gameId && <small className="muted table-note">Game started · counts once both players confirm the result</small>}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section>
        <h2 className="section-title">Players ({e.players.length})</h2>
        <div className="card rivals">
          {!e.players.length && <p className="muted small">Nobody yet.</p>}
          {e.players.map((p) => (
            <a key={p.id} className="rival rival-link" href={`#/club/member/${p.id}`}>
              <Avatar faction={p.faction} size={1.6} />
              <span className="grow">
                {p.name}
                {p.faction && <small className="muted">{p.faction}</small>}
              </span>
            </a>
          ))}
        </div>
      </section>

      {e.canManage && !e.finishedAt && (
        <section className="card organiser">
          <h2>Organiser</h2>
          {roundsLeft > 0 && (
            <button type="button" className="primary wide" disabled={busy || e.players.length < 2 || waiting > 0} onClick={() => act(() => api<EventView>(`/events/${e.id}/pair`, { method: "POST" }))}>
              <Icon name="swords" /> Pair round {(last?.round ?? 0) + 1}
            </button>
          )}
          {roundsLeft > 0 && waiting > 0 && (
            <p className="small muted">
              Waiting for {waiting} result{waiting > 1 ? "s" : ""} of round {last!.round}.
            </p>
          )}
          {roundsLeft <= 0 && e.kind === "tournament" && !waiting && <p className="small">All rounds played: finish the event to announce the winner.</p>}
          {e.kind === "night" && e.pairings.length > 0 && (
            <button type="button" className="outline wide" disabled={busy} onClick={() => act(() => api<EventView>(`/events/${e.id}/pair`, { method: "POST" }))}>
              Pair another round
            </button>
          )}
          {last && (
            <button type="button" className="ghost small" disabled={busy} onClick={() => act(() => api<EventView>(`/events/${e.id}/pair`, { method: "DELETE" }), `Undo the pairings of round ${last.round}?`)}>
              Undo round {last.round} pairings
            </button>
          )}
          <div className="row">
            <button type="button" className="ghost small" onClick={() => setEditing(true)}>
              <Icon name="pencil" /> Edit
            </button>
            {e.pairings.length > 0 && (
              <button type="button" className="ghost small" disabled={busy} onClick={() => act(() => api<EventView>(`/events/${e.id}/finish`, { method: "POST" }), "Finish the event and announce the winner?")}>
                <Icon name="trophy" /> Finish
              </button>
            )}
            <button
              type="button"
              className="ghost small danger"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await api(`/events/${e.id}`, { method: "DELETE" });
                  window.location.hash = "#/club/events";
                }, "Delete this event? Results already on the ladder stay there.")
              }
            >
              <Icon name="trash" /> Delete
            </button>
          </div>
          <p className="small muted">
            Round 1 is drawn at random; later rounds pair players on the same points, with no rematches. Games played in the app count once both players
            confirm them. For games on paper, enter the result: it counts straight away, on the ladder too.
          </p>
        </section>
      )}

      {picking && (
        <FactionPicker
          onPick={(f) => {
            setPicking(false);
            void join(f);
          }}
          onClose={() => {
            setPicking(false);
            if (!e.joined) void join();
          }}
        />
      )}
      {editing && (
        <EventForm
          event={e}
          onClose={() => setEditing(false)}
          onSaved={(v) => {
            setEditing(false);
            setEvent(v);
          }}
        />
      )}
      {scoring && (
        <ResultSheet
          names={[name(e.pairings.find((r) => r.round === scoring.round)!.tables[scoring.table].a), name(e.pairings.find((r) => r.round === scoring.round)!.tables[scoring.table].b)]}
          onClose={() => setScoring(undefined)}
          onSave={(a, b) => {
            setScoring(undefined);
            void act(() => api<EventView>(`/events/${e.id}/tables/${scoring.round}/${scoring.table}/result`, { method: "PUT", json: { a, b } }));
          }}
        />
      )}
    </div>
  );
}

function ResultSheet({ names, onClose, onSave }: { names: [string, string]; onClose: () => void; onSave: (a: number, b: number) => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  return (
    <Sheet title="Table result" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(ev) => {
          ev.preventDefault();
          onSave(Number(a), Number(b));
        }}
      >
        <div className="two-fields">
          {[
            [names[0], a, setA],
            [names[1], b, setB],
          ].map(([n, v, set], i) => (
            <label key={i} className="field">
              <span className="field-label">{n as string} VP</span>
              <span className="field-box">
                <input type="number" inputMode="numeric" min={0} value={v as string} onChange={(x) => (set as (s: string) => void)(x.target.value)} required />
              </span>
            </label>
          ))}
        </div>
        <button type="submit" className="primary wide" disabled={a === "" || b === ""}>
          Save result
        </button>
      </form>
    </Sheet>
  );
}
