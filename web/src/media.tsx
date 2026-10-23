// Voice and camera for the table: dictate what happened, hear Thorgrim read
// out loud, snap the board.

import { useEffect, useRef, useState } from "react";
import { currentLang } from "./i18n.ts";
import { feedback } from "./sound.ts";
import { Icon } from "./ui.tsx";

// The Web Speech API isn't in TypeScript's DOM types; this is the part we use.
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;
const SpeechRecognition = (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

/**
 * Microphone button: tap, speak, and the words are added to the text.
 * Uses the phone's language; Thorgrim understands Spanish or English.
 */
export function VoiceButton({ onText, label = "Dictate" }: { onText: (text: string) => void; label?: string }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const rec = useRef<Recognition | null>(null);
  useEffect(() => () => rec.current?.stop(), []);
  if (!SpeechRecognition) return null;

  const toggle = () => {
    if (listening) return rec.current?.stop();
    setError(undefined);
    const r = new SpeechRecognition();
    r.lang = navigator.language || "es-ES";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const text = Array.from(e.results)
        .slice(e.resultIndex)
        .filter((res) => res.isFinal)
        .map((res) => res[0].transcript)
        .join(" ")
        .trim();
      if (text) onText(text);
    };
    r.onerror = (e) => setError(e.error === "not-allowed" ? "Allow the microphone for this site to dictate." : e.error === "no-speech" ? "Didn't hear anything." : undefined);
    r.onend = () => {
      setListening(false);
      feedback("voiceOff");
    };
    rec.current = r;
    setListening(true);
    feedback("voiceOn");
    r.start();
  };

  return (
    <span className="voice">
      <button type="button" className={`icon mic ${listening ? "on" : ""}`} aria-pressed={listening} aria-label={listening ? "Stop dictating" : label} onClick={toggle}>
        <Icon name="mic" />
      </button>
      {listening && <span className="small listening">Listening…</span>}
      {error && <span className="small error">{error}</span>}
    </span>
  );
}

/** Text as it should sound: no markdown marks, links or tables. */
export function spoken(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_`~>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;

/** The phone's voice for a language, the best one it has. */
function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const voices = synth?.getVoices() ?? [];
  const mine = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  return mine.find((v) => /natural|neural|enhanced|premium|google/i.test(v.name)) ?? mine.find((v) => v.localService) ?? mine[0];
}

/**
 * A speaker button: Thorgrim reads the text out loud with the phone's voice
 * (a little low and slow: he's a dwarf), so the player can keep their hands
 * on the dice. Tap again to stop.
 */
export function SpeakButton({ text, lang, label = "Read aloud" }: { text: string; lang?: "en" | "es"; label?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const mine = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => () => void (mine.current && synth?.cancel()), []);
  if (!synth) return null;
  const toggle = () => {
    synth.cancel();
    if (speaking) return setSpeaking(false);
    const l = lang ?? currentLang();
    const u = new SpeechSynthesisUtterance(spoken(text));
    u.lang = l === "es" ? "es-ES" : "en-GB";
    const v = voiceFor(l);
    if (v) u.voice = v;
    u.pitch = 0.8;
    u.rate = 0.95;
    u.onend = u.onerror = () => {
      if (mine.current === u) setSpeaking(false);
    };
    mine.current = u;
    setSpeaking(true);
    synth.speak(u);
  };
  return (
    <button type="button" className={`icon speak ${speaking ? "on" : ""}`} aria-pressed={speaking} aria-label={speaking ? "Stop reading" : label} title={speaking ? "Stop reading" : label} onClick={toggle}>
      <Icon name="speaker" />
    </button>
  );
}

/** Shrink a phone photo to a JPEG of at most `max` px on its long side (keeps uploads small). */
export async function shrinkPhoto(file: File, max = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read the photo"))), "image/jpeg", 0.82));
}
