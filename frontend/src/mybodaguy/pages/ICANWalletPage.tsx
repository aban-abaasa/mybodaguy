import { useState, useEffect, useCallback } from 'react';
import { Bike, Copy, ArrowUp, ArrowDown, RefreshCw, Wallet, TrendingUp, ChevronRight, ShoppingCart, Banknote } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../services/supabaseClient';
import {
  getOrCreateWallet,
  getBalance,
  getTransactions,
  sendICAN,
  formatICAN,
  ICAN_TO_UGX,
  type ICANBalance,
  type ICANTransaction,
} from '../services/icanWalletService';
import BuyIcan from '../components/BuyIcan';
import SellIcan from '../components/SellIcan';

// ─── helpers ──────────────────────────────────────────────────────────────────

const TX_LABELS: Record<string, string> = {
  earn: 'Delivery Earned', cashback: 'Cashback', purchase: 'Purchase',
  transfer_in: 'Received', transfer_out: 'Sent',
  tithe: 'Tithe (10%)', sale: 'Sale', refund: 'Refund',
  buy: 'Bought ICAN', sell: 'Sold ICAN',
};

const APP_LABELS: Record<string, string> = {
  ican: 'ICAN', 'digital-city-era': 'Supermarket',
  'farm-agent': 'Farm Agent', mybodaguy: 'My Boda Guy',
};

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-UG', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Send Modal ───────────────────────────────────────────────────────────────

interface SendModalProps {
  userId: string;
  onClose: () => void;
  onDone: () => void;
}

