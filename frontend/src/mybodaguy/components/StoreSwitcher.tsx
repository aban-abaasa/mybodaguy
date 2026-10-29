/**
 * StoreSwitcher — the store-delivery shop's always-visible row of nearby stores, and the
 * prompt that appears the moment the customer tries to mix stores.
 *
 * The strip is ranked nearest first and never goes away: with an empty basket it narrows the
 * shop to a store (or back to every store); once the basket holds a store's products the shop
 * is that store only, the other stores stay one tap away, and tapping one asks first because
 * switching empties the basket (a delivery picks up from a single store).
 */
import { useEffect, useRef } from 'react';
import { ShoppingBasket, Store } from 'lucide-react';
import { formatDistance } from '../utils/storeLock';

export interface StripStore {
  id: string;
  name: string;
  emoji: string;
  distanceKm: number | null;
  abroad: boolean;
  country?: string | null;
}

/** Enough to cover "nearby" without turning the strip into a directory; the store search below it reaches the rest. */
const MAX_CHIPS = 14;

interface StripProps {
  /** Already ranked nearest first. */
  stores: StripStore[];
  /** The store the shop is narrowed to; '' = every store. */
  activeStoreId: string;
  /** The store the basket is from, or null when it is empty. */
  cartStoreId: string | null;
  cartCount: number;
  nearestStoreId: string | null;
  /** '' = every store. Called for every tap; the parent decides whether the basket makes it a switch prompt. */
  onPick: (storeId: string) => void;
}

export function StoreStrip({ stores, activeStoreId, cartStoreId, cartCount, nearestStoreId, onPick }: StripProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Bring the open store into view whenever it changes (a product tap can open a store far down the strip).
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [activeStoreId]);

  const shown = stores.slice(0, MAX_CHIPS);
  for (const id of [activeStoreId, cartStoreId]) {
    if (id && !shown.some(s => s.id === id)) {
      const extra = stores.find(s => s.id === id);
      if (extra) shown.push(extra);
    }
  }
  const locked = !!cartStoreId;

  return (
    <div className="sticky top-0 z-20 -mx-2 bg-white/95 px-2 pb-2 pt-1 backdrop-blur sm:mx-0 sm:px-0" role="group" aria-label="Nearby stores">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
        {!locked && (
          <button
            type="button"
            onClick={() => onPick('')}
            aria-pressed={!activeStoreId}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${!activeStoreId ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            All stores
          </button>
        )}
        {shown.map(sm => {
          const active = sm.id === activeStoreId;
          const isCartStore = sm.id === cartStoreId;
          const dist = sm.abroad ? null : formatDistance(sm.distanceKm);
          return (
            <button
              key={sm.id}
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => onPick(sm.id)}
              aria-pressed={active}
              className={`flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
                active
                  ? 'border-orange-500 bg-orange-500 font-semibold text-white'
                  : locked
                    ? 'border-slate-200 bg-white text-slate-500 hover:border-orange-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-orange-300'
              }`}
            >
              <span aria-hidden>{sm.emoji}</span>
              <span className="max-w-[9rem] truncate">{sm.name}</span>
              {sm.abroad
                ? <span className={active ? 'text-white/90' : 'text-violet-600'}>🌍 {sm.country}</span>
                : dist && <span className={active ? 'text-white/90' : 'text-slate-400'}>{dist}</span>}
              {sm.id === nearestStoreId && !active && <span className="rounded bg-green-100 px-1 text-[10px] font-semibold text-green-700">Nearest</span>}
              {isCartStore && cartCount > 0 && (
                <span className={`flex items-center gap-0.5 rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-white/25 text-white' : 'bg-orange-100 text-orange-700'}`}>
                  <ShoppingBasket size={10} /> {cartCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {locked && (
        <p className="mt-1 text-[11px] text-slate-500">
          A delivery picks up from one store, so you're seeing this store only. Other stores are one tap away.
        </p>
      )}
    </div>
  );
}

interface PromptProps {
  /** The store the basket is from. */
  cartStoreName: string;
  cartCount: number;
  /** The store the customer is trying to move to. */
  targetStoreName: string;
  /** Set when the trigger was a product tap rather than a store tap. */
  productName?: string;
  onKeep: () => void;
  onSwitch: () => void;
}

export function StoreSwitchPrompt({ cartStoreName, cartCount, targetStoreName, productName, onKeep, onSwitch }: PromptProps) {
  const keepRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onKeep(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKeep]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-3 sm:items-center" role="presentation" onClick={onKeep}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="store-switch-title"
        className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Store size={18} /></div>
          <div className="min-w-0">
            <p id="store-switch-title" className="text-sm font-bold text-slate-800">That's from a different store</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              {productName ? <><strong>{productName}</strong> is sold by <strong>{targetStoreName}</strong>. </> : <>You're moving to <strong>{targetStoreName}</strong>. </>}
              Your {cartCount} item{cartCount === 1 ? '' : 's'} from <strong>{cartStoreName}</strong> would be cleared, because a rider picks up from one store per delivery.
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <button ref={keepRef} type="button" onClick={onKeep} className="w-full rounded-xl bg-orange-500 py-2.5 text-sm font-bold text-white hover:bg-orange-600 active:scale-[0.99]">
            Keep my {cartStoreName} order
          </button>
          <button type="button" onClick={onSwitch} className="w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 active:scale-[0.99]">
            Switch to {targetStoreName} · clear cart
          </button>
        </div>
      </div>
    </div>
  );
}
