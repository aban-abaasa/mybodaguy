/**
 * Ringtones for the two things this app rings a phone for: a new job
 * request waiting to be accepted, and an incoming voice/video call. Both
 * share the same preset engine (short oscillator patterns synthesized with
 * the Web Audio API — no bundled audio file, no licensing question, works
 * the instant this loads) and the same "upload your own song" path (stored
 * as a Blob in IndexedDB, not localStorage — a compressed song can run into
 * several MB, well past localStorage's ~5MB per-origin quota, and storing
 * it as a base64 string would add another 33% on top of that).
 *
 * Browsers block audio from starting with no prior user gesture on the
 * page (autoplay policy). A rider/customer who has tapped/scrolled the
 * dashboard at all since loading it will hear this fine; on the very first
 * paint before any interaction, the browser may silently block it — this
 * is a browser restriction, not a bug here, and there's no reliable way
 * around it without an explicit "enable sound" tap.
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

// Each preset is a distinct oscillator sequence, shared by both the new-job
// ringtone and the incoming-call ringtone pickers.
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

/** Selecting this id means "play whatever song the user uploaded" instead of a preset. */
export const CUSTOM_RINGTONE_ID = 'custom';

const DEFAULT_RINGTONE_ID = 'classic';

// ---------------------------------------------------------------------------
// Custom (uploaded) ringtones — one slot per purpose ('job' or 'call'),
// stored as a Blob in IndexedDB with a small localStorage entry for the
// selected id + the file's display name.
// ---------------------------------------------------------------------------

type RingtonePurpose = 'job' | 'call';

const DB_NAME = 'mbg-ringtones';
const STORE_NAME = 'files';
const MAX_CUSTOM_RINGTONE_BYTES = 8 * 1024 * 1024; // ~8MB — generous for a compressed song, small enough to store reliably on-device
const AUDIO_EXTENSION_RE = /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|weba)$/i;

const SELECTED_ID_KEY: Record<RingtonePurpose, string> = {
  job: 'mbg_rider_ringtone',
  call: 'mbg_call_ringtone',
};
const CUSTOM_META_KEY: Record<RingtonePurpose, string> = {
  job: 'mbg_rider_ringtone_custom_meta',
  call: 'mbg_call_ringtone_custom_meta',
};

function openRingtoneDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: Blob): Promise<void> {
  const db = await openRingtoneDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet(key: string): Promise<Blob | undefined> {
  const db = await openRingtoneDb();
  const result = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

async function idbDelete(key: string): Promise<void> {
  const db = await openRingtoneDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export interface CustomRingtoneMeta {
  name: string;
}

function getCustomMeta(purpose: RingtonePurpose): CustomRingtoneMeta | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CUSTOM_META_KEY[purpose]);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getSelectedId(purpose: RingtonePurpose): string {
  if (typeof window === 'undefined') return DEFAULT_RINGTONE_ID;
  try {
    const stored = window.localStorage.getItem(SELECTED_ID_KEY[purpose]);
    if (stored === CUSTOM_RINGTONE_ID) return CUSTOM_RINGTONE_ID;
    return stored && RINGTONE_PATTERNS[stored] ? stored : DEFAULT_RINGTONE_ID;
  } catch {
    return DEFAULT_RINGTONE_ID;
  }
}

function setSelectedId(purpose: RingtonePurpose, id: string) {
  if (typeof window === 'undefined') return;
  if (id !== CUSTOM_RINGTONE_ID && !RINGTONE_PATTERNS[id]) return;
  try {
    window.localStorage.setItem(SELECTED_ID_KEY[purpose], id);
  } catch {}
}

/** Validates and stores an uploaded file as the custom ringtone for the given purpose. Throws with a user-facing message on rejection. */
async function saveCustomRingtone(purpose: RingtonePurpose, file: File): Promise<void> {
  const looksLikeAudio = file.type.startsWith('audio/') || AUDIO_EXTENSION_RE.test(file.name);
  if (!looksLikeAudio) {
    throw new Error("That file doesn't look like an audio file.");
  }
  if (file.size > MAX_CUSTOM_RINGTONE_BYTES) {
    throw new Error(`Keep it under ${Math.floor(MAX_CUSTOM_RINGTONE_BYTES / (1024 * 1024))}MB — trim the song or pick a shorter clip.`);
  }
  await idbPut(purpose, file);
  window.localStorage.setItem(CUSTOM_META_KEY[purpose], JSON.stringify({ name: file.name }));
  setSelectedId(purpose, CUSTOM_RINGTONE_ID);
}

async function removeCustomRingtone(purpose: RingtonePurpose): Promise<void> {
  await idbDelete(purpose).catch(() => {});
  try {
    window.localStorage.removeItem(CUSTOM_META_KEY[purpose]);
  } catch {}
  if (getSelectedId(purpose) === CUSTOM_RINGTONE_ID) {
    setSelectedId(purpose, DEFAULT_RINGTONE_ID);
  }
}

// A short, single preview play of a purpose's custom ringtone (used when the
// picker UI's tile for it is tapped) — stops itself after a few seconds so
// tapping through the list doesn't play an entire song each time.
const previewAudioEls: Partial<Record<RingtonePurpose, HTMLAudioElement>> = {};

function playCustomPreview(purpose: RingtonePurpose) {
  const existing = previewAudioEls[purpose];
  if (existing) {
    existing.pause();
    delete previewAudioEls[purpose];
  }
  idbGet(purpose).then(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    previewAudioEls[purpose] = audio;
    audio.play().catch(() => {});
    window.setTimeout(() => {
      audio.pause();
      URL.revokeObjectURL(url);
      if (previewAudioEls[purpose] === audio) delete previewAudioEls[purpose];
    }, 4000);
  }).catch(() => {});
}

function playPresetOrCustom(purpose: RingtonePurpose, ringtoneId?: string) {
  const id = ringtoneId && (RINGTONE_PATTERNS[ringtoneId] || ringtoneId === CUSTOM_RINGTONE_ID)
    ? ringtoneId
    : getSelectedId(purpose);

  if (id === CUSTOM_RINGTONE_ID) {
    playCustomPreview(purpose);
    return;
  }

  const audioCtx = getContext();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  const pattern = RINGTONE_PATTERNS[id] || RINGTONE_PATTERNS[DEFAULT_RINGTONE_ID];
  pattern(audioCtx, audioCtx.currentTime);
}

// A looping ring — either the interval-based preset chime, or a real <audio>
// element looping the uploaded song from the start, same as a phone ringtone.
interface RingLoopHandle {
  intervalId: number | null;
  audioEl: HTMLAudioElement | null;
  objectUrl: string | null;
}
const activeLoops: Partial<Record<RingtonePurpose, RingLoopHandle>> = {};

function stopLoop(purpose: RingtonePurpose) {
  const handle = activeLoops[purpose];
  if (!handle) return;
  if (handle.intervalId !== null) window.clearInterval(handle.intervalId);
  if (handle.audioEl) {
    handle.audioEl.pause();
    handle.audioEl.src = '';
  }
  if (handle.objectUrl) URL.revokeObjectURL(handle.objectUrl);
  delete activeLoops[purpose];
}

function startPresetLoop(purpose: RingtonePurpose, intervalMs: number) {
  playPresetOrCustom(purpose);
  const intervalId = window.setInterval(() => playPresetOrCustom(purpose), intervalMs);
  activeLoops[purpose] = { intervalId, audioEl: null, objectUrl: null };
}

function startLoop(purpose: RingtonePurpose, intervalMs: number) {
  stopLoop(purpose);
  const id = getSelectedId(purpose);
  if (id !== CUSTOM_RINGTONE_ID) {
    startPresetLoop(purpose, intervalMs);
    return;
  }
  idbGet(purpose).then(blob => {
    if (!blob) {
      startPresetLoop(purpose, intervalMs);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    const audioEl = new Audio(objectUrl);
    audioEl.loop = true;
    audioEl.play().catch(() => {
      // Decoding failed or playback was blocked — fall back to a preset
      // rather than leaving the ring silent.
      stopLoop(purpose);
      startPresetLoop(purpose, intervalMs);
    });
    activeLoops[purpose] = { intervalId: null, audioEl, objectUrl };
  }).catch(() => startPresetLoop(purpose, intervalMs));
}

// ---------------------------------------------------------------------------
// New-job ringtone (rider/driver) — plays on repeat while a ride request is
// waiting to be accepted.
// ---------------------------------------------------------------------------

/** Per-device choice — riders pick this from their profile; read fresh on every chime so a change takes effect without needing a page reload. */
export const getSelectedRingtoneId = () => getSelectedId('job');
export const setSelectedRingtoneId = (id: string) => setSelectedId('job', id);
export const getCustomRingtoneMeta = () => getCustomMeta('job');
export const saveCustomJobRingtone = (file: File) => saveCustomRingtone('job', file);
export const removeCustomJobRingtone = () => removeCustomRingtone('job');

/** Plays the rider's selected ringtone (or a specific one, for previewing in the picker UI before committing to it) — used when a rider/driver receives a new job. */
export function playNewJobChime(ringtoneId?: string) {
  playPresetOrCustom('job', ringtoneId);
}

/**
 * Keeps ringing every 2s (presets) or loops the uploaded song from the
 * start (custom) — the same way CallController's incoming-call ringtone
 * loops until the call is answered/declined — a single chime is too easy
 * to miss if the rider isn't looking at the screen. Call stopJobRingLoop()
 * the moment the request is accepted, declined, or disappears
 * (expired/taken by someone else).
 */
export function startJobRingLoop() {
  startLoop('job', 2000);
}

export function stopJobRingLoop() {
  stopLoop('job');
}

// ---------------------------------------------------------------------------
// Incoming-call ringtone (any role) — plays on repeat while a voice/video
// call from a ride's other party is waiting to be answered.
// ---------------------------------------------------------------------------

export const getSelectedCallRingtoneId = () => getSelectedId('call');
export const setSelectedCallRingtoneId = (id: string) => setSelectedId('call', id);
export const getCustomCallRingtoneMeta = () => getCustomMeta('call');
export const saveCustomCallRingtone = (file: File) => saveCustomRingtone('call', file);
export const removeCustomCallRingtone = () => removeCustomRingtone('call');

/** Plays the selected incoming-call ringtone once — used to preview a choice in the picker UI. */
export function playCallRingtonePreview(ringtoneId?: string) {
  playPresetOrCustom('call', ringtoneId);
}

/** Starts the looping incoming-call ring (preset every 1.2s, or the uploaded song on loop). */
export function startCallRingLoop() {
  startLoop('call', 1200);
}

export function stopCallRingLoop() {
  stopLoop('call');
}
