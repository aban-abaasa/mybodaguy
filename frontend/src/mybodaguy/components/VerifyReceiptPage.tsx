import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, PackageCheck, Clock, ShieldCheck, ReceiptText } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

interface GoodsSnapshotLine {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

interface VerifyResult {
  is_valid: boolean;
  status?: 'paid' | 'picked_up' | 'delivered' | 'cancelled';
  store_name?: string;
  item_summary?: string | null;
  goods_snapshot?: GoodsSnapshotLine[] | null;
  created_at?: string;
  picked_up_at?: string | null;
  picked_up_by_email?: string | null;
  delivered_at?: string | null;
}

function formatUGX(n: number) {
  return `UGX ${n.toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;
}

const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid — awaiting pickup from store',
  picked_up: 'Picked up — payment to store complete',
  delivered: 'Delivered to customer',
  cancelled: 'Cancelled',
};

// sessionStorage key used to find our way back to this exact /verify/<code>
// page after bouncing out to Google for sign-in and back — see main.tsx's
// matching fallback (Supabase's OAuth redirectTo only reliably returns to
// whatever the Supabase project's redirect allow-list actually covers).
const RETURN_CODE_KEY = 'icanera_verify_return_code';

// Public, unauthenticated page for https://bodagoera.icanera.space/verify/<code>
// — what a QR scan on a DeliveryReceiptCard opens. Proves a receipt is real
// (icanera_verify_delivery_receipt, GRANT'd to anon) for anyone, and lets
// whoever is physically there with the code — store staff or the rider —
// sign in with Google in one tap and Approve it, which is what actually
// completes the payment to the store (see
// ICAN/backend/ADD_DELIVERY_RECEIPT_APPROVAL_TRACKING.sql). A code can only
// ever be approved once: re-scanning an already-approved code shows exactly
// who approved it and when, instead of letting anyone else claim it.
export default function VerifyReceiptPage({ code }: { code: string }) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'proof'>('summary');

  const refresh = async () => {
    const { data } = await supabase.rpc('icanera_verify_delivery_receipt', { p_code: code });
    setResult(data ?? { is_valid: false });
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();

    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setSignedIn(!!data.user);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user);
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [code]);

  const signInToApprove = async () => {
    setSigningIn(true);
    try {
      sessionStorage.setItem(RETURN_CODE_KEY, code);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href },
      });
      if (error) throw error;
    } catch (e: any) {
      setConfirmError(e.message || 'Could not start Google sign-in');
      setSigningIn(false);
    }
  };

  const approvePickup = async () => {
    setConfirming(true);
    setConfirmError(null);
    try {
      const { data, error } = await supabase.rpc('icanera_confirm_pickup', { p_verification_code: code });
      if (error) throw error;
      if (!data?.success) {
        // Someone else may have just approved it — refresh so the page
        // shows exactly who, rather than a bare error.
        if (data?.status) {
          setResult((prev) => (prev ? { ...prev, status: data.status, picked_up_by_email: data.picked_up_by_email, picked_up_at: data.picked_up_at } : prev));
        }
        throw new Error(data?.error || 'Could not approve pickup');
      }
      setResult((prev) => (prev ? { ...prev, status: 'picked_up', picked_up_by_email: data.picked_up_by_email, picked_up_at: new Date().toISOString() } : prev));
    } catch (e: any) {
      setConfirmError(e.message || 'Could not approve pickup');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 text-center max-w-sm w-full">
        {loading ? (
          <p className="text-slate-500 py-10">Checking receipt…</p>
        ) : !result?.is_valid ? (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle className="text-red-500" size={32} />
            </div>
            <h1 className="text-xl font-bold text-slate-800 mb-1">Not a valid receipt</h1>
            <p className="text-slate-500 text-sm">This code doesn't match any ICANera delivery receipt.</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              {result.status === 'paid' ? (
                <Clock className="text-amber-500" size={32} />
              ) : (
                <CheckCircle className="text-green-500" size={32} />
              )}
            </div>
            <h1 className="text-xl font-bold text-slate-800 mb-1">Receipt Verified</h1>
            <p className="text-slate-500 text-sm mb-4">{result.store_name}</p>

            {!!result.goods_snapshot?.length && (
              <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-3">
                <button
                  onClick={() => setActiveTab('summary')}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                    activeTab === 'summary' ? 'bg-white shadow text-slate-800' : 'text-slate-500'
                  }`}
                >
                  Summary
                </button>
                <button
                  onClick={() => setActiveTab('proof')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                    activeTab === 'proof' ? 'bg-white shadow text-slate-800' : 'text-slate-500'
                  }`}
                >
                  <ReceiptText size={14} /> Proof
                </button>
              </div>
            )}

            {activeTab === 'proof' && !!result.goods_snapshot?.length ? (
              <div className="bg-slate-50 rounded-xl p-4 text-left mb-4">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Items purchased</p>
                <div className="divide-y divide-slate-200">
                  {result.goods_snapshot.map((line, i) => (
                    <div key={`${line.product_id}-${i}`} className="py-2 flex justify-between gap-3 text-sm">
                      <span className="text-slate-800">
                        {line.product_name} × {line.quantity}
                        <span className="block text-xs text-slate-400">{formatUGX(line.unit_price)} each</span>
                      </span>
                      <span className="font-semibold text-slate-900 whitespace-nowrap">{formatUGX(line.line_total)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between font-bold text-sm border-t border-slate-200 pt-2 mt-2">
                  <span>Total</span>
                  <span className="text-orange-600">
                    {formatUGX(result.goods_snapshot.reduce((s, l) => s + l.line_total, 0))}
                  </span>
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 rounded-xl p-4 text-left space-y-2 mb-4">
                {result.item_summary && (
                  <div className="flex justify-between text-sm gap-3">
                    <span className="text-slate-500">Order</span>
                    <span className="font-semibold text-slate-900 text-right">{result.item_summary}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Status</span>
                  <span className="font-semibold text-slate-900">{STATUS_LABEL[result.status || ''] || result.status}</span>
                </div>
                {result.created_at && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Ordered</span>
                    <span className="text-slate-900">{new Date(result.created_at).toLocaleString()}</span>
                  </div>
                )}
                {result.picked_up_at && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Picked up</span>
                    <span className="text-slate-900">{new Date(result.picked_up_at).toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}

            {(result.status === 'picked_up' || result.status === 'delivered') && result.picked_up_by_email && (
              <div className="flex items-center gap-2 justify-center bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 mb-4">
                <ShieldCheck className="text-emerald-600 flex-shrink-0" size={16} />
                <span className="text-xs font-medium text-emerald-700">
                  Approved by {result.picked_up_by_email} — this code can't be approved again
                </span>
              </div>
            )}

            {result.status === 'paid' && !signedIn && (
              <button
                onClick={signInToApprove}
                disabled={signingIn}
                className="w-full py-3 bg-white border-2 border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {signingIn ? 'Redirecting to Google…' : 'Sign in with Google to Approve'}
              </button>
            )}

            {result.status === 'paid' && signedIn && (
              <>
                <p className="text-xs text-slate-400 mb-3">
                  Approving confirms the product left the store and completes payment to the store.
                </p>
                <button
                  onClick={approvePickup}
                  disabled={confirming}
                  className="w-full py-3 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <PackageCheck size={18} />
                  {confirming ? 'Approving…' : 'Approve Pickup'}
                </button>
              </>
            )}
            {confirmError && <p className="text-red-500 text-xs mt-2">{confirmError}</p>}
          </>
        )}
      </div>
    </div>
  );
}
