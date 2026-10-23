// Sounds from the dwarven forge, for what happens at the table: a coin for
// points, a war drum when the turn passes, a horn for a new round, anvil and
// brass for a level up. All of them are made here with Web Audio (no files:
// nothing to download, they work offline, nobody else's sounds).
//
// `feedback(cue)` is what pages call: it buzzes (Android) and plays the cue
// if the player's setting allows it. "important" (the default) plays what
// helps at the table and the big moments; "all" adds taps, votes and
// reactions. Nothing plays while the app is hidden, and on iPhone the silent
// switch mutes it. Sounds only play on the phone that acted: what the
// opponent does on their phone doesn't ring on yours.

import { buzz } from "./motion.tsx";

export type SoundLevel = "off" | "important" | "all";

export type Cue =
  | "tap"
  | "phase"
  | "score"
  | "tactic"
  | "turn"
  | "round"
  | "victory"
  | "defeat"
  | "draw"
  | "levelUp"
  | "achievement"
  | "mission"
  | "notice"
  | "cheer"
  | "coach"
  | "voiceOn"
  | "voiceOff"
  | "clockStart"
  | "clockPause";

/** What each cue needs to be heard, and how long the phone buzzes with it. */
export const CUES: Record<Cue, { level: Exclude<SoundLevel, "off">; buzz: number }> = {
  tap: { level: "all", buzz: 10 },
  phase: { level: "all", buzz: 8 },
  score: { level: "important", buzz: 18 },
  tactic: { level: "important", buzz: 24 },
  turn: { level: "important", buzz: 8 },
  round: { level: "important", buzz: 20 },
  victory: { level: "important", buzz: 0 },
  defeat: { level: "important", buzz: 0 },
  draw: { level: "important", buzz: 0 },
  levelUp: { level: "important", buzz: 0 },
  achievement: { level: "important", buzz: 0 },
  mission: { level: "important", buzz: 0 },
  notice: { level: "important", buzz: 0 },
  cheer: { level: "all", buzz: 12 },
  coach: { level: "important", buzz: 0 },
  voiceOn: { level: "important", buzz: 0 },
  voiceOff: { level: "important", buzz: 0 },
  clockStart: { level: "important", buzz: 10 },
  clockPause: { level: "important", buzz: 10 },
};

/** Whether a cue plays at a setting. */
export const heard = (cue: Cue, level: SoundLevel) => level === "all" || (level === "important" && CUES[cue].level === "important");

const LEVEL_KEY = "thorgrim-sound";
const VOLUME_KEY = "thorgrim-volume";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function keep(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: just this visit */
  }
}

let level: SoundLevel = (["off", "important", "all"] as const).find((l) => l === stored(LEVEL_KEY)) ?? "important";
let volume = Math.min(1, Math.max(0, Number(stored(VOLUME_KEY) ?? 0.7)));

export const soundLevel = () => level;
export const soundVolume = () => volume;
export function setSoundLevel(l: SoundLevel) {
  level = l;
  keep(LEVEL_KEY, l);
}
export function setSoundVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  keep(VOLUME_KEY, String(volume));
  if (master && ctx) master.gain.setValueAtTime(volume, ctx.currentTime);
}

// ---------- the synth ----------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  // iPhone: "ambient" follows the silent switch and doesn't stop the player's music.
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = "ambient";
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  return ctx;
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  /** Glide to this frequency over the tone. */
  to?: number;
  /** Through a low-pass filter at this frequency (brass, drums). */
  lowpass?: number;
  detune?: number;
}

/** One note: `at` seconds from now, `dur` seconds long, fading out. */
function tone(c: AudioContext, freq: number, at: number, dur: number, o: ToneOpts = {}) {
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = c.createGain();
  const peak = o.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out: AudioNode = osc;
  if (o.lowpass) {
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.lowpass;
    osc.connect(f);
    out = f;
  }
  out.connect(g).connect(master!);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** A burst of filtered noise: drum skins, clicks, a crowd. */
function noise(c: AudioContext, at: number, dur: number, o: { freq: number; type?: BiquadFilterType; q?: number; gain?: number; attack?: number }) {
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = o.type ?? "bandpass";
  f.frequency.value = o.freq;
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.3, t + (o.attack ?? 0.003));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t);
}

/** A struck bell: a few inharmonic partials that ring and fade. */
const bell = (c: AudioContext, freq: number, at: number, dur = 0.8, gain = 0.18) =>
  [1, 2.76, 5.4].forEach((k, i) => tone(c, freq * k, at, dur / (i + 1), { gain: gain / (i + 1.5) }));

/** Hammer on an anvil: a hard clang. */
const anvil = (c: AudioContext, at: number, gain = 0.22) => {
  [1, 2.42, 3.91, 5.33].forEach((k, i) => tone(c, 620 * k, at, 0.5 / (i + 1), { type: i ? "sine" : "triangle", gain: gain / (i + 1) }));
  noise(c, at, 0.04, { freq: 3500, type: "highpass", gain: gain * 0.8 });
};

/** A brass note: a filtered sawtooth that swells. */
const brass = (c: AudioContext, freq: number, at: number, dur: number, gain = 0.14) => {
  tone(c, freq, at, dur, { type: "sawtooth", gain, attack: 0.06, lowpass: 1400 });
  tone(c, freq, at, dur, { type: "sawtooth", gain: gain * 0.6, attack: 0.08, lowpass: 1400, detune: 9 });
};

