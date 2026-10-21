import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ALLIANCES, allianceOf, baseFaction, type Alliance } from "../../shared/season.ts";
import { api } from "./api.ts";

export interface Meta {
  user?: { id: string; name: string; isAdmin: boolean; developer?: boolean };
  accounts?: boolean;
  source: string;
  commit: string;
  builtAt: string;
  factions: string[];
  battleTactics: { name: string; Card?: string; Affray?: string; Strike?: string; Domination?: string }[];
  coachReady: boolean;
  /** False online: the Rules page drives the reading of scanned pages. */
  backgroundJobs?: boolean;
  storage?: "file" | "supabase";
}

export const MetaContext = createContext<Meta | null>(null);
export const useMeta = () => useContext(MetaContext);

export function useLoad<T>(path: string | null, deps: unknown[] = []): [T | undefined, () => void, string | undefined] {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    api<T>(path)
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((e: Error) => setError(e.message));
  }, [path, tick, ...deps]);
  return [data, () => setTick((t) => t + 1), error];
}

export function Stepper({ label, value, onChange, min = 0 }: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label={`decrease ${label}`}>
        −
      </button>
      <span className="stepper-value">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} aria-label={`increase ${label}`}>
        +
      </button>
    </div>
  );
}

export function Card({ title, children, actions, className }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string) {
  return escapeHtml(s)
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Minimal Markdown: headings, lists, tables, bold/italic, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let table: string[][] | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const closeTable = () => {
    if (!table) return;
    const [head, ...rows] = table;
    out.push(
      `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`,
    );
    table = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      (table ??= []).push(cells);
      continue;
    }
    closeTable();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`);
    } else if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  closeTable();
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: out.join("") }} />;
}

/** Rules text from BSData uses **bold** and ***italic*** markup. */
export function RulesText({ text }: { text: string }) {
  return <Markdown text={text} />;
}

// ---------- shared pieces for the scoreboard look ----------

const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  games: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8.5 8.5h.01 M15.5 15.5h.01 M12 12h.01 M15.5 8.5h.01 M8.5 15.5h.01",
  lists: "M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7",
  rules: "M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z",
  coach: "M4 5h16v11H9l-5 4z M8 9.5h8 M8 12.5h5",
  plus: "M12 5v14 M5 12h14",
  right: "M9 6l6 6-6 6",
  left: "M15 6l-6 6 6 6",
  down: "M6 9l6 6 6-6",
  close: "M6 6l12 12 M18 6L6 18",
  check: "M5 12l5 5 9-10",
  more: "M12 5h.01 M12 12h.01 M12 19h.01",
  calc: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M8 7h8 M8.5 12h.01 M12 12h.01 M15.5 12h.01 M8.5 16h.01 M12 16h.01 M15.5 16h.01",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
  calendar: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4",
  pencil: "M4 20l4-1 11-11-3-3L5 16z",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 17l.6 1.6 1.4.4-1.4.5L19 21l-.6-1.5-1.4-.5 1.4-.4z",
  shield: "M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z",
  log: "M5 6h14 M5 12h14 M5 18h9",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
  share: "M12 4v11 M7 9l5-5 5 5 M5 14v6h14v-6",
  flag: "M5 21V4 M5 4h12l-2 4 2 4H5",
  castle: "M4 21V9h3V6h3v3h4V6h3v3h3v12z M10 21v-4h4v4",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3",
  camera: "M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  send: "M4 12l16-8-6 16-2-7z",
  club: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.5a3.5 3.5 0 0 1 0 6.5 M18 14a6.5 6.5 0 0 1 3.5 6",
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, className = "ico" }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Two-or-more option toggle, e.g. You / Opponent. */
export function Seg<T extends string>({ value, options, onChange, label }: { value?: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segbtn" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" className={value === v ? "on" : ""} aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** − value + with a caption under the value. */
export function Counter({ value, label, onChange, min = 0 }: { value: number; label: string; onChange: (v: number) => void; min?: number }) {
  return (
    <div className="counter">
      <button type="button" className="ghost" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span>
        <b>{value}</b>
        <small>{label}</small>
      </span>
      <button type="button" className="ghost" aria-label={`Increase ${label}`} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

/** Dashed group with a small caption on the border. */
export function Group({ label, children, className }: { label?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`group ${className ?? ""}`}>
      {label && <legend>{label}</legend>}
      {children}
    </fieldset>
  );
}

/** Full-screen sheet over the page (menus, pickers, the coach). */
export function Sheet({ title, onClose, children, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("sheet-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("sheet-open");
    };
  }, []);
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
      <header className="sheet-head">
        <h2>{title}</h2>
        <span className="row" style={{ margin: 0, flexWrap: "nowrap" }}>
          {actions}
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </span>
      </header>
      <div className="sheet-body">{children}</div>
    </div>
  );
}

const ALLIANCE_COLOR: Record<string, string> = { Order: "#2c5a8f", Chaos: "#7a2e2e", Death: "#35574f", Destruction: "#6b5520" };

/** Round badge with the faction's initials, coloured by grand alliance. */
export function Avatar({ faction, size = 2.4 }: { faction?: string; size?: number }) {
  const base = faction ? baseFaction(faction) : "";
  const initials = base
    .split(/[\s-]+/)
    .filter((w) => /^[A-Z]/.test(w) && !["of", "the"].includes(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <span className="avatar" style={{ width: `${size}rem`, height: `${size}rem`, fontSize: `${size * 0.38}rem`, background: ALLIANCE_COLOR[allianceOf(base) ?? ""] ?? "#3a3d44" }} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

/** Pick a faction: grand alliance first, then the army. */
export function FactionPicker({ onPick, onClose }: { onPick: (f: string) => void; onClose: () => void }) {
  const meta = useMeta();
  const [alliance, setAlliance] = useState<Alliance | null>(null);
  const all = (meta?.factions ?? []).filter((f) => !f.startsWith("۞"));
  const inAlliance = alliance ? all.filter((f) => allianceOf(f) === alliance).sort((a, b) => a.localeCompare(b)) : [];
  return (
    <Sheet title="Select a faction" onClose={onClose}>
      {alliance ? (
        <>
          <button type="button" className="ghost back-link" onClick={() => setAlliance(null)}>
            <Icon name="left" /> {alliance}
          </button>
          <ul className="pick-list">
            {inAlliance.map((f) => (
              <li key={f}>
                <button type="button" className="ghost" onClick={() => onPick(f)}>
                  <Avatar faction={f} />
                  <span className="grow">
                    {baseFaction(f)}
                    {f.includes(" - ") && <small className="muted">{f.split(" - ").slice(1).join(" - ")}</small>}
                  </span>
                  <Icon name="right" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="pick-list">
          {(Object.keys(ALLIANCES) as Alliance[]).map((a) => (
            <li key={a}>
              <button type="button" className="ghost" onClick={() => setAlliance(a)}>
                <span className="grow">{a}</span>
                <Icon name="right" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
