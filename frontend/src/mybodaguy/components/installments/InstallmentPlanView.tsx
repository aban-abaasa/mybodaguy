import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowLeft, Bike, CalendarClock, CheckCircle, Clock, ExternalLink, Globe, Loader, MapPin, Navigation, Package, Plane, QrCode, Smartphone, Store, Truck, Wallet, X,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  FREQUENCY_LABELS, InstallmentPlan, InstallmentTerms, ShippingAddress, Shipment, STATUS_LABELS, cancelInstallmentPlan, chooseInstallmentDelivery, chooseInstallmentPickup,
  chooseInstallmentShipping, confirmInstallmentReceived, reportInstallmentProblem, cleanAmountInput, coinsFor, formatCoinAmount, formatMoney, unitDecimals,
  clearInstallmentDelivery, formatCoins, COIN_RECOMMENDATION, getWalletCoins, getInstallmentPlan, payInstallmentFromWallet, payInstallmentWithFlutterwave, quoteInstallmentDelivery,
  resumePendingInstallmentPayment, installmentPlanUrl,
} from '../../services/installmentService';

const DELIVERY_WINDOWS = [
  { hours: 1, label: 'Within 1 hour' }, { hours: 2, label: 'Within 2 hours' }, { hours: 4, label: 'Within 4 hours' },
  { hours: 8, label: 'Within 8 hours' }, { hours: 24, label: 'Within 24 hours' }, { hours: 48, label: 'Within 2 days' },
];
const VEHICLES: { value: string | null; label: string }[] = [
  { value: null, label: 'Any' }, { value: 'motorcycle', label: '🏍️ Boda' }, { value: 'car', label: '🚗 Car' }, { value: 'van', label: '🚐 Van' },
];
const DONE_PAYING = ['pickup_ready', 'dispatched', 'shipping_pending', 'shipped', 'disputed'];
const WAITING = ['awaiting_deposit', 'active', 'pickup_ready', 'dispatched', 'shipping_pending', 'shipped', 'disputed'];
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

const tone = (status: string) => ({
  ready: 'bg-emerald-100 text-emerald-700', pickup_ready: 'bg-emerald-100 text-emerald-700', completed: 'bg-emerald-100 text-emerald-700',
  dispatched: 'bg-sky-100 text-sky-700', shipping_pending: 'bg-amber-100 text-amber-700', shipped: 'bg-sky-100 text-sky-700', disputed: 'bg-red-100 text-red-700', active: 'bg-indigo-100 text-indigo-700', awaiting_deposit: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-slate-100 text-slate-600', lapsed: 'bg-red-100 text-red-700',
} as Record<string, string>)[status] || 'bg-slate-100 text-slate-600';

const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`classic-card p-4 ${className}`}>{children}</div>
);

interface Props {
  code: string;
  onBack: () => void;
  /** A message to show on top (e.g. the deposit was not completed). */
  notice?: string;
}

/**
 * One instalment plan: what is paid and owed, pay more (wallet or Mobile Money
 * / card / bank) and — once the items are paid in full — collect them at the
 * store or have them delivered. Same plan, same rules as on icanera.space.
 */
