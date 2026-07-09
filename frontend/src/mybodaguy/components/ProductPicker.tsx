/**
 * ProductPicker — a real storefront view for one supermarket: optional
 * background photo, search, category chips, and a product grid the customer
 * builds a cart from. Backed by the shared public.products/inventory tables
 * (see productService.ts) — no mock data.
 */
import { useState, useEffect, useMemo } from 'react';
import { Minus, Plus, Image as ImageIcon, ShoppingCart, Search, Store } from 'lucide-react';
import { productService, Product, SupermarketProfile } from '../services/productService';

export interface CartLine {
  product: Product;
  qty: number;
}

interface ProductPickerProps {
  supermarketId: string;
  onCartChange: (lines: CartLine[]) => void;
}

export default function ProductPicker({ supermarketId, onCartChange }: ProductPickerProps) {
  const [profile, setProfile] = useState<SupermarketProfile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [qtyById, setQtyById] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  useEffect(() => {
    setLoading(true);
    setQtyById({});
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

  const cartCount = Object.values(qtyById).reduce((sum, q) => sum + q, 0);
  const cartTotal = products.reduce((sum, p) => sum + (qtyById[p.id] || 0) * Number(p.price_ugx), 0);

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
                    <p className="text-xs text-orange-600 font-bold">UGX {Number(p.price_ugx).toLocaleString()}</p>
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
            <span className="font-bold text-orange-700">UGX {cartTotal.toLocaleString()}</span>
          </div>
        )}
      </div>
    </div>
  );
}
