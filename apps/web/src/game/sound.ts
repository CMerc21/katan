"use client";

/**
 * A tiny original sound set synthesised with WebAudio (docs/phase7.md §7):
 * dice roll, card slide, piece placed, robber move, turn chime, win fanfare.
 * Nothing is loaded from the network. Off by default; muted when animations
 * are off.
 */

export type SoundKind = "dice" | "card" | "piece" | "robber" | "turn" | "win" | "tick" | "open";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

function tone(c: AudioContext, freq: number, at: number, dur: number, type: OscillatorType, gain = 0.08): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

function noise(c: AudioContext, at: number, dur: number, gain = 0.06, filterHz = 1800): void {
  const len = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, len, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = filterHz;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(at);
}

export function playSound(kind: SoundKind): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  switch (kind) {
    case "dice":
      for (let i = 0; i < 5; i++) noise(c, t + i * 0.07, 0.06, 0.05, 900 + i * 300);
      tone(c, 220, t + 0.38, 0.12, "triangle", 0.04);
      break;
    case "card":
      noise(c, t, 0.12, 0.03, 3000);
      break;
    case "piece":
      tone(c, 160, t, 0.09, "square", 0.05);
      noise(c, t, 0.05, 0.04, 600);
      break;
    case "robber":
      tone(c, 110, t, 0.25, "sawtooth", 0.04);
      tone(c, 82, t + 0.12, 0.25, "sawtooth", 0.04);
      break;
    case "turn":
      tone(c, 660, t, 0.18, "sine", 0.06);
      tone(c, 990, t + 0.12, 0.25, "sine", 0.05);
      break;
    case "win":
      [523, 659, 784, 1047].forEach((f, i) => tone(c, f, t + i * 0.16, 0.5, "triangle", 0.07));
      tone(c, 1319, t + 0.7, 0.9, "triangle", 0.06);
      break;
    // HUD cues (docs/phase12.md §8): a soft tick when a numeral bumps, a short breath when a panel opens.
    case "tick":
      tone(c, 1760, t, 0.04, "sine", 0.025);
      break;
    case "open":
      noise(c, t, 0.08, 0.02, 2400);
      tone(c, 880, t, 0.08, "sine", 0.02);
      break;
    default: {
      const exhaustive: never = kind;
      throw new Error(String(exhaustive));
    }
  }
}

/**
 * Listen for the HUD's `hud:tick` / `hud:open` window events and play the
 * matching cue while `enabled()` says sound is on. Returns the unsubscribe.
 */
export function installHudSounds(enabled: () => boolean): () => void {
  if (typeof window === "undefined") return () => undefined;
  let last = 0;
  const onTick = () => {
    const now = performance.now();
    if (!enabled() || now - last < 60) return; // many numerals may bump in one render
    last = now;
    playSound("tick");
  };
  const onOpen = () => enabled() && playSound("open");
  window.addEventListener("hud:tick", onTick);
  window.addEventListener("hud:open", onOpen);
  return () => {
    window.removeEventListener("hud:tick", onTick);
    window.removeEventListener("hud:open", onOpen);
  };
}
