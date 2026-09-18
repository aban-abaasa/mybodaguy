import { useState, useEffect, useRef } from 'react';
import { Bike } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import DeveloperDashboard from './DeveloperDashboard';

// Passwordless entry point into DeveloperDashboard, reachable at
// /support-console?key=<token> — see
// backend/database/ADD_SUPPORT_CONSOLE.sql + ADD_SUPPORT_CONSOLE_ANY_TAB.sql
// + frontend/api/support-console/activate.js.
//
// Unlike a hidden dev-token panel, mybodaguy's DeveloperDashboard is gated
// end-to-end by a real Supabase Auth session + RLS. So instead of building
// a separate anonymous data path per tab, a correct password here calls a
// backend endpoint that mints a REAL (not anonymous) throwaway account
// using the service role already configured for this app, elevates it to
// a developer scoped to whichever tabs the admin picked, and hands back a
// real session — no Supabase "Anonymous Sign-ins" project setting needed.
// DeveloperDashboard's own existing tab-restriction logic
// (mbg_developer_self -> allowed_tabs) then does the rest, unmodified.
const MBG_API_BASE_URL = 'https://bodagoera.icanera.space';

const getTokenFromUrl = (): string => {
  try {
    return new URLSearchParams(window.location.search).get('key') || '';
  } catch {
    return '';
  }
};

type Status = 'checking' | 'invalid' | 'password_required' | 'granted';

export default function SupportConsole() {
  const [token] = useState(getTokenFromUrl);
  const [status, setStatus] = useState<Status>('checking');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [user, setUser] = useState<any>(null);

  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    if (!token) { setStatus('invalid'); setError('This link is missing its access key.'); return; }

    (async () => {
      const { data, error: err } = await supabase.rpc('mbg_support_get_link_access', { p_token: token });
      if (err || !data || data.status === 'invalid') {
        setStatus('invalid');
        setError('This link is invalid or has been revoked.');
        return;
      }
      setLabel(data.label || '');
      setStatus('password_required');
    })();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!password.trim() || verifying) return;
    setVerifying(true);
    try {
      const res = await fetch(`${MBG_API_BASE_URL}/api/support-console/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: password.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) { setError(data.error || 'Could not verify.'); return; }

      const { error: sessionErr } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessionErr) { setError(sessionErr.message); return; }

      const { data: userData } = await supabase.auth.getUser();
      setUser(userData?.user || null);
      setLabel(data.label || label);
      setStatus('granted');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  if (status === 'granted' && user) {
    return <DeveloperDashboard user={user} onSignOut={handleSignOut} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex items-center gap-2 mb-4">
          <Bike className="text-orange-500" size={24} />
          <h1 className="text-lg font-black text-slate-800">BodaGoEra Support Console</h1>
        </div>

        {status === 'checking' && <p className="text-sm text-slate-500">Loading…</p>}

        {status === 'invalid' && (
          <p className="text-sm text-rose-500">{error || 'This link is invalid or has been revoked.'}</p>
        )}

        {status === 'password_required' && (
          <>
            <p className="mb-5 text-sm text-slate-600">
              {label ? `Enter the password for "${label}".` : 'Enter the password you were given for this link.'}
            </p>
            <form onSubmit={handleSubmit} className="space-y-2">
              {error && <p className="text-xs text-rose-500">{error}</p>}
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Password" autoFocus
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
              />
              <button
                type="submit" disabled={verifying || !password.trim()}
                className="w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50 bg-gradient-to-r from-orange-500 to-yellow-500"
              >
                {verifying ? 'Checking…' : 'Enter'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
