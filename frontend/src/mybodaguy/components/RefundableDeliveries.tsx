import { useEffect, useState } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';

interface RefundableDelivery {
  verification_code: string;
  store_name: string;
  item_summary: string | null;
  amount_ican: number;
  picked_up_at: string;
  delivery_due_at: string;
  overdue_warned_at: string;
  refund_available_at: string;
}

// Customer-facing side of ADD_DELIVERY_ESCROW_DEADLINE_AND_RIDER_LIABILITY.sql
// — icanera_my_refundable_deliveries()/icanera_request_delivery_refund() were
// built there but never surfaced anywhere; a customer whose store order blew
// through its chosen delivery window had no way to see that or claim the
// refund. Polls every 30s (own window, no push infra) rather than once, since
// "available in N minutes" needs to flip to "claimable now" without a reload.
export default function RefundableDeliveries({ customerId }: { customerId: string }) {
  const [rows, setRows] = useState<RefundableDelivery[]>([]);
  const [now, setNow] = useState(Date.now());
  const [claimingCode, setClaimingCode] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase.rpc('icanera_my_refundable_deliveries');
      if (!cancelled && !error) setRows((data || []) as RefundableDelivery[]);
    };
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [customerId]);

  // Local ticking clock just to re-render the "available in Xm" countdown —
  // no extra fetch, the row data itself only needs refreshing every 30s above.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(tick);
  }, []);

  const claimRefund = async (code: string) => {
    setClaimingCode(code);
    try {
      const { data, error } = await supabase.rpc('icanera_request_delivery_refund', { p_verification_code: code });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not process refund yet');
      toast.success(`✅ Refunded ${Number(data.refunded_ican || 0).toFixed(2)} ₡ back to your wallet`);
      setRows(prev => prev.filter(r => r.verification_code !== code));
    } catch (e: any) {
      toast.error(e.message || 'Failed to claim refund');
    } finally {
      setClaimingCode(null);
    }
  };

  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      {rows.map(r => {
        const availableAt = new Date(r.refund_available_at).getTime();
        const claimable = now >= availableAt;
        const minutesLeft = Math.max(0, Math.ceil((availableAt - now) / 60000));
        return (
          <div key={r.verification_code} className="border-2 border-red-300 bg-red-50 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-bold text-red-800 text-sm">Delivery overdue — {r.store_name}</p>
                <p className="text-xs text-red-700 mt-0.5">
                  {r.item_summary || 'Your order'} missed its delivery window
                  {' '}(due {new Date(r.delivery_due_at).toLocaleString()}).
                </p>
                <p className="text-xs text-red-600 mt-1">
                  We already tried to reach your rider — if it still hasn't arrived, you can pull your
                  {' '}<strong>{Number(r.amount_ican).toFixed(2)} ₡</strong> back from their account.
                </p>
              </div>
            </div>
            <button
              onClick={() => claimRefund(r.verification_code)}
              disabled={!claimable || claimingCode === r.verification_code}
              className="mt-3 w-full py-2.5 bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {claimingCode === r.verification_code
                ? 'Processing…'
                : claimable
                  ? 'Claim Refund'
                  : <><Clock size={14} /> Available in {minutesLeft}m</>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
