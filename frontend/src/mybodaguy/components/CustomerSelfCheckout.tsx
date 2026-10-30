import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera, CameraOff, ScanLine, X, Plus, Minus, Trash2,
  ShoppingCart, CheckCircle, Loader, AlertCircle, Coins,
  ReceiptText, QrCode, Store, ChevronDown, CalendarClock, ExternalLink,
  Download, Clock, ShieldCheck, ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../../services/supabaseClient';
import {
  getBalance,
  formatICAN,
  ICAN_TO_UGX,
  type ICANBalance,
} from '../services/icanWalletService';
import ProductPicker, { CartLine } from './ProductPicker';
import { formatMoney } from '../services/money';
import ScanFrameOverlay from './ScanFrameOverlay';
import SetPinPrompt from './SetPinPrompt';
import { hasPinSet, verifyPin, validatePIN } from '../services/pinService';
import { getStoreSiteForCustomer, getStoreWebsiteUrl } from '../services/storeWebsite';
import { buildApprovalUrl, downloadReceiptPdf, type StoreReceipt } from '../services/receiptPdf';
import ShopStoreChooser from './ShopStoreChooser';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Product {
  product_id: string;
  name: string;
  sku: string;
  barcode: string;
  selling_price: number;
  tax_rate: number;
  category_name: string;
  brand: string;
  images: { url: string }[] | null;
  available_stock: number;
  in_stock: boolean;
  /** Store this line belongs to — checkout records each store's sale separately. */
  supermarket_id?: string;
}

interface CartItem {
  product: Product;
  quantity: number;
  line_total: number;
}

interface CheckoutReceipt {
  transaction_id: string;
  items_count: number;
  /** The store paid: its name, the products bought, the verification QR and who approved it. */
  store: StoreReceipt;
  ican_cashback: {
    success: boolean;
    net_credited?: number;
  } | null;
}

type ScannerState = 'idle' | 'scanning' | 'product_found' | 'cart' | 'checkout' | 'complete';
type PaymentMethod = 'cash' | 'card' | 'mobile_money' | 'ican';
type ShopMode = 'scan' | 'browse';

interface SupermarketRow {
  id: string;
  name: string;
  location: string | null;
  business_type: string;
  price_currency?: string | null;
}

