import { useState } from 'react';

/**
 * Decoy dashboard — where a flagged IP gets rerouted (see the reputation
 * check called from SignInPage's canweGuard and the decoy endpoints under
 * frontend/api/**).
 *
 * Hard rule: this component must NEVER import authService, userService, or
 * any Supabase client. Everything on this page is a hardcoded literal — an
 * attacker who got this far should be able to click around, "see" a rider
 * dashboard, "log in", and never once touch real data or a real session.
 */

const FAKE_RIDES = [
  { id: 'RIDE-3021', label: 'Airport pickup — Entebbe', amount: 'UGX 45,000', time: 'Today, 9:12 AM' },
  { id: 'RIDE-3018', label: 'City delivery', amount: 'UGX 12,000', time: 'Today, 8:40 AM' },
  { id: 'RIDE-3009', label: 'Cross-town ride', amount: 'UGX 18,500', time: 'Yesterday, 6:05 PM' },
];

export default function DecoyPortal() {
  const [view, setView] = useState<'login' | 'dashboard'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleFakeLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setView('dashboard');
  };

  if (view === 'login') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-slate-900">BodaGoEra Admin</h1>
            <p className="text-sm text-slate-500 mt-1">Sign in to continue</p>
          </div>
          <form onSubmit={handleFakeLogin} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Admin email"
              className="w-full px-4 py-3 rounded-lg border border-slate-300 text-slate-900 placeholder-slate-400"
              autoComplete="off"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-3 rounded-lg border border-slate-300 text-slate-900 placeholder-slate-400"
              autoComplete="off"
            />
            <button
              type="submit"
              className="w-full py-3 rounded-lg font-semibold text-white bg-orange-500 hover:bg-orange-600 transition"
            >
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 p-6">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <button onClick={() => setView('login')} className="text-sm text-slate-500 hover:text-slate-800">
            Sign out
          </button>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl shadow p-5">
            <p className="text-slate-500 text-sm">Today's Rides</p>
            <p className="text-2xl font-bold mt-1 text-slate-900">58</p>
          </div>
          <div className="bg-white rounded-xl shadow p-5">
            <p className="text-slate-500 text-sm">Active Riders</p>
            <p className="text-2xl font-bold mt-1 text-slate-900">21</p>
          </div>
          <div className="bg-white rounded-xl shadow p-5">
            <p className="text-slate-500 text-sm">Total Payout</p>
            <p className="text-2xl font-bold mt-1 text-slate-900">UGX 890,200</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="font-semibold text-slate-900">Recent Rides</h2>
          </div>
          <ul className="divide-y divide-slate-200">
            {FAKE_RIDES.map((ride) => (
              <li key={ride.id} className="px-5 py-4 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">{ride.label}</p>
                  <p className="text-slate-500">{ride.id} • {ride.time}</p>
                </div>
                <span className="text-emerald-600">{ride.amount}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
