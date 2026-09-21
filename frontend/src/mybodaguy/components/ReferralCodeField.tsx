import { useEffect, useState } from 'react';
import {
  checkReferralCode, getPendingReferralCode, savePendingReferralCode, clearPendingReferralCode,
} from '../services/referralService';

type Status = 'idle' | 'checking' | 'valid' | 'unverified' | 'paused' | 'invalid' | 'wrong_app';

const MESSAGES: Record<Exclude<Status, 'idle'>, { text: string; cls: string }> = {
  checking: { text: 'Checking…', cls: 'text-slate-400' },
  valid: { text: '✓ Code accepted — it will be linked to your account when you sign in, with Google too.', cls: 'text-emerald-600' },
  unverified: { text: "We'll check this code when you sign in.", cls: 'text-slate-500' },
  paused: { text: "Referral rewards are paused right now, but we'll keep your code.", cls: 'text-amber-600' },
  invalid: { text: "That code isn't valid — check the spelling.", cls: 'text-red-500' },
  wrong_app: { text: 'That code belongs to a different app.', cls: 'text-red-500' },
};

// Optional "Have a referral code?" field for the sign-in / sign-up page. The code
// is saved in the browser as soon as it checks out, so it is redeemed after
// sign-in whichever way the person continues — email and password, or "Continue
// with Google" (which leaves the page and comes back). A code that arrived
// through a shared ?ref= link is pre-filled. Never required.
export default function ReferralCodeField() {
  const initial = getPendingReferralCode() ?? '';
  const [open, setOpen] = useState(!!initial);
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    const code = value.trim().toUpperCase();
    if (!code) { clearPendingReferralCode(); setStatus('idle'); return; }
    if (code.length < 4) { setStatus('idle'); return; } // still typing — don't store half a code

    let cancelled = false;
    setStatus('checking');
    const t = setTimeout(async () => {
      try {
        const res = await checkReferralCode(code);
        if (cancelled) return;
        if (res.valid) { savePendingReferralCode(code); setStatus(res.paused ? 'paused' : 'valid'); }
        else { clearPendingReferralCode(); setStatus(res.reason === 'wrong_app' ? 'wrong_app' : 'invalid'); }
      } catch {
        // Offline / server hiccup: keep it, the server checks again at redeem time.
        if (!cancelled) { savePendingReferralCode(code); setStatus('unverified'); }
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [value]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-orange-600 hover:text-orange-700 font-medium">
        Have a referral code?
      </button>
    );
  }

  const msg = status === 'idle' ? null : MESSAGES[status];
  return (
    <div>
      <label htmlFor="referral-code" className="block text-sm font-medium text-slate-700 mb-2">
        Referral code <span className="text-slate-400 font-normal">(optional — works with email or Google)</span>
      </label>
      <input
        id="referral-code"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))}
        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all font-mono tracking-widest"
        placeholder="e.g. ABANI4821"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
      />
      {msg && <p className={`text-xs mt-1.5 ${msg.cls}`}>{msg.text}</p>}
    </div>
  );
}
