import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import {
  ArrowDown, ArrowUp, Banknote, CheckCircle2, ChevronDown, Gem, Landmark, Receipt, RotateCcw, Search, ShoppingCart,
  Smartphone, Sparkles, Wallet, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../services/supabaseClient';
import {
  getOrCreateWallet,
  getBalance,
  getTransactions,
  sendICAN,
  requestIcanPayout,
  resolveRecipient,
  sendICANToBusiness,
  detectUgandaMobileNetwork,
  formatICAN,
  ICAN_TO_UGX,
  type ICANBalance,
  type ICANTransaction,
  type ResolvedRecipient,
} from '../services/icanWalletService';
import BuyIcan from '../components/BuyIcan';
import SellIcan from '../components/SellIcan';
import SendIcanOut from '../components/SendIcanOut';
import SetPinPrompt from '../components/SetPinPrompt';
import PayMoneyModal from '../components/PayMoneyModal';
import ReceiveMoneyModal from '../components/ReceiveMoneyModal';
import {
  WalletSheet, BalanceCard, QuickActions, ActivityStrip, AddressQr, CopyButton, formatLocalMoney, compactNumber, formatAmount,
  type WalletAction, type LocalValue, type DayFlow,
} from '../components/WalletClassic';
import { hasPinSet, verifyPin } from '../services/pinService';
import { parseIcanPayCode, payIcanRequest } from '../services/icanPaymentRequestService';

// ─── helpers ──────────────────────────────────────────────────────────────────

const TX_LABELS: Record<string, string> = {
  earn: 'Earned', cashback: 'Cashback', purchase: 'Purchase',
  transfer_in: 'Received', transfer_out: 'Sent',
  tithe: 'Tithe (10%)', sale: 'Sale', refund: 'Refund',
  buy: 'Bought IcanEra', sell: 'Sold IcanEra', journey_payment: 'Journey payment',
};

const APP_LABELS: Record<string, string> = {
  ican: 'ICAN', 'digital-city-era': 'Supermarket',
  'farm-agent': 'AgriBone', mybodaguy: 'BodaGoEra',
};

/** Receipts carry the coin's code ("ICAN"); people see its name. */
const unitLabel = (code?: string) => (!code || code === 'ICAN' ? 'IcanEra' : code);

const HIDE_KEY = 'ican_wallet_balance_hidden';

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('en-UG', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const timeOf = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Every word typed must appear somewhere in the transaction: its name, the app,
 * the note, the amount (either as shown or plain), the direction, the date
 * (as "25 Sep 2026", "September", "Today"…), its status or its id.
 */
function matchesQuery(tx: ICANTransaction, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const d = new Date(tx.created_at);
  const hay = [
    TX_LABELS[tx.transaction_type] ?? tx.transaction_type,
    tx.transaction_type,
    APP_LABELS[tx.source_app] ?? tx.source_app,
    tx.note,
    tx.direction === 'in' ? 'in received incoming' : 'out sent outgoing',
    formatICAN(tx.ican_amount),
    String(Number(tx.ican_amount)),
    d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }),
    d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }),
    d.toLocaleDateString([], { weekday: 'long' }),
    dayLabel(tx.created_at),
    tx.status,
    tx.id,
    tx.reference_id,
  ].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

