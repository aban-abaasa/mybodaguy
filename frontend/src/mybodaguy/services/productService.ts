import { supabase } from './supabaseClient';

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
  background_image_url: string | null;
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

async function fetchProducts(supermarketId: string, activeOnly: boolean): Promise<Product[]> {
  let query = supabase
    .from('products')
    .select('id, supermarket_id, name, description, selling_price, images, is_active, created_at, sku, tax_rate, categories(name)')
    .eq('supermarket_id', supermarketId)
    .order('created_at', { ascending: false });
  if (activeOnly) query = query.eq('is_active', true);

  const { data: products, error } = await query;
  if (error) throw error;
  if (!products || products.length === 0) return [];

  const ids = products.map((p: any) => p.id);
  const { data: inventoryRows } = await supabase
    .from('inventory')
    .select('product_id, current_stock, reserved_stock')
    .in('product_id', ids);

  const stockByProduct = new Map<string, number>();
  (inventoryRows || []).forEach((inv: any) => {
    stockByProduct.set(inv.product_id, Math.max(0, Number(inv.current_stock || 0) - Number(inv.reserved_stock || 0)));
  });

  return products.map((p: any) => mapProductRow(p, stockByProduct));
}

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

export const productService = {
  // Real products for a supermarket — used by the customer product picker.
  async getActiveProducts(supermarketId: string): Promise<Product[]> {
    return fetchProducts(supermarketId, true);
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
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${supermarketId}/${productId}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(path, file, { upsert: true, cacheControl: '3600' });
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
  // as-is rather than adding a MyBodaGuy-only duplicate.
  async getSupermarketProfile(supermarketId: string): Promise<SupermarketProfile | null> {
    const { data, error } = await supabase
      .from('supermarkets')
      .select('id, name, location, background_image_url')
      .eq('id', supermarketId)
      .maybeSingle();

    if (error) return null;
    return data;
  },

  // Optional — a supermarket doesn't need a background photo to sell products.
  async uploadStoreBackground(supermarketId: string, file: File): Promise<string> {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${supermarketId}/branding/background-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(path, file, { upsert: true, cacheControl: '3600' });
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
