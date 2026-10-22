// Voice and camera input for the table: dictate what happened, snap the board.

import { useEffect, useRef, useState } from "react";
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
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
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