/** A war drum: a low thump that drops in pitch, and the skin. */
const drum = (c: AudioContext, at: number, gain = 0.5) => {
  tone(c, 120, at, 0.4, { to: 50, gain });
  noise(c, at, 0.12, { freq: 400, type: "lowpass", gain: gain * 0.4 });
};

const D3 = 146.83;
const F3 = 174.61;
const A3 = 220;
const D4 = 293.66;
const Fs4 = 369.99;
const A4 = 440;
const D5 = 587.33;

const SOUNDS: Record<Cue, (c: AudioContext) => void> = {
  tap: (c) => tone(c, 1200, 0, 0.04, { to: 900, gain: 0.08 }),
  phase: (c) => (tone(c, 660, 0, 0.05, { type: "triangle", gain: 0.12 }), tone(c, 880, 0.06, 0.05, { type: "triangle", gain: 0.1 })),
  // A coin dropped in the tally.
  score: (c) => (tone(c, 988, 0, 0.08, { type: "square", gain: 0.11, lowpass: 4000 }), tone(c, 1319, 0.07, 0.25, { type: "square", gain: 0.11, lowpass: 4000 })),
  // A rune lighting up.
  tactic: (c) => (bell(c, 880, 0, 0.7), bell(c, 1319, 0.09, 0.9)),
  turn: (c) => (drum(c, 0), drum(c, 0.22, 0.35)),
  round: (c) => (drum(c, 0, 0.35), brass(c, D3, 0.05, 0.9), brass(c, A3, 0.05, 0.9, 0.1)),
  victory: (c) => {
    brass(c, D4, 0, 0.18);
    brass(c, A4, 0.16, 0.18);
    brass(c, D5, 0.32, 1.1, 0.12);
    brass(c, Fs4, 0.32, 1.1, 0.09);
    brass(c, A4, 0.32, 1.1, 0.09);
    anvil(c, 0.32, 0.15);
  },
  // Low and dignified: the dead are honoured, then the forge burns on.
  defeat: (c) => [D3, F3, A3].forEach((f, i) => tone(c, f, i * 0.12, 1.4, { type: "triangle", gain: 0.12, attack: 0.08, lowpass: 900 })),
  draw: (c) => (tone(c, A3, 0, 0.6, { type: "triangle", gain: 0.12, attack: 0.04 }), tone(c, 329.63, 0.2, 0.8, { type: "triangle", gain: 0.12, attack: 0.04 })),
  levelUp: (c) => {
    anvil(c, 0);
    anvil(c, 0.18, 0.18);
    // A short choir: a soft major chord.
    [D4, Fs4, A4, D5].forEach((f, i) => tone(c, f, 0.36, 1.3, { type: "sawtooth", gain: 0.05, attack: 0.25, lowpass: 1100, detune: i % 2 ? 6 : -6 }));
  },
  achievement: (c) => (anvil(c, 0, 0.16), bell(c, 1175, 0.12, 0.9)),
  mission: (c) => [784, 988, 1175].forEach((f, i) => bell(c, f, i * 0.09, 0.7, 0.14)),
  notice: (c) => (bell(c, 1047, 0, 0.5, 0.09), bell(c, 1319, 0.12, 0.6, 0.08)),
  // The crowd at the table next door.
  cheer: (c) => (noise(c, 0, 0.7, { freq: 1100, q: 0.7, gain: 0.12, attack: 0.15 }), noise(c, 0.05, 0.6, { freq: 2200, q: 1.2, gain: 0.06, attack: 0.12 })),
  // Thorgrim answers: a soft rune.
  coach: (c) => (bell(c, 659, 0, 0.8, 0.1), bell(c, 988, 0.1, 0.9, 0.08)),
  voiceOn: (c) => tone(c, 880, 0, 0.12, { to: 1320, gain: 0.12 }),
  voiceOff: (c) => tone(c, 1320, 0, 0.12, { to: 880, gain: 0.1 }),
  clockStart: (c) => (noise(c, 0, 0.03, { freq: 2500, gain: 0.2 }), noise(c, 0.11, 0.03, { freq: 1800, gain: 0.2 })),
  clockPause: (c) => noise(c, 0, 0.04, { freq: 1200, gain: 0.2 }),
};

/** Plays a cue now, if the setting allows it (and only then). */
export function play(cue: Cue, opts: { force?: boolean } = {}) {
  if (!opts.force && (!heard(cue, level) || document.hidden)) return;
  // For the end-to-end tests, and anything else that wants to know.
  window.dispatchEvent(new CustomEvent("thorgrim-sound", { detail: cue }));
  try {
    const c = audio();
    if (!c || !master) return;
    if (c.state === "suspended") void c.resume();
    SOUNDS[cue](c);
  } catch {
    /* no sound here: fine */
  }
}

/** What happened, felt and heard: a buzz and the cue's sound. */
export function feedback(cue: Cue) {
  if (CUES[cue].buzz) buzz(CUES[cue].buzz);
  play(cue);
}

/** Once per visit for each key: a result or a level up shown on several screens is heard once. */
const done = new Set<string>();
export function feedbackOnce(key: string, cue: Cue) {
  if (done.has(key)) return;
  done.add(key);
  feedback(cue);
}
