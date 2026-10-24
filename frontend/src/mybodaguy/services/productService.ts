import { supabase } from './supabaseClient';
import { compressImageFile } from '../utils/imageCompression';

// Reads/writes the SHARED product catalog that digital-city-era ("Supermartkera")
// already runs on this same Supabase project: public.products, public.inventory,
// public.categories, public.supermarkets (owner_user_id / background_image_url).
// See mybodaguy/backend/database/CREATE_PRODUCT_PHOTOS_BUCKET.sql for the one
// genuinely new piece added here — a Storage bucket for photo uploads.

const PRODUCT_IMAGE_BUCKET = 'product-photos';

export interface Product {
  id: string;
  supermarket_id: string;
  name: string;
  description: string | null;
  category: string | null;
  price_ugx: number;
  image_url: string | null;
  stock_qty: number;
  is_active: boolean;
  created_at: string;
  sku: string | null;
  tax_rate: number;
  /** The selling store's customer rating (1-5) and how many customers rated it; null / 0 until someone has. */
  store_rating_avg?: number | null;
  store_rating_count?: number;
  /** How many customers subscribe to the store, and whether the signed-in customer is one of them. */
  store_followers?: number;
  store_followed?: boolean;
}

export interface ProductInput {
  name: string;
  description?: string;
  category?: string;
  price_ugx: number;
  stock_qty: number;
  is_active?: boolean;
}

export interface SupermarketProfile {
  id: string;
  name: string;
  location: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  background_image_url: string | null;
  /** Where the store is, and the currency its prices are written in — set by the owner; a store with a country can be bought from abroad. */
  country?: string | null;
  price_currency?: string;
}

/** An order from a customer abroad, as the store sees it. */
export interface StoreImportOrder {
  journeyId: string;
  createdAt: string;
  transport: 'air' | 'sea';
  orderStatus: 'held' | 'released' | 'refunded';
  currency: string;
  goodsLocal: number;
  lines: Array<{ product_name: string; quantity: number }>;
  destinationCountry: string | null;
  courierStatus: string | null;
  courierDue: string | null;
}

function mapProductRow(row: any, stockByProduct: Map<string, number>): Product {
  const images = Array.isArray(row.images) ? row.images : [];
  return {
    id: row.id,
    supermarket_id: row.supermarket_id,
    name: row.name,
    description: row.description,
    category: row.categories?.name ?? null,
    price_ugx: Number(row.selling_price) || 0,
    image_url: images[0] || null,
    stock_qty: stockByProduct.get(row.id) ?? 0,
    is_active: !!row.is_active,
    created_at: row.created_at,
    sku: row.sku ?? null,
    tax_rate: row.tax_rate != null ? Number(row.tax_rate) : 18,
  };
}

// supermarketId === null loads products from every store (capped), so the
// customer Shop/Delivery views can always show everything and filter client-side.
const ALL_STORES_PRODUCT_LIMIT = 1000;

async function fetchProducts(supermarketId: string | null, activeOnly: boolean): Promise<Product[]> {
  let query = supabase
    .from('products')
    .select('id, supermarket_id, name, description, selling_price, images, is_active, created_at, sku, tax_rate, categories(name)')
    .order('created_at', { ascending: false });
  query = supermarketId ? query.eq('supermarket_id', supermarketId) : query.limit(ALL_STORES_PRODUCT_LIMIT);
  if (activeOnly) query = query.eq('is_active', true);

  const { data: products, error } = await query;
  if (error) throw error;
  if (!products || products.length === 0) return [];

  const ids = products.map((p: any) => p.id);
  // Chunked so an all-stores load doesn't blow past the request URL length.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const inventoryPages = await Promise.all(
    chunks.map(chunk =>
      supabase.from('inventory').select('product_id, current_stock, reserved_stock').in('product_id', chunk),
    ),
  );

  const stockByProduct = new Map<string, number>();
  inventoryPages.forEach(({ data }) => (data || []).forEach((inv: any) => {
    stockByProduct.set(inv.product_id, Math.max(0, Number(inv.current_stock || 0) - Number(inv.reserved_stock || 0)));
  }));

  return products.map((p: any) => mapProductRow(p, stockByProduct));
}

