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

/** Plays a short ascending two-tone chime — used when a rider/driver
 * receives a new job. */
export function playNewJobChime() {
  const audioCtx = getContext();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  const now = audioCtx.currentTime;
  beep(now, 740, 0.16, audioCtx);
  beep(now + 0.18, 988, 0.22, audioCtx);
}
