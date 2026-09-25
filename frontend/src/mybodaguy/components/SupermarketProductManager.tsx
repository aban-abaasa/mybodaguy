/**
 * SupermarketProductManager — lets a supermarket manage its real product
 * catalog: add/edit/delete products and upload a photo for each one.
 * Reads/writes the shared public.products / public.inventory / public.categories
 * tables that digital-city-era's Supermartkera system already runs on this
 * same Supabase project (see productService.ts for details).
 */
import { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, X, Image as ImageIcon, Package, Camera, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { productService, Product, ProductInput, SupermarketProfile, StoreImportOrder } from '../services/productService';
import { reverseGeocodeCountry } from '../services/geocodeService';
import LocationPickerMap from './LocationPickerMap';
import type { Location } from '../data/mockLocations';

interface SupermarketProductManagerProps {
  supermarketId: string;
  supermarketName?: string;
}

const CATEGORIES = ['Groceries', 'Fresh Produce', 'Dairy & Eggs', 'Bakery', 'Beverages', 'Household', 'Personal Care', 'Other'];

export default function SupermarketProductManager({ supermarketId, supermarketName }: SupermarketProductManagerProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  // The currency this store's prices are written in (UGX until the owner sets another).
  const [currency, setCurrency] = useState('UGX');
  useEffect(() => {
    productService.getSupermarketProfile(supermarketId).then((p) => { if (p?.price_currency) setCurrency(p.price_currency); });
  }, [supermarketId]);

  const load = async () => {
    setLoading(true);
    try {
      setProducts(await productService.getAllProducts(supermarketId));
    } catch (e: any) {
      toast.error(e.message || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [supermarketId]);

  const toggleActive = async (p: Product) => {
    try {
      await productService.updateProduct(p.id, { is_active: !p.is_active });
      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, is_active: !x.is_active } : x));
    } catch (e: any) {
      toast.error(e.message || 'Failed to update product');
      load();
    }
  };

  const remove = async (p: Product) => {
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    try {
      await productService.deleteProduct(p.id);
      setProducts(prev => prev.filter(x => x.id !== p.id));
      toast.success('Product deleted');
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete product');
    }
  };

  return (
    <div className="space-y-4">
      <StoreLocationEditor supermarketId={supermarketId} onCurrencyChange={setCurrency} />
      <StoreImportOrders supermarketId={supermarketId} />
      <StoreBackgroundEditor supermarketId={supermarketId} />

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Package size={20} className="text-orange-500" /> Products
          </h3>
          {supermarketName && <p className="text-sm text-slate-500">{supermarketName}</p>}
        </div>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
        >
          <Plus size={18} /> Add Product
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading…</div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 text-center">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No products yet.</p>
          <button
            onClick={() => setEditing('new')}
            className="mt-4 px-5 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg text-sm font-medium"
          >
            Add Your First Product
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map((p) => (
            <div key={p.id} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${p.is_active ? 'border-slate-100' : 'border-slate-200 opacity-60'}`}>
              <div className="aspect-square bg-slate-100 flex items-center justify-center">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon size={28} className="text-slate-300" />
                )}
              </div>
              <div className="p-3">
                <p className="font-semibold text-slate-800 text-sm truncate">{p.name}</p>
                <p className="text-xs text-slate-400 truncate">{p.category || 'Uncategorized'}</p>
                <p className="font-bold text-orange-600 text-sm mt-1">{currency} {Number(p.price_ugx).toLocaleString()}</p>
                <p className="text-[11px] text-slate-400">{p.stock_qty} in stock</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <button onClick={() => setEditing(p)} className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-medium">
                    <Pencil size={12} /> Edit
                  </button>
                  <button onClick={() => toggleActive(p)} className={`px-2 py-1.5 rounded-lg text-xs font-medium ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {p.is_active ? 'Live' : 'Hidden'}
                  </button>
                  <button onClick={() => remove(p)} className="px-2 py-1.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ProductEditModal
          supermarketId={supermarketId}
          product={editing === 'new' ? null : editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ProductEditModal({
  supermarketId, product, currency, onClose, onSaved,
}: {
  supermarketId: string;
  product: Product | null;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [category, setCategory] = useState(product?.category || CATEGORIES[0]);
  const [price, setPrice] = useState(product?.price_ugx?.toString() || '');
  const [stock, setStock] = useState(product?.stock_qty?.toString() || '0');
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [imagePreview, setImagePreview] = useState<string | null>(product?.image_url || null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    const priceNum = parseFloat(price);
    const stockNum = parseInt(stock, 10);
    if (!name.trim()) { toast.error('Product name is required'); return; }
    if (isNaN(priceNum) || priceNum < 0) { toast.error('Enter a valid price'); return; }
    if (isNaN(stockNum) || stockNum < 0) { toast.error('Enter a valid stock quantity'); return; }

    setSaving(true);
    try {
      const input: ProductInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        price_ugx: priceNum,
        stock_qty: stockNum,
        is_active: isActive,
      };

      let productId: string;
      if (product) {
        await productService.updateProduct(product.id, input);
        productId = product.id;
      } else {
        const created = await productService.createProduct(supermarketId, input);
        productId = created.id;
      }

      if (imageFile) {
        await productService.uploadProductImage(supermarketId, productId, imageFile);
      }

      toast.success(product ? 'Product updated' : 'Product added');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800">{product ? 'Edit Product' : 'Add Product'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={22} /></button>
        </div>

        <div className="space-y-4">
          {/* Image picker */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-24 h-24 rounded-lg bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center overflow-hidden flex-shrink-0"
            >
              {imagePreview ? (
                <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon size={24} className="text-slate-400" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0])}
            />
            <div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-sm text-orange-600 font-medium hover:text-orange-700"
              >
                {imagePreview ? 'Change photo' : 'Upload photo'}
              </button>
              <p className="text-xs text-slate-400 mt-1">JPG or PNG, square photos look best</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fresh Milk 1L"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 outline-none"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Price ({currency}) *</label>
              <input
                type="number" min="0" value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Stock Qty *</label>
              <input
                type="number" min="0" value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 outline-none"
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded" />
              Visible to customers
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional short description"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 outline-none resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} disabled={saving} className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : product ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Unlike the background photo below, this one isn't just cosmetic — without
// real coordinates on file, the customer app's "nearest store" search
// (EnhancedRideRequest.tsx) can't rank or even show this store by distance,
// and a delivery's pickup point falls back to geocoding the store's address
// text on every order instead of using an exact, reliable pin.
function StoreLocationEditor({ supermarketId, onCurrencyChange }: { supermarketId: string; onCurrencyChange: (currency: string) => void }) {
  const [profile, setProfile] = useState<SupermarketProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState<Location | null>(null);
  const [saving, setSaving] = useState(false);
  const [priceCurrency, setPriceCurrency] = useState('UGX');

  useEffect(() => {
    productService.getSupermarketProfile(supermarketId).then((p) => {
      setProfile(p);
      if (p?.price_currency) setPriceCurrency(p.price_currency);
    });
  }, [supermarketId]);

  const hasLocation = profile?.latitude != null && profile?.longitude != null;

  const openEditor = () => {
    setPin(hasLocation ? {
      id: 'store_location',
      name: profile!.name,
      area: profile!.name,
      fullAddress: profile!.address || profile!.location || '',
      coordinates: { lat: profile!.latitude!, lng: profile!.longitude! },
    } : null);
    setEditing(true);
  };

  const save = async () => {
    if (!pin) { toast.error('Search, use GPS, or tap the map to drop a pin first'); return; }
    setSaving(true);
    try {
      await productService.updateStoreLocation(supermarketId, {
        latitude: pin.coordinates.lat,
        longitude: pin.coordinates.lng,
        address: pin.fullAddress,
      });
      setProfile(p => p ? { ...p, latitude: pin.coordinates.lat, longitude: pin.coordinates.lng, address: pin.fullAddress } : p);
      // The country comes from where the pin is, and the currency is what the owner says their
      // prices are in: together they let customers abroad buy from this store.
      try {
        const country = await reverseGeocodeCountry(pin.coordinates.lat, pin.coordinates.lng);
        await productService.updateStoreImportSettings(supermarketId, { country: country?.name ?? null, priceCurrency });
        setProfile(p => p ? { ...p, country: country?.name ?? null, price_currency: priceCurrency.toUpperCase() } : p);
        onCurrencyChange(priceCurrency.toUpperCase());
        toast.success('Store location saved');
      } catch (settingsError: any) {
        toast.warning(`Location saved, but the country and currency could not be: ${settingsError.message || 'try again'}`);
      }
      setEditing(false);
    } catch (e: any) {
      toast.error(e.message || 'Failed to save location');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-xl border p-4 flex items-center justify-between gap-3 ${hasLocation ? 'border-slate-200 bg-white' : 'border-amber-300 bg-amber-50'}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
          <MapPin size={14} className={hasLocation ? 'text-green-600' : 'text-amber-600'} />
          Store location
        </p>
        <p className="text-xs text-slate-500 truncate">
          {hasLocation
            ? ((profile?.address || 'Set — findable in nearest-store search and delivery pickup auto-fills') + (profile?.country ? ` · ${profile.country}, prices in ${profile.price_currency || 'UGX'}` : ''))
            : "Not set — customers won't find this store in nearest-store search"}
        </p>
      </div>
      <button
        type="button"
        onClick={openEditor}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 flex-shrink-0"
      >
        <MapPin size={14} />
        {hasLocation ? 'Update' : 'Set location'}
      </button>

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-slate-800">Set store location</h3>
              <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-slate-600"><X size={22} /></button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Search for it, use your current location, or tap the map — exactly where customers should get picked up from.
            </p>
            <LocationPickerMap
              pickup={pin}
              dropoff={null}
              onPickupChange={setPin}
              onDropoffChange={() => {}}
              selectionMode="pickup"
              gpsTarget="pickup"
            />
            {pin && <p className="text-xs text-slate-500 mt-2 truncate">📍 {pin.fullAddress}</p>}
            <div className="mt-3">
              <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="store-price-currency">Currency your prices are written in</label>
              <input
                id="store-price-currency"
                value={priceCurrency}
                onChange={(e) => setPriceCurrency(e.target.value.toUpperCase().slice(0, 3))}
                maxLength={3}
                placeholder="UGX"
                className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm uppercase focus:ring-2 focus:ring-orange-400 outline-none"
              />
              <p className="text-xs text-slate-500 mt-1">Customers in other countries pay in ICAN, converted from this at its live value — so a UK store enters GBP.</p>
            </div>
            <div className="flex gap-3 pt-4">
              <button onClick={() => setEditing(false)} disabled={saving} className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !pin}
                className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Location'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Orders from customers abroad (the "Buy abroad" flow in Book a Journey): what to
// prepare, and when the courier comes. The goods money is held and paid to the
// store's business wallet once the courier has collected the order.
function StoreImportOrders({ supermarketId }: { supermarketId: string }) {
  const [orders, setOrders] = useState<StoreImportOrder[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => productService.listStoreImportOrders(supermarketId).then((rows) => { if (!cancelled) setOrders(rows); });
    load();
    const timer = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [supermarketId]);

  // Nothing to show (or the feature isn't installed yet): stay out of the way.
  if (!orders || orders.length === 0) return null;

  const statusText = (o: StoreImportOrder) => {
    if (o.orderStatus === 'released') return 'Collected — payment released to your wallet';
    if (o.orderStatus === 'refunded') return 'Cancelled — refunded';
    if (o.courierStatus === 'in_progress') return 'Courier is on the way with it';
    if (o.courierStatus === 'dispatched') return 'Courier assigned — have it ready';
    return o.courierDue ? `Courier due ${new Date(o.courierDue).toLocaleString()}` : 'Courier being arranged';
  };

  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">
      <p className="text-sm font-semibold text-orange-800 flex items-center gap-1.5">
        <Package size={15} /> Orders from abroad ({orders.filter((o) => o.orderStatus === 'held').length} to prepare)
      </p>
      {orders.map((o) => (
        <div key={o.journeyId} className="rounded-lg bg-white p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-slate-700">
              {o.transport === 'air' ? '✈️ By air' : '🚢 By sea'} → {o.destinationCountry || 'abroad'}
            </span>
            <span className="text-xs text-slate-500">{new Date(o.createdAt).toLocaleDateString()}</span>
          </div>
          <p className="mt-1 text-slate-600">
            {o.lines.map((l) => `${l.quantity}× ${l.product_name}`).join(', ')}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {o.currency} {Number(o.goodsLocal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {statusText(o)}
          </p>
        </div>
      ))}
    </div>
  );
}

// Optional storefront background photo — shown behind the store name in the
// customer's product picker. A supermarket can sell products with zero setup
// here; this is purely cosmetic polish, never required.
function StoreBackgroundEditor({ supermarketId }: { supermarketId: string }) {
  const [profile, setProfile] = useState<SupermarketProfile | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    productService.getSupermarketProfile(supermarketId).then(setProfile);
  }, [supermarketId]);

  const handleFileSelect = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    setUploading(true);
    try {
      const url = await productService.uploadStoreBackground(supermarketId, file);
      setProfile(p => p ? { ...p, background_image_url: url } : p);
      toast.success('Store photo updated');
    } catch (e: any) {
      toast.error(e.message || 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
      <div
        className="h-24 bg-cover bg-center bg-gradient-to-r from-orange-100 to-yellow-100"
        style={profile?.background_image_url ? { backgroundImage: `url(${profile.background_image_url})` } : undefined}
      />
      <div className="flex items-center justify-between px-4 py-2.5">
        <div>
          <p className="text-sm font-medium text-slate-700">Store background photo</p>
          <p className="text-xs text-slate-400">Optional — shown to customers browsing your products</p>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex-shrink-0"
        >
          <Camera size={14} />
          {uploading ? 'Uploading…' : profile?.background_image_url ? 'Change' : 'Add photo'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
