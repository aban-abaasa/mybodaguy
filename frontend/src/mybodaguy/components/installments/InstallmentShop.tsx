import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader, Minus, Plus, Search, Store, Truck, X } from 'lucide-react';
import {
  BrowseOffer, BrowseProduct, ShelfItem, browseProducts, formatUGX, productOffers, resellerShelf,
} from '../../services/installmentService';
import InstallmentOfferCard from './InstallmentOfferCard';

interface Props {
  customerName?: string | null;
  customerPhone?: string | null;
  onCreated: (code: string, note?: string) => void;
}

/**
 * Find something to pay for in instalments: browse products across every
 * reseller, pick the seller you want, fill a basket from that seller's shelf,
 * then choose the deposit and schedule.
 */
export default function InstallmentShop({ customerName, customerPhone, onCreated }: Props) {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<BrowseProduct[] | null>(null);
  const [selected, setSelected] = useState<BrowseProduct | null>(null);
  const [offers, setOffers] = useState<Record<string, BrowseOffer[]>>({});
  const [offersLoading, setOffersLoading] = useState<string | null>(null);
  const [seller, setSeller] = useState<{ id: string; name: string } | null>(null);
  const [shelf, setShelf] = useState<ShelfItem[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setProducts(null);
      const data = await browseProducts(query.trim());
      if (!cancelled) setProducts(data);
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const pickProduct = async (p: BrowseProduct) => {
    if (selected?.product_id === p.product_id) { setSelected(null); return; }
    setSelected(p);
    if (!offers[p.product_id]) {
      setOffersLoading(p.product_id);
      const data = await productOffers(p.product_id);
      setOffers(prev => ({ ...prev, [p.product_id]: data }));
      setOffersLoading(null);
    }
  };

  const openSeller = async (offer: BrowseOffer, productId: string) => {
    setSeller({ id: offer.reseller_business_profile_id, name: offer.reseller_name });
    setShelf(null);
    setQty({ [productId]: 1 });
    setShelf(await resellerShelf(offer.reseller_business_profile_id));
  };

  const cart = useMemo(
    () => (shelf || []).filter(i => (qty[i.product_id] || 0) > 0).map(i => ({ product_id: i.product_id, quantity: qty[i.product_id] })),
    [shelf, qty],
  );
  const change = (item: ShelfItem, delta: number) =>
    setQty(prev => ({ ...prev, [item.product_id]: Math.max(0, Math.min(item.available_stock, (prev[item.product_id] || 0) + delta)) }));

  if (seller) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={() => { setSeller(null); setShelf(null); setQty({}); }} aria-label="Back to products" className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600"><ArrowLeft size={18} /></button>
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800">{seller.name}</p>
            <p className="text-[11px] text-slate-400">Choose what to put on your plan</p>
          </div>
        </div>
        {!shelf ? (
          <div className="flex justify-center py-10"><Loader className="animate-spin text-slate-400" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {shelf.map(item => {
                const q = qty[item.product_id] || 0;
                return (
                  <div key={item.listing_id} className="classic-card flex flex-col overflow-hidden">
                    <div className="flex aspect-square items-center justify-center overflow-hidden bg-slate-100">
                      {item.images?.[0] ? <img src={item.images[0]} alt={item.name} className="h-full w-full object-cover" /> : <Store className="text-slate-300" size={28} />}
                    </div>
                    <div className="flex flex-1 flex-col p-2.5">
                      <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-slate-800">{item.name}</p>
                      <p className="mt-1 font-bold text-orange-600">{formatUGX(item.listed_price)}</p>
                      {!item.in_stock ? <p className="mt-2 text-xs text-red-500">Out of stock</p> : q === 0 ? (
                        <button onClick={() => change(item, 1)} className="mt-2 w-full rounded-lg bg-orange-500 py-1.5 text-xs font-semibold text-white">Add</button>
                      ) : (
                        <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-100">
                          <button onClick={() => change(item, -1)} aria-label={`Fewer ${item.name}`} className="p-1.5 text-slate-700"><Minus size={14} /></button>
                          <span className="text-sm font-semibold text-slate-800">{q}</span>
                          <button onClick={() => change(item, 1)} aria-label={`More ${item.name}`} className="p-1.5 text-slate-700"><Plus size={14} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {cart.length > 0 && (
              <InstallmentOfferCard businessProfileId={seller.id} cart={cart} customerName={customerName} customerPhone={customerPhone} storeName={seller.name} onCreated={onCreated} />
            )}
          </>
        )}
      </div>
    );
  }

  const list = selected ? offers[selected.product_id] : null;
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products to pay for in instalments…"
          className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800" />
      </div>
      {products === null ? (
        <div className="flex justify-center py-10"><Loader className="animate-spin text-slate-400" /></div>
      ) : products.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">No products found</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {products.map(p => (
            <button key={p.product_id} onClick={() => pickProduct(p)}
              className={`classic-card overflow-hidden text-left transition ${selected?.product_id === p.product_id ? 'ring-2 ring-orange-400' : ''}`}>
              <div className="flex aspect-square items-center justify-center overflow-hidden bg-slate-100">
                {p.images?.[0] ? <img src={p.images[0]} alt={p.name} className="h-full w-full object-cover" /> : <Store className="text-slate-300" size={28} />}
              </div>
              <div className="p-2.5">
                <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-slate-800">{p.name}</p>
                <p className="mt-0.5 text-xs font-semibold text-orange-600">From {formatUGX(p.min_price)}</p>
                <p className="text-[11px] text-slate-400">{p.reseller_count} seller{p.reseller_count === 1 ? '' : 's'}</p>
                {p.any_free_delivery && <p className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-600"><Truck size={11} />Free delivery</p>}
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
                      {formatUGX(o.listed_price)}
                      {o.free_delivery && <span className="flex items-center gap-0.5 text-emerald-600"><Truck size={11} />Free delivery</span>}
                      {!o.in_stock && <span className="text-red-500">Out of stock</span>}
                    </p>
                  </div>
                  <button disabled={!o.in_stock} onClick={() => openSeller(o, selected.product_id)}
                    className="shrink-0 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Choose</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
