import { useEffect, useState } from 'react';
import { Globe, Loader, Search, Store, Truck, X } from 'lucide-react';
import { BrowseOffer, BrowseProduct, browseProducts, formatMoney, productOffers } from '../../services/installmentService';
import { getStoreSiteForCustomer } from '../../services/storeWebsite';

/**
 * Find something to pay for in installments: browse products across every
 * reseller and tap one to open that seller's own website, where the customer
 * has an account with the store and sets up and follows their plan. A product
 * with several sellers asks which seller first.
 */
export default function InstallmentShop() {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<BrowseProduct[] | null>(null);
  const [selected, setSelected] = useState<BrowseProduct | null>(null);
  const [offers, setOffers] = useState<Record<string, BrowseOffer[]>>({});
  const [offersLoading, setOffersLoading] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setProducts(null);
      const data = await browseProducts(query.trim());
      if (!cancelled) setProducts(data);
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const loadOffers = async (productId: string) => {
    if (offers[productId]) return offers[productId];
    const data = await productOffers(productId);
    setOffers(prev => ({ ...prev, [productId]: data }));
    return data;
  };

  // `win` is opened synchronously on the tap so mobile browsers don't block it.
  const openStoreSite = async (businessProfileId: string, win: Window | null) => {
    const site = await getStoreSiteForCustomer({ businessProfileId });
    if (!site) {
      win?.close();
      setError("We couldn't find this store's website. Try again in a moment.");
      return;
    }
    // Instalments are started from the cart in the website's Market tab.
    const target = site.viaStorefront ? site.url : `${site.url}?tab=market`;
    if (win) { win.opener = null; win.location.href = target; }
    else window.location.href = target;
  };

  const pickProduct = async (p: BrowseProduct) => {
    setError('');
    if (p.reseller_count > 1) {
      if (selected?.product_id === p.product_id) { setSelected(null); return; }
      setSelected(p);
      setOffersLoading(p.product_id);
      await loadOffers(p.product_id);
      setOffersLoading(null);
      return;
    }
    // One seller: straight to its website.
    const win = window.open('', '_blank');
    setOpening(p.product_id);
    try {
      const seller = (await loadOffers(p.product_id))[0];
      if (!seller) { win?.close(); setError('No sellers available right now'); return; }
      await openStoreSite(seller.reseller_business_profile_id, win);
    } finally {
      setOpening(null);
    }
  };

  const chooseSeller = (o: BrowseOffer) => openStoreSite(o.reseller_business_profile_id, window.open('', '_blank'));

  const list = selected ? offers[selected.product_id] : null;
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products to pay for in installments…"
          className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800" />
      </div>
      <p className="flex items-start gap-1.5 text-[11px] text-slate-400"><Globe size={13} className="mt-0.5 shrink-0" />Shops from around the world. Items from abroad are priced in the shop's currency and shipped to you once they are paid in full.</p>
      <p className="text-[11px] text-slate-400">Tap a product to open the store's website, where you create your account and set up your plan.</p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      {products === null ? (
        <div className="flex justify-center py-10"><Loader className="animate-spin text-slate-400" /></div>
      ) : products.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">No products found</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {products.map(p => (
            <button key={p.product_id} onClick={() => pickProduct(p)} disabled={opening === p.product_id}
              className={`classic-card overflow-hidden text-left transition ${selected?.product_id === p.product_id ? 'ring-2 ring-orange-400' : ''}`}>
              <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-slate-100">
                {p.images?.[0] ? <img src={p.images[0]} alt={p.name} className="h-full w-full object-cover" /> : <Store className="text-slate-300" size={28} />}
                {opening === p.product_id && <Loader className="absolute animate-spin text-orange-500" />}
              </div>
              <div className="p-2.5">
                <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-slate-800">{p.name}</p>
                <p className="mt-0.5 text-xs font-semibold text-orange-600">From {formatMoney(p.min_price, p.currency)}</p>
                {p.cross_border && <p className="flex items-center gap-1 text-[11px] text-sky-600"><Globe size={11} />Ships from {p.store_country || 'abroad'}</p>}
                <p className="text-[11px] text-slate-400">{p.reseller_count} seller{p.reseller_count === 1 ? '' : 's'}</p>
                {p.any_free_delivery && p.currency === 'UGX' && <p className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-600"><Truck size={11} />Free delivery</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="classic-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
            <p className="truncate text-sm font-medium text-slate-800">{selected.name}</p>
            <button onClick={() => setSelected(null)} aria-label="Close" className="p-1 text-slate-400"><X size={16} /></button>
          </div>
          {offersLoading === selected.product_id || !list ? (
            <div className="flex justify-center py-6"><Loader size={18} className="animate-spin text-slate-400" /></div>
          ) : list.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">No sellers available right now</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {list.map(o => (
                <div key={o.listing_id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-800">{o.reseller_name}</p>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500">
                      {formatMoney(o.listed_price, o.currency)}
                      {o.free_delivery && o.currency === 'UGX' && <span className="flex items-center gap-0.5 text-emerald-600"><Truck size={11} />Free delivery</span>}
                      {!o.in_stock && <span className="text-red-500">Out of stock</span>}
                    </p>
                  </div>
                  <button disabled={!o.in_stock} onClick={() => chooseSeller(o)}
                    className="shrink-0 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Open store</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
