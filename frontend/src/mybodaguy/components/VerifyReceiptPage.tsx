import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, PackageCheck, Clock } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

interface VerifyResult {
  is_valid: boolean;
  status?: 'paid' | 'picked_up' | 'delivered' | 'cancelled';
  store_name?: string;
  item_summary?: string | null;
  created_at?: string;
  picked_up_at?: string | null;
  delivered_at?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid — awaiting pickup from store',
  picked_up: 'Picked up from store',
  delivered: 'Delivered to customer',
  cancelled: 'Cancelled',
};

// Public, unauthenticated page for https://bodagoera.icanera.space/verify/<code>
// — what a QR scan on a DeliveryReceiptCard opens. Proves a receipt is real
// (icanera_verify_delivery_receipt, GRANT'd to anon) and, if the viewer is
// signed in as the store or the assigned rider, lets them confirm pickup
// (icanera_confirm_pickup checks that server-side — this page doesn't need
// to know who anyone is ahead of time). See
// ICAN/backend/ADD_DELIVERY_RECEIPT_VERIFICATION.sql.
export default function VerifyReceiptPage({ code }: { code: string }) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.rpc('icanera_verify_delivery_receipt', { p_code: code });
      if (!cancelled) {
        setResult(data ?? { is_valid: false });
        setLoading(false);
      }
    })();

    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setSignedIn(!!data.user);
    });

    return () => { cancelled = true; };
  }, [code]);

  const confirmPickup = async () => {
    setConfirming(true);
    setConfirmError(null);
    try {
      const { data, error } = await supabase.rpc('icanera_confirm_pickup', { p_verification_code: code });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not confirm pickup');
      setResult((prev) => (prev ? { ...prev, status: 'picked_up' } : prev));
    } catch (e: any) {
      setConfirmError(e.message || 'Could not confirm pickup');
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
            <p className="text-slate-500 text-sm mb-6">{result.store_name}</p>

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

            {signedIn && result.status === 'paid' && (
              <>
                <button
                  onClick={confirmPickup}
                  disabled={confirming}
                  className="w-full py-3 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <PackageCheck size={18} />
                  {confirming ? 'Confirming…' : 'Confirm Pickup'}
                </button>
                {confirmError && <p className="text-red-500 text-xs mt-2">{confirmError}</p>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
