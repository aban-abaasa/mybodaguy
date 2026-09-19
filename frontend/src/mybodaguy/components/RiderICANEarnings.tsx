/**
 * RiderICANEarnings
 * Embedded in RiderDashboard overview.
 * Shows the rider's ICAN balance and recent earnings.
 */

import { useState, useEffect, useCallback } from 'react';
import { Wallet, TrendingUp, RefreshCw } from 'lucide-react';
import {
  getOrCreateWallet,
  getBalance,
  getTransactions,
  formatICAN,
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
      <div className="border-b border-slate-100">
        <div className="p-3 text-center">
          <p className="text-slate-400 text-xs">Total Earned</p>
          <p className="font-bold text-slate-700 text-sm">{formatICAN(balance.totalEarned)} ICAN</p>
        </div>
      </div>

      {/* Recent earnings */}
      {recentTx.length > 0 && (
        <div className="p-4">
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
  );
}
