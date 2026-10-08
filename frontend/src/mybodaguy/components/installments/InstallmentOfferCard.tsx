import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, Loader, Smartphone, Wallet } from 'lucide-react';
import {
  CartLine, FREQUENCY_LABELS, InstallmentTerms, createInstallmentPlan, formatMoney, formatCoins, formatCoinAmount, coinsFor, cleanAmountInput, unitDecimals,
  COIN_RECOMMENDATION, getWalletCoins, getBusinessSiteInfo, payInstallmentWithFlutterwave, previewSchedule, quoteInstallments,
} from '../../services/installmentService';

interface Props {
  businessProfileId: string;
  cart: CartLine[];
  customerName?: string | null;
  customerPhone?: string | null;
  storeName?: string;
  /** Called with the new plan's code once it exists (the deposit is paid, or waiting to be). */
  onCreated: (code: string, note?: string) => void;
}

const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * "Pay in instalments" for a basket from one seller. Pick a deposit, how many
 * payments after it and how often; the items are reserved while the customer
 * pays, and once the last instalment is in they collect the order or have it
 * delivered. The IcanEra account the customer is already signed in with keeps
 * their balance, receipts and pickup code.
 */
export default function InstallmentOfferCard({ businessProfileId, cart, customerName, customerPhone, storeName = 'IcanEra order', onCreated }: Props) {
  const cartKey = JSON.stringify(cart);
  const [accountsOn, setAccountsOn] = useState<boolean | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [quote, setQuote] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(3);
  const [freq, setFreq] = useState(7);
  const [deposit, setDeposit] = useState('');
  const [busy, setBusy] = useState<'wallet' | 'flutterwave' | null>(null);
  const [error, setError] = useState('');
  const [walletCoins, setWalletCoins] = useState<number | null>(null); // null = unknown

  useEffect(() => {
    let cancelled = false;
    getWalletCoins().then(v => { if (!cancelled) setWalletCoins(v); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getBusinessSiteInfo(businessProfileId).then(i => { if (!cancelled) setAccountsOn(i.accounts_enabled !== false); });
    return () => { cancelled = true; };
  }, [businessProfileId]);

  useEffect(() => {
    setQuote(null);
    if (cart.length === 0) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => { quoteInstallments(businessProfileId, cart).then(q => { if (!cancelled) setQuote(q); }); }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessProfileId, cartKey]);

  const terms: InstallmentTerms | undefined = quote?.terms;
  const cur: string = quote?.currency || terms?.currency || 'UGX';
  const price = Number(quote?.coin_price || 0);
  const unit = Number(terms?.unit || 1);
  const dec = unitDecimals(unit);
  const abroad = quote?.cross_border === true;
  const money = (v: number) => formatMoney(v, cur);
  const items = Number(quote?.items_amount || 0);
  const minDeposit = Number(quote?.min_deposit_amount || 0);
  const minPay = Number(terms?.min_payment_amount || unit);
  const maxN = Number(terms?.max_installments || 6);
  const maxDays = Number(terms?.max_plan_days || 90);
  const freqs = (terms?.frequencies_days || [7, 14, 30]).filter(f => f <= maxDays);
  // 0 = pay it all today (how an order from abroad is simply bought)
  const nChoices = [0, ...Array.from({ length: maxN }, (_, i) => i + 1).filter(v => v * freq <= maxDays)];
  const feePct = Number(terms?.gateway_fee_pct ?? 3.5);

  useEffect(() => {
    if (!terms) return;
    if (!freqs.includes(freq)) setFreq(freqs[0] || 7);
    if (!nChoices.includes(n)) setN(nChoices[nChoices.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms, freq, n]);

  const maxDeposit = n === 0 ? items : items - n * minPay;
  useEffect(() => {
    if (!items) return;
    const suggested = Math.max(minDeposit, Math.ceil((items * 0.3) / unit) * unit);
    setDeposit(String(Number(Math.min(suggested, Math.max(minDeposit, maxDeposit)).toFixed(dec))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, minDeposit]);

  const depositNum = n === 0 ? items : (Number(deposit) || 0);
  const problem = !depositNum ? 'Enter your deposit'
    : depositNum < minDeposit ? `The deposit must be at least ${money(minDeposit)}`
      : depositNum > maxDeposit ? `That leaves too little for ${n} payment${n > 1 ? 's' : ''} — choose a smaller deposit or fewer payments` : '';
  const schedule = useMemo(
    () => (items && !problem ? previewSchedule({ items, deposit: depositNum, installments: n, frequencyDays: freq, unit }) : []),
    [items, depositNum, n, freq, unit, problem],
  );
  const depositCoins = coinsFor(depositNum, price);
  const walletShort = walletCoins !== null && depositCoins !== null && depositNum > 0 && walletCoins + 1e-9 < depositCoins;
  const momoCharge = depositNum ? Math.ceil(Number((depositNum / (1 - feePct / 100) / unit).toFixed(6))) * unit : 0;

  if (cart.length === 0 || accountsOn === false) return null;
  if (quote && quote.success === false) return null;
  if (!quote || !terms) {
    return <div className="flex items-center gap-2 text-xs text-slate-400"><Loader size={14} className="animate-spin" />Checking instalment options…</div>;
  }
  if (!quote.eligible) {
    return <p className="text-xs text-slate-400">Pay in instalments on orders from {money(terms.min_order_amount)}.</p>;
  }

  const start = async (payWith: 'wallet' | 'flutterwave') => {
    if (problem) { setError(problem); return; }
    setError('');
    setBusy(payWith);
    try {
      const plan = await createInstallmentPlan({
        businessProfileId, cart, installments: n, frequencyDays: freq, depositAmount: depositNum, payWith,
        customerName: customerName ?? null, customerPhone: customerPhone ?? null,
      });
      let note: string | undefined;
      if (payWith === 'flutterwave') {
        try {
          await payInstallmentWithFlutterwave(plan.code, depositNum, { name: customerName, phone: customerPhone, title: storeName });
        } catch (err) {
          // The plan exists and holds the stock for a couple of hours: open it so the deposit can be retried.
          note = (err as Error).message || 'The deposit was not completed.';
        }
      }
      onCreated(plan.code, note);
    } catch (err) {
      setError((err as Error).message || 'Could not start this plan. Please try again.');
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-orange-200 bg-orange-50/60 p-3">
      <button type="button" onClick={() => setOpen(v => !v)} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800"><CalendarClock size={16} className="text-orange-500" />Pay in instalments</span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {!open && <p className="text-xs text-slate-500">{abroad
        ? `This shop is abroad. Start from ${money(minDeposit)} now (or pay it all today) — once it is paid in full the seller ships it to your address, and they are only paid when you confirm it arrived.`
        : `Start from ${money(minDeposit)} now, pay the rest over weeks, then collect it or have it delivered once it is paid in full.`}</p>}

      {open && (
        <>
          <p className="text-xs text-slate-500">Your items are reserved for you while you pay. {abroad ? 'Once the last payment is in, you give the seller your shipping address and they send it to you.' : 'Once the last instalment is in, you choose to collect them or have them delivered.'}</p>

          <div>
            <label className="mb-1 block text-xs text-slate-500">{n === 0 ? `You pay today (${cur})` : `Deposit today (${cur})`}</label>
            <input
              inputMode={dec ? 'decimal' : 'numeric'} value={n === 0 ? String(items) : deposit} disabled={n === 0} onChange={e => setDeposit(cleanAmountInput(e.target.value, unit))}
              aria-label="Deposit" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
            />
            {problem && <p className="mt-1 text-xs text-red-600">{problem}</p>}
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500">{n === 0 ? 'Pay' : 'Then pay the rest in'}</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {nChoices.map(v => (
                <button key={v} type="button" onClick={() => setN(v)}
                  className={`min-w-[44px] rounded-lg border px-3 py-1.5 text-xs font-semibold ${n === v ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{v === 0 ? 'All today' : v}</button>
              ))}
              {n > 0 && <span className="text-xs text-slate-400">payment{n > 1 ? 's' : ''}</span>}
            </div>
          </div>

          <div>
            {n > 0 && <label className="mb-1 block text-xs text-slate-500">How often</label>}
            <div className={n > 0 ? 'flex gap-1.5' : 'hidden'}>
              {freqs.map(f => (
                <button key={f} type="button" onClick={() => setFreq(f)}
                  className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold ${freq === f ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{FREQUENCY_LABELS[f] || `every ${f} days`}</button>
              ))}
            </div>
          </div>

          {schedule.length > 0 && (
            <div className="space-y-1 rounded-lg border border-slate-200 bg-white p-2.5">
              {schedule.map(row => (
                <div key={row.n} className="flex justify-between text-xs">
                  <span className="text-slate-500">{row.n === 0 ? 'Today — deposit' : `Payment ${row.n} · ${fmtDate(row.due)}`}</span>
                  <span className="font-semibold text-slate-800">{money(row.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-100 pt-1 text-xs">
                <span className="text-slate-500">Total · fully paid by {fmtDate(schedule[schedule.length - 1].due)}</span>
                <span className="font-semibold text-slate-800">{money(items)}</span>
              </div>
            </div>
          )}
          <p className="text-[11px] text-slate-400">
            You can pay more, or pay it all off, any time. {abroad ? 'Shipping is arranged by the seller.' : 'Delivery (if you choose it) is priced and paid at the end.'} Cancel within {terms.cooling_off_hours} hours for a full refund; after that a {terms.cancel_fee_pct}% fee applies.
          </p>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="space-y-2">
            <p className="text-[11px] leading-relaxed text-emerald-700">★ {COIN_RECOMMENDATION}</p>
            <button type="button" onClick={() => start('wallet')} disabled={!!busy || !!problem || walletShort}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy === 'wallet' ? <Loader size={16} className="animate-spin" /> : <Wallet size={16} />}Pay {formatCoins(depositNum, price) || money(depositNum)} {n === 0 ? '' : 'deposit '}from IcanEra wallet
            </button>
            <button type="button" onClick={() => start('flutterwave')} disabled={!!busy || !!problem}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">
              {busy === 'flutterwave' ? <Loader size={16} className="animate-spin" /> : <Smartphone size={16} />}Pay {money(momoCharge)} with {cur === 'UGX' ? 'Mobile Money, card or bank' : 'card, bank or mobile money'}
            </button>
            {walletCoins !== null && (
              <p className={`text-[11px] ${walletShort ? 'text-red-600' : 'text-slate-400'}`}>
                {walletShort
                  ? `Your IcanEra wallet has ${formatCoinAmount(walletCoins)} (about ${money(walletCoins * price)}) — not enough for this payment. Pay with card, bank or mobile money instead, or add to your wallet first.`
                  : `Your IcanEra wallet: ${formatCoinAmount(walletCoins)} (about ${money(walletCoins * price)}).`}
              </p>
            )}
            <p className="text-[11px] text-slate-400">Card, bank or mobile money adds a {money(momoCharge - depositNum)} processing fee. The wallet has none.</p>
          </div>
        </>
      )}
    </div>
  );
}
