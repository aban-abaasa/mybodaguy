/**
 * ProductPicker — a real storefront view: optional background photo, search,
 * category chips, and a product grid the customer builds a cart from. Backed
 * by the shared public.products/inventory tables (see productService.ts).
 *
 * Built for catalogs of thousands: products are fetched a page at a time
 * (search and category are filtered on the server, not in the browser) and the
 * next page loads as the customer scrolls. The basket lives apart from the
 * pages, so it survives any search, category or store change.
 */
import { memo, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Minus, Plus, Image as ImageIcon, ShoppingCart, Search, Store, X, Loader2 } from 'lucide-react';
import { productService, Product, SupermarketProfile } from '../services/productService';

export interface CartLine {
  product: Product;
  qty: number;
}

interface ProductPickerProps {
  /** With allStores: optional filter (null/undefined = every store). Otherwise the one store to load. */
  supermarketId?: string | null;
  /** List products from every store (narrowed by supermarketId when given); the basket survives switching stores. */
  allStores?: boolean;
  /** With allStores: store names, shown under each product while no single store is selected. */
  stores?: { id: string; name: string }[];
  /** With allStores and no store selected: stores whose products are left out (e.g. stores abroad). */
  excludeStoreIds?: string[];
  onCartChange: (lines: CartLine[]) => void;
  /** Render as an edge-to-edge storefront (no card chrome, unbounded product grid) — used by the full-page Shop tab. */
  fullPage?: boolean;
  /** With fullPage: makes the floating cart bar tappable. */
  onOpenCart?: () => void;
  /** Hide the floating basket bar when the parent shows its own. */
  hideCartBar?: boolean;
  /** The store's own price currency. Defaults to UGX (whole shillings); any other is shown to 2 decimals, matching how the server prices it. */
  currency?: string;
  /** Quantities already chosen elsewhere (product id -> qty) for THIS store, so a basket started on another screen carries over. */
  initialQty?: Record<string, number>;
}

type Money = (n: number) => string;

interface CardProps {
  product: Product;
  qty: number;
  price: number;
  money: Money;
  storeName?: string;
  onQty: (product: Product, qty: number) => void;
}

