/**
 * RiderICANEarnings
 * Embedded in RiderDashboard overview.
 * Shows the rider's ICAN balance and lets them log a completed delivery
 * to earn ICAN coins (credited via the DB stored function with 10% tithe auto-deducted).
 */

import { useState, useEffect, useCallback } from 'react';
import { Wallet, Bike, ChevronRight, TrendingUp, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  getOrCreateWallet,
  getBalance,
  getTransactions,
  earnFromDelivery,
  formatICAN,
  ICAN_TO_UGX,
  type ICANBalance,
  type ICANTransaction,
} from '../services/icanWalletService';

interface Props {
  user: any;
}

export default function RiderICANEarnings({ user }: Props) {
  const [balance, setBalance] = useState<ICANBalance>({ ican: 0, ugx: 0, address: null, totalEarned: 0, totalSpent: 0, totalTithe: 0 });
  const [recentTx, setRecentTx] = useState<ICANTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [fareUGX, setFareUGX] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      await getOrCreateWallet(user.id);
      const [bal, txs] = await Promise.all([
        getBalance(user.id),
        getTransactions(user.id, 5),
      ]);
      setBalance(bal);
      setRecentTx(txs.filter(tx => tx.source_app === 'mybodaguy').slice(0, 5));
    } catch (e: any) {
      console.error('ICAN wallet load error:', e.message);
    }
  }, [user?.id]);

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const handleLogDelivery = async () => {
    const fare = parseFloat(fareUGX);
    if (!fareUGX || isNaN(fare) || fare < 1000) {
      toast.error('Enter a valid fare (min UGX 1,000)');
      return;
    }
    setLogging(true);
    try {
      const deliveryId = `RIDE-${Date.now()}`;
      const result = await earnFromDelivery({
        riderId: user.id,
        ugxFareAmount: fare,
        deliveryId,
        riderName: user.email?.split('@')[0],
      });
      toast.success(
        `Earned ${formatICAN(result.net_credited)} ICAN (≈ UGX ${Math.round(result.net_credited * ICAN_TO_UGX).toLocaleString()}) — 10% tithe deducted`
      );
      setFareUGX('');
      setDeliveryNote('');
      setShowForm(false);
      await loadData();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLogging(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-1/3 mb-3" />
        <div className="h-8 bg-slate-100 rounded w-1/2" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-white">
            <Wallet className="w-5 h-5" />
            <span className="font-semibold text-sm">ICAN Wallet Earnings</span>
          </div>
          <button onClick={loadData} className="text-white/70 hover:text-white p-1">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <p className="text-white/60 text-xs uppercase tracking-wider mb-1">Balance</p>
        <p className="text-white font-bold text-2xl">{formatICAN(balance.ican)} ICAN</p>
        <p className="text-orange-100 text-sm">≈ UGX {Number(balance.ugx).toLocaleString()}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100">
        <div className="p-3 text-center">
          <p className="text-slate-400 text-xs">Total Earned</p>
          <p className="font-bold text-slate-700 text-sm">{formatICAN(balance.totalEarned)} ICAN</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-slate-400 text-xs">Tithe Paid</p>
          <p className="font-bold text-amber-600 text-sm">{formatICAN(balance.totalTithe)} ICAN</p>
        </div>
      </div>

      {/* Log Delivery Button */}
      <div className="p-4">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-between px-4 py-3 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl text-orange-700 font-medium text-sm transition-colors"
          >
            <div className="flex items-center gap-2">
              <Bike className="w-4 h-4" />
              Log Completed Delivery — Earn ICAN
            </div>
            <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-slate-600 text-sm font-medium">Log delivery to earn ICAN</p>
            <div>
              <label className="text-slate-500 text-xs mb-1 block">Fare Received (UGX)</label>
              <input
                type="number" min="1000" step="500"
                value={fareUGX} onChange={e => setFareUGX(e.target.value)}
                placeholder="e.g. 8000"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
              />
              {fareUGX && !isNaN(parseFloat(fareUGX)) && (
                <p className="text-orange-600 text-xs mt-1">
                  You earn ≈ {formatICAN(Math.max(parseFloat(fareUGX), ICAN_TO_UGX) / ICAN_TO_UGX * 0.9)} ICAN (after 10% tithe)
                </p>
              )}
            </div>
            <div>
              <label className="text-slate-500 text-xs mb-1 block">Note (optional)</label>
              <input
                value={deliveryNote} onChange={e => setDeliveryNote(e.target.value)}
                placeholder="Route, customer, etc."
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
              />
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-700 text-xs">
              Minimum payout: UGX 5,000 = 1 ICAN. 10% tithe auto-deducted.
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm">Cancel</button>
              <button onClick={handleLogDelivery} disabled={logging}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-60">
                {logging ? 'Crediting…' : 'Claim ICAN'}
              </button>
            </div>
          </div>
        )}

        {/* Recent earnings */}
        {recentTx.length > 0 && (
          <div className="mt-4">
            <p className="text-slate-400 text-xs font-medium mb-2 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Recent earnings
            </p>
            <div className="space-y-1.5">
              {recentTx.map(tx => (
                <div key={tx.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 truncate max-w-[180px]">{tx.note || tx.transaction_type}</span>
                  <span className={`font-semibold shrink-0 ml-2 ${tx.direction === 'in' ? 'text-emerald-600' : 'text-amber-500'}`}>
                    {tx.direction === 'in' ? '+' : '-'}{formatICAN(tx.ican_amount)} ICAN
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
