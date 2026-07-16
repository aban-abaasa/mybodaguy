/**
 * 💳 Buy ICAN Component - My Boda Guy
 * Simplified version for buying ICAN coins
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { ICAN_TO_UGX, SOURCE_APP, formatICAN } from '../services/icanWalletService';
import { supabase } from '../services/supabaseClient';
import { payWithFlutterwave, generateTxRef } from '../services/flutterwaveClient';

interface BuyIcanProps {
  userId: string;
  onSuccess?: () => void;
}

const PAYMENT_METHODS = [
  { key: 'mtn', label: '📱 MTN', paymentOptions: 'mobilemoneyuganda' },
  { key: 'airtel', label: '📱 Airtel', paymentOptions: 'mobilemoneyuganda' },
  { key: 'card', label: '💳 Card', paymentOptions: 'card' },
  { key: 'bank', label: '🏦 Bank Account', paymentOptions: 'account' },
] as const;

export default function BuyIcan({ userId, onSuccess }: BuyIcanProps) {
  const [ugxAmount, setUgxAmount] = useState('');
  const [method, setMethod] = useState<'mtn' | 'airtel' | 'card' | 'bank'>('mtn');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [processing, setProcessing] = useState(false);

  const icanAmount = ugxAmount ? parseFloat(ugxAmount) / ICAN_TO_UGX : 0;
  const isMobileMoney = method === 'mtn' || method === 'airtel';
  const canBuy = !!ugxAmount && parseFloat(ugxAmount) >= ICAN_TO_UGX && (!isMobileMoney || !!phoneNumber);

  const handleBuy = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!ugxAmount || parseFloat(ugxAmount) < ICAN_TO_UGX) {
      toast.error(`Minimum purchase: UGX ${ICAN_TO_UGX.toLocaleString()}`);
      return;
    }
    if (isMobileMoney && !phoneNumber) {
      toast.error('Enter your mobile money number');
      return;
    }

    setProcessing(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const txRef = generateTxRef('MBG-BUY');
      const selectedMethod = PAYMENT_METHODS.find((m) => m.key === method)!;

      const payment = await payWithFlutterwave({
        amount: parseFloat(ugxAmount),
        currency: 'UGX',
        customerEmail: userData?.user?.email,
        customerName: userData?.user?.user_metadata?.full_name,
        customerPhone: isMobileMoney ? phoneNumber : undefined,
        paymentOptions: selectedMethod.paymentOptions,
        title: 'BodaGo — IcanEra Wallet',
        description: `Buy ${formatICAN(icanAmount)} ICAN`,
        txRef,
      });

      if (payment.status === 'cancelled') {
        toast.info('Payment cancelled');
        return;
      }
      if (payment.status !== 'successful' || !payment.transaction_id) {
        toast.error('Payment was not successful');
        return;
      }

      const { data, error } = await supabase.functions.invoke('verify-flutterwave-payment', {
        body: {
          transaction_id: payment.transaction_id,
          tx_ref: txRef,
          ican_amount: icanAmount,
          source_app: SOURCE_APP,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Payment verification failed');

      toast.success(`Successfully bought ${formatICAN(icanAmount)} ICAN!`);
      setUgxAmount('');
      setPhoneNumber('');
      if (onSuccess) onSuccess();
    } catch (error: any) {
      toast.error(error.message || 'Purchase failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="p-4">
      <form onSubmit={handleBuy} className="space-y-4">
        {/* Payment Method */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Payment Method</label>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMethod(m.key)}
                disabled={processing}
                className={`py-2 rounded-lg text-sm font-medium border ${
                  method === m.key ? 'bg-orange-500 border-orange-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {isMobileMoney && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Mobile Money Number</label>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="e.g. 0770123456"
              disabled={processing}
              className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:outline-none focus:border-orange-500"
            />
          </div>
        )}

        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Amount in UGX
          </label>
          <div className="relative">
            <span className="absolute left-3 top-3 text-gray-400">UGX</span>
            <input
              type="number"
              min={ICAN_TO_UGX}
              step={ICAN_TO_UGX}
              value={ugxAmount}
              onChange={(e) => setUgxAmount(e.target.value)}
              placeholder={`Min: ${ICAN_TO_UGX.toLocaleString()}`}
              disabled={processing}
              className="w-full pl-16 pr-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:outline-none focus:border-orange-500"
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            1 ICAN = UGX {ICAN_TO_UGX.toLocaleString()} (floor price)
          </p>
        </div>

        {/* Conversion Display */}
        {icanAmount > 0 && (
          <div className="bg-gray-800 rounded-lg p-4 flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">You Pay</div>
              <div className="text-white font-semibold">
                UGX {parseFloat(ugxAmount).toLocaleString()}
              </div>
            </div>
            <div className="text-orange-400 mx-4">→</div>
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">You Get</div>
              <div className="text-orange-400 font-bold text-lg">
                {formatICAN(icanAmount)} ICAN
              </div>
            </div>
          </div>
        )}

        {/* Info */}
        <div className="bg-orange-900/20 border border-orange-700/30 rounded-lg p-3">
          <p className="text-xs text-orange-200 font-semibold mb-2">ℹ️ How it works</p>
          <ul className="text-xs text-orange-200/80 space-y-1">
            <li>✓ ICAN arrives in your wallet instantly</li>
            <li>✓ Floor price: 1 ICAN = UGX 5,000</li>
            <li>✓ Use ICAN to pay for rides or send to others</li>
          </ul>
        </div>

        {/* Buy Button */}
        <button
          type="submit"
          disabled={!canBuy || processing}
          className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Processing...
            </span>
          ) : (
            '💳 Buy ICAN Now'
          )}
        </button>

        <button
          type="button"
          onClick={() => window.open('https://icanera.space/', '_blank', 'noopener,noreferrer')}
          className="w-full text-center text-xs text-gray-500 hover:text-gray-300 underline"
        >
          Prefer the web? Buy for free at icanera.space ↗
        </button>
      </form>
    </div>
  );
}
