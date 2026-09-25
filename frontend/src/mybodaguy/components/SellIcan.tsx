/**
 * 💰 Sell ICAN Component - My Boda Guy
 * Simplified version for selling ICAN coins
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { sellICAN, formatICAN, getBalance, getLiveUgxPrice, SELL_FEE_RATE } from '../services/icanWalletService';
import { useEffect } from 'react';

interface SellIcanProps {
  userId: string;
  onSuccess?: () => void;
}

export default function SellIcan({ userId, onSuccess }: SellIcanProps) {
  const [icanAmount, setIcanAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [balance, setBalance] = useState(0);
  // Sales pay at icaneracoin's live value, so nothing is quoted until it is known.
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [priceFailed, setPriceFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => getLiveUgxPrice().then((p) => {
      if (cancelled) return;
      setLivePrice(p);
      setPriceFailed(p === null);
    });
    load();
    // The price moves slowly, but a sale should never be quoted from a stale figure.
    const timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

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

  // What lands in the wallet: the coins at the live value, less the platform's cut — the one final number.
  const ugxAmount = icanAmount && livePrice ? Math.round(parseFloat(icanAmount) * livePrice * (1 - SELL_FEE_RATE) * 100) / 100 : 0;

  const handleSell = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!icanAmount || parseFloat(icanAmount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (parseFloat(icanAmount) > balance) {
      toast.error('Insufficient IcanEra balance');
      return;
    }
    if (!livePrice) {
      toast.error("The live IcanEra price isn't available right now — please try again in a moment");
      return;
    }

    setProcessing(true);
    try {
      const result = await sellICAN({
        userId,
        icanAmount: parseFloat(icanAmount),
        reference: `MBG-SELL-${Date.now()}`,
      });

      toast.success(`Successfully sold ${formatICAN(parseFloat(icanAmount))} IcanEra for UGX ${result.ugx_payout.toLocaleString()} (after fees) — added to your IcanEra Wallet balance!`);
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
            {formatICAN(balance)} IcanEra
          </div>
          <div className="text-gray-500 text-xs mt-1">
            {livePrice ? `≈ UGX ${Math.round(balance * livePrice).toLocaleString()}` : '…'}
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Amount to Sell (IcanEra)
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
            {livePrice
              ? `1 IcanEra = UGX ${livePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} (live value)`
              : priceFailed ? "Couldn't load the live price — retrying…" : 'Loading the live price…'}
          </p>
        </div>

        {/* Conversion Display */}
        {ugxAmount > 0 && (
          <div className="bg-gray-800 rounded-lg p-4 flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">You Sell</div>
              <div className="text-white font-semibold">
                {formatICAN(parseFloat(icanAmount))} IcanEra
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
            <li>✓ Credited instantly to your IcanEra Wallet balance</li>
            <li>✓ To cash out to mobile money/bank, use "Send Out" instead</li>
            <li>✓ Paid at the live value of IcanEra — never below UGX 5,000</li>
          </ul>
        </div>

        {/* Sell Button */}
        <button
          type="submit"
          disabled={!icanAmount || parseFloat(icanAmount) <= 0 || parseFloat(icanAmount) > balance || processing || !livePrice}
          className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Processing...
            </span>
          ) : (
            '💰 Sell IcanEra'
          )}
        </button>
      </form>
    </div>
  );
}
