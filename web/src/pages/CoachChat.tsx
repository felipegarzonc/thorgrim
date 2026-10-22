import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api.ts";
import { VoiceButton } from "../media.tsx";
import { Card, Markdown, useMeta } from "../ui.tsx";
import { moment } from "../analytics.tsx";

interface Entry {
  role: "user" | "coach";
  text: string;
  tools?: string[];
  at: string;
}

const PRESET_LABEL: Record<string, string> = {
  pregame: "Pre-game brief requested",
  review: "Post-game review requested",
};

export function CoachChat(props: {
  convoId: string;
  title: string;
  placeholder: string;
  presets?: [string, "pregame" | "review"][];
  quick?: string[];
  /** Shown while the conversation is empty. */
  intro?: ReactNode;
}) {
  const meta = useMeta();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Entry[]>(`/coach/${props.convoId}`).then(setEntries);
  }, [props.convoId]);
  // Braces matter: newer Chrome returns a promise from scrollIntoView, and an
  // effect that returns anything but a function breaks React on cleanup.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, busy]);

  const send = async (body: { question?: string; preset?: string }) => {
    setBusy(true);
    setError(undefined);
    const shown = body.question ?? PRESET_LABEL[body.preset ?? ""] ?? "";
    setEntries((e) => [...e, { role: "user", text: shown, at: new Date().toISOString() }]);
    setQuestion("");
    moment("Asked Thorgrim");
    try {
      const answer = await api<Entry>(`/coach/${props.convoId}`, { method: "POST", json: body });
      // Reload so the stored transcript (with preset prompts) is shown.
      const all = await api<Entry[]>(`/coach/${props.convoId}`);
      setEntries(all.length ? all : (e) => [...e, answer]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirm("Start a fresh conversation? Thorgrim forgets this chat (the game itself is kept).")) return;
    await api(`/coach/${props.convoId}`, { method: "DELETE" });
    setEntries([]);
  };

  return (
    <Card
      title={props.title}
      actions={
        entries.length > 0 && (
          <button type="button" className="small" onClick={reset}>
            New chat
          </button>
        )
      }
    >
      {meta && (!meta.coachReady || error?.includes("API key")) && <ApiKeySetup />}
      {entries.length === 0 && props.intro}
      <div className="chat">
        {entries.map((e, i) => (
          <div key={i} className={`bubble ${e.role}`} translate="no">
            {e.role === "coach" ? <Markdown text={e.text} /> : <p>{e.text.length > 400 ? `${e.text.slice(0, 400)}…` : e.text}</p>}
            {e.tools && e.tools.length > 0 && <p className="tools">used: {e.tools.join(", ")}</p>}
          </div>
        ))}
        {busy && <div className="bubble coach thinking">Thinking… (checking rules and running the numbers)</div>}
        <div ref={bottom} />
      </div>
      {error && <p className="error">{error}</p>}
      {(props.presets || props.quick) && (
        <div className="chips">
          {props.presets?.map(([label, preset]) => (
            <button key={preset} type="button" className="chip strong" disabled={busy} onClick={() => send({ preset })}>
              {label}
            </button>
          ))}
          {props.quick?.map((q) => (
            <button key={q} type="button" className="chip" disabled={busy} onClick={() => send({ question: q })}>
              {q}
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <textarea data-gramm="false"
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && question.trim()) send({ question });
          }}
          placeholder={props.placeholder}
        />
        <VoiceButton label="Dictate a question" onText={(t) => setQuestion((q) => (q ? `${q} ${t}` : t))} />
        <button type="button" className="primary" disabled={busy || !question.trim()} onClick={() => send({ question })}>
          Ask
        </button>
      </div>
    </Card>
  );
}

/** Paste the Claude API key once; the server saves it to .env. */
export function ApiKeySetup() {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api("/settings/api-key", { method: "POST", json: { key } });
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="key-setup">
      <h3 style={{ marginTop: 0 }}>Wake Thorgrim</h3>
      <p className="small">
        Thorgrim runs on Claude and needs your API key (it starts with <code>sk-ant-</code>). Get one at{" "}
        <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
          platform.claude.com
        </a>
        , then paste it here. It's saved only on this computer.
      </p>
      <div className="row" style={{ margin: 0 }}>
        <label style={{ flex: 1, margin: 0 }}>
          <span className="muted small">Claude API key</span>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && key && save()} placeholder="sk-ant-…" />
        </label>
        <button type="button" className="primary" disabled={!key.trim() || busy} onClick={save}>
          {busy ? "Saving…" : "Save key"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