export default function InstallmentPlanView({ code, onBack, notice: initialNotice = '' }: Props) {
  const [data, setData] = useState<{ plan: InstallmentPlan; terms: InstallmentTerms } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState(initialNotice);
  const [flash, setFlash] = useState('');
  const busyRef = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setData(await getInstallmentPlan(code));
      setLoadError('');
    } catch (err) {
      setLoadError((err as Error).message || 'Could not load this plan');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    (async () => {
      const resumed = await resumePendingInstallmentPayment(code);
      if (resumed) setFlash('Your payment was confirmed.');
      await load();
    })();
  }, [code, load]);

  const plan = data?.plan;
  useEffect(() => {
    if (!plan || !WAITING.includes(plan.status)) return undefined;
    const timer = setInterval(() => { if (!document.hidden && !busyRef.current) load(true); }, 15000);
    return () => clearInterval(timer);
  }, [plan, load]);

  const after = async (message?: string) => { if (message) setFlash(message); setNotice(''); await load(true); };

  if (loading) return <div className="flex justify-center py-16"><Loader className="animate-spin text-slate-400" /></div>;
  if (!data || !plan) {
    return (
      <div className="space-y-3 py-10 text-center">
        <AlertCircle className="mx-auto text-slate-300" size={40} />
        <p className="font-semibold text-slate-700">{loadError || 'This plan isn\'t available'}</p>
        <p className="text-sm text-slate-400">It may belong to a different account.</p>
        <button onClick={onBack} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Back</button>
      </div>
    );
  }

  const { terms } = data;
  const voided = plan.status === 'cancelled' || plan.status === 'lapsed';
  const closed = voided || plan.status === 'completed';
  const money = (v: number) => formatMoney(v, plan.currency);
  const itemsPaidUp = plan.paid_amount >= plan.items_amount;
  const deliveryFeeDue = plan.fulfilment === 'delivery' && plan.status === 'active' && itemsPaidUp;
  const canPay = plan.status === 'awaiting_deposit' || plan.status === 'active';
  const pct = Math.min(100, Math.round((plan.paid_amount / Math.max(plan.total_amount, 1)) * 100));

  return (
    <div className="space-y-3 pb-10">
      <div className="flex items-center gap-2">
        <button onClick={onBack} aria-label="Back to my plans" className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-800">{plan.seller_name || 'Your order'}</p>
          <p className="font-mono text-[11px] text-slate-400">Plan {plan.code}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone(plan.status)}`}>{STATUS_LABELS[plan.status] || plan.status}</span>
      </div>

      {notice && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{notice} Your items are still held — you can pay the deposit below.</span>
        </div>
      )}
      {flash && (
        <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle size={16} className="mt-0.5 shrink-0" /><span>{flash}</span>
          <button className="ml-auto text-emerald-600" onClick={() => setFlash('')} aria-label="Dismiss"><X size={16} /></button>
        </div>
      )}

      <Card>
        <div className="mb-2 flex items-end justify-between">
          <div>
            <p className="text-xs text-slate-400">{voided ? 'You had paid' : 'Paid so far'}</p>
            <p className="text-2xl font-bold text-slate-800">{money(plan.paid_amount)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">{voided ? 'Returned to your wallet' : plan.balance_amount > 0 ? 'Still to pay' : 'Balance'}</p>
            <p className="text-lg font-semibold text-slate-600">{money(voided ? plan.refunded_amount : plan.balance_amount)}</p>
          </div>
        </div>
        {!voided && <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-orange-500 transition-all" style={{ width: `${pct}%` }} /></div>}
        <p className="mt-1.5 text-[11px] text-slate-400">
          Total {money(plan.total_amount)}{plan.delivery_fee_amount > 0 ? ` (items ${money(plan.items_amount)} + delivery ${money(plan.delivery_fee_amount)})` : ''}
          {!closed && !DONE_PAYING.includes(plan.status) ? ` · due in full by ${fmtDate(plan.final_due_at)}` : ''}
        </p>
        {plan.held_ican > 0 && !closed && <p className="mt-0.5 text-[11px] text-slate-400">Held for you as {formatCoinAmount(plan.held_ican)} until your order is handed over.</p>}
        <a href={installmentPlanUrl(plan.code)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-orange-600 underline">Open this plan on icanera.space <ExternalLink size={12} /></a>
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          {plan.items.map(it => (
            <div key={it.product_id} className="flex justify-between gap-2 text-sm">
              <span className="truncate text-slate-600">{it.name} × {Number(it.quantity)}</span>
              <span className="shrink-0 text-slate-400">{money(it.line_total)}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-400"><Store size={14} className="mt-0.5 shrink-0" />From {plan.store_name}{plan.store_address ? `, ${plan.store_address}` : ''}</p>
        {plan.cross_border && <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-sky-600"><Globe size={14} className="mt-0.5 shrink-0" />This shop is abroad — it ships to you once you have paid in full.</p>}
      </Card>

      {voided && (
        <Card>
          <p className="mb-1 font-semibold text-slate-800">{plan.status === 'lapsed' ? 'This plan lapsed' : 'This plan was cancelled'}</p>
          <p className="text-sm text-slate-500">{plan.cancel_reason}</p>
          <p className="mt-2 text-sm text-slate-700">{money(plan.refunded_amount)} was returned to your IcanEra wallet{plan.cancel_fee_amount > 0 ? `, after a ${money(plan.cancel_fee_amount)} cancel fee` : ''}.</p>
        </Card>
      )}

      {canPay && !deliveryFeeDue && <PayBox plan={plan} terms={terms} onDone={after} busyRef={busyRef} />}
      {plan.status === 'ready' && plan.cross_border && <ShippingForm plan={plan} onDone={after} busyRef={busyRef} />}
      {plan.status === 'ready' && !plan.cross_border && <Fulfilment plan={plan} onDone={after} busyRef={busyRef} />}
      {['shipping_pending', 'shipped', 'disputed'].includes(plan.status) && <ShipmentCard plan={plan} onDone={after} busyRef={busyRef} />}

      {deliveryFeeDue && (
        <>
          <Card>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-semibold text-slate-800"><Truck size={16} />Delivery chosen</p>
                <p className="mt-1 text-sm text-slate-500">To {plan.delivery?.address || 'your location'} · within {plan.delivery?.max_hours}h of dispatch</p>
                <p className="mt-1 text-sm text-slate-600">The real rider fare is {money(plan.delivery_fee_amount)}. Pay it and a rider is booked straight away.</p>
              </div>
              <button className="shrink-0 text-xs text-orange-600 underline"
                onClick={async () => { try { await clearInstallmentDelivery(plan.code); await after('Delivery cleared — choose again.'); } catch (err) { setNotice((err as Error).message); } }}>Change</button>
            </div>
          </Card>
          <PayBox plan={plan} terms={terms} onDone={after} busyRef={busyRef} feeMode />
        </>
      )}

      {plan.status === 'pickup_ready' && <PickupCard plan={plan} />}

      {plan.status === 'dispatched' && (
        <Card className="text-center">
          <Truck className="mx-auto mb-2 text-sky-500" size={36} />
          <p className="font-semibold text-slate-800">Your order is on its way</p>
          <p className="mt-1 text-sm text-slate-500">A BodaGoera rider has been booked. The seller is only paid once the rider scans the order out of the store — track it and confirm delivery on your receipt.</p>
          {plan.verify_url && <a href={plan.verify_url} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 px-4 py-2 text-sm font-semibold text-white">Open delivery receipt</a>}
          <p className="mt-2 text-[11px] text-slate-400">If it misses the window you chose, you can reclaim your money from the rider on that receipt.</p>
        </Card>
      )}

      {plan.status === 'completed' && (
        <Card className="text-center">
          <CheckCircle className="mx-auto mb-2 text-emerald-500" size={40} />
          <p className="font-semibold text-slate-800">All done — thank you!</p>
          <p className="mt-1 text-sm text-slate-500">{plan.fulfilment === 'pickup' ? 'You collected your order.' : plan.fulfilment === 'ship' ? 'You received your order.' : 'Your order was delivered.'}</p>
        </Card>
      )}

      {plan.schedule && plan.n_installments > 0 && !closed && !DONE_PAYING.includes(plan.status) && (
        <Card>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><CalendarClock size={16} />Schedule</p>
          <div className="space-y-1.5">
            {plan.schedule.map(row => (
              <div key={row.n} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{row.n === 0 ? 'Deposit' : `Payment ${row.n}`} · {fmtDate(row.due_at)}</span>
                <span className={row.status === 'paid' ? 'text-emerald-600' : row.status === 'overdue' ? 'text-red-600' : 'text-slate-700'}>
                  {row.status === 'paid' ? `Paid ${money(row.amount)}` : `${money(row.amount - row.paid_amount)}${row.status === 'overdue' ? ' · overdue' : ''}`}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Every {plan.frequency_days} days ({FREQUENCY_LABELS[plan.frequency_days] || ''}). Pay more or settle early whenever you like.</p>
        </Card>
      )}

      {plan.events && plan.events.length > 0 && (
        <Card>
          <p className="mb-2 text-sm font-semibold text-slate-800">History</p>
          <div className="space-y-1.5">
            {[...plan.events].reverse().map((ev, i) => (
              <div key={i} className="flex justify-between gap-2 text-xs">
                <span className="text-slate-500">{ev.note || ev.kind}</span>
                <span className="shrink-0 text-slate-400">{ev.amount ? `${money(ev.amount)} · ` : ''}{fmtDate(ev.at)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {plan.can_cancel && (
        <button
          className="w-full py-2 text-xs text-slate-400 underline hover:text-red-500"
          onClick={async () => {
            const fee = plan.cancel_fee_amount_now;
            const ok = window.confirm(plan.paid_amount > 0
              ? `Cancel this plan? ${fee > 0 ? `A ${terms.cancel_fee_pct}% fee (${money(fee)}) applies and the rest (${money(plan.paid_amount - fee)})` : `All ${money(plan.paid_amount)}`} goes back to your IcanEra wallet.`
              : 'Cancel this plan and release the items?');
            if (!ok) return;
            try { await cancelInstallmentPlan(plan.code); await after('Plan cancelled — your money is back in your wallet.'); } catch (err) { setNotice((err as Error).message); }
          }}
        >
          Cancel this plan{plan.in_cooling_off ? ' (free for now)' : ''}
        </button>
      )}
    </div>
  );
}

// ── Pay more ────────────────────────────────────────────────────────────────

function PayBox({ plan, terms, onDone, busyRef, feeMode = false }: {
  plan: InstallmentPlan; terms: InstallmentTerms; onDone: (m?: string) => Promise<void>; busyRef: { current: boolean }; feeMode?: boolean;
}) {
  const money = (v: number) => formatMoney(v, plan.currency);
  const nextSlot = plan.schedule?.find(r => r.status !== 'paid');
  const unit = Number(plan.unit || 1);
  const dec = unitDecimals(unit);
  const price = Number(plan.coin_price || 0);
  const fixed = feeMode ? plan.balance_amount : plan.status === 'awaiting_deposit' ? plan.deposit_amount : null;
  const suggested = fixed ?? Math.min(plan.balance_amount, nextSlot ? Number((nextSlot.amount - nextSlot.paid_amount).toFixed(dec)) : plan.balance_amount);
  const [amount, setAmount] = useState(String(suggested));
  const [busy, setBusy] = useState<'wallet' | 'flutterwave' | null>(null);
  const [error, setError] = useState('');
  const [walletCoins, setWalletCoins] = useState<number | null>(null); // null = unknown
  useEffect(() => { setAmount(String(suggested)); }, [suggested]);
  useEffect(() => {
    let cancelled = false;
    getWalletCoins().then(v => { if (!cancelled) setWalletCoins(v); });
    return () => { cancelled = true; };
  }, [plan.paid_amount]);

  const amt = fixed ?? (Number(amount) || 0);
  const minPay = Math.min(Number(terms.min_payment_amount || unit), plan.balance_amount);
  const problem = !amt ? 'Enter an amount' : amt > plan.balance_amount + 1e-9 ? `The most you can pay is ${money(plan.balance_amount)}` : amt + 1e-9 < minPay ? `The smallest payment is ${money(minPay)}` : '';
  const feePct = Number(terms.gateway_fee_pct ?? 3.5);
  const amtCoins = coinsFor(amt, price);
  const walletShort = walletCoins !== null && amtCoins !== null && amt > 0 && walletCoins + 1e-9 < amtCoins;
  const charge = amt ? Math.ceil(Number((amt / (1 - feePct / 100) / unit).toFixed(6))) * unit : 0;

  const run = async (kind: 'wallet' | 'flutterwave') => {
    if (problem) { setError(problem); return; }
    setError(''); setBusy(kind); busyRef.current = true;
    try {
      const res = kind === 'wallet'
        ? await payInstallmentFromWallet(plan.code, amt)
        : await payInstallmentWithFlutterwave(plan.code, amt, { name: plan.customer_name, phone: plan.customer_phone, title: plan.seller_name || 'IcanEra' });
      await onDone(res.status === 'dispatched' ? 'Paid — a rider has been booked for your delivery.' : 'Payment received — thank you.');
    } catch (err) {
      setError((err as Error).message || 'Payment failed. Please try again.');
    } finally {
      setBusy(null); busyRef.current = false;
    }
  };

  return (
    <Card>
      <p className="mb-2 text-sm font-semibold text-slate-800">{feeMode ? 'Pay the delivery fare' : plan.status === 'awaiting_deposit' ? 'Pay your deposit' : 'Make a payment'}</p>
      {fixed == null ? (
        <>
          <input inputMode={dec ? 'decimal' : 'numeric'} value={amount} onChange={e => setAmount(cleanAmountInput(e.target.value, unit))} aria-label={`Amount to pay (${plan.currency})`}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-lg font-semibold text-slate-800" />
          <div className="mt-2 flex gap-2">
            {nextSlot && <button type="button" className="flex-1 rounded-lg border border-slate-200 py-1.5 text-xs text-slate-600" onClick={() => setAmount(String(Number((nextSlot.amount - nextSlot.paid_amount).toFixed(dec))))}>Next payment</button>}
            <button type="button" className="flex-1 rounded-lg border border-slate-200 py-1.5 text-xs text-slate-600" onClick={() => setAmount(String(plan.balance_amount))}>Pay it all · {money(plan.balance_amount)}</button>
          </div>
        </>
      ) : (
        <p className="text-2xl font-bold text-slate-800">{money(fixed)}</p>
      )}
      {(error || problem) && amt > 0 && <p className="mt-2 text-xs text-red-600">{error || problem}</p>}
      <div className="mt-3 space-y-2">
        <p className="text-[11px] leading-relaxed text-emerald-700">★ {COIN_RECOMMENDATION}</p>
        <button type="button" disabled={!!busy || !!problem || walletShort} onClick={() => run('wallet')}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy === 'wallet' ? <Loader size={16} className="animate-spin" /> : <Wallet size={16} />}Pay {formatCoins(amt, price) || money(amt)} from IcanEra wallet
        </button>
        <button type="button" disabled={!!busy || !!problem} onClick={() => run('flutterwave')}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">
          {busy === 'flutterwave' ? <Loader size={16} className="animate-spin" /> : <Smartphone size={16} />}Pay {money(charge)} with {plan.currency === 'UGX' ? 'Mobile Money, card or bank' : 'card, bank or mobile money'}
        </button>
        {walletCoins !== null && (
          <p className={`text-[11px] ${walletShort ? 'text-red-600' : 'text-slate-400'}`}>
            {walletShort
              ? `Your IcanEra wallet has ${formatCoinAmount(walletCoins)} (about ${money(walletCoins * price)}) — not enough for this payment. Use card, bank or mobile money, or add to your wallet first.`
              : `Your IcanEra wallet: ${formatCoinAmount(walletCoins)} (about ${money(walletCoins * price)}).`}
          </p>
        )}
        <p className="text-[11px] text-slate-400">Card, bank or mobile money adds a {money(charge - amt)} processing fee; the wallet has none. Your money is held for you and is only released to the seller when you collect, it is delivered{plan.cross_border ? ', or you confirm it arrived' : ''}.</p>
      </div>
    </Card>
  );
}

// ── Collect or deliver ──────────────────────────────────────────────────────

function Fulfilment({ plan, onDone, busyRef }: { plan: InstallmentPlan; onDone: (m?: string) => Promise<void>; busyRef: { current: boolean } }) {
  const money = (v: number) => formatMoney(v, plan.currency);
  const [mode, setMode] = useState<'pickup' | 'delivery' | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [address, setAddress] = useState('');
  const [hours, setHours] = useState(4);
  const [vehicle, setVehicle] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [quote, setQuote] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { setQuote(null); }, [coords, vehicle]);

  const shareLocation = () => {
    if (!navigator.geolocation) { setError('Your browser can\'t share location — choose collection instead.'); return; }
    setLocating(true); setError('');
    navigator.geolocation.getCurrentPosition(
      pos => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(false); },
      () => { setError('Could not get your location — please allow location access to book delivery.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const run = async (name: string, fn: () => Promise<void>) => {
    setError(''); setBusy(name); busyRef.current = true;
    try { await fn(); } catch (err) { setError((err as Error).message || 'Something went wrong. Please try again.'); } finally { setBusy(null); busyRef.current = false; }
  };

  const options: [('pickup' | 'delivery'), typeof Package, string, string][] = [
    ['pickup', Package, 'Collect', 'at the store · free'], ['delivery', Truck, 'Delivery', 'a rider brings it'],
  ];

  return (
    <Card>
      <p className="flex items-center gap-2 font-semibold text-slate-800"><CheckCircle size={16} className="text-emerald-500" />Your items are paid in full</p>
      <p className="mb-3 mt-1 text-sm text-slate-500">How would you like to get them?</p>
      <div className={`grid gap-2 ${plan.delivery_available ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {options.filter(([id]) => id !== 'delivery' || plan.delivery_available).map(([id, Icon, title, sub]) => (
          <button key={id} type="button" onClick={() => { setMode(id); setError(''); }}
            className={`rounded-xl border p-3 text-center transition ${mode === id ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white'}`}>
            <Icon size={24} className="mx-auto mb-1 text-orange-500" />
            <span className="block text-sm font-semibold text-slate-800">{title}</span>
            <span className="block text-[11px] text-slate-500">{sub}</span>
          </button>
        ))}
      </div>

      {mode === 'pickup' && (
        <div className="mt-3 space-y-2">
          <p className="flex items-start gap-2 text-sm text-slate-600"><MapPin size={16} className="mt-0.5 shrink-0 text-slate-400" />{plan.store_name}{plan.store_address ? `, ${plan.store_address}` : ''}</p>
          <p className="text-[11px] text-slate-400">You will get a pickup code. The store scans it when it hands your items over — only then is the seller paid.</p>
          <button type="button" disabled={!!busy} onClick={() => run('pickup', async () => { await chooseInstallmentPickup(plan.code); await onDone('Ready to collect — show your pickup code at the store.'); })}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy === 'pickup' ? <Loader size={16} className="animate-spin" /> : <QrCode size={16} />}Get my pickup code
          </button>
        </div>
      )}

      {mode === 'delivery' && (
        <div className="mt-3 space-y-2">
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Delivery address (street, landmark)"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
          <button type="button" onClick={shareLocation} disabled={locating}
            className={`flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-xs font-semibold ${coords ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}>
            {locating ? <Loader size={14} className="animate-spin" /> : <Navigation size={14} />}{coords ? 'Delivery location shared' : 'Share my delivery location'}
          </button>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs text-slate-500"><Clock size={14} />Deliver within</label>
            <select value={hours} onChange={e => setHours(Number(e.target.value))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
              {DELIVERY_WINDOWS.map(w => <option key={w.hours} value={w.hours}>{w.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">If the rider misses this window you can reclaim your money from their account.</p>
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs text-slate-500"><Bike size={14} />Vehicle</label>
            <div className="flex gap-1.5">
              {VEHICLES.map(v => (
                <button key={v.value ?? 'any'} type="button" onClick={() => setVehicle(v.value)}
                  className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold ${vehicle === v.value ? 'border-orange-500 bg-orange-50 text-slate-800' : 'border-slate-200 bg-white text-slate-500'}`}>{v.label}</button>
              ))}
            </div>
          </div>

          {!quote ? (
            <button type="button" disabled={!coords || !!busy}
              onClick={() => run('quote', async () => { if (coords) setQuote(await quoteInstallmentDelivery(plan.code, coords.lat, coords.lng, vehicle ? [vehicle] : null)); })}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">
              {busy === 'quote' ? <Loader size={16} className="animate-spin" /> : <Truck size={16} />}{coords ? 'Get the delivery price' : 'Share your location first'}
            </button>
          ) : (
            <div className="space-y-1 rounded-lg border border-slate-200 p-3">
              <div className="flex justify-between text-sm"><span className="text-slate-500">Rider</span><span className="text-slate-800">{quote.rider_name} · ~{quote.rider_eta_min} min</span></div>
              {quote.subsidy_amount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">Covered by the seller</span><span className="text-emerald-600">-{money(quote.subsidy_amount)}</span></div>}
              <div className="flex justify-between border-t border-slate-100 pt-1 text-base font-semibold"><span className="text-slate-600">Delivery fare</span><span className="text-slate-800">{quote.delivery_fee_amount > 0 ? money(quote.delivery_fee_amount) : 'Free'}</span></div>
              <button type="button" disabled={!!busy}
                onClick={() => run('deliver', async () => {
                  if (!coords) return;
                  const res = await chooseInstallmentDelivery(plan.code, { address, lat: coords.lat, lng: coords.lng, maxHours: hours, vehicleTypes: vehicle ? [vehicle] : null });
                  await onDone(res.status === 'dispatched' ? 'A rider has been booked — your delivery is on its way.' : 'Delivery chosen — pay the fare below and a rider is booked at once.');
                })}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy === 'deliver' ? <Loader size={16} className="animate-spin" /> : null}{quote.delivery_fee_amount > 0 ? 'Choose delivery' : 'Book my free delivery'}
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </Card>
  );
}

