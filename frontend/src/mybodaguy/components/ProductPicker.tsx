/**
 * ProductPicker — a real storefront view for one supermarket: optional
 * background photo, search, category chips, and a product grid the customer
 * builds a cart from. Backed by the shared public.products/inventory tables
 * (see productService.ts) — no mock data.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { Minus, Plus, Image as ImageIcon, ShoppingCart, Search, Store } from 'lucide-react';
import { productService, Product, SupermarketProfile } from '../services/productService';

export interface CartLine {
  product: Product;
  qty: number;
}

interface ProductPickerProps {
  supermarketId: string;
  onCartChange: (lines: CartLine[]) => void;
  /** Render as an edge-to-edge storefront (no card chrome, unbounded product grid) — used by the full-page Shop tab. */
  fullPage?: boolean;
  /** With fullPage: makes the floating cart bar tappable. */
  onOpenCart?: () => void;
  /** The store's own price currency. Defaults to UGX (whole shillings); any other is shown to 2 decimals, matching how the server prices it. */
  currency?: string;
  /** Quantities already chosen elsewhere (product id -> qty) for THIS store, so a basket started on another screen carries over. */
  initialQty?: Record<string, number>;
}

export default function ProductPicker({ supermarketId, onCartChange, currency = 'UGX', initialQty, fullPage = false, onOpenCart }: ProductPickerProps) {
  const [profile, setProfile] = useState<SupermarketProfile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [qtyById, setQtyById] = useState<Record<string, number>>(initialQty ?? {});
  // The basket handed in belongs to the store it arrived with; any other store starts empty.
  const initialFor = useRef<string | null>(initialQty ? supermarketId : null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  useEffect(() => {
    setLoading(true);
    if (initialFor.current !== supermarketId) setQtyById({});
    setSearch('');
    setActiveCategory('All');
    Promise.all([
      productService.getActiveProducts(supermarketId),
      productService.getSupermarketProfile(supermarketId),
    ])
      .then(([prods, prof]) => { setProducts(prods); setProfile(prof); })
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [supermarketId]);

  useEffect(() => {
    const lines: CartLine[] = products
      .filter((p) => (qtyById[p.id] || 0) > 0)
      .map((p) => ({ product: p, qty: qtyById[p.id] }));
    onCartChange(lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qtyById, products]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => set.add(p.category || 'Other'));
    return ['All', ...Array.from(set).sort()];
  }, [products]);

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchesCategory = activeCategory === 'All' || (p.category || 'Other') === activeCategory;
      const matchesSearch = !q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [products, search, activeCategory]);

  const setQty = (productId: string, qty: number) => {
    setQtyById((prev) => ({ ...prev, [productId]: Math.max(0, qty) }));
  };

  // The store's listed price plus its own tax_rate — always shown together,
  // never added on top later. mbg_respond_to_ride charges the customer this
  // exact same tax-inclusive amount at acceptance, so what's shown here
  // while shopping is always what actually gets billed.
  const foreign = currency !== 'UGX';
  const inclusivePrice = (p: Product) => foreign
    ? Math.round(Number(p.price_ugx) * (1 + (p.tax_rate || 0) / 100) * 100) / 100
    : Math.round(Number(p.price_ugx) * (1 + (p.tax_rate || 0) / 100));
  const money = (n: number) => `${currency} ${foreign ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toLocaleString()}`;

  const cartCount = Object.values(qtyById).reduce((sum, q) => sum + q, 0);
  const cartTotal = products.reduce((sum, p) => sum + (qtyById[p.id] || 0) * inclusivePrice(p), 0);

  if (loading) {
    return <p className="text-sm text-slate-400 text-center py-6">Loading store…</p>;
  }

  if (products.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
        This store hasn't listed any products yet — describe what you need below instead.
      </div>
    );
  }

  // Full-page storefront (Shop tab): no card/border chrome, edge-to-edge
  // product grid that flows with the page instead of a small scroll box.
  if (fullPage) {
    return (
      <div className="-mx-2 sm:mx-0">
        {profile?.background_image_url && (
          <div
            className="h-20 sm:h-28 bg-cover bg-center"
            style={{ backgroundImage: `url(${profile.background_image_url})` }}
            role="img"
            aria-label={profile?.name || 'Store'}
          />
        )}

        <div className="flex items-center gap-2 px-2 sm:px-0 pt-1 pb-2">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${profile?.name || 'store'}…`}
              className="w-full pl-9 pr-3 py-2 bg-slate-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:bg-white"
            />
          </div>
        </div>

        {categories.length > 2 && (
          <div className="flex gap-1.5 overflow-x-auto px-2 sm:px-0 pb-2 scrollbar-hide">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  activeCategory === c ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {visibleProducts.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-10">No products match your search.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-2 gap-y-4 sm:gap-x-4 px-2 sm:px-0">
            {visibleProducts.map((p) => {
              const qty = qtyById[p.id] || 0;
              return (
                <div key={p.id} className="min-w-0">
                  <div className={`aspect-square overflow-hidden rounded-xl bg-slate-100 flex items-center justify-center ${qty > 0 ? 'ring-2 ring-orange-400' : ''}`}>
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon size={28} className="text-slate-300" />
                    )}
                  </div>
                  <div className="pt-1.5">
                    <p className="text-[13px] font-semibold text-slate-800 leading-tight line-clamp-2">{p.name}</p>
                    <p className="text-sm text-orange-600 font-bold">{money(inclusivePrice(p))}</p>
                    {p.stock_qty <= 0 ? (
                      <p className="mt-1 text-xs font-medium text-red-500">Out of stock</p>
                    ) : qty === 0 ? (
                      <button
                        onClick={() => setQty(p.id, 1)}
                        className="mt-1.5 w-full py-1.5 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 active:scale-95 transition"
                      >
                        Add
                      </button>
                    ) : (
                      <div className="mt-1.5 flex items-center justify-between bg-orange-50 rounded-lg">
                        <button onClick={() => setQty(p.id, qty - 1)} aria-label={`Remove one ${p.name}`} className="px-3 py-1.5 text-orange-700">
                          <Minus size={14} />
                        </button>
                        <span className="text-sm font-bold text-orange-700">{qty}</span>
                        <button
                          onClick={() => setQty(p.id, Math.min(qty + 1, p.stock_qty))}
                          aria-label={`Add one ${p.name}`}
                          className="px-3 py-1.5 text-orange-700 disabled:opacity-30"
                          disabled={qty >= p.stock_qty}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {cartCount > 0 && (
          <div className="sticky bottom-20 sm:bottom-4 z-30 mt-5 px-2 sm:px-0">
            <button
              type="button"
              onClick={onOpenCart}
              disabled={!onOpenCart}
              className="flex w-full items-center justify-between rounded-full bg-orange-600 px-5 py-3 text-white shadow-lg disabled:cursor-default"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <ShoppingCart size={16} /> {cartCount} item{cartCount !== 1 ? 's' : ''}{onOpenCart ? ' · View cart' : ''}
              </span>
              <span className="text-sm font-bold">{money(cartTotal)}</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden border border-slate-200">
      {/* Storefront header */}
      <div
        className="relative h-20 bg-cover bg-center bg-gradient-to-r from-orange-400 to-yellow-400 flex items-end"
        style={profile?.background_image_url ? { backgroundImage: `url(${profile.background_image_url})` } : undefined}
      >
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative flex items-center gap-2 px-3 py-2 text-white">
          <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
            <Store size={16} />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm truncate leading-tight">{profile?.name || 'Store'}</p>
            {profile?.location && <p className="text-[10px] opacity-90 truncate leading-tight">{profile.location}</p>}
          </div>
        </div>
      </div>

      <div className="p-3 bg-white space-y-2.5">
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>

        {/* Category chips */}
        {categories.length > 2 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
                  activeCategory === c ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Product grid */}
        {visibleProducts.length === 0 ? (
          <p className="text-center text-xs text-slate-400 py-6">No products match your search.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-1">
            {visibleProducts.map((p) => {
              const qty = qtyById[p.id] || 0;
              return (
                <div key={p.id} className={`rounded-lg border overflow-hidden ${qty > 0 ? 'border-orange-400 ring-1 ring-orange-200' : 'border-slate-200'}`}>
                  <div className="aspect-square bg-slate-100 flex items-center justify-center">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon size={22} className="text-slate-300" />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-semibold text-slate-800 truncate">{p.name}</p>
                    <p className="text-xs text-orange-600 font-bold">{money(inclusivePrice(p))}</p>
                    {p.tax_rate > 0 && <p className="text-[9px] text-slate-400">incl. {p.tax_rate}% tax</p>}
                    {p.stock_qty <= 0 ? (
                      <p className="mt-1.5 text-center text-[10px] font-medium text-red-500 py-1">Out of stock</p>
                    ) : qty === 0 ? (
                      <button
                        onClick={() => setQty(p.id, 1)}
                        className="mt-1.5 w-full py-1 bg-orange-500 text-white rounded text-xs font-medium hover:bg-orange-600"
                      >
                        Add
                      </button>
                    ) : (
                      <div className="mt-1.5 flex items-center justify-between bg-slate-50 rounded">
                        <button onClick={() => setQty(p.id, qty - 1)} className="p-1.5 text-slate-600 hover:text-orange-600">
                          <Minus size={12} />
                        </button>
                        <span className="text-xs font-semibold">{qty}</span>
                        <button
                          onClick={() => setQty(p.id, Math.min(qty + 1, p.stock_qty))}
                          className="p-1.5 text-slate-600 hover:text-orange-600 disabled:opacity-30"
                          disabled={qty >= p.stock_qty}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {cartCount > 0 && (
          <div className="flex items-center justify-between px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-sm">
            <span className="flex items-center gap-1.5 text-orange-700 font-medium">
              <ShoppingCart size={14} /> {cartCount} item{cartCount !== 1 ? 's' : ''}
            </span>
            <span className="font-bold text-orange-700">{money(cartTotal)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
