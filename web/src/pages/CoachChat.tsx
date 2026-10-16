import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { Card, Markdown, useMeta } from "../ui.tsx";

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
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [entries, busy]);

  const send = async (body: { question?: string; preset?: string }) => {
    setBusy(true);
    setError(undefined);
    const shown = body.question ?? PRESET_LABEL[body.preset ?? ""] ?? "";
    setEntries((e) => [...e, { role: "user", text: shown, at: new Date().toISOString() }]);
    setQuestion("");
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
    if (!confirm("Start a fresh conversation? The coach forgets this chat (the game itself is kept).")) return;
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
      {meta && !meta.coachReady && <p className="warning">Set ANTHROPIC_API_KEY in .env on the server to enable the coach.</p>}
      <div className="chat">
        {entries.map((e, i) => (
          <div key={i} className={`bubble ${e.role}`}>
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
        <textarea
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && question.trim()) send({ question });
          }}
          placeholder={props.placeholder}
        />
        <button type="button" className="primary" disabled={busy || !question.trim()} onClick={() => send({ question })}>
          Ask
        </button>
      </div>
    </Card>
  );
}
