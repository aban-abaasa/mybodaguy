/**
 * RiderICANEarnings
 * Embedded in RiderDashboard overview.
 * Shows what the rider has earned in ICAN and the latest earnings. The current
 * balance itself lives on the Overview's ICAN Coins card above, so it isn't
 * repeated here.
 */

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  getOrCreateWallet,
  getBalance,
  getTransactions,
  formatICAN,
  type ICANBalance,
  type ICANTransaction,
} from '../services/icanWalletService';
import { SectionHeading } from './ClassicBits';

interface Props {
  user: any;
}

export default function RiderICANEarnings({ user }: Props) {
  const [balance, setBalance] = useState<ICANBalance>({ ican: 0, ugx: 0, address: null, totalEarned: 0, totalSpent: 0, totalTithe: 0 });
  const [recentTx, setRecentTx] = useState<ICANTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const refresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="classic-card animate-pulse p-5">
        <div className="mb-3 h-4 w-1/3 rounded bg-slate-100" />
        <div className="h-8 w-1/2 rounded bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="classic-card p-4 min-[360px]:p-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1"><SectionHeading>ICAN earnings</SectionHeading></div>
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh earnings"
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 active:scale-95"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-[#faf8f3] px-3.5 py-3 ring-1 ring-inset ring-[#c4a052]/25 dark:bg-slate-800 dark:ring-slate-700">
          <p className="classic-eyebrow">Total earned</p>
          <p className="mt-1 font-classic-display text-[20px] font-bold leading-tight tabular-nums text-slate-900">
            {formatICAN(balance.totalEarned)}
          </p>
          <p className="text-[11px] text-slate-500">ICAN</p>
        </div>
        <div className="rounded-2xl bg-[#faf8f3] px-3.5 py-3 ring-1 ring-inset ring-[#c4a052]/25 dark:bg-slate-800 dark:ring-slate-700">
          <p className="classic-eyebrow">Balance worth</p>
          <p className="mt-1 font-classic-display text-[20px] font-bold leading-tight tabular-nums text-slate-900">
            {Number(balance.ugx).toLocaleString()}
          </p>
          <p className="text-[11px] text-slate-500">UGX</p>
        </div>
      </div>

      {recentTx.length > 0 ? (
        <div className="mt-4">
          <p className="mb-1 text-xs font-semibold text-slate-500">Latest</p>
          <div>
            {recentTx.map(tx => (
              <div key={tx.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 text-xs last:border-0">
                <span className="min-w-0 truncate text-slate-600">{tx.note || tx.transaction_type}</span>
                <span className={`flex-shrink-0 font-semibold tabular-nums ${tx.direction === 'in' ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {tx.direction === 'in' ? '+' : '−'}{formatICAN(tx.ican_amount)} ICAN
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-center text-xs text-slate-400">Earnings from your rides will appear here.</p>
      )}
    </div>
  );
}
