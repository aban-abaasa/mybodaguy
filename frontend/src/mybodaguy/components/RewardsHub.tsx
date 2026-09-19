import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Gift, TrendingUp, History, Package, X, CheckCircle2, Coins, Sparkles, ArrowRight,
} from 'lucide-react';
import {
  getRewardSummary, getRewardCatalog, getRewardTransactions, getMyRedemptions,
  redeemPointsForCoins, redeemPointsForItem, pointsToICAN, POINTS_PER_ICAN, TIER_META,
  type RewardSummary, type RewardCatalogItem, type RewardTransaction, type RewardRedemption,
} from '../services/rewardsService';

interface Props {
  user: any;
  role: 'customer' | 'rider';
  onGoToWallet?: () => void;
}

const STATUS_STYLE: Record<RewardRedemption['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  processing: 'bg-blue-100 text-blue-700',
  shipped: 'bg-indigo-100 text-indigo-700',
  fulfilled: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const SOURCE_LABEL: Record<string, string> = {
  ride: 'Ride completed', delivery: 'Delivery completed', shop: 'Shop purchase',
  bonus: 'Bonus', redeem_coins: 'Converted to ICAN', redeem_item: 'Redeemed item',
};

export default function RewardsHub({ user, role, onGoToWallet }: Props) {
  const [summary, setSummary] = useState<RewardSummary | null>(null);
  const [catalog, setCatalog] = useState<RewardCatalogItem[]>([]);
  const [txs, setTxs] = useState<RewardTransaction[]>([]);
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [convertPoints, setConvertPoints] = useState('');
  const [converting, setConverting] = useState(false);
  const [redeemItem, setRedeemItem] = useState<RewardCatalogItem | null>(null);

  const reload = async () => {
    if (!user?.id) return;
    try {
      const [s, c, t, r] = await Promise.all([
        getRewardSummary(user.id),
        getRewardCatalog(),
        getRewardTransactions(user.id, 15),
        getMyRedemptions(user.id, 10),
      ]);
      setSummary(s);
      setCatalog(c.filter(item => item.role_scope === 'both' || item.role_scope === role));
      setTxs(t);
      setRedemptions(r);
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  const tier = TIER_META[summary?.tier ?? 'bronze'];
  const balance = summary?.points_balance ?? 0;
  const convertAmount = Number(convertPoints) || 0;

  const handleConvert = async () => {
    if (convertAmount < POINTS_PER_ICAN) {
      toast.error(`Minimum ${POINTS_PER_ICAN} points (1 ICAN) to convert`);
      return;
    }
    if (convertAmount > balance) {
      toast.error('Not enough points');
      return;
    }
    setConverting(true);
    try {
      const result = await redeemPointsForCoins(user.id, convertAmount);
      toast.success(`Converted ${result.points_spent} points → ${Number(result.ican_credited).toFixed(4)} ₡ ICAN`);
      setConvertPoints('');
      await reload();
    } catch (e: any) {
      toast.error(e.message || 'Conversion failed');
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Points balance + tier progress */}
      <div className={`bg-gradient-to-br ${tier.color} rounded-2xl p-5 text-white`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white/80 text-sm mb-1 flex items-center gap-1"><Gift size={14} /> Reward Points</p>
            <p className="text-4xl font-bold">{loading ? '…' : Math.floor(balance).toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl">{tier.emoji}</p>
            <p className="text-xs text-white/80">{tier.label}</p>
          </div>
        </div>
        {summary?.next_tier && summary.next_threshold && (
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-white/80 mb-1">
              <span>{tier.label}</span>
              <span>{TIER_META[summary.next_tier].label} at {summary.next_threshold.toLocaleString()} lifetime pts</span>
            </div>
            <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all" style={{ width: `${summary.progress_pct}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Ways to earn */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-orange-500" /> Ways to Earn
        </h4>
        <div className="grid grid-cols-2 gap-3">
          {role === 'customer' ? (
            <>
              <EarnTile emoji="₡" label="5 pts per 1 ICAN-equivalent of every ride or delivery fare — cash or wallet" />
              <EarnTile emoji="🏍️" label="Pay with ICAN Wallet at checkout to earn 10% more points than cash" />
            </>
          ) : (
            <>
              <EarnTile emoji="₡" label="10 pts per 1 ICAN-equivalent of what you earn — cash or wallet" />
              <EarnTile emoji="🏍️" label="Wallet-settled rides earn 10% more points than cash" />
            </>
          )}
        </div>
      </div>

      {/* Convert points to ICAN coins */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <h4 className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <Coins size={16} className="text-violet-500" /> Convert to ICAN Coins
        </h4>
        <p className="text-xs text-slate-500 mb-3">{POINTS_PER_ICAN} points = 1 ₡ ICAN — no tithe on point redemptions</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={POINTS_PER_ICAN}
            step={POINTS_PER_ICAN}
            value={convertPoints}
            onChange={(e) => setConvertPoints(e.target.value)}
            placeholder={`e.g. ${POINTS_PER_ICAN}`}
            className="flex-1 min-w-0 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <ArrowRight size={16} className="text-slate-400 flex-shrink-0" />
          <div className="px-3 py-2 bg-violet-50 rounded-lg text-sm font-semibold text-violet-700 flex-shrink-0 whitespace-nowrap">
            {convertAmount > 0 ? `${pointsToICAN(convertAmount).toFixed(4)} ₡` : '— ₡'}
          </div>
        </div>
        <button
          onClick={handleConvert}
          disabled={converting || convertAmount < POINTS_PER_ICAN || convertAmount > balance}
          className="mt-3 w-full py-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-lg text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          {converting ? 'Converting…' : 'Convert Now'}
        </button>
        {onGoToWallet && (
          <button onClick={onGoToWallet} className="mt-2 w-full py-2 text-xs text-violet-600 hover:underline">
            View ICAN Wallet →
          </button>
        )}
      </div>

      {/* Redeemable catalog */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <h4 className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <Sparkles size={16} className="text-orange-500" /> Redeem for Rewards
        </h4>
        <p className="text-xs text-slate-500 mb-3">Helmets, jackets, reflectors and home essentials — same catalog for riders and customers.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {catalog.map(item => {
            const canAfford = balance >= item.points_cost;
            return (
              <button
                key={item.id}
                onClick={() => canAfford && setRedeemItem(item)}
                disabled={!canAfford}
                className={`text-left rounded-xl border p-3 transition-all ${
                  canAfford ? 'border-orange-200 hover:border-orange-400 hover:shadow-md bg-orange-50/40' : 'border-slate-100 bg-slate-50 opacity-60'
                }`}
              >
                <p className="text-2xl mb-1">{item.emoji}</p>
                <p className="text-xs font-semibold text-slate-800 leading-tight">{item.name}</p>
                <p className="text-[11px] font-bold text-orange-600 mt-1">{item.points_cost.toLocaleString()} pts</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* My redemptions */}
      {redemptions.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <Package size={16} className="text-orange-500" /> My Redemptions
          </h4>
          <div className="space-y-2">
            {redemptions.map(r => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div>
                  <p className="text-sm text-slate-700 font-medium">{r.item_name}</p>
                  <p className="text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString()} · {r.points_spent.toLocaleString()} pts</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Points history */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <History size={16} className="text-orange-500" /> Points Activity
        </h4>
        {loading ? (
          <p className="text-slate-400 text-sm text-center py-4">Loading…</p>
        ) : txs.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-4">No points activity yet — complete a ride or delivery to start earning!</p>
        ) : (
          <div className="space-y-2">
            {txs.map(tx => (
              <div key={tx.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div>
                  <p className="text-sm text-slate-700 font-medium">{SOURCE_LABEL[tx.source] || tx.source}</p>
                  <p className="text-xs text-slate-400">{new Date(tx.created_at).toLocaleDateString()}</p>
                </div>
                <p className={`font-bold text-sm ${tx.direction === 'earn' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {tx.direction === 'earn' ? '+' : '-'}{Math.floor(tx.points).toLocaleString()} pts
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {redeemItem && (
        <RedeemItemModal
          item={redeemItem}
          userId={user.id}
          onClose={() => setRedeemItem(null)}
          onRedeemed={async () => { setRedeemItem(null); await reload(); }}
        />
      )}
    </div>
  );
}

function EarnTile({ emoji, label }: { emoji: string; label: string }) {
  return (
    <div className="bg-orange-50 rounded-xl p-3 text-center">
      <p className="text-xl mb-1">{emoji}</p>
      <p className="text-[11px] font-medium text-slate-700 leading-tight">{label}</p>
    </div>
  );
}

function RedeemItemModal({
  item, userId, onClose, onRedeemed,
}: {
  item: RewardCatalogItem; userId: string; onClose: () => void; onRedeemed: () => void;
}) {
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!address.trim() || !phone.trim()) {
      toast.error('Please enter a delivery address and phone number');
      return;
    }
    setSubmitting(true);
    try {
      await redeemPointsForItem({ userId, catalogItemId: item.id, deliveryAddress: address.trim(), phone: phone.trim() });
      toast.success(`${item.name} redeemed! We'll contact you to arrange delivery.`);
      onRedeemed();
    } catch (e: any) {
      toast.error(e.message || 'Redemption failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-3xl">{item.emoji}</span>
            <div>
              <p className="font-semibold text-slate-800">{item.name}</p>
              <p className="text-xs text-orange-600 font-bold">{item.points_cost.toLocaleString()} points</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        {item.description && <p className="text-xs text-slate-500 mb-3">{item.description}</p>}
        <div className="space-y-2">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Delivery address / pickup stage"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
        </div>
        <button
          onClick={submit}
          disabled={submitting}
          className="mt-4 w-full py-2.5 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting ? 'Redeeming…' : <><CheckCircle2 size={16} /> Confirm Redemption</>}
        </button>
      </div>
    </div>
  );
}
