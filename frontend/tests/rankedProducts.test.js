// The storefront's product page: ranked by customers' ratings and subscriptions when the database function is installed
// (ICAN/supabase/migrations/20261118100000_business_ratings_subscriptions_ranking.sql), "newest first" when it is not.
// Run with: node --experimental-test-module-mocks --test tests/rankedProducts.test.js   (npm run test:ranked-products)
import test, { mock } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

register('./tsResolve.mjs', import.meta.url);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const urlOf = (...p) => pathToFileURL(path.join(root, ...p)).href;

// A tiny stand-in for the supabase client: records calls, answers from `db`.
const db = { ranked: null, rankedError: null, products: [], inventory: [] };
const calls = { rpc: [], from: [] };
const builder = (table) => {
  const state = { table, filters: [], orders: [] };
  const b = {
    select: () => b,
    eq: (...a) => { state.filters.push(['eq', ...a]); return b; },
    not: () => b, or: () => b, is: () => b,
    order: (...a) => { state.orders.push(a); return b; },
    range: () => b,
    in: (col, ids) => { state.filters.push(['in', col, ids]); return b; },
    then: (resolve) => {
      calls.from.push(state);
      let data = [];
      if (table === 'products') {
        const inFilter = state.filters.find((f) => f[0] === 'in');
        // Like Postgres, an id list comes back in no particular order (here: reversed).
        data = inFilter ? db.products.filter((p) => inFilter[2].includes(p.id)).reverse() : db.products;
      }
      if (table === 'inventory') data = db.inventory;
      resolve({ data, error: null });
    },
  };
  return b;
};
const supabase = {
  rpc: async (fn, args) => { calls.rpc.push({ fn, args }); return { data: db.ranked, error: db.rankedError }; },
  from: (table) => builder(table),
};
mock.module(urlOf('mybodaguy', 'services', 'supabaseClient.ts'), { namedExports: { supabase } });
mock.module(urlOf('services', 'supabaseClient.ts'), { namedExports: { supabase } });
mock.module(urlOf('mybodaguy', 'utils', 'imageCompression.ts'), { namedExports: { compressImageFile: async (f) => f } });

const { productService } = await import(urlOf('mybodaguy', 'services', 'productService.ts'));

const product = (id, store) => ({ id, supermarket_id: store, name: `Item ${id}`, description: null, selling_price: 1000, images: [], is_active: true, created_at: '2026-10-01T00:00:00Z', sku: id, tax_rate: 18, categories: null });
const rankedRow = (id, store, over = {}) => ({ product_id: id, supermarket_id: store, store_score: 0.9, rating_avg: 4.8, rating_count: 20, subscriber_count: 10, is_subscribed: false, ...over });
const reset = () => { db.ranked = null; db.rankedError = null; db.products = []; db.inventory = []; calls.rpc.length = 0; calls.from.length = 0; };

test('products come back in the order the database ranked them, not the order the table returned them', async () => {
  reset();
  db.products = [product('p1', 's1'), product('p2', 's2'), product('p3', 's1')];
  db.inventory = ['p1', 'p2', 'p3'].map((id) => ({ product_id: id, current_stock: 5, reserved_stock: 1 }));
  db.ranked = [rankedRow('p2', 's2'), rankedRow('p1', 's1'), rankedRow('p3', 's1')];
  const page = await productService.getProductsPage({ page: 0, pageSize: 24 });
  assert.deepEqual(page.products.map((p) => p.id), ['p2', 'p1', 'p3']);
  assert.equal(page.hasMore, false);
  assert.equal(page.products[0].stock_qty, 4, 'stock is on hand minus reserved, as before');
});

test('each product carries its store\'s stars and followers, and whether this customer follows it', async () => {
  reset();
  db.products = [product('p1', 's1')];
  db.ranked = [rankedRow('p1', 's1', { rating_avg: '4.80', rating_count: 20, subscriber_count: 10, is_subscribed: true })];
  const [p] = (await productService.getProductsPage({ page: 0 })).products;
  assert.equal(p.store_rating_avg, 4.8);
  assert.equal(p.store_rating_count, 20);
  assert.equal(p.store_followers, 10);
  assert.equal(p.store_followed, true);
});

test('an unrated store has no average', async () => {
  reset();
  db.products = [product('p1', 's1')];
  db.ranked = [rankedRow('p1', 's1', { rating_avg: null, rating_count: 0, subscriber_count: 0 })];
  const [p] = (await productService.getProductsPage({ page: 0 })).products;
  assert.equal(p.store_rating_avg, null);
  assert.equal(p.store_rating_count, 0);
  assert.equal(p.store_followed, false);
});

test('the page is asked for with its offset, one extra row, and the same filters the screen had', async () => {
  reset();
  db.ranked = [];
  await productService.getProductsPage({ page: 2, pageSize: 24, supermarketId: 's9', search: '  rice ', category: 'Drinks', excludeStoreIds: ['x1'] });
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].fn, 'fn_ranked_products_page');
  assert.deepEqual(calls.rpc[0].args, { p_supermarket_id: 's9', p_exclude_store_ids: ['x1'], p_search: 'rice', p_category: 'Drinks', p_offset: 48, p_limit: 25 });
  reset(); db.ranked = [];
  await productService.getProductsPage({ page: 0 });
  assert.deepEqual(calls.rpc[0].args, { p_supermarket_id: null, p_exclude_store_ids: null, p_search: null, p_category: null, p_offset: 0, p_limit: 25 });
});

test('the extra row only tells us there is another page and is not shown', async () => {
  reset();
  const ids = Array.from({ length: 5 }, (_, i) => `p${i + 1}`);
  db.products = ids.map((id) => product(id, 's1'));
  db.ranked = ids.map((id) => rankedRow(id, 's1'));
  const page = await productService.getProductsPage({ page: 0, pageSize: 4 });
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.products.map((p) => p.id), ['p1', 'p2', 'p3', 'p4']);
});

test('an empty ranked page is an empty page, and loads nothing else', async () => {
  reset();
  db.ranked = [];
  const page = await productService.getProductsPage({ page: 0 });
  assert.deepEqual(page, { products: [], hasMore: false });
  assert.equal(calls.from.length, 0);
});

test('where the database function is not installed the old newest-first query is used', async () => {
  reset();
  db.rankedError = { code: 'PGRST202', message: 'Could not find the function public.fn_ranked_products_page' };
  db.products = [product('p1', 's1'), product('p2', 's1')];
  const page = await productService.getProductsPage({ page: 0 });
  assert.deepEqual(page.products.map((p) => p.id), ['p1', 'p2']);
  const query = calls.from.find((c) => c.table === 'products');
  assert.deepEqual(query.orders[0], ['created_at', { ascending: false }]);
  assert.equal(page.products[0].store_rating_count, undefined, 'no ranking numbers without the function');
});

test('a page size the function cannot serve falls back instead of silently losing rows', async () => {
  reset();
  db.ranked = [rankedRow('p1', 's1')];
  db.products = [product('p1', 's1')];
  await productService.getProductsPage({ page: 0, pageSize: 150 });
  assert.equal(calls.rpc.length, 0);
});
