/**
 * A short two-tone "new job" chime, synthesized with the Web Audio API
 * instead of a bundled audio file — no licensing question, no asset to
 * fetch, and it works the instant this loads.
 *
 * Browsers block audio from starting with no prior user gesture on the
 * page (autoplay policy). A rider who has tapped/scrolled the dashboard at
 * all since loading it will hear this fine; on the very first paint before
 * any interaction, the browser may silently block it — this is a browser
 * restriction, not a bug here, and there's no reliable way around it
 * without an explicit "enable sound" tap.
 */
let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

function beep(startAt: number, frequency: number, durationSec: number, audioCtx: AudioContext) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec);
}

function sweep(startAt: number, fromFreq: number, toFreq: number, durationSec: number, audioCtx: AudioContext) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(fromFreq, startAt);
  osc.frequency.linearRampToValueAtTime(toFreq, startAt + durationSec);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec);
}

// Each ringtone is a distinct oscillator sequence, synthesized live so
// there's still no bundled audio file to fetch or license — same reasoning
// as the original single chime, just with rider-selectable variety.
const RINGTONE_PATTERNS: Record<string, (audioCtx: AudioContext, startAt: number) => void> = {
  classic: (ctx, t) => {
    beep(t, 740, 0.16, ctx);
    beep(t + 0.18, 988, 0.22, ctx);
  },
  pulse: (ctx, t) => {
    beep(t, 880, 0.1, ctx);
    beep(t + 0.14, 880, 0.1, ctx);
    beep(t + 0.28, 880, 0.16, ctx);
  },
  bellroll: (ctx, t) => {
    beep(t, 1046, 0.12, ctx);
    beep(t + 0.12, 880, 0.12, ctx);
    beep(t + 0.24, 698, 0.2, ctx);
  },
  siren: (ctx, t) => {
    sweep(t, 500, 1100, 0.3, ctx);
  },
};

export interface RingtoneOption {
  id: string;
  label: string;
}

export const RINGTONES: RingtoneOption[] = [
  { id: 'classic', label: 'Classic Chime' },
  { id: 'pulse', label: 'Urgent Pulse' },
  { id: 'bellroll', label: 'Bell Roll' },
  { id: 'siren', label: 'Siren Sweep' },
];

const DEFAULT_RINGTONE_ID = 'classic';
const RINGTONE_STORAGE_KEY = 'mbg_rider_ringtone';

/** Per-device choice — riders pick this from their profile; read fresh on
 * every chime so a change takes effect without needing a page reload. */
export function getSelectedRingtoneId(): string {
  if (typeof window === 'undefined') return DEFAULT_RINGTONE_ID;
  try {
    const stored = window.localStorage.getItem(RINGTONE_STORAGE_KEY);
    return stored && RINGTONE_PATTERNS[stored] ? stored : DEFAULT_RINGTONE_ID;
  } catch {
    return DEFAULT_RINGTONE_ID;
  }
}

export function setSelectedRingtoneId(id: string) {
  if (typeof window === 'undefined' || !RINGTONE_PATTERNS[id]) return;
  try {
    window.localStorage.setItem(RINGTONE_STORAGE_KEY, id);
  } catch {}
}

/** Plays the rider's selected ringtone (or a specific one, for previewing
 * in the picker UI before committing to it) — used when a rider/driver
 * receives a new job. */
export function playNewJobChime(ringtoneId?: string) {
  const audioCtx = getContext();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  const id = ringtoneId && RINGTONE_PATTERNS[ringtoneId] ? ringtoneId : getSelectedRingtoneId();
  const pattern = RINGTONE_PATTERNS[id] || RINGTONE_PATTERNS[DEFAULT_RINGTONE_ID];
  pattern(audioCtx, audioCtx.currentTime);
}

let jobRingInterval: number | null = null;

/**
 * Keeps playing the new-job chime every 2s, the same way CallController's
 * incoming-call ringtone loops until the call is answered/declined — a
 * single chime is too easy to miss if the rider isn't looking at the
 * screen. Call stopJobRingLoop() the moment the request is accepted,
 * declined, or disappears (expired/taken by someone else).
 */
export function startJobRingLoop() {
  stopJobRingLoop();
  playNewJobChime();
  jobRingInterval = window.setInterval(playNewJobChime, 2000);
}

export function stopJobRingLoop() {
  if (jobRingInterval !== null) {
    window.clearInterval(jobRingInterval);
    jobRingInterval = null;
  }
}
