import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, Loader, Smartphone, Wallet } from 'lucide-react';
import {
  CartLine, FREQUENCY_LABELS, InstallmentTerms, createInstallmentPlan, formatUGX, getBusinessSiteInfo,
  payInstallmentWithFlutterwave, previewSchedule, quoteInstallments,
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

const digits = (v: string) => v.replace(/[^0-9]/g, '');
const fmtDate = (d: Date) => d.toLocaleDateString('en-UG', { day: 'numeric', month: 'short' });

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
  const items = Number(quote?.items_ugx || 0);
  const minDeposit = Number(quote?.min_deposit_ugx || 0);
  const minPay = Number(terms?.min_payment_ugx || 1000);
  const maxN = Number(terms?.max_installments || 6);
  const maxDays = Number(terms?.max_plan_days || 90);
  const freqs = (terms?.frequencies_days || [7, 14, 30]).filter(f => f <= maxDays);
  const nChoices = Array.from({ length: maxN }, (_, i) => i + 1).filter(v => v * freq <= maxDays);
  const feePct = Number(terms?.gateway_fee_pct ?? 3.5);

  useEffect(() => {
    if (!terms) return;
    if (!freqs.includes(freq)) setFreq(freqs[0] || 7);
    if (nChoices.length && !nChoices.includes(n)) setN(nChoices[nChoices.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms, freq, n]);

  const maxDeposit = items - n * minPay;
  useEffect(() => {
    if (!items) return;
    const suggested = Math.max(minDeposit, Math.ceil((items * 0.3) / 1000) * 1000);
    setDeposit(String(Math.min(suggested, Math.max(minDeposit, maxDeposit))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, minDeposit]);

  const depositNum = Number(digits(deposit)) || 0;
  const problem = !depositNum ? 'Enter your deposit'
    : depositNum < minDeposit ? `The deposit must be at least ${formatUGX(minDeposit)}`
      : depositNum > maxDeposit ? `That leaves too little for ${n} payment${n > 1 ? 's' : ''} — choose a smaller deposit or fewer payments` : '';
  const schedule = useMemo(
    () => (items && !problem ? previewSchedule({ itemsUgx: items, depositUgx: depositNum, installments: n, frequencyDays: freq }) : []),
    [items, depositNum, n, freq, problem],
  );
  const momoCharge = depositNum ? Math.ceil((depositNum / (1 - feePct / 100)) / 100) * 100 : 0;

  if (cart.length === 0 || accountsOn === false) return null;
  if (quote && quote.success === false) return null;
  if (!quote || !terms) {
    return <div className="flex items-center gap-2 text-xs text-slate-400"><Loader size={14} className="animate-spin" />Checking instalment options…</div>;
  }
  if (!quote.eligible) {
    return <p className="text-xs text-slate-400">Pay in instalments on orders from {formatUGX(terms.min_order_ugx)}.</p>;
  }

  const start = async (payWith: 'wallet' | 'flutterwave') => {
    if (problem) { setError(problem); return; }
    setError('');
    setBusy(payWith);
    try {
      const plan = await createInstallmentPlan({
        businessProfileId, cart, installments: n, frequencyDays: freq, depositUgx: depositNum, payWith,
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
      {!open && <p className="text-xs text-slate-500">Start from {formatUGX(minDeposit)} now, pay the rest over weeks, then collect it or have it delivered once it is paid in full.</p>}

      {open && (
        <>
          <p className="text-xs text-slate-500">Your items are reserved for you while you pay. Once the last instalment is in, you choose to collect them or have them delivered.</p>

          <div>
            <label className="mb-1 block text-xs text-slate-500">Deposit today</label>
            <input
              inputMode="numeric" value={depositNum ? depositNum.toLocaleString('en-UG') : ''} onChange={e => setDeposit(digits(e.target.value))}
              aria-label="Deposit" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
            />
            {problem && <p className="mt-1 text-xs text-red-600">{problem}</p>}
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500">Then pay the rest in</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {nChoices.map(v => (
                <button key={v} type="button" onClick={() => setN(v)}
                  className={`min-w-[44px] rounded-lg border px-3 py-1.5 text-xs font-semibold ${n === v ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{v}</button>
              ))}
              <span className="text-xs text-slate-400">payment{n > 1 ? 's' : ''}</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500">How often</label>
            <div className="flex gap-1.5">
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
                  <span className="font-semibold text-slate-800">{formatUGX(row.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-100 pt-1 text-xs">
                <span className="text-slate-500">Total · fully paid by {fmtDate(schedule[schedule.length - 1].due)}</span>
                <span className="font-semibold text-slate-800">{formatUGX(items)}</span>
              </div>
            </div>
          )}
          <p className="text-[11px] text-slate-400">
            You can pay more, or pay it all off, any time. Delivery (if you choose it) is priced and paid at the end. Cancel within {terms.cooling_off_hours} hours for a full refund; after that a {terms.cancel_fee_pct}% fee applies.
          </p>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="space-y-2">
            <button type="button" onClick={() => start('wallet')} disabled={!!busy || !!problem}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy === 'wallet' ? <Loader size={16} className="animate-spin" /> : <Wallet size={16} />}Pay {formatUGX(depositNum)} deposit from IcanEra wallet
            </button>
            <button type="button" onClick={() => start('flutterwave')} disabled={!!busy || !!problem}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">
              {busy === 'flutterwave' ? <Loader size={16} className="animate-spin" /> : <Smartphone size={16} />}Pay {formatUGX(momoCharge)} with Mobile Money, card or bank
            </button>
            <p className="text-[11px] text-slate-400">Mobile Money, card or bank adds a {formatUGX(momoCharge - depositNum)} processing fee. The wallet has none.</p>
          </div>
        </>
      )}
    </div>
  );
}