// ── Collecting ──────────────────────────────────────────────────────────────

function PickupCard({ plan }: { plan: InstallmentPlan }) {
  const code = plan.pickup_code || plan.receipt_code || '';
  const url = useMemo(() => plan.verify_url || `https://bodagoera.icanera.space/verify/${code}`, [plan.verify_url, code]);
  return (
    <Card className="text-center">
      <p className="mb-1 font-semibold text-slate-800">Show this at the store</p>
      <p className="mb-3 text-sm text-slate-500">{plan.store_name}{plan.store_address ? `, ${plan.store_address}` : ''}</p>
      <div className="inline-block rounded-xl border border-slate-200 bg-white p-3"><QRCodeCanvas value={url} size={168} /></div>
      <p className="mt-3 font-mono text-2xl tracking-[0.25em] text-slate-800">{code}</p>
      <p className="mt-2 text-[11px] text-slate-400">The store scans this QR (or types the code) when it hands over your items. Only then is the seller paid — until then your money is held safe.</p>
    </Card>
  );
}

// ── Shops abroad: where to send it, then follow the parcel ──────────────────

const ADDRESS_KEY = 'icanera_ship_address';
const readAddress = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(ADDRESS_KEY) || '{}') || {}; } catch { return {}; } };

const ADDRESS_FIELDS: [keyof ShippingAddress, string, string][] = [
  ['name', 'Full name', 'name'], ['phone', 'Phone (with country code)', 'tel'], ['line1', 'Street address', 'address-line1'],
  ['line2', 'Apartment, landmark (optional)', 'address-line2'], ['city', 'City / town', 'address-level2'],
  ['region', 'State / region (optional)', 'address-level1'], ['postal_code', 'Postal code (optional)', 'postal-code'], ['country', 'Country', 'country-name'],
];