function dayLabel(ts: string): string {
  const d = new Date(ts);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function txTone(tx: ICANTransaction): { text: string; bg: string } {
  if (tx.transaction_type === 'tithe') return { text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-500/15' };
  if (tx.direction === 'in') return { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-500/15' };
  return { text: 'text-[#9a4a2e] dark:text-rose-400', bg: 'bg-[#f6e6df] dark:bg-rose-500/15' };
}

function TxIcon({ tx }: { tx: ICANTransaction }) {
  const tone = txTone(tx);
  const type = tx.transaction_type as string;
  let inner: ReactNode;
  if (type === 'tithe') inner = <span className="text-[11px] font-bold">10%</span>;
  else if (type === 'buy' || type === 'purchase') inner = <ShoppingCart size={16} />;
  else if (type === 'sell' || type === 'sale') inner = <Banknote size={16} />;
  else if (type === 'refund') inner = <RotateCcw size={16} />;
  else if (type === 'earn' || type === 'cashback') inner = <Sparkles size={16} />;
  else inner = tx.direction === 'in' ? <ArrowDown size={16} /> : <ArrowUp size={16} />;
  return <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${tone.bg} ${tone.text}`}>{inner}</span>;
}

// ─── Send Modal ───────────────────────────────────────────────────────────────

interface SendModalProps {
  userId: string;
  balance: ICANBalance;
  onClose: () => void;
  onDone: () => void;
}

const SEND_DESTINATIONS = [
  { key: 'wallet', label: 'IcanEra wallet', Icon: Gem },
  { key: 'mobilemoneyuganda', label: 'Mobile Money', Icon: Smartphone },
  { key: 'bank', label: 'Bank', Icon: Landmark },
] as const;

function SendModal({ userId, balance, onClose, onDone }: SendModalProps) {
  const [destination, setDestination] = useState<'wallet' | 'mobilemoneyuganda' | 'bank'>('wallet');
  const [step, setStep] = useState<'form' | 'confirm'>('form');

  // ICAN-to-ICAN fields — numbers only: the recipient's 16-digit account number
  // (or a 3… business wallet number, or a phone number), never an "ICA-"/"BIZ" code.
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [resolved, setResolved] = useState<ResolvedRecipient | null>(null);
  const [pin, setPin] = useState('');

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

  // The network comes from the number's prefix; the MTN/Airtel picker only
  // appears when the prefix isn't recognised (same as the ICAN app).
  const detectedNetwork = destination === 'mobilemoneyuganda' ? detectUgandaMobileNetwork(phoneNumber) : null;
  const payoutNetwork = detectedNetwork ?? network;

  const canSend = isPayout
    ? amountNum > 0 && amountNum <= balance.ican &&
      (destination === 'mobilemoneyuganda' ? !!phoneNumber : !!accountNumber && !!bankCode && !!beneficiaryName)
    : !!recipient.trim() && amountNum > 0;

  // Step 1: check the form and (for a wallet) find out who is really being paid.
  const handleContinue = async () => {
    if (!canSend) { toast.error('Fill in all fields'); return; }
    if (amountNum > balance.ican) { toast.error('Insufficient balance'); return; }
    if (destination === 'wallet') {
      setLoading(true);
      try {
        const found = await resolveRecipient(recipient);
        if (!found) { toast.error(`Recipient not found: ${recipient.trim()}`); return; }
        if (found.kind === 'user' && found.userId === userId) { toast.error('Cannot send IcanEra to yourself'); return; }
        setResolved(found);
      } catch (e: any) {
        toast.error(e.message || 'Could not look up the recipient');
        return;
      } finally {
        setLoading(false);
      }
    }
    setPin('');
    setStep('confirm');
  };

  // Step 2: the transaction PIN, then the money moves.
  const handleConfirm = async () => {
    setLoading(true);
    try {
      const pinCheck = await verifyPin(userId, pin);
      if (!pinCheck.success) { toast.error(pinCheck.error || 'Incorrect transaction PIN. Transfer cancelled.'); return; }

      if (destination === 'wallet' && resolved) {
        const memo = note.trim() || `Transfer to ${resolved.name}`;
        if (resolved.kind === 'business') {
          await sendICANToBusiness({ fromUserId: userId, businessProfileId: resolved.businessProfileId!, amount: amountNum, note: memo });
        } else {
          await sendICAN({ fromUserId: userId, toUserId: resolved.userId!, amount: amountNum, note: memo });
        }
        toast.success(`Sent ${formatICAN(amountNum)} IcanEra to ${resolved.name}. No fee.`);
      } else {
        const data = await requestIcanPayout({
          icanAmount: amountNum,
          channel: destination as 'mobilemoneyuganda' | 'bank',
          phoneNumber: destination === 'mobilemoneyuganda' ? phoneNumber : undefined,
          network: destination === 'mobilemoneyuganda' ? payoutNetwork : undefined,
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

  if (step === 'confirm') {
    const rows: Array<[string, string]> = destination === 'wallet' && resolved
      ? [
          ['To', resolved.name],
          [resolved.kind === 'business' ? 'Business wallet' : 'Account', resolved.identifier],
          ['Amount', `${formatICAN(amountNum)} IcanEra`],
          ['Fee', 'None'],
        ]
      : [
          ['To', destination === 'mobilemoneyuganda' ? `${phoneNumber} (${payoutNetwork})` : `${beneficiaryName} · ${accountNumber}`],
          ['Amount', `${formatICAN(amountNum)} IcanEra`],
          [`Fee (${feePercent}%)`, `−UGX ${(ugxGross - ugxNet).toLocaleString()}`],
          ['Recipient gets', `UGX ${ugxNet.toLocaleString()}`],
        ];
    return (
      <WalletSheet title="Confirm" onClose={onClose}>
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#c4a052]/30 bg-white/70 p-4 text-[13px] dark:bg-slate-800/60">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline py-1.5">
                <span className="shrink-0 text-slate-500">{k}</span>
                <span className="classic-leader" />
                <span className="min-w-0 max-w-[62%] break-words text-right font-semibold text-slate-800 dark:text-slate-100">{v}</span>
              </div>
            ))}
          </div>
          <div>
            <label className="classic-label" htmlFor="w-send-pin">Transaction PIN</label>
            <input
              id="w-send-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6}
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••" className="classic-input text-center text-[20px] tracking-[0.5em]" autoFocus
            />
          </div>
          <div className="grid grid-cols-[1fr_1.4fr] gap-3 pt-1">
            <button type="button" onClick={() => setStep('form')} disabled={loading} className="classic-btn classic-btn-outline">Back</button>
            <button type="button" onClick={handleConfirm} disabled={loading || pin.length < 4} className="classic-btn classic-btn-ink">
              {loading ? 'Sending…' : isPayout ? 'Cash out' : 'Send'}
            </button>
          </div>
        </div>
      </WalletSheet>
    );
  }

  return (
    <WalletSheet title="Send" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <span className="classic-label">Send to</span>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Send to">
            {SEND_DESTINATIONS.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                aria-pressed={destination === key}
                onClick={() => setDestination(key)}
                disabled={loading}
                className={`classic-tile flex min-w-0 flex-col items-center gap-1.5 p-2.5 text-center ${destination === key ? 'is-active' : ''}`}
              >
                <Icon size={18} className="text-[#a17c28]" />
                <span className="text-[11.5px] font-semibold leading-tight">{label}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Cards can only receive top-ups, not payouts — sending to a card isn't supported by any provider we integrate with.
          </p>
        </div>

        {destination === 'wallet' && (
          <div>
            <label className="classic-label" htmlFor="w-send-recipient">Recipient account number</label>
            <input
              id="w-send-recipient" value={recipient}
              onChange={(e) => setRecipient(e.target.value.replace(/[^\d+]/g, ''))}
              placeholder="1002345678901234" inputMode="numeric" autoComplete="off"
              className="classic-input font-mono tabular-nums"
            />
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              Numbers only — their 16-digit account number or phone number. A business wallet number starts with 3.
            </p>
          </div>
        )}

        {destination === 'mobilemoneyuganda' && (
          <>
            <div>
              <label className="classic-label" htmlFor="w-send-phone">Mobile Money number</label>
              <input id="w-send-phone" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="e.g. 0770123456" inputMode="tel" className="classic-input" />
            </div>
            {phoneNumber.trim() && (detectedNetwork ? (
              <p className="-mt-2 text-[12px] text-slate-500">Network detected: <span className="font-semibold text-slate-800 dark:text-slate-100">{detectedNetwork === 'AIRTEL' ? 'Airtel' : 'MTN'}</span></p>
            ) : (
              <div>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Network">
                  {(['MTN', 'AIRTEL'] as const).map((n) => (
                    <button key={n} type="button" aria-pressed={network === n} onClick={() => setNetwork(n)} disabled={loading} className={`classic-tile p-2.5 text-center text-sm font-semibold ${network === n ? 'is-active' : ''}`}>
                      {n === 'AIRTEL' ? 'Airtel' : n}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">Couldn't tell the network from this number — pick which one it's on.</p>
              </div>
            ))}
          </>
        )}

        {destination === 'bank' && (
          <>
            <div>
              <label className="classic-label" htmlFor="w-send-bank">Bank code</label>
              <input id="w-send-bank" value={bankCode} onChange={(e) => setBankCode(e.target.value)} className="classic-input" />
            </div>
            <div>
              <label className="classic-label" htmlFor="w-send-acc">Account number</label>
              <input id="w-send-acc" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} inputMode="numeric" className="classic-input" />
            </div>
            <div>
              <label className="classic-label" htmlFor="w-send-name">Account holder name</label>
              <input id="w-send-name" value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} className="classic-input" />
            </div>
          </>
        )}

        <div>
          <label className="classic-label" htmlFor="w-send-amount">Amount (IcanEra)</label>
          <input
            id="w-send-amount"
            type="number" step="0.0001" min="0.0001" max={balance.ican} inputMode="decimal"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0000"
            className="classic-input font-classic-display text-[18px] font-bold tabular-nums lining-nums"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-slate-500">
            <span className="min-w-0 truncate">{amount && !isPayout ? `≈ UGX ${(amountNum * ICAN_TO_UGX).toLocaleString()}` : ' '}</span>
            <button type="button" className="shrink-0 font-semibold text-[#8a6a1f] hover:underline" onClick={() => setAmount(String(balance.ican))}>
              Max {formatICAN(balance.ican)}
            </button>
          </div>
        </div>

        {destination === 'wallet' && (
          <div>
            <label className="classic-label" htmlFor="w-send-note">Note (optional)</label>
            <input id="w-send-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's this for?" className="classic-input" />
          </div>
        )}

        {isPayout && amountNum > 0 && (
          <div className="rounded-2xl border border-[#c4a052]/30 bg-white/70 p-4 text-sm dark:bg-slate-800/60">
            <div className="flex items-center text-slate-600 dark:text-slate-300"><span>Fee ({feePercent}%)</span><span className="classic-leader" /><span>−UGX {(ugxGross - ugxNet).toLocaleString()}</span></div>
            <div className="mt-2 flex items-center font-semibold text-slate-800 dark:text-slate-100"><span>Recipient gets</span><span className="classic-leader" /><span>UGX {ugxNet.toLocaleString()}</span></div>
          </div>
        )}

        <p className="rounded-2xl border border-[#c4a052]/35 bg-[#fdf8ea] px-4 py-3 text-[12px] leading-relaxed text-[#5c4410] dark:bg-[#c4a052]/10 dark:text-[#e6c980]">
          {isPayout
            ? 'Sent via Flutterwave. A 3% cash-out fee applies. If the transfer fails, your IcanEra is refunded automatically.'
            : 'No fee — the recipient receives the full amount you send.'}
        </p>

        <div className="grid grid-cols-[1fr_1.4fr] gap-3 pt-1">
          <button type="button" onClick={onClose} className="classic-btn classic-btn-outline">Cancel</button>
          <button type="button" onClick={handleContinue} disabled={loading || !canSend} className="classic-btn classic-btn-ink">
            {loading ? 'Checking…' : 'Continue'}
          </button>
        </div>
      </div>
    </WalletSheet>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

interface ICANWalletPageProps {
  user: any;
}

type TxTab = 'all' | 'in' | 'out' | 'tithe';

export default function ICANWalletPage({ user }: ICANWalletPageProps) {
  const [balance, setBalance] = useState<ICANBalance>({ ican: 0, ugx: 0, address: null, totalEarned: 0, totalSpent: 0, totalTithe: 0 });
  const [transactions, setTransactions] = useState<ICANTransaction[]>([]);
  const [local, setLocal] = useState<LocalValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TxTab>('all');
  const [historyOpen, setHistoryOpen] = useState(false); // collapsed until asked for
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<WalletAction | 'qr' | null>(null);
  const [selectedTx, setSelectedTx] = useState<ICANTransaction | null>(null);
  const [paymentReceipt, setPaymentReceipt] = useState<any>(null);
  const [balanceHidden, setBalanceHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
  });
  const [needsPin, setNeedsPin] = useState(false);

  const toggleHidden = () => {
    setBalanceHidden((h) => {
      try { localStorage.setItem(HIDE_KEY, h ? '0' : '1'); } catch { /* private mode — just don't remember it */ }
      return !h;
    });
  };

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
      // The balance in the customer's own currency at the LIVE ICAN price —
      // the floor-price figure stays as the fallback if the engine can't be reached.
      supabase.rpc('ican_get_user_wallet_display', { p_user_id: user.id }).then(({ data, error }) => {
        const row = data?.[0];
        if (!error && row && Number(row.price_local) > 0) {
          setLocal({
            currency: row.currency_code || 'UGX',
            priceLocal: Number(row.price_local),
            balanceLocal: Number(row.balance_local),
            appreciationPct: Number(row.appreciation_pct || 0),
          });
        }
      });
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
      toast.error('This QR code is not an IcanEra payment request');
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
      `Amount: ${formatICAN(paymentReceipt.amount)} ${unitLabel(paymentReceipt.currency)}`,
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

  const filteredTx = useMemo(() => transactions.filter((tx) => {
    if (activeTab === 'in') return tx.direction === 'in';
    if (activeTab === 'out') return tx.direction === 'out';
    if (activeTab === 'tithe') return tx.transaction_type === 'tithe';
    return true;
  }).filter((tx) => matchesQuery(tx, query)), [transactions, activeTab, query]);

  // History grouped by day, newest first (the query already returns it that way).
  const groups = useMemo(() => {
    const out: Array<{ label: string; items: ICANTransaction[] }> = [];
    for (const tx of filteredTx) {
      const label = dayLabel(tx.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(tx);
      else out.push({ label, items: [tx] });
    }
    return out;
  }, [filteredTx]);

  // Money in / out for each of the last 7 days.
  const week: DayFlow[] = useMemo(() => {
    const days: DayFlow[] = [];
    const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const index = new Map<string, DayFlow>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const flow: DayFlow = { label: d.toLocaleDateString([], { weekday: 'short' }).slice(0, 3), in: 0, out: 0 };
      days.push(flow);
      index.set(keyOf(d), flow);
    }
    for (const tx of transactions) {
      const flow = index.get(keyOf(new Date(tx.created_at)));
      if (!flow) continue;
      if (tx.direction === 'in') flow.in += Number(tx.ican_amount);
      else flow.out += Number(tx.ican_amount);
    }
    return days;
  }, [transactions]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6" role="status" aria-label="Loading your wallet">
        <div className="h-[250px] animate-pulse rounded-[26px] bg-gradient-to-br from-[#2f2415] to-[#4a3418] opacity-80" />
        <div className="classic-card h-32 animate-pulse" />
        <div className="classic-card h-40 animate-pulse" />
      </div>
    );
  }

  const valueOf = (ican: number) => (local ? formatLocalMoney(ican * local.priceLocal, local.currency) : `UGX ${(ican * ICAN_TO_UGX).toLocaleString()}`);

  const onAction = (a: WalletAction) => setModal(a);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5 sm:py-6">
      <BalanceCard
        balanceText={formatAmount(balance.ican)}
        exactText={formatICAN(balance.ican)}
        hidden={balanceHidden}
        onToggleHidden={toggleHidden}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        local={local}
        fallbackUgx={Number(balance.ugx)}
        address={balance.address}
        onCopyAddress={() => { if (balance.address) navigator.clipboard.writeText(balance.address).then(() => toast.success('Address copied')); }}
        onShowQr={() => setModal('qr')}
      />

      <QuickActions onAction={onAction} />

      <ActivityStrip
        days={week}
        earned={compactNumber(balance.totalEarned)}
        spent={compactNumber(balance.totalSpent)}
        tithe={compactNumber(balance.totalTithe)}
        hidden={balanceHidden}
        format={(n) => compactNumber(n)}
      />

      {/* How the wallet earns — collapsed by default; it is a note, not a headline. */}
      <details className="classic-card group p-4">
        <summary className="flex cursor-pointer list-none items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#fbf3dc] text-[#a17c28] ring-1 ring-[#c4a052]/50 dark:bg-[#c4a052]/15"><Wallet size={16} /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-classic-display text-[15px] font-semibold leading-tight text-slate-800 dark:text-slate-100">Earn IcanEra on every delivery</span>
            <span className="block text-[11.5px] text-slate-500">How earnings and tithe work</span>
          </span>
          <ChevronDown size={18} className="shrink-0 text-[#a17c28] transition-transform group-open:rotate-180" />
        </summary>
        <ul className="mt-3 space-y-2 border-t border-[#c4a052]/25 pt-3 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
          {[
            'Riders earn IcanEra per completed delivery (minimum UGX 5,000).',
            'Chairpersons earn a group bonus in IcanEra each month.',
            'A 10% tithe is deducted automatically from all earnings.',
          ].map((item) => (
            <li key={item} className="flex gap-2"><span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#c4a052]" />{item}</li>
          ))}
        </ul>
      </details>

      {/* Transaction history — collapsed by default, searchable once open */}
      <section id="tx-list" aria-label="Transaction history">
        <h2 className="m-0">
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            aria-expanded={historyOpen}
            aria-controls="tx-panel"
            className="classic-card flex w-full items-center gap-3 px-4 py-3.5 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="font-classic-display text-[20px] font-bold leading-none text-slate-800 dark:text-slate-100">Activity</span>
                <span className="rounded-full bg-[#fbf3dc] px-2 py-0.5 text-[11px] font-semibold text-[#7a5a12] dark:bg-[#c4a052]/15 dark:text-[#e6c980]">{transactions.length}</span>
              </span>
              {!historyOpen && (
                <span className="mt-1 block truncate text-[12px] font-normal text-slate-500">
                  {transactions[0]
                    ? `Latest: ${TX_LABELS[transactions[0].transaction_type] ?? transactions[0].transaction_type} · ${dayLabel(transactions[0].created_at)}, ${timeOf(transactions[0].created_at)}`
                    : 'No transactions yet'}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-[#8a6a1f] dark:text-[#e6c980]">
              {historyOpen ? 'Hide' : 'Show'}
              <ChevronDown size={18} className={`transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
            </span>
          </button>
        </h2>

        {historyOpen && (
          <div id="tx-panel" className="animate-step-in mt-3 space-y-3">
            <div className="relative">
              <Search size={16} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a17c28]" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, app, note, amount, date…"
                aria-label="Search transactions"
                className="classic-input !pl-10 !pr-10"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-slate-500 hover:bg-[#c4a052]/15">
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1 rounded-full border border-[#c4a052]/40 bg-white/80 p-1 dark:bg-slate-800" role="tablist" aria-label="Filter transactions">
                {(['all', 'in', 'out', 'tithe'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    onClick={() => setActiveTab(tab)}
                    className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold capitalize transition-colors ${
                      activeTab === tab ? 'bg-gradient-to-br from-[#231b12] to-[#3d2e18] text-[#f6e7bd] shadow-sm' : 'text-slate-500 hover:text-[#7a5a12]'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              {(query || activeTab !== 'all') && (
                <p className="text-[12px] text-slate-500" aria-live="polite">{filteredTx.length} {filteredTx.length === 1 ? 'result' : 'results'}</p>
              )}
            </div>

        {groups.length === 0 ? (
          <div className="classic-card px-6 py-10 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#fbf3dc] text-[#a17c28] ring-1 ring-[#c4a052]/50 dark:bg-[#c4a052]/15"><Receipt size={22} /></span>
            <p className="mt-3 font-classic-display text-[16px] font-semibold text-slate-800 dark:text-slate-100">{query ? 'No matches' : 'Nothing here yet'}</p>
            <p className="mt-1 text-[13px] text-slate-500">
              {query
                ? `Nothing matches “${query}”. Try a name, an amount or a date.`
                : activeTab === 'all' ? 'Complete a delivery or a ride to earn your first IcanEra.' : 'No transactions match this filter.'}
            </p>
            {query && <button type="button" onClick={() => setQuery('')} className="classic-btn classic-btn-outline mx-auto mt-4 !w-auto !min-h-[40px] !px-5 !text-[13px]">Clear search</button>}
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="classic-eyebrow mb-1.5 px-1">{g.label}</p>
                <ul className="classic-card divide-y divide-[#c4a052]/20 overflow-hidden !rounded-2xl">
                  {g.items.map((tx) => {
                    const isIn = tx.direction === 'in';
                    const tone = txTone(tx);
                    return (
                      <li key={tx.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedTx(tx)}
                          className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[#fbf3dc]/60 focus-visible:bg-[#fbf3dc]/60 focus-visible:outline-none dark:hover:bg-white/5"
                        >
                          <TxIcon tx={tx} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold text-slate-800 dark:text-slate-100">{TX_LABELS[tx.transaction_type] ?? tx.transaction_type}</span>
                            <span className="mt-0.5 block truncate text-[11.5px] text-slate-500">
                              {APP_LABELS[tx.source_app] ?? tx.source_app} · {timeOf(tx.created_at)}{tx.note ? ` · ${tx.note}` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className={`block font-classic-display text-[15px] font-bold tabular-nums lining-nums ${tone.text}`}>
                              {balanceHidden ? '••••' : `${isIn ? '+' : '−'}${formatAmount(tx.ican_amount)}`}
                            </span>
                            <span className="block text-[10.5px] text-slate-400">{balanceHidden ? ' ' : valueOf(tx.ican_amount)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
          </div>
        )}
      </section>

      {/* Transaction detail */}
      {selectedTx && (() => {
        const tx = selectedTx;
        const isIn = tx.direction === 'in';
        const tone = txTone(tx);
        const rows: Array<[string, string]> = [
          ['Value today', valueOf(tx.ican_amount)],
          ['App', APP_LABELS[tx.source_app] ?? tx.source_app],
          ['Date', formatDate(tx.created_at)],
          ['Status', String(tx.status || 'completed')],
          ['Note', tx.note || '—'],
        ];
        return (
          <WalletSheet title="Transaction" onClose={() => setSelectedTx(null)} z={60}>
            <div className="text-center">
              <div className="mx-auto w-fit"><TxIcon tx={tx} /></div>
              <p className="mt-2 text-[13px] font-semibold text-slate-600 dark:text-slate-300">{TX_LABELS[tx.transaction_type] ?? tx.transaction_type}</p>
              <p className={`mt-1 font-classic-display text-[34px] font-bold leading-none tabular-nums lining-nums ${tone.text}`}>
                {isIn ? '+' : '−'}{formatAmount(tx.ican_amount)}
              </p>
            </div>
            <div className="mt-5 rounded-2xl border border-[#c4a052]/30 bg-white/70 p-4 text-[13px] dark:bg-slate-800/60">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-baseline py-1.5">
                  <span className="text-slate-500">{k}</span>
                  <span className="classic-leader" />
                  <span className="max-w-[55%] truncate text-right font-semibold text-slate-800 dark:text-slate-100">{v}</span>
                </div>
              ))}
            </div>
            {tx.id && (
              <div className="mt-4 flex items-center gap-3">
                <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-400" title={tx.id}>ID {tx.id}</p>
                <div className="w-32 shrink-0"><CopyButton text={tx.id} label="Copy ID" /></div>
              </div>
            )}
          </WalletSheet>
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
      {modal === 'qr' && balance.address && (
        <WalletSheet title="Your wallet code" onClose={() => setModal(null)}>
          <AddressQr address={balance.address} />
        </WalletSheet>
      )}
      {modal === 'buy' && (
        <WalletSheet title="Buy IcanEra" onClose={() => setModal(null)}>
          <BuyIcan userId={user.id} onSuccess={() => { loadData(); setModal(null); }} />
        </WalletSheet>
      )}
      {modal === 'sell' && (
        <WalletSheet title="Sell IcanEra" onClose={() => setModal(null)}>
          <SellIcan userId={user.id} onSuccess={() => { loadData(); setModal(null); }} />
        </WalletSheet>
      )}
      {modal === 'sendout' && (
        <WalletSheet title="Cash out" onClose={() => setModal(null)}>
          <SendIcanOut userId={user.id} balance={balance.ican} onSuccess={() => { loadData(); setModal(null); }} />
        </WalletSheet>
      )}
      {paymentReceipt && (
        <WalletSheet title="Payment successful" onClose={() => setPaymentReceipt(null)} z={60}>
          <div className="text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 size={28} /></span>
            <p className="mt-2 text-[13px] text-slate-500">Your IcanEra payment was sent and recorded.</p>
          </div>
          <div className="mt-4 rounded-2xl border border-[#c4a052]/30 bg-white/70 p-4 text-[13px] dark:bg-slate-800/60">
            {([
              ['Receipt', paymentReceipt.receiptNumber],
              ['Amount', `${formatICAN(paymentReceipt.amount)} ${unitLabel(paymentReceipt.currency)}`],
              ['Transaction', paymentReceipt.transactionId || 'N/A'],
            ] as Array<[string, string]>).map(([k, v]) => (
              <div key={k} className="flex items-baseline py-1.5">
                <span className="text-slate-500">{k}</span>
                <span className="classic-leader" />
                <span className="max-w-[55%] truncate text-right font-semibold text-slate-800 dark:text-slate-100">{v}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-[1.4fr_1fr] gap-3">
            <button type="button" onClick={downloadPaymentReceipt} className="classic-btn classic-btn-ink">Download receipt</button>
            <button type="button" onClick={() => setPaymentReceipt(null)} className="classic-btn classic-btn-outline">Close</button>
          </div>
        </WalletSheet>
      )}
      {needsPin && (
        <SetPinPrompt userId={user.id} onDone={() => setNeedsPin(false)} />
      )}
    </div>
  );
}
