import { useCallback, useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { supabase } from '../mybodaguy/services/supabaseClient';
import { enablePushAlerts, getPushStatus, refreshPushRegistration } from '../mybodaguy/services/pushAlertsService';

const SNOOZE_KEY = 'bodagoera-push-prompt-snoozed-until';
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

const snoozed = () => {
  try { return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now(); } catch { return false; }
};

/**
 * Asks a signed-in person, once, to turn on phone alerts - the thing that lets a
 * rider hear a new ride request and a customer hear an incoming call while the
 * app is closed. Silent for people who already have alerts on (it just re-attaches
 * their device to whoever is signed in), on browsers that cannot do push, and
 * after a "Not now" for a few days. Sits at the top so it never covers the
 * install prompt at the bottom.
 */
export default function PushAlertsPrompt() {
  const [signedIn, setSignedIn] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const evaluate = useCallback(async (hasSession: boolean) => {
    setSignedIn(hasSession);
    if (!hasSession) { setVisible(false); return; }
    const status = await getPushStatus();
    if (status.enabled) { setVisible(false); refreshPushRegistration(); return; }
    setVisible(status.supported && status.permission === 'default' && !snoozed());
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => evaluate(Boolean(data.session)));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => { evaluate(Boolean(session)); });
    return () => sub.subscription.unsubscribe();
  }, [evaluate]);

  if (!signedIn || !visible) return null;

  const turnOn = async () => {
    setBusy(true);
    setError('');
    try {
      await enablePushAlerts();
      setVisible(false);
    } catch (err) {
      setError((err as Error).message || 'Could not turn on alerts.');
    } finally {
      setBusy(false);
    }
  };

  const notNow = () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* private mode */ }
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Turn on alerts"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      className="fixed inset-x-3 z-[90] mx-auto flex max-w-lg items-start gap-3 rounded-2xl border border-orange-200 bg-white p-3 shadow-2xl"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white">
        <Bell className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900">Never miss a ride or a call</p>
        <p className="text-xs text-slate-600">Get ride requests, messages and incoming calls on this phone — even when the app is closed.</p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        <div className="mt-2 flex gap-2">
          <button onClick={turnOn} disabled={busy} className="rounded-xl bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60">
            {busy ? 'Turning on…' : 'Turn on alerts'}
          </button>
          <button onClick={notNow} className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Not now</button>
        </div>
      </div>
      <button onClick={notNow} aria-label="Dismiss" className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