function ShippingForm({ plan, onDone, busyRef }: { plan: InstallmentPlan; onDone: (m?: string) => Promise<void>; busyRef: { current: boolean } }) {
  const [addr, setAddr] = useState<ShippingAddress>(() => ({ name: plan.customer_name || '', phone: plan.customer_phone || '', ...readAddress() }));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setError(''); setBusy(true); busyRef.current = true;
    try {
      await chooseInstallmentShipping(plan.code, { ...addr, note });
      try { localStorage.setItem(ADDRESS_KEY, JSON.stringify(addr)); } catch { /* private mode */ }
      await onDone('Thank you — the seller has been asked to ship your order.');
    } catch (err) {
      setError((err as Error).message || 'Could not save your address.');
    } finally {
      setBusy(false); busyRef.current = false;
    }
  };
  return (
    <Card>
      <p className="flex items-center gap-2 font-semibold text-slate-800"><CheckCircle size={16} className="text-emerald-500" />Your order is paid in full</p>
      <p className="mb-3 mt-1 flex items-start gap-2 text-sm text-slate-500"><Plane size={16} className="mt-0.5 shrink-0 text-sky-500" />Where should {plan.seller_name || 'the seller'} send it? Your money stays held and is only paid to the seller when you confirm it arrived.</p>
      <div className="grid grid-cols-1 gap-2">
        {ADDRESS_FIELDS.map(([key, label, auto]) => (
          <input key={key} value={addr[key] || ''} onChange={e => setAddr(a => ({ ...a, [key]: e.target.value }))} placeholder={label} aria-label={label} autoComplete={auto}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
        ))}
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Anything the courier should know (optional)" rows={2} aria-label="Note for the courier"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <button type="button" disabled={busy} onClick={submit}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? <Loader size={16} className="animate-spin" /> : <Plane size={16} />}Ship it to me
      </button>
      <p className="mt-2 text-[11px] text-slate-400">Import duties and taxes in your country, if any, are not included in the price.</p>
    </Card>
  );
}

