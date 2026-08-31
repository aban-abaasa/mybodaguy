import { useState, useEffect, useCallback } from 'react';
import { Bike, Copy, ArrowUp, ArrowDown, RefreshCw, Wallet, TrendingUp, ChevronRight, ShoppingCart, Banknote } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../services/supabaseClient';
import {
  getOrCreateWallet,
  getBalance,
  getTransactions,
  sendICAN,
  requestIcanPayout,
  formatICAN,
  ICAN_TO_UGX,
  type ICANBalance,
  type ICANTransaction,
} from '../services/icanWalletService';
import BuyIcan from '../components/BuyIcan';
import SellIcan from '../components/SellIcan';
import SendIcanOut from '../components/SendIcanOut';
import SetPinPrompt from '../components/SetPinPrompt';
import PayMoneyModal from '../components/PayMoneyModal';
import ReceiveMoneyModal from '../components/ReceiveMoneyModal';
import { hasPinSet, verifyPin } from '../services/pinService';
import { parseIcanPayCode, payIcanRequest } from '../services/icanPaymentRequestService';

// ─── helpers ──────────────────────────────────────────────────────────────────

const TX_LABELS: Record<string, string> = {
  earn: 'Delivery Earned', cashback: 'Cashback', purchase: 'Purchase',
  transfer_in: 'Received', transfer_out: 'Sent',
  tithe: 'Tithe (10%)', sale: 'Sale', refund: 'Refund',
  buy: 'Bought ICAN', sell: 'Sold ICAN',
};

const APP_LABELS: Record<string, string> = {
  ican: 'ICAN', 'digital-city-era': 'Supermarket',
  'farm-agent': 'AgriBone', mybodaguy: 'BodaGoEra',
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
  balance: ICANBalance;
  onClose: () => void;
  onDone: () => void;
}

const SEND_DESTINATIONS = [
  { key: 'wallet', label: '💎 ICAN Wallet' },
  { key: 'mobilemoneyuganda', label: '📱 Mobile Money' },
  { key: 'bank', label: '🏦 Bank Account' },
] as const;

