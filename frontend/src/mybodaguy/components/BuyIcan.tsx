/**
 * 💳 Buy ICAN Component - My Boda Guy
 * Simplified version for buying ICAN coins
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { buyICAN, ICAN_TO_UGX, formatICAN } from '../services/icanWalletService';

interface BuyIcanProps {
  userId: string;
  onSuccess?: () => void;
}

export default function BuyIcan({ userId, onSuccess }: BuyIcanProps) {
  const [ugxAmount, setUgxAmount] = useState('');
  const [processing, setProcessing] = useState(false);

  const icanAmount = ugxAmount ? parseFloat(ugxAmount) / ICAN_TO_UGX : 0;

  const handleBuy = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!ugxAmount || parseFloat(ugxAmount) < ICAN_TO_UGX) {
      toast.error(`Minimum purchase: UGX ${ICAN_TO_UGX.toLocaleString()}`);
      return;
    }

    setProcessing(true);
    try {
      await buyICAN({
        userId,
        icanAmount,
        paymentRef: `MBG-BUY-${Date.now()}`,
      });
      
      toast.success(`Successfully bought ${formatICAN(icanAmount)} ICAN!`);
      setUgxAmount('');
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
          disabled={!ugxAmount || parseFloat(ugxAmount) < ICAN_TO_UGX || processing}
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
      </form>
    </div>
  );
}