function ShipmentCard({ plan, onDone, busyRef }: { plan: InstallmentPlan; onDone: (m?: string) => Promise<void>; busyRef: { current: boolean } }) {
  const [reporting, setReporting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const sh: Shipment = plan.shipment || {};
  const to: ShippingAddress = plan.shipping || {};
  const run = async (name: string, fn: () => Promise<unknown>, message: string) => {
    setError(''); setBusy(name); busyRef.current = true;
    try { await fn(); await onDone(message); } catch (err) { setError((err as Error).message || 'Something went wrong. Please try again.'); } finally { setBusy(''); busyRef.current = false; }
  };
  return (
    <Card>
      {plan.status === 'shipping_pending' && (
        <>
          <p className="flex items-center gap-2 font-semibold text-slate-800"><Package size={16} className="text-amber-500" />Waiting for the seller to ship</p>
          <p className="mt-1 text-sm text-slate-500">They have your address. If it isn't shipped by {fmtDate(plan.ship_deadline_at)} your money is returned to your wallet.</p>
        </>
      )}
      {plan.status === 'shipped' && (
        <>
          <p className="flex items-center gap-2 font-semibold text-slate-800"><Plane size={16} className="text-sky-500" />On its way to you</p>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Carrier</span><span className="text-slate-800">{sh.carrier}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Tracking number</span><span className="font-mono text-slate-800">{sh.tracking_no}</span></div>
            {sh.eta_days ? <div className="flex justify-between"><span className="text-slate-500">Usually takes</span><span className="text-slate-800">about {sh.eta_days} days</span></div> : null}
            {/^https?:\/\//i.test(sh.tracking_url || '') && <a href={sh.tracking_url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-sm text-orange-600 underline">Track the parcel <ExternalLink size={14} /></a>}
          </div>
          {!reporting ? (
            <div className="mt-3 space-y-2">
              <button type="button" disabled={!!busy} onClick={() => run('received', () => confirmInstallmentReceived(plan.code), 'Thank you — the seller has been paid.')}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy === 'received' ? <Loader size={16} className="animate-spin" /> : <CheckCircle size={16} />}I received it — pay the seller
              </button>
              <button type="button" onClick={() => setReporting(true)} className="w-full py-1 text-xs text-slate-500 underline hover:text-red-500">There is a problem with my order</button>
              <p className="text-[11px] text-slate-400">If you do nothing, the seller is paid automatically {plan.auto_release_at ? `on ${fmtDate(plan.auto_release_at)}` : 'after the protection period'}.</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="What went wrong? (it hasn't arrived, it's damaged, it's not what you ordered…)" aria-label="What went wrong"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
              <button type="button" disabled={!!busy} onClick={() => run('report', () => reportInstallmentProblem(plan.code, text), 'We have your report — your money stays held while support looks at it.')}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy === 'report' ? <Loader size={16} className="animate-spin" /> : null}Report the problem
              </button>
              <button type="button" onClick={() => setReporting(false)} className="w-full py-1 text-xs text-slate-500 underline">Back</button>
            </div>
          )}
        </>
      )}
      {plan.status === 'disputed' && (
        <>
          <p className="flex items-center gap-2 font-semibold text-slate-800"><AlertCircle size={16} className="text-red-500" />Under review</p>
          <p className="mt-1 text-sm text-slate-500">Your report: “{plan.problem?.note}”. Your money stays held while support decides — you will get a refund or the seller is paid, based on what they find.</p>
        </>
      )}
      {(to.line1 || to.city) && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-400"><MapPin size={14} className="mt-0.5 shrink-0" />Sending to {[to.name, to.line1, to.line2, to.city, to.region, to.postal_code, to.country].filter(Boolean).join(', ')}</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </Card>
  );
}
