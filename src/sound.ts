// Tiny synthesized sound effects with WebAudio (no files to load). The context starts on the
// first tap, since phones only allow audio after a user gesture.
const MUTE_KEY = 'idle-driver-muted';

let ctx: AudioContext | undefined;
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage blocked */ }

export function isMuted(): boolean { return muted; }

export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* storage blocked */ }
}

/** Call from a tap handler so the browser lets us play sound. */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

/** One note: a frequency sweep with a quick attack and exponential fade. */
function tone(freq: number, start: number, length: number, opts: { type?: OscillatorType; to?: number; gain?: number } = {}) {
  if (!ctx || muted || ctx.state !== 'running') return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t + length);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

/** A burst of noise, for the crash. */
function noise(start: number, length: number, gain: number) {
  if (!ctx || muted || ctx.state !== 'running') return;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + start);
}

export const sfx = {
  takeover() { tone(880, 0, 0.18, { type: 'triangle' }); tone(660, 0.2, 0.25, { type: 'triangle' }); },
  crash() { noise(0, 0.9, 0.5); tone(220, 0, 0.8, { type: 'sawtooth', to: 40, gain: 0.15 }); tone(1600, 1.2, 0.15, { gain: 0.08 }); tone(2000, 1.4, 0.15, { gain: 0.08 }); },
  buy() { tone(660, 0, 0.09, { type: 'square', gain: 0.08 }); tone(990, 0.08, 0.14, { type: 'square', gain: 0.08 }); },
  levelUp() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.25, { type: 'triangle', gain: 0.15 })); },
  honk() { tone(392, 0, 0.35, { type: 'sawtooth', gain: 0.1 }); tone(494, 0, 0.35, { type: 'sawtooth', gain: 0.1 }); },
  landmark() { tone(1047, 0, 0.3, { gain: 0.1 }); tone(1319, 0.12, 0.4, { gain: 0.1 }); },
  arrive() { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.18, 0.9, { type: 'triangle', gain: 0.12 })); },
};