function SendModal({ userId, balance, onClose, onDone }: SendModalProps) {
  const [destination, setDestination] = useState<'wallet' | 'mobilemoneyuganda' | 'bank'>('wallet');

  // ICAN-to-ICAN fields
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');

  // Real-money payout fields
  const [network, setNetwork] = useState<'MTN' | 'AIRTEL'>('MTN');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState('');

  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const amountNum = parseFloat(amount) || 0;
  const isPayout = destination !== 'wallet';
  const feePercent = 3; // flat 3% cash-out fee (mobile money / bank) — sending to another ICAN wallet is 0%
  const ugxGross = amountNum * ICAN_TO_UGX;
  const ugxNet = ugxGross - Math.round((ugxGross * feePercent) / 100);

  const canSend = isPayout
    ? amountNum > 0 && amountNum <= balance.ican &&
      (destination === 'mobilemoneyuganda' ? !!phoneNumber : !!accountNumber && !!bankCode && !!beneficiaryName)
    : !!address && amountNum > 0;

  const handleSend = async () => {
    if (!canSend) { toast.error('Fill in all fields'); return; }
    setLoading(true);
    try {
      if (destination === 'wallet') {
        const { data: rw, error: re } = await supabase
          .from('ican_user_wallets').select('user_id')
          .eq('wallet_address', address.trim()).single();
        if (re || !rw) { toast.error('Wallet address not found'); return; }
        await sendICAN({ fromUserId: userId, toUserId: (rw as any).user_id, amount: amountNum, note });
        toast.success(`Sent ${amount} ICAN`);
      } else {
        const data = await requestIcanPayout({
          icanAmount: amountNum,
          channel: destination,
          phoneNumber: destination === 'mobilemoneyuganda' ? phoneNumber : undefined,
          network: destination === 'mobilemoneyuganda' ? network : undefined,
          accountNumber: destination === 'bank' ? accountNumber : undefined,
          bankCode: destination === 'bank' ? bankCode : undefined,
          beneficiaryName: destination === 'bank' ? beneficiaryName : undefined,
        });
        toast.success(`${data.message} You'll receive UGX ${Number(data.ugx_net).toLocaleString()}.`);
      }
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl my-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-lg text-slate-800">Send</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        <div className="mb-4">
          <label className="text-slate-600 text-sm font-medium mb-1 block">Send To</label>
          <div className="flex gap-2">
            {SEND_DESTINATIONS.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setDestination(d.key)}
                disabled={loading}
                className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-medium border ${
                  destination === d.key ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <p className="text-slate-400 text-xs mt-1">
            Cards can only receive top-ups, not payouts — send to a card isn't supported by any provider we integrate with.
          </p>
        </div>

        <div className="space-y-4">
          {destination === 'wallet' && (
            <div>
              <label className="text-slate-600 text-sm font-medium mb-1 block">Recipient Wallet Address</label>
              <input
                value={address} onChange={e => setAddress(e.target.value)}
                placeholder="ICA-XXXXXXXXXXXXXXXX"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400"
              />
            </div>
          )}

          {destination === 'mobilemoneyuganda' && (
            <>
              <div className="flex gap-2">
                {(['MTN', 'AIRTEL'] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNetwork(n)}
                    disabled={loading}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                      network === n ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-slate-600 text-sm font-medium mb-1 block">Mobile Money Number</label>
                <input
                  value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                  placeholder="e.g. 0770123456"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400"
                />
              </div>
            </>
          )}

          {destination === 'bank' && (
            <>
              <div>
                <label className="text-slate-600 text-sm font-medium mb-1 block">Bank Code</label>
                <input value={bankCode} onChange={e => setBankCode(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400" />
              </div>
              <div>
                <label className="text-slate-600 text-sm font-medium mb-1 block">Account Number</label>
                <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400" />
              </div>
              <div>
                <label className="text-slate-600 text-sm font-medium mb-1 block">Account Holder Name</label>
                <input value={beneficiaryName} onChange={e => setBeneficiaryName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400" />
              </div>
            </>
          )}

          <div>
            <label className="text-slate-600 text-sm font-medium mb-1 block">Amount (ICAN)</label>
            <input
              type="number" step="0.0001" min="0.0001" max={isPayout ? balance.ican : undefined}
              value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.0000"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400"
            />
            {amount && !isPayout && (
              <p className="text-slate-400 text-xs mt-1">
                ≈ UGX {(parseFloat(amount || '0') * ICAN_TO_UGX).toLocaleString()}
              </p>
            )}
          </div>

          {destination === 'wallet' && (
            <div>
              <label className="text-slate-600 text-sm font-medium mb-1 block">Note (optional)</label>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="What's this for?"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400" />
            </div>
          )}

          {isPayout && amountNum > 0 && (
            <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-1">
              <div className="flex justify-between text-slate-500"><span>Fee ({feePercent}%)</span><span>-UGX {(ugxGross - ugxNet).toLocaleString()}</span></div>
              <div className="flex justify-between text-slate-800 font-semibold pt-1 border-t border-slate-200"><span>Recipient Gets</span><span>UGX {ugxNet.toLocaleString()}</span></div>
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-700 text-xs">
            {isPayout
              ? 'Sent via Flutterwave. A 3% cash-out fee applies. If the transfer fails, your ICAN is refunded automatically.'
              : 'No fee — the recipient receives the full amount you send.'}
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium text-sm">Cancel</button>
          <button onClick={handleSend} disabled={!canSend || loading}
            className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-60">
            {loading ? 'Sending…' : 'Send'}
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
  const [modal, setModal] = useState<'send' | 'pay' | 'receive' | 'buy' | 'sell' | 'sendout' | null>(null);
  const [selectedTx, setSelectedTx] = useState<ICANTransaction | null>(null);
  const [paymentReceipt, setPaymentReceipt] = useState<any>(null);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);

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
      hasPinSet(user.id).then((has) => setNeedsPin(!has)).catch(() => {});
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

  const handlePaymentScanned = async (scannedValue: string, paymentPurpose: string = 'personal', businessProfileId: string | null = null) => {
    const paymentCode = parseIcanPayCode(scannedValue);
    if (!paymentCode) {
      toast.error('This QR code is not an ICAN payment request');
      return;
    }
    const pin = window.prompt('Enter your transaction PIN to approve this payment:');
    if (pin === null) return;
    const pinCheck = await verifyPin(user.id, pin);
    if (!pinCheck.success) {
      toast.error(pinCheck.error || 'Incorrect PIN. Payment cancelled.');
      return;
    }
    try {
      const result = await payIcanRequest({
        paymentCode,
        payerUserId: user.id,
        expenseClassification: paymentPurpose === 'business' ? 'business_expense' : 'personal_expense',
        counterpartyType: 'business',
        businessProfileId,
      });
      setPaymentReceipt(result.payerReceipt);
      toast.success(`Payment sent successfully. Receipt: ${result.payerReceipt.receiptNumber}`);
      setModal(null);
      await loadData();
    } catch (e: any) {
      toast.error(e.message || 'Payment failed');
    }
  };

  const downloadPaymentReceipt = () => {
    if (!paymentReceipt) return;
    const text = [
      'ICANERA WALLET PAYMENT RECEIPT',
      '--------------------------------',
      `Receipt: ${paymentReceipt.receiptNumber}`,
      `Transaction: ${paymentReceipt.transactionId || 'N/A'}`,
      `Amount: ${formatICAN(paymentReceipt.amount)} ${paymentReceipt.currency}`,
      `Description: ${paymentReceipt.description}`,
      `Payment code: ${paymentReceipt.paymentCode}`,
      `Date: ${new Date(paymentReceipt.issuedAt).toLocaleString('en-UG')}`,
      '',
      'Payment successful.',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${paymentReceipt.receiptNumber}.txt`;
    link.click();
    URL.revokeObjectURL(url);
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
              <span className="text-white font-semibold text-sm">BodaGoEra — IcanEra Wallet</span>
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

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              { label: 'Pay', icon: <span className="text-lg">⌕</span>, onClick: () => setModal('pay') },
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

          <button onClick={() => setModal('sendout')}
            className="w-full mt-3 py-3 rounded-xl bg-white/15 hover:bg-white/25 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors">
            📤 Send Out to Mobile Money / Bank
          </button>
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
          <div className="space-y-0.5">
            {filteredTx.map(tx => {
              const isIn = tx.direction === 'in';
              const isTithe = tx.transaction_type === 'tithe';
              return (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => setSelectedTx(tx)}
                  className="w-full flex items-center justify-between py-1.5 px-2 rounded-lg text-left hover:bg-slate-100 transition-colors"
                >
                  <p className="text-slate-700 text-xs truncate pr-2">
                    {TX_LABELS[tx.transaction_type] ?? tx.transaction_type}
                  </p>
                  <p className={`text-xs font-semibold shrink-0 ${
                    isTithe ? 'text-amber-500' : isIn ? 'text-emerald-600' : 'text-rose-500'
                  }`}>
                    {isIn ? '+' : '-'}{formatICAN(tx.ican_amount)} ICAN
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Transaction detail modal */}
      {selectedTx && (() => {
        const tx = selectedTx;
        const isIn = tx.direction === 'in';
        const isTithe = tx.transaction_type === 'tithe';
        return (
          <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={() => setSelectedTx(null)}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-slate-800" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">Transaction Details</h3>
                <button onClick={() => setSelectedTx(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">&times;</button>
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  isTithe ? 'bg-amber-100' : isIn ? 'bg-emerald-100' : 'bg-rose-100'
                }`}>
                  {isTithe
                    ? <span className="text-amber-600 text-sm font-bold">10%</span>
                    : isIn
                      ? <ArrowDown className="w-5 h-5 text-emerald-600" />
                      : <ArrowUp className="w-5 h-5 text-rose-600" />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{TX_LABELS[tx.transaction_type] ?? tx.transaction_type}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                      {APP_LABELS[tx.source_app] ?? tx.source_app}
                    </span>
                  </div>
                  <p className="text-slate-300 text-xs">{formatDate(tx.created_at)}</p>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Amount</span>
                  <strong className={isTithe ? 'text-amber-500' : isIn ? 'text-emerald-600' : 'text-rose-500'}>
                    {isIn ? '+' : '-'}{formatICAN(tx.ican_amount)} ICAN
                  </strong>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Local value</span>
                  <strong>UGX {(tx.ican_amount * ICAN_TO_UGX).toLocaleString()}</strong>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Note</span>
                  <strong className="truncate max-w-[60%]">{tx.note || '—'}</strong>
                </div>
                {tx.id && (
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">ID</span>
                    <strong className="truncate max-w-[60%] text-xs">{tx.id}</strong>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modals */}
      {modal === 'send' && (
        <SendModal userId={user.id} balance={balance} onClose={() => setModal(null)} onDone={loadData} />
      )}
      {modal === 'receive' && balance.address && (
        <ReceiveMoneyModal isOpen userId={user.id} onClose={() => setModal(null)} onSuccess={loadData} />
      )}
      {modal === 'pay' && (
        <PayMoneyModal isOpen userId={user.id} onClose={() => setModal(null)} onPaymentScanned={handlePaymentScanned} />
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
      {modal === 'sendout' && (
        <TradeModal title="📤 Send ICAN Out" userId={user.id} onClose={() => setModal(null)} onDone={loadData}>
          <SendIcanOut userId={user.id} balance={balance.ican} onSuccess={() => { loadData(); setModal(null); }} />
        </TradeModal>
      )}
      {paymentReceipt && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 text-slate-900">
            <div className="text-center">
              <div className="text-5xl mb-3">✅</div>
              <h2 className="text-xl font-bold text-emerald-700">Payment successful</h2>
              <p className="text-sm text-slate-600 mt-1">Your ICAN payment was sent and recorded.</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 mt-5 space-y-2 text-sm">
              <div className="flex justify-between gap-4"><span>Receipt</span><strong>{paymentReceipt.receiptNumber}</strong></div>
              <div className="flex justify-between gap-4"><span>Amount</span><strong>{formatICAN(paymentReceipt.amount)} {paymentReceipt.currency}</strong></div>
              <div className="flex justify-between gap-4"><span>Transaction</span><strong className="truncate">{paymentReceipt.transactionId || 'N/A'}</strong></div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={downloadPaymentReceipt} className="flex-1 py-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold">Download receipt</button>
              <button onClick={() => setPaymentReceipt(null)} className="px-5 py-3 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}
      {needsPin && (
        <SetPinPrompt userId={user.id} onDone={() => setNeedsPin(false)} />
      )}
    </div>
  );
}