const PRODUCT_COLUMNS = 'id, supermarket_id, name, description, selling_price, images, is_active, created_at, sku, tax_rate';
export const PRODUCT_PAGE_SIZE = 24;

export interface ProductPageQuery {
  /** One store, or omit/null for every store. */
  supermarketId?: string | null;
  /** All-stores view only: stores whose products must not be listed (e.g. stores abroad). */
  excludeStoreIds?: string[];
  search?: string;
  /** A category name; 'Other' means uncategorised. Omit/null for every category. */
  category?: string | null;
  /** Zero-based. */
  page: number;
  pageSize?: number;
}

export interface ProductPage {
  products: Product[];
  hasMore: boolean;
}

// Available stock (on hand minus reserved) for just the products on screen.
async function fetchStockFor(ids: string[]): Promise<Map<string, number>> {
  const stock = new Map<string, number>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const pages = await Promise.all(
    chunks.map(chunk => supabase.from('inventory').select('product_id, current_stock, reserved_stock').in('product_id', chunk)),
  );
  pages.forEach(({ data }) => (data || []).forEach((inv: any) => {
    stock.set(inv.product_id, Math.max(0, Number(inv.current_stock || 0) - Number(inv.reserved_stock || 0)));
  }));
  return stock;
}

// Strips characters that have meaning inside a PostgREST filter string.
const cleanSearchTerm = (q: string) => q.replace(/[%*,()\\]/g, ' ').replace(/\s+/g, ' ').trim();

async function resolveCategoryId(categoryName: string): Promise<string | null> {
  const name = categoryName.trim();
  if (!name) return null;

  const { data: existing } = await supabase
    .from('categories')
    .select('id')
    .ilike('name', name)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from('categories')
    .insert({ name })
    .select('id')
    .single();
  if (error) return null;
  return created?.id ?? null;
}

// Customers' ratings and subscriptions decide which store's products come first: fn_ranked_products_page
// (ICAN/supabase/migrations/20261118100000_business_ratings_subscriptions_ranking.sql) returns the ids of ONE page in
// display order, with the store's stars and followers. The products are then loaded exactly as before and kept in that
// order. Resolves null when the function is not installed on this project (or the call fails), so the caller falls back
// to "newest first" and the storefront keeps working either way.
async function getRankedProductsPage(q: ProductPageQuery, pageSize: number, from: number): Promise<ProductPage | null> {
  if (pageSize > 99) return null; // the function returns at most 100 rows, and one extra tells us whether more exist
  const term = (q.search ?? '').trim();
  const { data: ranked, error } = await supabase.rpc('fn_ranked_products_page', {
    p_supermarket_id: q.supermarketId || null,
    p_exclude_store_ids: q.excludeStoreIds?.length ? q.excludeStoreIds : null,
    p_search: term || null,
    p_category: q.category || null,
    p_offset: from,
    p_limit: pageSize + 1,
  });
  if (error || !Array.isArray(ranked)) return null;
  const hasMore = ranked.length > pageSize;
  const pageRanked: any[] = hasMore ? ranked.slice(0, pageSize) : ranked;
  if (pageRanked.length === 0) return { products: [], hasMore: false };

  const ids = pageRanked.map(r => r.product_id as string);
  const { data: rows, error: rowsError } = await supabase
    .from('products')
    .select(`${PRODUCT_COLUMNS}, categories(name)`)
    .in('id', ids);
  if (rowsError || !rows) return null;
  const byId = new Map<string, any>(rows.map((r: any) => [r.id, r]));
  const stock = await fetchStockFor(ids);

  const products: Product[] = [];
  for (const r of pageRanked) {
    const row = byId.get(r.product_id);
    if (!row) continue;
    products.push({
      ...mapProductRow(row, stock),
      store_rating_avg: r.rating_avg != null ? Number(r.rating_avg) : null,
      store_rating_count: Number(r.rating_count) || 0,
      store_followers: Number(r.subscriber_count) || 0,
      store_followed: r.is_subscribed === true,
    });
  }
  return { products, hasMore };
}