// One product in the full-page grid. Memoised so typing a quantity or loading
// the next page doesn't re-render every card already on screen.
const FullCard = memo(function FullCard({ product: p, qty, price, money, storeName, onQty }: CardProps) {
  return (
    <div className="min-w-0">
      {p.image_url ? (
        <img
          src={p.image_url}
          alt={p.name}
          loading="lazy"
          decoding="async"
          className={`aspect-square w-full rounded-lg bg-slate-100 object-cover ${qty > 0 ? 'ring-2 ring-orange-400' : ''}`}
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-slate-50">
          <ImageIcon size={28} className="text-slate-300" />
        </div>
      )}
      <div className="pt-1.5">
        <p className="text-[13px] font-semibold text-slate-800 leading-tight line-clamp-2">{p.name}</p>
        {storeName && <p className="truncate text-[11px] text-slate-400">{storeName}</p>}
        <p className="text-sm text-orange-600 font-bold">{money(price)}</p>
        {p.stock_qty <= 0 ? (
          <p className="mt-1 text-xs font-medium text-red-500">Out of stock</p>
        ) : qty === 0 ? (
          <button
            onClick={() => onQty(p, 1)}
            className="mt-1 text-sm font-semibold text-orange-600 hover:text-orange-700 active:scale-95 transition"
          >
            + Add
          </button>
        ) : (
          <div className="mt-1 flex items-center gap-3 text-orange-700">
            <button onClick={() => onQty(p, qty - 1)} aria-label={`Remove one ${p.name}`} className="py-1">
              <Minus size={16} />
            </button>
            <span className="text-sm font-bold">{qty}</span>
            <button
              onClick={() => onQty(p, Math.min(qty + 1, p.stock_qty))}
              aria-label={`Add one ${p.name}`}
              className="py-1 disabled:opacity-30"
              disabled={qty >= p.stock_qty}
            >
              <Plus size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// One product in the compact (card-in-a-form) grid.
const CompactCard = memo(function CompactCard({ product: p, qty, price, money, onQty }: CardProps) {
  return (
    <div className={`rounded-lg border overflow-hidden ${qty > 0 ? 'border-orange-400 ring-1 ring-orange-200' : 'border-slate-200'}`}>
      <div className="aspect-square bg-slate-100 flex items-center justify-center">
        {p.image_url ? (
          <img src={p.image_url} alt={p.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : (
          <ImageIcon size={22} className="text-slate-300" />
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-semibold text-slate-800 truncate">{p.name}</p>
        <p className="text-xs text-orange-600 font-bold">{money(price)}</p>
        {p.tax_rate > 0 && <p className="text-[9px] text-slate-400">incl. {p.tax_rate}% tax</p>}
        {p.stock_qty <= 0 ? (
          <p className="mt-1.5 text-center text-[10px] font-medium text-red-500 py-1">Out of stock</p>
        ) : qty === 0 ? (
          <button
            onClick={() => onQty(p, 1)}
            className="mt-1.5 w-full py-1 bg-orange-500 text-white rounded text-xs font-medium hover:bg-orange-600"
          >
            Add
          </button>
        ) : (
          <div className="mt-1.5 flex items-center justify-between bg-slate-50 rounded">
            <button onClick={() => onQty(p, qty - 1)} className="p-1.5 text-slate-600 hover:text-orange-600">
              <Minus size={12} />
            </button>
            <span className="text-xs font-semibold">{qty}</span>
            <button
              onClick={() => onQty(p, Math.min(qty + 1, p.stock_qty))}
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
});

function SkeletonGrid({ count, full }: { count: number; full: boolean }) {
  return (
    <div className={full
      ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-2 gap-y-4 sm:gap-x-4 px-2 sm:px-0'
      : 'grid grid-cols-2 sm:grid-cols-3 gap-3'}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-square w-full rounded-lg bg-slate-100" />
          <div className="mt-2 h-3 w-4/5 rounded bg-slate-100" />
          <div className="mt-1.5 h-3 w-1/3 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

const SEARCH_DEBOUNCE_MS = 300;

export default function ProductPicker({ supermarketId, allStores = false, stores, excludeStoreIds, onCartChange, currency = 'UGX', initialQty, fullPage = false, onOpenCart, hideCartBar = false }: ProductPickerProps) {
  const [profile, setProfile] = useState<SupermarketProfile | null>(null);
  const [categoryNames, setCategoryNames] = useState<string[]>([]);

  // Pages of the current search/category/store, appended as the customer scrolls.
  const [items, setItems] = useState<Product[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // The basket, independent of whichever page/filter is showing: quantities by
  // id plus the product behind each id so a line outlives the page it came from.
  const [qtyById, setQtyById] = useState<Record<string, number>>(initialQty ?? {});
  const [cartProducts, setCartProducts] = useState<Record<string, Product>>({});
  // The basket handed in belongs to the store it arrived with; any other store starts empty.
  const initialFor = useRef<string | null>(initialQty ? supermarketId ?? null : null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const excludeKey = (excludeStoreIds ?? []).join(',');
  const storeKey = allStores ? `all:${supermarketId ?? ''}:${supermarketId ? '' : excludeKey}` : `one:${supermarketId ?? ''}`;
  const requestId = useRef(0);

  // A new store (or a different filter) starts a fresh listing. Single-store
  // mode also drops the basket, as before; all-stores mode keeps it.
  useEffect(() => {
    setActiveCategory('All');
    setSearchInput('');
    setSearch('');
    if (!allStores && initialFor.current !== (supermarketId ?? null)) {
      setQtyById({});
      setCartProducts({});
    }
  }, [storeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce the search box so each keystroke isn't a request.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Store header + category chips.
  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    if (supermarketId) {
      productService.getSupermarketProfile(supermarketId).then(p => { if (!cancelled) setProfile(p); }).catch(() => {});
    }
    productService.listCategoryNames(supermarketId)
      .then(names => { if (!cancelled) setCategoryNames(names); })
      .catch(() => { if (!cancelled) setCategoryNames([]); });
    return () => { cancelled = true; };
  }, [supermarketId]);

  // Products already in a basket from another screen: fetch them so they show
  // up in the cart even though they may be far down the catalog.
  useEffect(() => {
    const ids = Object.keys(initialQty ?? {}).filter(id => (initialQty![id] || 0) > 0);
    if (ids.length === 0) return;
    let cancelled = false;
    productService.getProductsByIds(ids).then(prods => {
      if (cancelled) return;
      setCartProducts(prev => ({ ...Object.fromEntries(prods.map(p => [p.id, p])), ...prev }));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPage = useCallback(async (pageIndex: number) => {
    const id = ++requestId.current;
    if (pageIndex === 0) { setLoading(true); setItems([]); } else { setLoadingMore(true); }
    setLoadError(false);
    try {
      if (!allStores && !supermarketId) {
        if (id === requestId.current) { setItems([]); setHasMore(false); setPage(0); }
        return;
      }
      const result = await productService.getProductsPage({
        supermarketId: supermarketId || null,
        excludeStoreIds: allStores && !supermarketId ? excludeStoreIds : undefined,
        search,
        category: activeCategory === 'All' ? null : activeCategory,
        page: pageIndex,
      });
      if (id !== requestId.current) return; // a newer search/filter superseded this one
      setItems(prev => {
        if (pageIndex === 0) return result.products;
        const seen = new Set(prev.map(p => p.id));
        return [...prev, ...result.products.filter(p => !seen.has(p.id))];
      });
      setHasMore(result.hasMore);
      setPage(pageIndex);
    } catch {
      if (id === requestId.current) { setLoadError(true); setHasMore(false); }
    } finally {
      if (id === requestId.current) { setLoading(false); setLoadingMore(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey, search, activeCategory]);

  useEffect(() => { fetchPage(0); }, [fetchPage]);

  // Next page when the end of the grid scrolls into view.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadNext = useCallback(() => {
    if (hasMore && !loading && !loadingMore) fetchPage(page + 1);
  }, [hasMore, loading, loadingMore, page, fetchPage]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) loadNext(); }, { rootMargin: '700px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadNext, items.length]);

  const storeNameById = useMemo(() => new Map((stores || []).map(s => [s.id, s.name])), [stores]);
  const showStoreName = allStores && !supermarketId;

  const setQty = useCallback((product: Product, qty: number) => {
    const next = Math.max(0, qty);
    setQtyById(prev => ({ ...prev, [product.id]: next }));
    setCartProducts(prev => (prev[product.id] ? prev : { ...prev, [product.id]: product }));
  }, []);

  useEffect(() => {
    const lines: CartLine[] = Object.keys(qtyById)
      .filter(id => (qtyById[id] || 0) > 0 && cartProducts[id])
      .map(id => ({ product: cartProducts[id], qty: qtyById[id] }));
    onCartChange(lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qtyById, cartProducts]);

  const categories = useMemo(() => {
    const set = new Set(categoryNames);
    if (activeCategory !== 'All') set.add(activeCategory);
    return ['All', ...Array.from(set)];
  }, [categoryNames, activeCategory]);

  // The store's listed price already includes tax, so it is shown and billed
  // as-is: mbg_respond_to_ride charges the customer exactly this amount at
  // acceptance, so what's shown here while shopping is what gets billed.
  const foreign = currency !== 'UGX';
  const inclusivePrice = useCallback((p: Product) => foreign
    ? Math.round(Number(p.price_ugx) * 100) / 100
    : Math.round(Number(p.price_ugx)), [foreign]);
  const money = useCallback<Money>((n) => `${currency} ${foreign ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toLocaleString()}`, [currency, foreign]);

  const cartCount = Object.values(qtyById).reduce((sum, q) => sum + q, 0);
  const cartTotal = Object.keys(qtyById).reduce((sum, id) => sum + (qtyById[id] || 0) * (cartProducts[id] ? inclusivePrice(cartProducts[id]) : 0), 0);

  const filtering = !!search || activeCategory !== 'All';
  const catalogEmpty = !loading && !loadError && items.length === 0 && !filtering;

  const renderGrid = (full: boolean) => {
    if (loading) return <SkeletonGrid count={full ? 12 : 6} full={full} />;
    if (loadError && items.length === 0) {
      return (
        <div className="py-8 text-center text-sm text-slate-500">
          Couldn't load products.{' '}
          <button type="button" onClick={() => fetchPage(0)} className="font-semibold text-orange-600">Try again</button>
        </div>
      );
    }
    if (catalogEmpty) {
      return (
        <div className="text-center py-6 text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
          {allStores && !supermarketId
            ? 'No products have been listed yet.'
            : "This store hasn't listed any products yet — describe what you need below instead."}
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <p className={`text-center text-slate-400 ${full ? 'text-sm py-10' : 'text-xs py-6'}`}>
          No products match{search ? ` “${search}”` : ' your filters'}.{' '}
          <button type="button" onClick={() => { setSearchInput(''); setActiveCategory('All'); }} className="font-semibold text-orange-600">Clear</button>
        </p>
      );
    }
    const Card = full ? FullCard : CompactCard;
    return (
      <>
        <div className={full
          ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-2 gap-y-4 sm:gap-x-4 px-2 sm:px-0'
          : 'grid grid-cols-2 sm:grid-cols-3 gap-3'}>
          {items.map(p => (
            <Card
              key={p.id}
              product={p}
              qty={qtyById[p.id] || 0}
              price={inclusivePrice(p)}
              money={money}
              storeName={showStoreName ? storeNameById.get(p.supermarket_id) : undefined}
              onQty={setQty}
            />
          ))}
        </div>
        {hasMore && (
          <div ref={sentinelRef} className="flex justify-center py-4">
            <button
              type="button"
              onClick={loadNext}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200"
            >
              {loadingMore ? <><Loader2 size={14} className="animate-spin" /> Loading more…</> : 'Show more products'}
            </button>
          </div>
        )}
        {!hasMore && items.length > 24 && (
          <p className="py-3 text-center text-[11px] text-slate-400">That's everything{filtering ? ' matching' : ''} · {items.length} products</p>
        )}
      </>
    );
  };

  const chips = (full: boolean) => categories.length > 1 && (
    <div className={`flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide ${full ? 'px-2 sm:px-0' : ''}`}>
      {categories.map((c) => (
        <button
          key={c}
          onClick={() => setActiveCategory(c)}
          className={`flex-shrink-0 rounded-full font-medium whitespace-nowrap transition-colors ${full ? 'px-3 py-1 text-xs' : 'px-2.5 py-1 text-[11px]'} ${
            activeCategory === c ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );

  const searchBox = (full: boolean) => (
    <div className="relative flex-1 min-w-0">
      <Search size={full ? 15 : 14} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${full ? 'left-3' : 'left-2.5'}`} />
      <input
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder={full ? `Search ${profile?.name || 'all stores'}…` : 'Search products…'}
        className={full
          ? 'w-full pl-9 pr-8 py-2 bg-slate-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:bg-white'
          : 'w-full pl-8 pr-7 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-orange-400'}
      />
      {searchInput && (
        <button type="button" onClick={() => setSearchInput('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          <X size={14} />
        </button>
      )}
    </div>
  );

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

        <div className="flex items-center gap-2 px-2 sm:px-0 pt-1 pb-2">{searchBox(true)}</div>
        {chips(true)}
        <div className="pt-2">{renderGrid(true)}</div>

        {cartCount > 0 && !hideCartBar && (
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
        <div className="flex items-center gap-2">{searchBox(false)}</div>
        {chips(false)}
        <div className="max-h-80 overflow-y-auto pr-1">{renderGrid(false)}</div>

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
