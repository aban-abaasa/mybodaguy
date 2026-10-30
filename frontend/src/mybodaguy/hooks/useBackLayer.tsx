import { useEffect, useRef } from 'react';

// Phone Back button support for a router-less SPA.
//
// Every "deeper" screen (a sub-tab, an opened menu sheet, a modal, the sign-in
// page, a role you switched to…) is a *layer*: while it is showing it owns one
// browser-history entry. The phone's Back button (or the browser's) pops that
// entry and the layer closes itself instead of the whole app leaving the page.
// When the app closes a layer by itself (an X button, an in-app back arrow) its
// entry is removed again so history never drifts out of step with the screen.

interface Layer {
  id: number;
  close: () => void;
  pushed: boolean;
  dead: boolean; // closed by the app while a newer layer sat above it; its entry is invisible
}

// Date-seeded so ids from before a page reload (still stored in history.state) are always older than new ones.
let nextId = Date.now();
const stack: Layer[] = [];
const pending: Layer[] = [];
let ignorePops = 0;
let ignoreTimer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

const stateId = (): number => {
  const s = window.history.state as { mbgLayer?: number } | null;
  return s && typeof s.mbgLayer === 'number' ? s.mbgLayer : 0;
};

function push(layer: Layer) {
  window.history.pushState({ ...(window.history.state ?? {}), mbgLayer: layer.id }, '');
  layer.pushed = true;
  stack.push(layer);
}

function flushPending() {
  while (pending.length && ignorePops === 0) push(pending.shift()!);
}

// Move history back n entries *without* treating the popstate as a user Back press.
function silentBack(n: number) {
  if (n <= 0) return;
  ignorePops++;
  window.history.go(-n);
  // If the browser never reports the pop (nothing to go back to), don't wedge new layers forever.
  clearTimeout(ignoreTimer);
  ignoreTimer = setTimeout(() => { ignorePops = 0; flushPending(); }, 600);
}

function onPopState() {
  if (ignorePops > 0) {
    ignorePops--;
    if (ignorePops === 0) { clearTimeout(ignoreTimer); flushPending(); }
    return;
  }
  const target = stateId();
  const top = stack[stack.length - 1];

  // Forward onto an entry that no longer has a layer — bounce straight back.
  if (target > (top ? top.id : 0)) { silentBack(1); return; }

  // Close every layer opened after the entry we landed on (a multi-step Back closes several).
  const closing: Layer[] = [];
  while (stack.length && stack[stack.length - 1].id > target) closing.push(stack.pop()!);
  closing.forEach((l) => { if (!l.dead) l.close(); });

  // Landed on an entry whose layer was already closed by the app: keep going back.
  const landed = stack[stack.length - 1];
  if (landed && landed.id === target && landed.dead) { stack.pop(); window.history.back(); }
}

function makeLayer(close: () => void): Layer {
  return { id: nextId++, close, pushed: false, dead: false };
}

function open(layer: Layer) {
  if (!listening) { window.addEventListener('popstate', onPopState); listening = true; }
  if (ignorePops > 0) pending.push(layer); else push(layer);
}

function shut(layer: Layer) {
  const queued = pending.indexOf(layer);
  if (queued !== -1) { pending.splice(queued, 1); return; }
  const i = stack.indexOf(layer);
  if (i === -1) return; // already popped by the user's Back
  const above = stack.slice(i + 1);
  if (above.every((l) => l.dead)) {
    // Nothing visible above it: remove its entry, any invisible ones above, and any invisible
    // ones now exposed beneath, in one silent step.
    stack.splice(i);
    let n = 1 + above.length;
    while (stack.length && stack[stack.length - 1].dead) { stack.pop(); n++; }
    silentBack(n);
  } else {
    layer.dead = true; // a live layer sits above — its entry is left behind, hidden
  }
}

/**
 * While `active` is true the phone/browser Back button calls `onBack` (which
 * should set `active` to false) instead of leaving the page.
 */
export function useBackLayer(active: boolean, onBack: () => void) {
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!active) return;
    const layer = makeLayer(() => handler.current());
    open(layer);
    return () => shut(layer);
  }, [active]);
}

/**
 * Same, for a trail that can be several screens deep: keeps `depth` history
 * entries, and each Back press calls `onBack` once (which should shrink `depth` by one).
 */
export function useBackDepth(depth: number, onBack: () => void) {
  const handler = useRef(onBack);
  handler.current = onBack;
  const layers = useRef<Layer[]>([]);
  useEffect(() => {
    while (layers.current.length < depth) {
      const layer = makeLayer(() => handler.current());
      layers.current.push(layer);
      open(layer);
    }
    while (layers.current.length > depth) shut(layers.current.pop()!);
  }, [depth]);
  useEffect(() => () => { layers.current.splice(0).reverse().forEach(shut); }, []);
}

/** Drop-in form for components that are only mounted while their screen is showing (modals, sheets). */
export function BackLayer({ onBack }: { onBack: () => void }) {
  useBackLayer(true, onBack);
  return null;
}
