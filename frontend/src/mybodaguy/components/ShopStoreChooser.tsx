import { useState } from 'react';
import { Check, Loader, MapPin, Search, Store } from 'lucide-react';

export interface ShopStore {
  id: string;
  name: string;
  location: string | null;
}

// Shown whenever the customer starts picking products (opening Shop, starting a new shop,
// or switching store): products and barcode scans are scoped to the store they are standing
// in, and each store gets its own receipt at checkout, so we always ask which one.
export default function ShopStoreChooser({ stores, loading, currentStoreId, notice, onChoose }: {
  stores: ShopStore[];
  loading: boolean;
  /** The store they were last shopping at, marked so confirming it is one tap. */
  currentStoreId?: string;
  /** Shown above the list, e.g. that choosing another store clears the cart. */
  notice?: string;
  onChoose: (storeId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? stores.filter(s => `${s.name} ${s.location ?? ''}`.toLowerCase().includes(needle))
    : stores;

  return (
    <section aria-labelledby="shop-store-heading" className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
      <div className="mb-3 flex items-start gap-3">
        <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-orange-100 text-orange-600">
          <Store size={20} />
        </div>
        <div className="min-w-0">
          <h3 id="shop-store-heading" className="text-base font-bold text-slate-800">Which store are you shopping at?</h3>
          <p className="text-xs text-slate-500">Pick the store you're in to choose products from its shelves. A cart can hold products from one store only.</p>
        </div>
      </div>

      {notice && (
        <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{notice}</p>
      )}

      {stores.length > 5 && (
        <div className="relative mb-2">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search store name or place…"
            aria-label="Search stores"
            className="w-full rounded-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
        </div>
      )}

      {loading ? (
        <p className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
          <Loader size={16} className="animate-spin" /> Loading stores…
        </p>
      ) : stores.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No stores are open yet.</p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No store matches “{query.trim()}”.</p>
      ) : (
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto" aria-label="Stores">
          {shown.map(store => {
            const current = store.id === currentStoreId;
            return (
              <li key={store.id}>
                <button
                  type="button"
                  onClick={() => onChoose(store.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                    current ? 'border-orange-400 bg-orange-50' : 'border-slate-200 hover:border-orange-300 hover:bg-orange-50/50'
                  }`}
                >
                  <Store size={18} className="flex-shrink-0 text-orange-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{store.name}</span>
                    {store.location && (
                      <span className="flex items-center gap-1 truncate text-xs text-slate-500">
                        <MapPin size={11} className="flex-shrink-0" /> {store.location}
                      </span>
                    )}
                  </span>
                  {current && (
                    <span className="flex flex-shrink-0 items-center gap-1 text-xs font-semibold text-orange-600">
                      <Check size={14} /> Current
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