function SendModal({ userId, onClose, onDone }: SendModalProps) {
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!address || !amount) { toast.error('Fill in all fields'); return; }
    setLoading(true);
    try {
      const { data: rw, error: re } = await supabase
        .from('ican_user_wallets').select('user_id')
        .eq('wallet_address', address.trim()).single();
      if (re || !rw) { toast.error('Wallet address not found'); return; }
      await sendICAN({ fromUserId: userId, toUserId: (rw as any).user_id, amount: parseFloat(amount), note });
      toast.success(`Sent ${amount} ICAN`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-lg text-slate-800">Send ICAN</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-slate-600 text-sm font-medium mb-1 block">Recipient Wallet Address</label>
            <input
              value={address} onChange={e => setAddress(e.target.value)}
              placeholder="ICA-XXXXXXXXXXXXXXXX"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400"
            />
          </div>
          <div>
            <label className="text-slate-600 text-sm font-medium mb-1 block">Amount (ICAN)</label>
            <input
              type="number" step="0.0001" min="0.0001"
              value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.0000"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400"
            />
            {amount && (
              <p className="text-slate-400 text-xs mt-1">
                ≈ UGX {(parseFloat(amount || '0') * ICAN_TO_UGX).toLocaleString()}
              </p>
            )}
          </div>
          <div>
            <label className="text-slate-600 text-sm font-medium mb-1 block">Note (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="What's this for?"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400" />
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-700 text-xs">
            10% tithe is automatically deducted from the recipient's earnings.
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium text-sm">Cancel</button>
          <button onClick={handleSend} disabled={loading}
            className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-60">
            {loading ? 'Sending…' : 'Send ICAN'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Receive Modal ────────────────────────────────────────────────────────────

function ReceiveModal({ address, onClose }: { address: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl text-center">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-lg text-slate-800">Receive ICAN</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        <p className="text-slate-500 text-sm mb-4">Share your wallet address to receive ICAN from any Icanera app.</p>
        <div className="bg-slate-50 rounded-xl p-4 font-mono text-sm text-slate-700 break-all mb-5">{address}</div>
        <button onClick={() => { navigator.clipboard.writeText(address); toast.success('Address copied!'); }}
          className="w-full py-3 rounded-xl bg-orange-500 text-white font-semibold flex items-center justify-center gap-2">
          <Copy className="w-4 h-4" /> Copy Address
        </button>
      </div>
    </div>
  );
}

// ─── Buy/Sell Overlays (use ICAN app components directly) ────────────────────

function TradeModal({ title, userId, onClose, onDone, children }: { title: string; userId: string; onClose: () => void; onDone: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-100">
          <h2 className="font-bold text-lg text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        <div className="p-2">{children}</div>
        <div className="px-6 pb-5">
          <button onClick={onClose} className="w-full py-3 rounded-xl border border-slate-200 text-slate-600 font-medium text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

interface ICANWalletPageProps {
  user: any;
}

export default function ICANWalletPage({ user }: ICANWalletPageProps) {
  const [balance, setBalance] = useState<ICANBalance>({ ican: 0, ugx: 0, address: null, totalEarned: 0, totalSpent: 0, totalTithe: 0 });
  const [transactions, setTransactions] = useState<ICANTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'in' | 'out' | 'tithe'>('all');
  const [modal, setModal] = useState<'send' | 'receive' | 'buy' | 'sell' | null>(null);
  const [balanceHidden, setBalanceHidden] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      await getOrCreateWallet(user.id);
      const [bal, txs] = await Promise.all([
        getBalance(user.id),
        getTransactions(user.id, 50),
      ]);
      setBalance(bal);
      setTransactions(txs);
    } catch (e: any) {
      toast.error('Wallet error: ' + e.message);
    }
  }, [user?.id]);

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
    toast.success('Wallet refreshed');
  };

  const filteredTx = transactions.filter(tx => {
    if (activeTab === 'in') return tx.direction === 'in';
    if (activeTab === 'out') return tx.direction === 'out';
    if (activeTab === 'tithe') return tx.transaction_type === 'tithe';
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      {/* Balance Card */}
      <div className="rounded-2xl overflow-hidden shadow-xl" style={{
        background: 'linear-gradient(135deg, #431407 0%, #9a3412 50%, #b45309 100%)',
      }}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bike className="w-6 h-6 text-orange-300" />
              <span className="text-white font-semibold text-sm">My Boda Guy — ICAN Wallet</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setBalanceHidden(h => !h)}
                className="text-white/60 hover:text-white text-xs px-2 py-1 rounded bg-white/10">
                {balanceHidden ? 'Show' : 'Hide'}
              </button>
              <button onClick={handleRefresh} disabled={refreshing}
                className="text-white/60 hover:text-white p-1 rounded bg-white/10">
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <p className="text-orange-200/70 text-xs uppercase tracking-widest mb-1">ICAN Balance</p>
          <p className="text-4xl font-bold text-white mb-1">
            {balanceHidden ? '••••••' : `${formatICAN(balance.ican)} ICAN`}
          </p>
          <p className="text-orange-200/80 text-sm mb-4">
            {balanceHidden ? '••••' : `≈ UGX ${Number(balance.ugx).toLocaleString()}`}
          </p>

          {balance.address && (
            <button
              onClick={() => { navigator.clipboard.writeText(balance.address!); toast.success('Address copied'); }}
              className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2 w-full text-left mb-4">
              <span className="text-orange-200/60 text-xs shrink-0">Wallet:</span>
              <span className="text-white/80 text-xs font-mono truncate flex-1">{balance.address}</span>
              <Copy className="w-3 h-3 text-orange-200/60 shrink-0" />
            </button>
          )}

          <div className="grid grid-cols-5 gap-2">
            {[
              { label: 'Send', icon: <ArrowUp className="w-4 h-4" />, onClick: () => setModal('send') },
              { label: 'Receive', icon: <ArrowDown className="w-4 h-4" />, onClick: () => setModal('receive') },
              { label: 'Buy', icon: <ShoppingCart className="w-4 h-4" />, onClick: () => setModal('buy') },
              { label: 'Sell', icon: <Banknote className="w-4 h-4" />, onClick: () => setModal('sell') },
              { label: 'History', icon: <TrendingUp className="w-4 h-4" />, onClick: () => document.getElementById('tx-list')?.scrollIntoView({ behavior: 'smooth' }) },
            ].map(btn => (
              <button key={btn.label} onClick={btn.onClick}
                className="flex flex-col items-center gap-1 py-3 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors">
                {btn.icon}
                <span className="text-xs font-medium">{btn.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Earned', value: `${formatICAN(balance.totalEarned)} ICAN` },
          { label: 'Total Tithe', value: `${formatICAN(balance.totalTithe)} ICAN` },
          { label: 'Floor Price', value: `1 ICAN = UGX 5K` },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-3 text-center shadow-sm border border-slate-100">
            <p className="text-slate-400 text-xs mb-1">{s.label}</p>
            <p className="text-slate-700 font-bold text-xs">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Earn-more banner */}
      <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <Wallet className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-orange-800 text-sm mb-1">Earn ICAN on every delivery</p>
            <ul className="space-y-1">
              {[
                'Riders: earn ICAN per completed delivery (min UGX 5,000)',
                'Chairpersons: earn group bonus ICAN monthly',
                '10% tithe is auto-deducted from all earnings',
              ].map(item => (
                <li key={item} className="flex items-start gap-1.5">
                  <ChevronRight className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
                  <span className="text-orange-700 text-xs">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Transaction history */}
      <div id="tx-list">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-slate-800">Transaction History</h2>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {(['all', 'in', 'out', 'tithe'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`text-xs px-3 py-1.5 rounded-md capitalize transition-colors ${activeTab === tab ? 'bg-orange-500 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                {tab}
              </button>
            ))}
          </div>
        </div>

        {filteredTx.length === 0 ? (
          <div className="bg-slate-50 rounded-2xl p-10 text-center">
            <Bike className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No transactions yet. Complete a delivery to earn your first ICAN.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTx.map(tx => {
              const isIn = tx.direction === 'in';
              const isTithe = tx.transaction_type === 'tithe';
              return (
                <div key={tx.id} className="bg-white rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm border border-slate-100">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    isTithe ? 'bg-amber-100' : isIn ? 'bg-emerald-100' : 'bg-rose-100'
                  }`}>
                    {isTithe
                      ? <span className="text-amber-600 text-sm font-bold">10%</span>
                      : isIn
                        ? <ArrowDown className="w-5 h-5 text-emerald-600" />
                        : <ArrowUp className="w-5 h-5 text-rose-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-slate-800 text-sm font-semibold">
                        {TX_LABELS[tx.transaction_type] ?? tx.transaction_type}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        {APP_LABELS[tx.source_app] ?? tx.source_app}
                      </span>
                    </div>
                    <p className="text-slate-400 text-xs truncate">{tx.note || '—'}</p>
                    <p className="text-slate-300 text-xs">{formatDate(tx.created_at)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-bold text-sm ${
                      isTithe ? 'text-amber-500' : isIn ? 'text-emerald-600' : 'text-rose-500'
                    }`}>
                      {isIn ? '+' : '-'}{formatICAN(tx.ican_amount)} ICAN
                    </p>
                    <p className="text-slate-400 text-xs">
                      UGX {(tx.ican_amount * ICAN_TO_UGX).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {modal === 'send' && (
        <SendModal userId={user.id} onClose={() => setModal(null)} onDone={loadData} />
      )}
      {modal === 'receive' && balance.address && (
        <ReceiveModal address={balance.address} onClose={() => setModal(null)} />
      )}
      {modal === 'buy' && (
        <TradeModal title="💳 Buy ICAN Coins" userId={user.id} onClose={() => setModal(null)} onDone={loadData}>
          <BuyIcan userId={user.id} onSuccess={() => { loadData(); setModal(null); }} />
        </TradeModal>
      )}
      {modal === 'sell' && (
        <TradeModal title="💰 Sell ICAN Coins" userId={user.id} onClose={() => setModal(null)} onDone={loadData}>
          <SellIcan userId={user.id} onSuccess={() => { loadData(); setModal(null); }} />
        </TradeModal>
      )}
    </div>
  );
}