// Extend Window for BarcodeDetector (not in standard TS lib yet)
declare global {
  interface Window {
    BarcodeDetector: any;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatUGX(n: number) {
  return `UGX ${n.toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;
}

const icanPriceCache = new Map<string, number>();

/** What one ICAN is worth in `currency` - the price the database converts with. UGX keeps the fixed rate. */
async function getIcanPrice(currency: string): Promise<number | null> {
  if (currency === 'UGX') return ICAN_TO_UGX;
  const cached = icanPriceCache.get(currency);
  if (cached) return cached;
  const { data, error } = await supabase.rpc('ican_get_price_in_currency', { p_currency_code: currency });
  const price = Number(Array.isArray(data) ? data[0]?.price_local : data?.price_local);
  if (error || !Number.isFinite(price) || price <= 0) return null;
  icanPriceCache.set(currency, price);
  return price;
}

function cartTotals(cart: CartItem[]) {
  // Selling prices already include tax, so the customer pays exactly the
  // displayed price. Tax is the portion inside it, shown for transparency.
  const total = cart.reduce((s, i) => s + i.product.selling_price * i.quantity, 0);
  const includedTax = cart.reduce((s, i) => {
    const rate = Number(i.product.tax_rate ?? 18);
    const gross = i.product.selling_price * i.quantity;
    return s + (rate > 0 ? gross - gross / (1 + rate / 100) : 0);
  }, 0);
  return {
    subtotal: Math.round(total - includedTax),
    tax: Math.round(includedTax),
    total: Math.round(total),
  };
}

// ── Main Component ─────────────────────────────────────────────────────────────

/** A service the customer chose in the Shop: the dashboard opens its Book screen for it. */
export type BookableServiceRef = { id: string; name: string; is_bookable?: boolean };

export default function CustomerSelfCheckout({ user, onBookService }: { user: any; onBookService?: (service: BookableServiceRef) => void }) {
  const [state, setState] = useState<ScannerState>('idle');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [icanPrice, setIcanPrice] = useState<number>(ICAN_TO_UGX);
  const [foundProduct, setFoundProduct] = useState<Product | null>(null);
  const [scanError, setScanError] = useState('');
  const [manualBarcode, setManualBarcode] = useState('');
  const [looking, setLooking] = useState(false);
  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [icanBalance, setIcanBalance] = useState<ICANBalance | null>(null);
  const [detectorSupported, setDetectorSupported] = useState(false);

  // IcanEra wallet payments are authorised with the transaction PIN first
  const [pinOpen, setPinOpen] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);
  const [pin, setPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  // Products load right away (browse); scanning is one tap away
  const [shopMode, setShopMode] = useState<ShopMode>('browse');
  const [supermarkets, setSupermarkets] = useState<SupermarketRow[]>([]);
  const [storesLoaded, setStoresLoaded] = useState(false);
  const [selectedSupermarketId, setSelectedSupermarketId] = useState('');
  // The customer is asked which store they are in every time they start picking
  // products (opening Shop, "Start New Shop", or tapping the store name to switch).
  // Until they answer, no products are listed and nothing can be scanned or added.
  const [storeConfirmed, setStoreConfirmed] = useState(false);
  // Quantities from the cart handed back to the product grid when the cart page is left,
  // so edits made on the cart page show on the grid (and removed products stay removed).
  const [pickerSync, setPickerSync] = useState<{ version: number; qty: Record<string, number> }>({ version: 0, qty: {} });
  // A store the customer picked while their cart still holds another store's products —
  // waits for them to confirm that the cart will be cleared.
  const [pendingStoreId, setPendingStoreId] = useState('');

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const rafRef = useRef<number>(0);
  const lastBarcodeRef = useRef('');
  const lastScanTimeRef = useRef(0);
  // Tracks which cart product_ids came from the browse picker, so its
  // onCartChange can resync just those lines without touching scanned items.
  const browsedIdsRef = useRef<Set<string>>(new Set());

  // ── ICAN balance ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (user?.id) {
      getBalance(user.id).then(setIcanBalance).catch(() => {});
    }
  }, [user?.id]);

  // ── BarcodeDetector support check ─────────────────────────────────────────

  useEffect(() => {
    setDetectorSupported('BarcodeDetector' in window);
  }, []);

  // ── Supermarket list — the customer must pick one before scanning or
  // browsing, so lookups/checkout are scoped to a real store, not left
  // pre-selected to whichever store happened to load first ────────────────

  useEffect(() => {
    supabase
      .from('supermarkets')
      .select('id, name, location, business_type, price_currency')
      .eq('is_active', true)
      .order('name')
      .then(({ data, error }) => {
        if (error) toast.error("Couldn't load the stores. Check your connection and reopen Shop.");
        setSupermarkets(data || []);
        setStoresLoaded(true);
      });
  }, []);

  // ── Camera start / stop ───────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    if (!selectedSupermarketId) {
      toast.error('Choose a store first');
      return;
    }
    setScanError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      // The <video> only exists while state === 'scanning', so the stream is attached
      // by the effect below once it has mounted (videoRef is still null here).
      setState('scanning');
    } catch (err: any) {
      setScanError(err.name === 'NotAllowedError'
        ? 'Camera permission denied. Use manual entry below.'
        : 'Camera unavailable. Use manual barcode entry.');
      setState('idle');
    }
  }, [selectedSupermarketId]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // ── Scan loop ─────────────────────────────────────────────────────────────

  const handleBarcode = useCallback(async (code: string) => {
    const now = Date.now();
    if (code === lastBarcodeRef.current && now - lastScanTimeRef.current < 2500) return;
    lastBarcodeRef.current = code;
    lastScanTimeRef.current = now;
    stopCamera();
    setState('idle');
    await lookupProduct(code);
  }, [stopCamera]);

  const scanLoop = useCallback(() => {
    const detect = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(detect);
        return;
      }
      try {
        const barcodes = await detectorRef.current.detect(videoRef.current);
        if (barcodes.length > 0) {
          await handleBarcode(barcodes[0].rawValue);
          return;
        }
      } catch {}
      rafRef.current = requestAnimationFrame(detect);
    };
    rafRef.current = requestAnimationFrame(detect);
  }, [handleBarcode]);

  // Once the live-view <video> has mounted, give it the camera stream and start detecting.
  useEffect(() => {
    if (state !== 'scanning') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
    if (detectorSupported) {
      try {
        detectorRef.current = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'],
        });
        scanLoop();
      } catch {}
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [state, detectorSupported, scanLoop]);

  useEffect(() => {
    return () => {
      stopCamera();
      cancelAnimationFrame(rafRef.current);
    };
  }, [stopCamera]);

  // ── Product lookup ────────────────────────────────────────────────────────

  async function lookupProduct(scan: string) {
    if (!scan.trim()) return;
    if (!selectedSupermarketId) {
      toast.error('Choose a store first');
      return;
    }
    setLooking(true);
    setScanError('');
    setFoundProduct(null);

    const { data, error } = await supabase.rpc('lookup_product_by_barcode', {
      p_scan: scan.trim(),
      p_supermarket_id: selectedSupermarketId,
    });

    setLooking(false);

    if (error || !data || data.length === 0) {
      setScanError(`No product found for "${scan}"`);
      setState('idle');
      return;
    }

    const product = { ...(data[0] as Product), supermarket_id: selectedSupermarketId };

    if (!product.in_stock) {
      // A service has no stock to run out of: it is booked, not scanned and paid for at the till.
      const { data: kind } = await supabase.from('products').select('inventory_mode').eq('id', product.product_id).maybeSingle();
      setScanError(kind?.inventory_mode === 'service_item'
        ? `${product.name} is a service, so it can't be scanned and paid for here. Book it from Services in the Shop.`
        : `${product.name} is out of stock`);
      setState('idle');
      return;
    }

    setFoundProduct(product);
    setManualBarcode('');
    setState('product_found');
  }

  // ── Cart management ───────────────────────────────────────────────────────

  function addToCart(product: Product, qty = 1) {
    setCart(prev => {
      const existing = prev.find(i => i.product.product_id === product.product_id);
      if (existing) {
        const newQty = existing.quantity + qty;
        if (newQty > product.available_stock) {
          toast.error(`Only ${product.available_stock} in stock`);
          return prev;
        }
        return prev.map(i =>
          i.product.product_id === product.product_id
            ? { ...i, quantity: newQty, line_total: product.selling_price * newQty }
            : i,
        );
      }
      return [...prev, { product, quantity: qty, line_total: product.selling_price * qty }];
    });
    setFoundProduct(null);
    setState('cart');
    toast.success(`${product.name} added to cart`);
  }

  // Browse mode's ProductPicker manages its own quantities and reports the
  // full line list on every change — merge those lines into the same cart
  // used for scanning, without touching any scanned-in items. Same
  // public.products.id underlies both paths, so no id translation needed.
  const handleBrowseCartChange = useCallback((lines: CartLine[]) => {
    setCart(prev => {
      const nonBrowsed = prev.filter(i => !browsedIdsRef.current.has(i.product.product_id));
      const browsedItems: CartItem[] = lines.map(l => ({
        product: {
          product_id: l.product.id,
          name: l.product.name,
          sku: l.product.sku || l.product.id,
          barcode: '',
          selling_price: Number(l.product.price_ugx),
          tax_rate: l.product.tax_rate,
          category_name: l.product.category || '',
          brand: '',
          images: l.product.image_url ? [{ url: l.product.image_url }] : null,
          available_stock: l.product.stock_qty,
          in_stock: l.product.stock_qty > 0,
          supermarket_id: l.product.supermarket_id,
        },
        quantity: l.qty,
        line_total: Number(l.product.price_ugx) * l.qty,
      }));
      browsedIdsRef.current = new Set(lines.map(l => l.product.id));
      return [...nonBrowsed, ...browsedItems];
    });
  }, []);

  function updateQty(productId: string, delta: number) {
    setCart(prev =>
      prev
        .map(i => {
          if (i.product.product_id !== productId) return i;
          const newQty = i.quantity + delta;
          if (newQty <= 0) return null;
          if (newQty > i.product.available_stock) {
            toast.error(`Only ${i.product.available_stock} in stock`);
            return i;
          }
          return { ...i, quantity: newQty, line_total: i.product.selling_price * newQty };
        })
        .filter(Boolean) as CartItem[],
    );
  }

  // ── Checkout ──────────────────────────────────────────────────────────────

  async function submitCheckout() {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      // A cart only ever holds one store's products (choosing another store clears it),
      // and the database refuses a sale that spans stores.
      const storeId = cart[0].product.supermarket_id || selectedSupermarketId;
      const store = supermarkets.find(sm => sm.id === storeId);

      const { data, error } = await supabase.rpc('customer_self_checkout', {
        p_cart: cart.map(i => ({
          product_id: i.product.product_id,
          quantity: i.quantity,
          unit_price: i.product.selling_price,
          tax_rate: i.product.tax_rate,
        })),
        p_payment_method: payment,
        p_pay_with_ican: payment === 'ican',
      });
      if (error || !data?.success) {
        toast.error(error?.message ?? data?.error ?? 'Checkout failed');
        return;
      }

      // Payment is final. Issue the receipt its QR token (staff scan it to approve the
      // receipt, which stamps their name on it). Best effort: a failure here must never
      // undo or hide a sale that is already paid — the receipt just shows without a QR.
      let approvalToken: string | null = null;
      if (data.receipt_id) {
        try {
          const { data: reg, error: regError } = await supabase.rpc('register_receipt_approval', {
            p_receipt_id: data.receipt_id,
            p_supermarket_id: storeId,
          });
          if (regError || !reg?.success) {
            console.warn('Receipt approval was not registered:', regError?.message ?? reg?.error);
          } else {
            approvalToken = reg.approval_token ?? null;
          }
        } catch (regErr) {
          console.warn('Receipt approval was not registered:', regErr);
        }
      }

      const lines: any[] = data.items?.length ? data.items : cart.map(i => ({
        product_id: i.product.product_id,
        product_name: i.product.name,
        quantity: i.quantity,
        unit_price: i.product.selling_price,
        line_total: i.line_total,
      }));
      setReceipt({
        transaction_id: data.transaction_id,
        items_count: Number(data.items_count || 0),
        store: {
          receipt_id: data.receipt_id || '',
          receipt_number: data.receipt_number || '',
          store_id: storeId,
          store_name: store?.name || 'Store',
          store_location: store?.location ?? null,
          currency: String(data.currency || store?.price_currency || 'UGX').toUpperCase(),
          purchased_at: new Date().toISOString(),
          customer_name: user?.user_metadata?.full_name || user?.email || null,
          items: lines.map(i => ({
            product_id: i.product_id,
            product_name: i.product_name || i.name || 'Product',
            quantity: Number(i.quantity),
            unit_price: Number(i.unit_price),
            line_total: Number(i.line_total),
          })),
          subtotal: Number(data.subtotal_ugx ?? data.total_ugx ?? 0),
          tax: Number(data.tax_ugx || 0),
          total: Number(data.total_ugx || 0),
          approval_token: approvalToken,
          approval_status: 'pending',
          approved_by_name: null,
          approved_at: null,
        },
        ican_cashback: data.ican_cashback ?? null,
      });

      // Refresh ICAN balance
      if (user?.id) getBalance(user.id).then(setIcanBalance).catch(() => {});

      setCart([]);
      setState('complete');
    } finally {
      setSubmitting(false);
    }
  }

  // While the receipt waits for staff, check every few seconds whether it has been
  // approved, so "Approved by <staff name>" appears on the customer's screen.
  const pendingReceiptId = receipt?.store.receipt_id && receipt.store.approval_token && receipt.store.approval_status === 'pending'
    ? receipt.store.receipt_id
    : '';
  useEffect(() => {
    if (state !== 'complete' || !pendingReceiptId) return undefined;
    let cancelled = false;
    const check = async () => {
      const { data, error } = await supabase.rpc('get_my_receipt_approvals', { p_receipt_ids: [pendingReceiptId] });
      if (cancelled || error || !Array.isArray(data)) return;
      const hit = data.find((row: any) => row.approval_status === 'approved');
      if (!hit) return;
      setReceipt(prev => prev && {
        ...prev,
        store: { ...prev.store, approval_status: 'approved', approved_by_name: hit.approved_by_name ?? null, approved_at: hit.approved_at ?? null },
      });
      toast.success('Your receipt was approved by staff');
    };
    const timer = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [state, pendingReceiptId]);

  async function handleDownloadReceipt() {
    if (!receipt) return;
    setDownloading(true);
    try {
      await downloadReceiptPdf(receipt.store);
    } catch (error) {
      console.error('Receipt PDF failed:', error);
      toast.error('Could not create the receipt PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  function reset() {
    stopCamera();
    setCart([]);
    setFoundProduct(null);
    setScanError('');
    setManualBarcode('');
    setReceipt(null);
    setPayment('cash');
    // A new shop starts by asking which store the customer is in.
    setSelectedSupermarketId('');
    setStoreConfirmed(false);
    setPendingStoreId('');
    setState('idle');
  }

  // ── Which store? ──────────────────────────────────────────────────────────

  function openStore(storeId: string) {
    setSelectedSupermarketId(storeId);
    setStoreConfirmed(true);
    setScanError('');
  }

  // A cart holds products from one store only. Choosing a different store while the
  // cart has products in it asks first, because the cart is cleared to make the switch.
  function chooseStore(storeId: string) {
    if (cart.length > 0 && cartStoreId && storeId !== cartStoreId) {
      setPendingStoreId(storeId);
      return;
    }
    openStore(storeId);
  }

  function confirmStoreSwitch() {
    const next = pendingStoreId;
    setPendingStoreId('');
    setCart([]);
    browsedIdsRef.current = new Set();
    openStore(next);
  }

  function keepCurrentStore() {
    setPendingStoreId('');
    openStore(cartStoreId);
  }

  // Leave the cart page and return to shopping.
  function leaveCartPage() {
    setPickerSync(prev => ({
      version: prev.version + 1,
      qty: Object.fromEntries(cart.map(i => [i.product.product_id, i.quantity])),
    }));
    setState('idle');
  }

  // Back to the "Which store are you shopping at?" question.
  function askStore() {
    stopCamera();
    setFoundProduct(null);
    setScanError('');
    setStoreConfirmed(false);
    setState('idle');
  }

  // Instalments are set up and followed up on the store's business website
  // (deposit, schedule, reminders, collect/deliver once paid), so this just
  // opens that site. Opened synchronously-first so mobile browsers don't block it.
  async function openInstalmentsOnWebsite() {
    const win = window.open('', '_blank');
    const site = siteStoreId ? await getStoreSiteForCustomer({ supermarketId: siteStoreId }) : null;
    if (!site) {
      win?.close();
      toast.error("We couldn't find this store's website. Try again in a moment.");
      return;
    }
    // Instalments are started from the cart in the website's Market tab.
    const target = site.viaStorefront ? site.url : `${site.url}?tab=market`;
    if (win) { win.opener = null; win.location.href = target; }
    else window.location.href = target;
  }

  // Every payment mode except the IcanEra wallet is settled on the store's own
  // website (its Pay tab: cash, Mobile Money, card or bank), so this just opens
  // that site. Opened synchronously-first so mobile browsers don't block it.
  async function payOnStoreWebsite() {
    const win = window.open('', '_blank');
    const website = await resolveStorePayUrl();
    if (!website) {
      win?.close();
      toast.error("We couldn't find this store's website. Try again in a moment.");
      return;
    }
    if (win) { win.opener = null; win.location.href = website; }
    else window.location.href = website;
  }

  async function resolveStorePayUrl(): Promise<string | null> {
    if (!siteStoreId) return null;
    try {
      // The store's page on the IcanEra site (customers can't read the company table
      // directly, so this goes through get_store_public_website).
      const storeSite = await getStoreWebsiteUrl({ supermarketId: siteStoreId });
      if (storeSite) return `${storeSite}?pay=1`;
      const { data: store } = await supabase.from('supermarkets')
        .select('pichin_business_profile_id').eq('id', siteStoreId).maybeSingle();
      const businessId = store?.pichin_business_profile_id;
      if (businessId) {
        const { data: business } = await supabase.from('business_profiles')
          .select('website').eq('id', businessId).maybeSingle();
        const site = business?.website?.trim();
        if (site) return /^https?:\/\//i.test(site) ? site : `https://${site}`;
      }
      // Every store has a website: with no company site yet, its storefront on icanera.space.
      return (await getStoreSiteForCustomer({ supermarketId: siteStoreId }))?.url ?? null;
    } catch (error) {
      console.warn('Could not resolve store website for payment:', error);
      return null;
    }
  }

  // Pay button: wallet → PIN first, anything else → the store's website.
  async function handlePay() {
    if (payment !== 'ican') {
      await payOnStoreWebsite();
      return;
    }
    if (!user?.id) { toast.error('Sign in to pay with your IcanEra wallet'); return; }
    try {
      if (!(await hasPinSet(user.id))) { setNeedsPin(true); return; }
      setPin('');
      setPinOpen(true);
    } catch {
      toast.error("We couldn't check your PIN. Please try again.");
    }
  }

  async function confirmPinAndPay() {
    if (!validatePIN(pin) || pinBusy) return;
    setPinBusy(true);
    try {
      const check = await verifyPin(user.id, pin);
      if (!check.success) { toast.error(check.error || 'Incorrect PIN'); setPin(''); return; }
      setPinOpen(false);
      setPin('');
      await submitCheckout();
    } catch {
      toast.error("We couldn't verify your PIN. Please try again.");
    } finally {
      setPinBusy(false);
    }
  }

  // ── Computed ──────────────────────────────────────────────────────────────

  const totals = cartTotals(cart);
  // Everything is shown in the store's own currency, and ICAN is converted at that currency's price.
  const cartStoreId = cart[0]?.product.supermarket_id || selectedSupermarketId;
  const currency = (supermarkets.find(sm => sm.id === cartStoreId)?.price_currency || 'UGX').toUpperCase();
  const fmt = (n: number) => formatMoney(n, currency);
  const icanNeeded = icanPrice > 0 ? Math.floor((totals.total / icanPrice) * 1e8) / 1e8 : 0;
  const canPayICAN = icanPrice > 0 && (icanBalance?.ican ?? 0) >= icanNeeded;

  useEffect(() => {
    let cancelled = false;
    setIcanPrice(currency === 'UGX' ? ICAN_TO_UGX : 0);
    getIcanPrice(currency).then(price => { if (!cancelled) setIcanPrice(price ?? 0); });
    return () => { cancelled = true; };
  }, [currency]);

  const activeStore = supermarkets.find(sm => sm.id === selectedSupermarketId) || null;
  // The store whose website applies (instalments, paying on the site) is the cart's store.
  const siteStoreId = cartStoreId;
  const lockedStore = cart.length > 0 ? supermarkets.find(sm => sm.id === cartStoreId) || null : null;
  const pendingStore = supermarkets.find(sm => sm.id === pendingStoreId) || null;
  const pickerCurrency = (activeStore?.price_currency || 'UGX').toUpperCase();
  // The cart is its own page: while it is open the shop (toolbar, products, scanner) is hidden.
  const showCartPage = (state === 'cart' || state === 'checkout') && cart.length > 0;

  // Opening the cart jumps to the top of the page — the customer may have scrolled far down
  // the products — and removing its last item goes back to shopping.
  useEffect(() => {
    if (showCartPage) window.scrollTo({ top: 0 });
  }, [showCartPage]);
  useEffect(() => {
    if (state === 'cart' && cart.length === 0) leaveCartPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, cart.length]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={rootRef} className="space-y-3">

      {/* ── Receipt ────────────────────────────────────────────────────── */}
      {state === 'complete' && receipt && (() => {
        const sr = receipt.store;
        const approved = sr.approval_status === 'approved';
        const money = (n: number) => formatMoney(n, sr.currency);
        return (
          <div className="bg-white rounded-2xl shadow-xl p-6 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="text-green-500" size={32} />
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-1">Order Complete!</h3>
            <p className="text-slate-500 text-sm mb-6">Your items are ready</p>

            {/* The receipt: the store's name, the products bought there, a QR code staff
                scan to approve it (and anyone can scan to verify it), and who approved it. */}
            <div className="bg-slate-50 rounded-xl p-4 text-left space-y-2 mb-4">
              <div className="flex items-center gap-2 pb-1">
                <Store size={18} className="flex-shrink-0 text-orange-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-slate-900">{sr.store_name}</p>
                  {sr.store_location && <p className="truncate text-xs text-slate-500">{sr.store_location}</p>}
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Receipt #</span>
                <span className="font-mono font-semibold text-slate-900">{sr.receipt_number}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Transaction #</span>
                <span className="font-mono font-semibold text-xs text-slate-900">{receipt.transaction_id?.slice(-12)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Items</span>
                <span className="font-semibold text-slate-900">{receipt.items_count}</span>
              </div>
              {sr.items.map((item, index) => (
                <div key={`${item.product_id}-${index}`} className="flex justify-between gap-3 text-sm border-t border-slate-200 pt-2">
                  <span className="text-slate-900">
                    {item.product_name} × {item.quantity}
                  </span>
                  <span className="font-semibold text-slate-900 whitespace-nowrap">
                    {money(item.line_total)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Tax</span>
                <span className="text-slate-900">{money(sr.tax)}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t pt-2">
                <span>Total Paid</span>
                <span className="text-orange-600">{money(sr.total)}</span>
              </div>

              {/* Verification QR + staff approval */}
              <div className={`flex items-center gap-3 rounded-lg border p-3 ${approved ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
                {sr.approval_token && (
                  <div className="flex-shrink-0 rounded-md bg-white p-1.5">
                    <QRCodeSVG
                      value={buildApprovalUrl(sr.approval_token)}
                      size={96}
                      level="M"
                      title={`Verification QR code for receipt ${sr.receipt_number}`}
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1 text-sm">
                  {approved ? (
                    <>
                      <p className="flex items-center gap-1.5 font-bold text-green-700">
                        <ShieldCheck size={16} /> Approved
                      </p>
                      <p className="text-xs text-slate-600">Approved by</p>
                      <p className="truncate font-semibold text-slate-900">{sr.approved_by_name || 'Store staff'}</p>
                      {sr.approved_at && <p className="text-xs text-slate-500">{new Date(sr.approved_at).toLocaleString()}</p>}
                    </>
                  ) : sr.approval_token ? (
                    <>
                      <p className="flex items-center gap-1.5 font-bold text-amber-700">
                        <Clock size={16} /> Awaiting staff approval
                      </p>
                      <p className="text-xs text-slate-600">
                        Show this QR code to a {sr.store_name} staff member. Their name appears here once they approve.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-600">
                      Your payment is complete. The verification code could not be created for this receipt; ask {sr.store_name} staff to confirm it with receipt # {sr.receipt_number}.
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleDownloadReceipt}
                disabled={downloading}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-orange-300 bg-white py-2.5 text-sm font-semibold text-orange-600 transition-colors hover:bg-orange-50 disabled:opacity-60"
              >
                {downloading ? <Loader size={16} className="animate-spin" /> : <Download size={16} />}
                {downloading ? 'Preparing PDF…' : 'Download receipt (PDF)'}
              </button>
            </div>

            {receipt.ican_cashback?.success && receipt.ican_cashback.net_credited && (
              <div className="flex items-center gap-2 justify-center bg-orange-50 border border-orange-200 rounded-lg px-4 py-2 mb-4">
                <Coins className="text-orange-500" size={16} />
                <span className="text-sm font-semibold text-orange-700">
                  +₡ {formatICAN(receipt.ican_cashback.net_credited)} ICAN cashback earned!
                </span>
              </div>
            )}

            <button
              onClick={reset}
              className="w-full py-3 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all"
            >
              Start New Shop
            </button>
          </div>
        );
      })()}

      {/* ── Idle / Scan entry ──────────────────────────────────────────── */}
      {/* Hidden, not removed, while the cart page is open: the product picker keeps its
          basket in its own state, which would be lost if it unmounted. */}
      {(state === 'idle' || state === 'product_found' || state === 'cart' || state === 'checkout') && (
        <div hidden={showCartPage} className="space-y-3">
          {/* One slim toolbar instead of stacked cards: the store being shopped at,
              Scan/Browse toggle, wallet balance and cart. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={askStore}
              aria-label={storeConfirmed && activeStore ? `Shopping at ${activeStore.name}. Change store` : 'Choose a store'}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-left hover:bg-slate-200 transition-colors"
            >
              <Store size={15} className="flex-shrink-0 text-orange-500" />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  {storeConfirmed && activeStore ? 'Shopping at' : 'No store chosen'}
                </span>
                <span className="block truncate text-sm font-semibold text-slate-700">
                  {storeConfirmed && activeStore ? activeStore.name : 'Choose a store'}
                </span>
              </span>
              <ChevronDown size={15} className="flex-shrink-0 text-slate-400" />
            </button>

            <div className="flex flex-shrink-0 gap-0.5 rounded-full bg-slate-100 p-0.5" role="tablist" aria-label="Shop mode">
              <button
                type="button"
                role="tab"
                aria-selected={shopMode === 'browse'}
                aria-label="Browse store"
                onClick={() => setShopMode('browse')}
                className={`grid h-8 w-9 place-items-center rounded-full transition-colors ${shopMode === 'browse' ? 'bg-white text-orange-600 shadow' : 'text-slate-500'}`}
              >
                <Store size={15} />
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={shopMode === 'scan'}
                aria-label="Scan barcode"
                onClick={() => setShopMode('scan')}
                className={`grid h-8 w-9 place-items-center rounded-full transition-colors ${shopMode === 'scan' ? 'bg-white text-orange-600 shadow' : 'text-slate-500'}`}
              >
                <ScanLine size={15} />
              </button>
            </div>

            {icanBalance && (
              <span className="hidden flex-shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-700 sm:flex" title={formatUGX(icanBalance.ugx)}>
                <Coins size={13} /> ₡ {formatICAN(icanBalance.ican)}
              </span>
            )}

            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => setState('cart')}
                aria-label={`Open cart, ${cart.length} items`}
                className="relative grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-orange-500 text-white"
              >
                <ShoppingCart size={16} />
                <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-slate-900 px-1 text-[10px] font-bold">{cart.length}</span>
              </button>
            )}
          </div>

          {/* Always ask which store the customer is in before showing any products or
              taking a scan. A cart holds one store's products only. */}
          {!storeConfirmed && state === 'idle' && (
            <ShopStoreChooser
              stores={supermarkets}
              loading={!storesLoaded}
              currentStoreId={lockedStore?.id || selectedSupermarketId}
              notice={lockedStore
                ? `Your cart has ${cart.length} item${cart.length === 1 ? '' : 's'} from ${lockedStore.name}. You can only buy from one store at a time, so choosing another store clears your cart.`
                : undefined}
              onChoose={chooseStore}
            />
          )}

          {/* Browse — the chosen store's products. Stays mounted (just hidden) while the
              question is asked again, so the basket survives if the customer keeps the store. */}
          {shopMode === 'browse' && selectedSupermarketId && (
            <div hidden={!storeConfirmed}>
              <ProductPicker
                supermarketId={selectedSupermarketId}
                currency={pickerCurrency}
                syncQty={pickerSync}
                onCartChange={handleBrowseCartChange}
                onOpenCart={() => setState('cart')}
                onBookService={onBookService}
                fullPage
              />
            </div>
          )}

          {/* Camera scanning panel — scans are looked up in the chosen store only */}
          {shopMode === 'scan' && storeConfirmed && (
            <div>
              {/* Camera button */}
              <button
                onClick={startCamera}
                disabled={looking || !selectedSupermarketId}
                className="w-full flex items-center justify-center gap-3 py-4 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all mb-3 disabled:opacity-50"
              >
                <Camera size={22} />
                {detectorSupported ? 'Scan Barcode with Camera' : 'Open Camera (manual entry)'}
              </button>

              {/* Manual barcode entry */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Type or paste barcode / SKU"
                  value={manualBarcode}
                  onChange={e => setManualBarcode(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && selectedSupermarketId && lookupProduct(manualBarcode)}
                  disabled={!selectedSupermarketId}
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:bg-slate-50 disabled:text-slate-400"
                />
                <button
                  onClick={() => lookupProduct(manualBarcode)}
                  disabled={!manualBarcode.trim() || looking || !selectedSupermarketId}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-40"
                >
                  {looking ? <Loader size={16} className="animate-spin" /> : <QrCode size={16} />}
                </button>
              </div>

              {scanError && (
                <div className="flex items-center gap-2 mt-3 text-red-600 bg-red-50 rounded-lg px-3 py-2 text-sm">
                  <AlertCircle size={15} />
                  {scanError}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Camera live view ────────────────────────────────────────────── */}
      {state === 'scanning' && (
        <div className="bg-black rounded-2xl overflow-hidden">
          <div className="relative overflow-hidden">
          <video
            ref={videoRef}
            className="w-full object-cover"
            style={{ maxHeight: '60vh' }}
            playsInline
            muted
          />
          <ScanFrameOverlay
            hint={detectorSupported ? 'Point camera at product barcode' : 'Camera open — type barcode below'}
            frameClassName="inset-x-[12%] top-[14%] bottom-[24%]"
          />
          </div>
          <div className="bg-gray-900 p-4">
            {/* Manual entry while camera is open */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Type barcode / SKU"
                value={manualBarcode}
                onChange={e => setManualBarcode(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    stopCamera();
                    setState('idle');
                    lookupProduct(manualBarcode);
                  }
                }}
                className="flex-1 bg-white/20 text-white placeholder-white/60 border border-white/30 rounded-lg px-3 py-2 text-sm focus:outline-none focus:bg-white/30"
              />
              <button
                onClick={() => {
                  stopCamera();
                  setState('idle');
                  lookupProduct(manualBarcode);
                }}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-semibold"
              >
                Go
              </button>
            </div>
            <button
              onClick={() => { stopCamera(); setState('idle'); }}
              className="mt-3 w-full flex items-center justify-center gap-2 text-white/80 hover:text-white text-sm"
            >
              <CameraOff size={16} /> Cancel Scan
            </button>
          </div>
        </div>
      )}

      {/* ── Product found card ──────────────────────────────────────────── */}
      {state === 'product_found' && foundProduct && (
        <div className="bg-white border-y border-slate-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800">Product Found</h3>
            <button
              onClick={() => { setFoundProduct(null); setState('idle'); }}
              className="text-slate-400 hover:text-slate-600"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex gap-4 mb-5">
            {foundProduct.images?.[0]?.url ? (
              <img
                src={foundProduct.images[0].url}
                alt={foundProduct.name}
                className="w-20 h-20 object-cover rounded-xl border border-slate-100"
              />
            ) : (
              <div className="w-20 h-20 bg-orange-50 rounded-xl flex items-center justify-center border border-orange-100">
                <ShoppingCart className="text-orange-300" size={32} />
              </div>
            )}
            <div className="flex-1">
              <p className="font-bold text-slate-800 text-lg leading-tight">{foundProduct.name}</p>
              {foundProduct.brand && (
                <p className="text-slate-500 text-sm">{foundProduct.brand}</p>
              )}
              <p className="text-xs text-slate-400 mt-1">{foundProduct.category_name} · SKU: {foundProduct.sku}</p>
              <p className="text-orange-600 font-bold text-xl mt-2">
                {fmt(foundProduct.selling_price)}
              </p>
              <p className="text-xs text-slate-400">
                {foundProduct.available_stock} in stock · {foundProduct.tax_rate}% tax included
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => addToCart(foundProduct)}
              className="flex-1 py-3 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all"
            >
              Add to Cart
            </button>
            <button
              onClick={() => { setFoundProduct(null); setState('idle'); startCamera(); }}
              className="px-4 py-3 bg-slate-100 text-slate-600 font-semibold rounded-xl hover:bg-slate-200 transition-all"
            >
              <ScanLine size={18} />
            </button>
          </div>
        </div>
      )}

      {/* ── Cart ───────────────────────────────────────────────────────── */}
      {showCartPage && (
        <div className="bg-white border-y border-slate-200 overflow-hidden">
          {/* Cart header */}
          <div className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white px-3 py-3 flex items-center gap-2">
            <button
              type="button"
              onClick={leaveCartPage}
              aria-label="Back to shopping"
              className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
            <ShoppingCart size={18} className="flex-shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Your Cart ({cart.length} items)</span>
              {lockedStore && <span className="block truncate text-xs text-white/80">from {lockedStore.name}</span>}
            </span>
          </div>

          {/* Cart items */}
          <div className="divide-y divide-slate-100">
            {cart.map(item => (
              <div key={item.product.product_id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm truncate">{item.product.name}</p>
                  <p className="text-xs text-slate-400">{fmt(item.product.selling_price)} each</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateQty(item.product.product_id, -1)}
                    className="w-7 h-7 bg-slate-100 rounded-full flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-colors"
                  >
                    {item.quantity === 1 ? <Trash2 size={12} /> : <Minus size={12} />}
                  </button>
                  <span className="w-6 text-center font-bold text-slate-700 text-sm">{item.quantity}</span>
                  <button
                    onClick={() => updateQty(item.product.product_id, 1)}
                    className="w-7 h-7 bg-slate-100 rounded-full flex items-center justify-center hover:bg-green-100 hover:text-green-600 transition-colors"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <span className="w-24 text-right font-bold text-slate-800 text-sm">
                  {fmt(item.line_total)}
                </span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="border-t border-slate-100 px-5 py-4 bg-slate-50 space-y-1">
            <div className="flex justify-between text-sm text-slate-500">
              <span>Subtotal</span><span>{fmt(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-500">
              <span>Tax included</span><span>{fmt(totals.tax)}</span>
            </div>
            <div className="flex justify-between font-bold text-slate-800 text-base border-t border-slate-200 pt-2">
              <span>Total</span>
              <span className="text-orange-600">{fmt(totals.total)}</span>
            </div>
          </div>

          {/* Add more items — scan or keep browsing, depending on mode */}
          <div className="px-5 py-3 border-t border-slate-100">
            <button
              onClick={() => { setStoreConfirmed(true); leaveCartPage(); if (shopMode === 'scan') startCamera(); }}
              className="w-full py-2.5 border-2 border-dashed border-orange-300 text-orange-600 font-semibold rounded-xl hover:bg-orange-50 transition-colors text-sm flex items-center justify-center gap-2"
            >
              {shopMode === 'browse' ? <><Store size={16} /> Add More Items</> : <><ScanLine size={16} /> Scan More Items</>}
            </button>
          </div>

          {/* Payment method */}
          <div className="px-5 pb-3">
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Pay with</p>
            <div className="grid grid-cols-2 gap-2">
              {(['cash', 'card', 'mobile_money'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setPayment(m)}
                  className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    payment === m
                      ? 'bg-orange-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {m === 'mobile_money' ? 'Mobile Money' : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
              <button
                onClick={() => canPayICAN && setPayment('ican')}
                disabled={!canPayICAN}
                className={`py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  payment === 'ican'
                    ? 'bg-orange-500 text-white'
                    : canPayICAN
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                }`}
              >
                <Coins size={14} />
                icaneracoins
                {!canPayICAN && (
                  <span className="text-xs opacity-70 block">
                    (need ₡{formatICAN(icanNeeded)})
                  </span>
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={openInstalmentsOnWebsite}
              className="mt-2 w-full py-2.5 rounded-lg text-sm font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-all flex items-center justify-center gap-1.5"
            >
              <CalendarClock size={14} />
              Pay in installments
              <ExternalLink size={12} className="opacity-60" />
            </button>
            <p className="text-[11px] text-slate-400 mt-1 text-center">Opens {activeStore?.name || 'the store'}'s website to set up and follow your plan</p>

            {payment === 'ican' ? (
              <p className="text-xs text-slate-500 mt-2 text-center">Your transaction PIN is needed to pay from your IcanEra wallet</p>
            ) : (
              <p className="text-xs text-slate-500 mt-2 text-center">
                You'll pay on {activeStore?.name || 'the store'}'s website, using its Pay page
              </p>
            )}
          </div>

          {/* Checkout button */}
          <div className="px-5 pb-5">
            <button
              onClick={handlePay}
              disabled={submitting || pinBusy}
              className="w-full py-4 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-bold rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 text-base"
            >
              {submitting ? (
                <><Loader size={20} className="animate-spin" /> Processing...</>
              ) : (
                payment === 'ican'
                  ? <><ReceiptText size={20} /> Pay {fmt(totals.total)} with PIN</>
                  : <><ExternalLink size={20} /> Pay {fmt(totals.total)} on website</>
              )}
            </button>
          </div>
        </div>
      )}

      {pendingStore && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="switch-store-title">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="text-center mb-5">
              <div className="text-4xl mb-2">🛒</div>
              <h2 id="switch-store-title" className="font-bold text-lg text-slate-800">Switch to {pendingStore.name}?</h2>
              <p className="text-slate-500 text-sm mt-2">
                You can only buy from one store at a time. Your {cart.length} item{cart.length === 1 ? '' : 's'} from {lockedStore?.name || 'your current store'} will be removed from the cart.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={keepCurrentStore}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium text-sm"
              >
                Keep my cart
              </button>
              <button
                type="button"
                onClick={confirmStoreSwitch}
                className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm"
              >
                Switch store
              </button>
            </div>
          </div>
        </div>
      )}

      {needsPin && user?.id && (
        <SetPinPrompt
          userId={user.id}
          onDone={async () => {
            setNeedsPin(false);
            try { if (await hasPinSet(user.id)) { setPin(''); setPinOpen(true); } } catch { /* they can tap Pay again */ }
          }}
        />
      )}

      {pinOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => { e.preventDefault(); confirmPinAndPay(); }}
            className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl"
          >
            <div className="text-center mb-5">
              <div className="text-4xl mb-2">🔐</div>
              <h2 className="font-bold text-lg text-slate-800">Enter your PIN</h2>
              <p className="text-slate-500 text-xs mt-1">
                Confirm {fmt(totals.total)} from your IcanEra Wallet
              </p>
            </div>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="4-6 digit PIN"
              disabled={pinBusy}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-center tracking-widest text-lg focus:outline-none focus:border-orange-400"
            />
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => { setPinOpen(false); setPin(''); }}
                disabled={pinBusy}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pinBusy || !validatePIN(pin)}
                className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-60"
              >
                {pinBusy ? 'Verifying…' : 'Confirm & Pay'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Empty state — scan mode only; browse mode shows the products ── */}
      {state === 'idle' && shopMode === 'scan' && storeConfirmed && cart.length === 0 && !foundProduct && !looking && (
        <p className="text-center text-sm text-slate-400 py-6">Your cart is empty — scan a barcode to add items.</p>
      )}
    </div>
  );
}