export const productService = {
  // One page of active products, filtered on the server (store, search,
  // category) and ordered by store rating and subscriptions (see
  // getRankedProductsPage), or newest first where that is not installed. The
  // storefront scrolls through these instead of loading a whole catalog; the
  // page is fetched with one extra row to learn if more exist.
  async getProductsPage(q: ProductPageQuery): Promise<ProductPage> {
    const pageSize = q.pageSize ?? PRODUCT_PAGE_SIZE;
    const from = q.page * pageSize;
    const ranked = await getRankedProductsPage(q, pageSize, from);
    if (ranked) return ranked;
    const byCategory = !!q.category && q.category !== 'Other';
    const term = cleanSearchTerm(q.search ?? '');
    // In the all-stores view, products of deactivated stores stay hidden.
    // If the embedded filter isn't available on this project, retry without it.
    const build = (activeStoresOnly: boolean) => {
      let query = supabase
        .from('products')
        .select(`${PRODUCT_COLUMNS}, ${byCategory ? 'categories!inner(name)' : 'categories(name)'}${activeStoresOnly ? ', supermarkets!inner(is_active)' : ''}`)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + pageSize);
      if (q.supermarketId) query = query.eq('supermarket_id', q.supermarketId);
      else {
        if (q.excludeStoreIds?.length) query = query.not('supermarket_id', 'in', `(${q.excludeStoreIds.join(',')})`);
        if (activeStoresOnly) query = query.eq('supermarkets.is_active', true);
      }
      if (byCategory) query = query.eq('categories.name', q.category as string);
      else if (q.category === 'Other') query = query.is('category_id', null);
      if (term) query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
      return query;
    };

    let { data, error } = await build(!q.supermarketId);
    if (error && !q.supermarketId) ({ data, error } = await build(false));
    if (error) throw error;
    const rows = data || [];
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const stock = await fetchStockFor(pageRows.map((r: any) => r.id));
    return { products: pageRows.map((r: any) => mapProductRow(r, stock)), hasMore };
  },

  // Specific products, e.g. to restore a basket started on another screen.
  async getProductsByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    const pages = await Promise.all(
      chunks.map(chunk => supabase.from('products').select(`${PRODUCT_COLUMNS}, categories(name)`).in('id', chunk)),
    );
    const rows = pages.flatMap(({ data }) => data || []);
    const stock = await fetchStockFor(rows.map((r: any) => r.id));
    return rows.map((r: any) => mapProductRow(r, stock));
  },

  // Category chips for the storefront: the store's own, or the shared list for all stores.
  async listCategoryNames(supermarketId?: string | null): Promise<string[]> {
    if (supermarketId) {
      const { data } = await supabase
        .from('products')
        .select('categories(name)')
        .eq('supermarket_id', supermarketId)
        .eq('is_active', true)
        .limit(2000);
      const names = new Set<string>();
      (data || []).forEach((r: any) => { if (r.categories?.name) names.add(r.categories.name); });
      return Array.from(names).sort();
    }
    const { data } = await supabase.from('categories').select('name').order('name').limit(80);
    return Array.from(new Set((data || []).map((r: any) => r.name as string).filter(Boolean)));
  },

  // Real products for a supermarket — used by the customer product picker.
  async getActiveProducts(supermarketId: string): Promise<Product[]> {
    return fetchProducts(supermarketId, true);
  },

  // Active products from every store — the customer Shop/Delivery default view.
  async getActiveProductsAllStores(): Promise<Product[]> {
    return fetchProducts(null, true);
  },

  // Everything (including inactive) — used by the supermarket's own manager view.
  async getAllProducts(supermarketId: string): Promise<Product[]> {
    return fetchProducts(supermarketId, false);
  },

  async createProduct(supermarketId: string, input: ProductInput): Promise<Product> {
    const categoryId = input.category ? await resolveCategoryId(input.category) : null;
    const sku = `MBG-${supermarketId.slice(0, 6)}-${Date.now().toString(36).toUpperCase()}`;

    const { data: product, error } = await supabase
      .from('products')
      .insert({
        supermarket_id: supermarketId,
        sku,
        name: input.name,
        description: input.description || null,
        category_id: categoryId,
        cost_price: input.price_ugx,
        selling_price: input.price_ugx,
        images: [],
        is_active: input.is_active ?? true,
      })
      .select('id, supermarket_id, name, description, selling_price, images, is_active, created_at, sku, tax_rate')
      .single();
    if (error) throw error;

    const { error: invError } = await supabase
      .from('inventory')
      .insert({ product_id: product.id, current_stock: input.stock_qty });
    if (invError) throw invError;

    return {
      id: product.id,
      supermarket_id: product.supermarket_id,
      name: product.name,
      description: product.description,
      category: input.category || null,
      price_ugx: Number(product.selling_price) || 0,
      image_url: null,
      stock_qty: input.stock_qty,
      is_active: !!product.is_active,
      created_at: product.created_at,
      sku: product.sku ?? null,
      tax_rate: product.tax_rate != null ? Number(product.tax_rate) : 18,
    };
  },

  async updateProduct(productId: string, updates: Partial<ProductInput>): Promise<void> {
    const productUpdates: Record<string, any> = {};
    if (updates.name !== undefined) productUpdates.name = updates.name;
    if (updates.description !== undefined) productUpdates.description = updates.description || null;
    if (updates.price_ugx !== undefined) {
      productUpdates.selling_price = updates.price_ugx;
      productUpdates.cost_price = updates.price_ugx;
    }
    if (updates.is_active !== undefined) productUpdates.is_active = updates.is_active;
    if (updates.category !== undefined) {
      productUpdates.category_id = updates.category ? await resolveCategoryId(updates.category) : null;
    }

    if (Object.keys(productUpdates).length > 0) {
      const { error } = await supabase.from('products').update(productUpdates).eq('id', productId);
      if (error) throw error;
    }

    if (updates.stock_qty !== undefined) {
      const { error } = await supabase
        .from('inventory')
        .update({ current_stock: updates.stock_qty })
        .eq('product_id', productId);
      if (error) throw error;
    }
  },

  async deleteProduct(productId: string): Promise<void> {
    // inventory row cascades via ON DELETE CASCADE on inventory.product_id
    const { error } = await supabase.from('products').delete().eq('id', productId);
    if (error) throw error;
  },

  // Uploads to the public `product-photos` bucket, then points the product's
  // `images` column (already read by lookup_product_by_barcode elsewhere) at it.
  async uploadProductImage(supermarketId: string, productId: string, file: File): Promise<string> {
    const compressed = await compressImageFile(file, 1280, 0.8);
    const ext = compressed.name.split('.').pop() || 'jpg';
    const path = `${supermarketId}/${productId}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(path, compressed, { upsert: true, cacheControl: '31536000' });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
    const publicUrl = data.publicUrl;

    const { error: updateError } = await supabase
      .from('products')
      .update({ images: [publicUrl] })
      .eq('id', productId);
    if (updateError) throw updateError;

    return publicUrl;
  },

  // Which supermarket (if any) the signed-in user manages.
  async getOwnedSupermarket(userId: string): Promise<{ id: string; name: string } | null> {
    const { data, error } = await supabase
      .from('supermarkets')
      .select('id, name')
      .eq('owner_user_id', userId)
      .maybeSingle();

    if (error) return null;
    return data;
  },

  // Storefront profile — background_image_url is the existing Supermartkera
  // branding column (digital-city-era's ADD_SUPERMARKET_BRANDING.sql), reused
  // as-is rather than adding a MyBodaGuy-only duplicate. latitude/longitude
  // are ADD_SUPERMARKET_GEOLOCATION.sql's columns — read here (and written
  // by updateStoreLocation below) so the customer-side nearest-store search
  // in EnhancedRideRequest.tsx has real coordinates to sort by instead of
  // silently falling back to an unsorted list for every store.
  async getSupermarketProfile(supermarketId: string): Promise<SupermarketProfile | null> {
    const { data, error } = await supabase
      .from('supermarkets')
      .select('id, name, location, address, latitude, longitude, background_image_url, country, price_currency')
      .eq('id', supermarketId)
      .maybeSingle();

    if (!error) return data;

    // The country / currency columns come from ADD_JOURNEY_STORE_IMPORT.sql — until that has
    // been run, the profile still loads without them.
    const { data: basic, error: basicError } = await supabase
      .from('supermarkets')
      .select('id, name, location, address, latitude, longitude, background_image_url')
      .eq('id', supermarketId)
      .maybeSingle();
    if (basicError) return null;
    return basic;
  },

  // The store's country and price currency — what makes it a store customers abroad can
  // buy from. Owner-only (the same RLS as the location above).
  async updateStoreImportSettings(supermarketId: string, settings: { country: string | null; priceCurrency: string }): Promise<void> {
    const currency = settings.priceCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Enter the currency as a 3-letter code, e.g. GBP');
    const { error } = await supabase.from('supermarkets').update({ country: settings.country, price_currency: currency }).eq('id', supermarketId);
    if (error) throw error;
  },

  // Orders placed from abroad for this store (owner only). An empty list when there are none —
  // or when the feature's SQL hasn't been run yet.
  async listStoreImportOrders(supermarketId: string): Promise<StoreImportOrder[]> {
    const { data, error } = await supabase.rpc('mbg_list_store_import_orders', { p_supermarket_id: supermarketId });
    if (error) return [];
    return (data || []).map((r: any) => ({
      journeyId: r.journey_id, createdAt: r.created_at, transport: r.transport, orderStatus: r.order_status,
      currency: r.currency, goodsLocal: Number(r.goods_local),
      lines: Array.isArray(r.goods_snapshot) ? r.goods_snapshot : [],
      destinationCountry: r.destination_country, courierStatus: r.courier_status, courierDue: r.courier_due,
    }));
  },

  // Sets/updates the store's real pickup coordinates — the one thing that
  // makes this store findable by the customer app's "nearest store" search
  // and lets a delivery's pickup point auto-fill instead of needing a
  // geocode round-trip against the store's address text every time.
  async updateStoreLocation(supermarketId: string, location: { latitude: number; longitude: number; address?: string | null }): Promise<void> {
    const updates: Record<string, any> = { latitude: location.latitude, longitude: location.longitude };
    if (location.address !== undefined) updates.address = location.address;
    const { error } = await supabase.from('supermarkets').update(updates).eq('id', supermarketId);
    if (error) throw error;
  },

  // Optional — a supermarket doesn't need a background photo to sell products.
  async uploadStoreBackground(supermarketId: string, file: File): Promise<string> {
    const compressed = await compressImageFile(file, 1600, 0.8);
    const ext = compressed.name.split('.').pop() || 'jpg';
    const path = `${supermarketId}/branding/background-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(path, compressed, { upsert: true, cacheControl: '31536000' });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
    const publicUrl = data.publicUrl;

    const { error: updateError } = await supabase
      .from('supermarkets')
      .update({ background_image_url: publicUrl })
      .eq('id', supermarketId);
    if (updateError) throw updateError;

    return publicUrl;
  },
};
