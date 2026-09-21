import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { UserPlus, Copy, Link2, Share2, CheckCircle2, Clock, ChevronDown } from 'lucide-react';
import {
  loadReferralStats, buildReferralLink, type ReferralStats, type ReferralFriendState,
} from '../services/referralService';
import { formatICAN } from '../services/icanWalletService';

const FRIEND_STATE: Record<ReferralFriendState, { label: string; style: string }> = {
  joined: { label: 'Joined — waiting for first deposit', style: 'bg-slate-100 text-slate-600' },
  pending: { label: 'Reward pending', style: 'bg-amber-100 text-amber-700' },
  paid: { label: 'Reward paid', style: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Not eligible', style: 'bg-red-100 text-red-600' },
};

// The title + "Earn X% … live coin price" line are always visible; clicking the
// header opens the code, share buttons, stats and friends list.
export default function ReferralCard() {
  const [open, setOpen] = useState(false); // collapsed until clicked
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      setStats(await loadReferralStats());
    } catch (e) {
      console.error('[ReferralCard] load failed:', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const copy = (text: string, done: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(done), () => toast.error('Could not copy'));
  };

  const shareMessage = (code: string) =>
    `🏍️ Join me on BodaGoEra! Sign up with my link and get moving: ${buildReferralLink(code)} (my referral code: ${code})`;

  const share = async (code: string) => {
    const text = shareMessage(code);
    if (navigator.share) {
      try { await navigator.share({ title: 'Join BodaGoEra', text }); return; } catch { /* dismissed — fall through to WhatsApp */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  // The line under the title — always visible, collapsed or not.
  let description: ReactNode = null;
  if (loading) description = 'Loading your referral info…';
  else if (failed) description = "Couldn't load your referral info.";
  else if (stats && !stats.enabled) description = 'Referral rewards are paused right now. Your code and link stay valid.';
  else if (stats) {
    description = (
      <>
        Earn <b>{stats.reward_percent}%</b> of your friend's first ICAN deposit, paid straight into your wallet
        {stats.max_reward_ican != null && <> (up to {formatICAN(stats.max_reward_ican)} ₡ per friend)</>}.
        {stats.min_deposit_ican > 0 && <> Their deposit must be at least {formatICAN(stats.min_deposit_ican)} ₡.</>}
        {stats.live_price_ugx > 0 && <> Rewards are valued at the live coin price (1 ₡ ≈ UGX {Math.round(stats.live_price_ugx).toLocaleString()} today).</>}
      </>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-start justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="font-semibold text-slate-800 flex items-center gap-2">
            <UserPlus size={16} className="text-emerald-500" /> Refer Friends
          </span>
          <span className="block text-xs text-slate-500 mt-1 font-normal">{description}</span>
        </span>
        <ChevronDown size={18} className={`mt-0.5 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {failed && (
        <button onClick={load} className="mt-2 text-sm text-orange-600 font-medium hover:underline">Try again</button>
      )}

      {open && !loading && !failed && stats && (
        <div className="mt-4">
          {stats.code && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-2 text-center font-mono font-bold tracking-widest text-slate-800">
                  {stats.code}
                </div>
                <button
                  onClick={() => copy(stats.code!, 'Referral code copied')}
                  className="p-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
                  aria-label="Copy referral code"
                >
                  <Copy size={16} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <button
                  onClick={() => copy(buildReferralLink(stats.code!), 'Referral link copied')}
                  className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium"
                >
                  <Link2 size={15} /> Copy link
                </button>
                <button
                  onClick={() => share(stats.code!)}
                  className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium"
                >
                  <Share2 size={15} /> Share
                </button>
              </div>
            </>
          )}

          <div className="grid grid-cols-3 gap-2 text-center mb-1">
            <Stat value={String(stats.friends_joined)} label="Joined" />
            <Stat value={String(stats.friends_deposited)} label="Deposited" />
            <Stat value={`${formatICAN(stats.earned_ican)} ₡`} label={`≈ UGX ${Math.round(stats.earned_ugx).toLocaleString()}`} highlight />
          </div>
          {stats.pending_ican > 0 && (
            <p className="text-xs text-amber-600 flex items-center justify-center gap-1 mt-2">
              <Clock size={12} /> {formatICAN(stats.pending_ican)} ₡ (≈ UGX {Math.round(stats.pending_ugx).toLocaleString()}) pending approval
            </p>
          )}

          {stats.friends.length > 0 && (
            <ul className="mt-4 divide-y divide-slate-100">
              {stats.friends.map((f, i) => {
                const st = FRIEND_STATE[f.state];
                return (
                  <li key={`${f.created_at}-${i}`} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{f.first_name}</p>
                      <p className="text-[11px] text-slate-400">{new Date(f.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${st.style}`}>
                        {f.state === 'paid' && <CheckCircle2 size={11} />}{st.label}
                      </span>
                      {f.reward_ican != null && f.state !== 'rejected' && (
                        <p className="text-xs font-semibold text-emerald-600 mt-0.5">
                          +{formatICAN(f.reward_ican)} ₡{f.reward_ugx != null && <span className="font-normal text-slate-400"> · UGX {Math.round(f.reward_ugx).toLocaleString()}</span>}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  return (
    <div className="bg-slate-50 rounded-lg py-2 px-1">
      <p className={`text-lg font-bold ${highlight ? 'text-emerald-600' : 'text-slate-800'}`}>{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}
