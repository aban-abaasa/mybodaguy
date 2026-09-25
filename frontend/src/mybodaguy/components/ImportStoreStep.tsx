/**
 * ImportStoreStep — the first step of "Buy abroad": pick a registered store in a
 * country other than your own, fill a basket from its real catalogue, and see the
 * goods priced in ICAN at the live value of the store's own currency.
 *
 * The parent keeps this mounted (just hidden) while the rest of the flow runs, so
 * going back to change the basket never loses it.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Store } from 'lucide-react';
import { StepCard, Field } from './JourneyUI';
import ProductPicker, { type CartLine } from './ProductPicker';
import { listImportStores, quoteImportGoods, type ImportGoodsQuote, type ImportStore, type StoreCartLine } from '../services/journeyService';
import { formatIcan } from '../services/flightOffers';
import { COUNTRIES } from '../data/countries';

const STORE_EMOJI: Record<string, string> = { supermarket: '🏪', hotel: '🏨', boutique: '👗', restaurant_cafe: '☕' };

interface ImportStoreStepProps {
  /** The customer's own country (name) — stores here are left out, since this is for buying from abroad. */
  homeCountry: string;
  onHomeCountryChange: (name: string) => void;
  store: ImportStore | null;
  onStoreChange: (store: ImportStore | null) => void;
  onCartChange: (cart: StoreCartLine[]) => void;
  goods: ImportGoodsQuote | null;
  onGoodsChange: (goods: ImportGoodsQuote | null) => void;
  onContinue: () => void;
}

export default function ImportStoreStep({
  homeCountry, onHomeCountryChange, store, onStoreChange, onCartChange, goods, onGoodsChange, onContinue,
}: ImportStoreStepProps) {
  const [stores, setStores] = useState<ImportStore[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [countryFilter, setCountryFilter] = useState('all');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Stores abroad, refreshed if the customer says they live somewhere else.
  useEffect(() => {
    let cancelled = false;
    setStores(null);
    setLoadError(null);
    listImportStores(homeCountry)
      .then((rows) => { if (!cancelled) setStores(rows); })
      .catch((err: any) => { if (!cancelled) setLoadError(err.message || 'Could not load stores'); });
    return () => { cancelled = true; };
  }, [homeCountry]);

  // The basket in the parent's terms, and its price from the server (stock, tax and the
  // live ICAN conversion all happen there — never in the browser).
  const cart = useMemo<StoreCartLine[]>(() => lines.map((l) => ({ productId: l.product.id, quantity: l.qty })), [lines]);
  const cartKey = JSON.stringify(cart);
  useEffect(() => {
    onCartChange(cart);
    setQuoteError(null);
    if (!store || cart.length === 0) {
      setQuoting(false);
      onGoodsChange(null);
      return;
    }
    setQuoting(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await quoteImportGoods(store.id, cart);
      if (cancelled) return;
      setQuoting(false);
      if (result.success && result.quote) {
        onGoodsChange(result.quote);
      } else {
        onGoodsChange(null);
        setQuoteError(result.error || 'Could not price this order');
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.id, cartKey]);

  const storeCountries = useMemo(() => [...new Set((stores || []).map((s) => s.country))].sort(), [stores]);
  const visibleStores = (stores || []).filter((s) => countryFilter === 'all' || s.country === countryFilter);

  return (
    <StepCard
      eyebrow="Buy abroad · 1 of 2"
      title="Shop from a store abroad"
      description="Choose a store in another country, fill your basket, and we bring it to your door — by air or by sea. You pay once, in ICAN; the store is paid when our courier collects your order."
    >
      <Field label="I live in" htmlFor="jb-import-home">
        <select
          id="jb-import-home"
          className="classic-input"
          value={homeCountry}
          onChange={(e) => { onHomeCountryChange(e.target.value); onStoreChange(null); setLines([]); setCountryFilter('all'); }}
        >
          {COUNTRIES.map((c) => <option key={c.iso2 || c.name} value={c.name}>{c.name}</option>)}
        </select>
      </Field>

      {!store && (
        <div className="space-y-3">
          {stores === null && !loadError && (
            <p className="flex items-center justify-center gap-2 text-sm text-slate-500" role="status"><Loader2 className="animate-spin" size={16} /> Finding stores abroad…</p>
          )}
          {loadError && <p role="alert" className="text-center text-sm font-medium text-red-600">{loadError}</p>}
          {stores && stores.length === 0 && (
            <p className="rounded-2xl bg-[#fbf3dc] p-4 text-center text-sm text-[#7a5a12]">
              No stores outside {homeCountry} are open for orders yet. Stores appear here once their owner has set the store's location and price currency.
            </p>
          )}
          {storeCountries.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter stores by country">
              {['all', ...storeCountries].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={countryFilter === c}
                  onClick={() => setCountryFilter(c)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${countryFilter === c ? 'bg-[#231b12] text-[#f6e7bd] ring-[#c4a052]/60' : 'bg-white text-slate-600 ring-slate-200'}`}
                >
                  {c === 'all' ? 'All countries' : c}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {visibleStores.map((s) => (
              <button key={s.id} type="button" onClick={() => onStoreChange(s)} className="classic-tile flex items-center gap-3 p-3 text-left">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#fbf3dc] text-xl ring-1 ring-[#c4a052]/40">{STORE_EMOJI[s.businessType || ''] || '🏪'}</span>
                <span className="min-w-0">
                  <span className="block truncate font-classic-display text-[15px] font-semibold leading-tight text-slate-800">{s.name}</span>
                  <span className="block text-[11px] leading-tight text-slate-500">{s.country} · prices in {s.currency} · {s.productCount} item{s.productCount === 1 ? '' : 's'}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {store && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#fbf3dc] p-3">
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[#5c4410]">
              <Store size={16} className="shrink-0" />
              <span className="truncate">{store.name} · {store.country}</span>
            </span>
            <button type="button" onClick={() => { onStoreChange(null); setLines([]); }} className="shrink-0 text-xs font-semibold text-[#a17c28] underline">Change store</button>
          </div>

          <ProductPicker supermarketId={store.id} currency={store.currency} onCartChange={setLines} />

          {quoting && <p className="flex items-center justify-center gap-2 text-xs text-slate-500" role="status"><Loader2 className="animate-spin" size={14} /> Pricing your basket…</p>}
          {quoteError && <p role="alert" className="text-center text-xs font-medium text-red-600">{quoteError}</p>}
          {goods && (
            <div className="classic-tile !cursor-default space-y-1 p-3.5 text-sm text-slate-600" aria-live="polite">
              <div className="flex justify-between gap-3"><span>Goods, at the store's price</span><span className="tabular-nums">{goods.currency} {goods.goodsLocal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between gap-3 font-semibold text-slate-800"><span>Goods in ICAN, at today's live value</span><span className="tabular-nums">{formatIcan(goods.goodsIcan)} ICAN</span></div>
              <p className="text-[11px] text-slate-500">Shipping to your door is priced in the next step.</p>
            </div>
          )}
        </div>
      )}

      <button disabled={!store || !goods || quoting} onClick={onContinue} className="classic-btn classic-btn-primary">
        {store && goods ? <>Continue to delivery <ArrowRight size={18} /></> : store ? 'Add items to continue' : 'Choose a store to continue'}
      </button>
    </StepCard>
  );
}
