import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Loader, ShieldCheck, Store, XCircle } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { formatMoney } from '../services/money';

interface ApprovalReceipt {
  store_name: string;
  store_location?: string | null;
  receipt_number: string;
  customer_name?: string | null;
  purchased_at: string;
  currency: string;
  items: Array<{ product_id?: string; product_name?: string; name?: string; quantity: number; line_total: number }>;
  total: number;
  approval_status: 'pending' | 'approved';
  approved_by_name?: string | null;
  approved_at?: string | null;
}

// sessionStorage key used to find our way back to this exact /receipt-approve/<token>
// page after bouncing out to Google (or an email link) for sign-in — see main.tsx's
// matching fallback, same reason as VerifyReceiptPage's RETURN_CODE_KEY.
export const RECEIPT_APPROVE_RETURN_KEY = 'icanera_receipt_approve_return_token';

// Staff receipt approval for https://bodagoera.icanera.space/receipt-approve/<token>
// — what scanning the QR code on a customer's shop receipt (CustomerSelfCheckout)
// opens. The staff member signs in, sees the store, the products and the total,
// and approves; their NAME is then saved on the receipt and shown on the customer's
// screen. Only staff of the store that sold the products can approve, and never the
// customer who bought them — both enforced server-side in approve_receipt() (see
// digital-city-era's ADD_RECEIPT_STORE_APPROVAL_ICAN_LINK.sql, which both apps share).
export default function ReceiptApprovePage({ token }: { token: string }) {
  const [userId, setUserId] = useState<string | null | undefined>(undefined); // undefined = still checking
  const [receipt, setReceipt] = useState<ApprovalReceipt | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [signInEmail, setSignInEmail] = useState('');
  const [signInNotice, setSignInNotice] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('get_receipt_for_approval', { p_token: token });
    if (rpcError || !data?.success) {
      setError(rpcError?.message || data?.error || 'Receipt not found');
      setReceipt(null);
    } else {
      setError(null);
      setReceipt(data.receipt);
      setCanApprove(!!data.can_approve);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (userId) void load();
    else if (userId === null) setLoading(false);
  }, [userId, load]);

  const signInWithGoogle = async () => {
    setSigningIn(true);
    setSignInError(null);
    try {
      sessionStorage.setItem(RECEIPT_APPROVE_RETURN_KEY, token);
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href, queryParams: { prompt: 'select_account' } },
      });
      if (authError) throw authError;
    } catch (e: any) {
      setSignInError(e.message || 'Could not start Google sign-in');
      setSigningIn(false);
    }
  };

  const sendEmailLink = async () => {
    const email = signInEmail.trim();
    if (!email) return;
    setSigningIn(true);
    setSignInError(null);
    setSignInNotice(null);
    try {
      sessionStorage.setItem(RECEIPT_APPROVE_RETURN_KEY, token);
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.href },
      });
      if (otpError) throw otpError;
      setSignInNotice(`Sign-in link sent to ${email}. Open it on this device.`);
    } catch (e: any) {
      setSignInError(e.message || 'Could not send the sign-in link');
    } finally {
      setSigningIn(false);
    }
  };

  const approve = async () => {
    setApproving(true);
    setApproveError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('approve_receipt', { p_token: token });
      if (rpcError || !data?.success) throw new Error(rpcError?.message || data?.error || 'Approval failed');
      await load();
    } catch (e: any) {
      setApproveError(e.message || 'Approval failed');
    } finally {
      setApproving(false);
    }
  };

  const approved = receipt?.approval_status === 'approved';

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
        <div className="text-center mb-5">
          <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <ShieldCheck className="text-orange-500" size={24} />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Approve receipt</h1>
          <p className="text-slate-500 text-sm">Confirm this purchase was made at your store.</p>
        </div>

        {userId === undefined || (userId && loading) ? (
          <p className="text-center text-slate-500 py-8">Checking receipt…</p>
        ) : userId === null ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">Sign in with your staff account to view and approve this receipt.</p>
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={signingIn}
              className="w-full py-3 bg-white border-2 border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-50"
            >
              {signingIn ? 'Redirecting…' : 'Continue with Google'}
            </button>
            <div className="flex gap-2">
              <input
                type="email"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                placeholder="Staff email"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
              <button
                type="button"
                onClick={sendEmailLink}
                disabled={signingIn || !signInEmail.trim()}
                className="rounded-lg border border-orange-300 px-3 py-2 text-sm font-semibold text-orange-600 disabled:opacity-50"
              >
                Email link
              </button>
            </div>
            {signInNotice && <p className="rounded-lg bg-green-50 p-3 text-center text-sm text-green-700">{signInNotice}</p>}
            {signInError && <p className="rounded-lg bg-red-50 p-3 text-center text-sm text-red-700">{signInError}</p>}
          </div>
        ) : error ? (
          <div className="text-center">
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <XCircle className="text-red-500" size={28} />
            </div>
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
          </div>
        ) : receipt ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 p-4 space-y-1.5">
              <div className="flex items-center gap-2 pb-1">
                <Store size={18} className="flex-shrink-0 text-orange-500" />
                <div className="min-w-0">
                  <p className="truncate text-base font-bold text-slate-900">{receipt.store_name}</p>
                  {receipt.store_location && <p className="truncate text-xs text-slate-500">{receipt.store_location}</p>}
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Receipt #</span>
                <span className="font-mono font-semibold text-slate-900">{receipt.receipt_number}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Customer</span>
                <span className="font-semibold text-slate-900">{receipt.customer_name || 'Customer'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Date</span>
                <span className="text-slate-900">{new Date(receipt.purchased_at).toLocaleString()}</span>
              </div>
              {(receipt.items || []).map((item, index) => (
                <div key={`${item.product_id ?? 'item'}-${index}`} className="flex justify-between gap-3 text-sm border-t border-slate-200 pt-2">
                  <span className="text-slate-900">{item.product_name || item.name || 'Product'} × {item.quantity}</span>
                  <span className="font-semibold text-slate-900 whitespace-nowrap">{formatMoney(Number(item.line_total) || 0, receipt.currency)}</span>
                </div>
              ))}
              <div className="flex justify-between font-bold text-base border-t pt-2">
                <span>Total paid</span>
                <span className="text-orange-600">{formatMoney(Number(receipt.total) || 0, receipt.currency)}</span>
              </div>
            </div>

            {approved ? (
              <div className="rounded-xl border border-green-300 bg-green-50 p-4 text-center">
                <CheckCircle className="mx-auto mb-1 text-green-600" size={26} />
                <p className="font-bold text-green-700">Approved</p>
                <p className="text-sm text-slate-700">by {receipt.approved_by_name || 'Store staff'}</p>
                {receipt.approved_at && <p className="text-xs text-slate-500">{new Date(receipt.approved_at).toLocaleString()}</p>}
              </div>
            ) : canApprove ? (
              <>
                <button
                  type="button"
                  onClick={approve}
                  disabled={approving}
                  className="w-full py-3.5 bg-gradient-to-r from-green-600 to-emerald-500 text-white font-semibold rounded-xl disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {approving ? <><Loader size={18} className="animate-spin" /> Approving…</> : 'Approve this receipt'}
                </button>
                {approveError && <p className="rounded-lg bg-red-50 p-3 text-center text-sm text-red-700">{approveError}</p>}
              </>
            ) : (
              <p className="rounded-lg bg-amber-50 p-3 text-center text-sm text-amber-800">
                Only staff of {receipt.store_name} can approve this receipt. Sign in with your staff account.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
