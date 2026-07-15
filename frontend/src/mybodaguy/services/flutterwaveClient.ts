/**
 * Flutterwave inline checkout — public key only, safe for the browser.
 * Payment is verified server-side by the shared verify-flutterwave-payment
 * Supabase Edge Function before any wallet credit happens.
 */

declare global {
  interface Window {
    FlutterwaveCheckout?: (config: Record<string, unknown>) => void;
  }
}

const PUBLIC_KEY = import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY as string | undefined;

export function generateTxRef(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

export interface FlutterwavePayParams {
  amount: number;
  currency?: string;
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  title?: string;
  description?: string;
  txRef: string;
}

export interface FlutterwavePayResult {
  status: 'successful' | 'cancelled' | 'failed';
  transaction_id?: string;
  tx_ref: string;
}

export function payWithFlutterwave(params: FlutterwavePayParams): Promise<FlutterwavePayResult> {
  return new Promise((resolve, reject) => {
    if (!window.FlutterwaveCheckout) {
      reject(new Error('Flutterwave checkout is not available. Please refresh and try again.'));
      return;
    }
    if (!PUBLIC_KEY) {
      reject(new Error('Flutterwave is not configured for this app.'));
      return;
    }

    window.FlutterwaveCheckout({
      public_key: PUBLIC_KEY,
      tx_ref: params.txRef,
      amount: params.amount,
      currency: params.currency || 'UGX',
      // Uganda-supported channels only — 'card' covers Visa/Mastercard,
      // 'mobilemoneyuganda' covers both MTN and Airtel Uganda mobile money
      // (Flutterwave routes by the number's network automatically), 'account'
      // is bank-account/direct-debit. Tokens like 'bank_transfer'/'barter'
      // aren't valid Flutterwave option strings and were silently ignored.
      payment_options: 'card,mobilemoneyuganda,account',
      customer: {
        email: params.customerEmail || 'customer@bodago.app',
        phone_number: params.customerPhone || '',
        name: params.customerName || 'BodaGo Customer',
      },
      customizations: {
        title: params.title || 'ICAN Wallet',
        description: params.description || 'Buy ICAN Coins',
      },
      callback: (response: { status: string; transaction_id?: string }) => {
        resolve({
          status: response.status === 'successful' ? 'successful' : 'failed',
          transaction_id: response.transaction_id ? String(response.transaction_id) : undefined,
          tx_ref: params.txRef,
        });
      },
      onclose: () => {
        resolve({ status: 'cancelled', tx_ref: params.txRef });
      },
    });
  });
}
