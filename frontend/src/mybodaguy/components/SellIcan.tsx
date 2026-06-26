/**
 * 💰 Sell ICAN Component - My Boda Guy
 * Simplified version for selling ICAN coins
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { sellICAN, ICAN_TO_UGX, formatICAN, getBalance } from '../services/icanWalletService';
import { useEffect } from 'react';

interface SellIcanProps {
  userId: string;
  onSuccess?: () => void;
}

export default function SellIcan({ userId, onSuccess }: SellIcanProps) {
  const [icanAmount, setIcanAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    const loadBalance = async () => {
      try {
        const bal = await getBalance(userId);
        setBalance(bal.ican);
      } catch (error) {
        console.error('Failed to load balance:', error);
      }
    };
    loadBalance();
  }, [userId]);

  const ugxAmount = icanAmount ? parseFloat(icanAmount) * ICAN_TO_UGX : 0;

  const handleSell = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!icanAmount || parseFloat(icanAmount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (parseFloat(icanAmount) > balance) {
      toast.error('Insufficient ICAN balance');
      return;
    }

    setProcessing(true);
    try {
      await sellICAN({
        userId,
        icanAmount: parseFloat(icanAmount),
        reference: `MBG-SELL-${Date.now()}`,
      });
      
      toast.success(`Successfully sold ${formatICAN(parseFloat(icanAmount))} ICAN for UGX ${ugxAmount.toLocaleString()}!`);
      setIcanAmount('');
      if (onSuccess) onSuccess();
    } catch (error: any) {
      toast.error(error.message || 'Sale failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="p-4">
      <form onSubmit={handleSell} className="space-y-4">
        {/* Balance Display */}
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-400 mb-1">Available Balance</div>
          <div className="text-orange-400 text-xl font-bold">
            {formatICAN(balance)} ICAN
          </div>
          <div className="text-gray-500 text-xs mt-1">
            ≈ UGX {(balance * ICAN_TO_UGX).toLocaleString()}
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Amount to Sell (ICAN)
          </label>
          <div className="relative">
            <input
              type="number"
              min="0.0001"
              step="0.0001"
              max={balance}
              value={icanAmount}
              onChange={(e) => setIcanAmount(e.target.value)}
              placeholder="0.0000"
              disabled={processing}
              className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:outline-none focus:border-orange-500"
            />
            <button
              type="button"
              onClick={() => setIcanAmount(balance.toString())}
              className="absolute right-3 top-3 text-xs text-orange-400 hover:text-orange-300 font-semibold"
            >
              MAX
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            1 ICAN = UGX {ICAN_TO_UGX.toLocaleString()} (floor price)
          </p>
        </div>

        {/* Conversion Display */}
        {ugxAmount > 0 && (
          <div className="bg-gray-800 rounded-lg p-4 flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">You Sell</div>
              <div className="text-white font-semibold">
                {formatICAN(parseFloat(icanAmount))} ICAN
              </div>
            </div>
            <div className="text-orange-400 mx-4">→</div>
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">You Get</div>
              <div className="text-orange-400 font-bold text-lg">
                UGX {ugxAmount.toLocaleString()}
              </div>
            </div>
          </div>
        )}

        {/* Info */}
        <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3">
          <p className="text-xs text-amber-200 font-semibold mb-2">ℹ️ Payout Information</p>
          <ul className="text-xs text-amber-200/80 space-y-1">
            <li>✓ Cash payout handled by admin/cashier</li>
            <li>✓ Contact support to arrange pickup</li>
            <li>✓ Floor price: 1 ICAN = UGX 5,000</li>
          </ul>
        </div>

        {/* Sell Button */}
        <button
          type="submit"
          disabled={!icanAmount || parseFloat(icanAmount) <= 0 || parseFloat(icanAmount) > balance || processing}
          className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Processing...
            </span>
          ) : (
            '💰 Sell ICAN'
          )}
        </button>
      </form>
    </div>
  );
}
