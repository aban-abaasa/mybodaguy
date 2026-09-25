/**
 * 💳 Buy ICAN Component - My Boda Guy
 * Buys icaneracoin with the money in the user's own IcanEra Wallet, at the coin's
 * LIVE value — an exchange between two balances they already hold, so there is no
 * payment window. (Flutterwave is for money entering or leaving the platform.)
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { buyICANFromWallet, formatICAN, getLiveUgxPrice, getWalletUgxBalance } from '../services/icanWalletService';

interface BuyIcanProps {
  userId: string;
  onSuccess?: () => void;
}

export default function BuyIcan({ userId, onSuccess }: BuyIcanProps) {
  const [ugxAmount, setUgxAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [walletUgx, setWalletUgx] = useState<number | null>(null);
  // Purchases are priced at icaneracoin's live value, so nothing is quoted until it is known.
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [priceFailed, setPriceFailed] = useState(false);

  const loadWallet = () => getWalletUgxBalance().then(setWalletUgx).catch(() => setWalletUgx(null));

  useEffect(() => {
    loadWallet();
    let cancelled = false;
    const loadPrice = () => getLiveUgxPrice().then((p) => {
      if (cancelled) return;
      setLivePrice(p);
      setPriceFailed(p === null);
    });
    loadPrice();
    const timer = setInterval(loadPrice, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const spend = parseFloat(ugxAmount) || 0;
  // Whole coins are not required: the UGX entered buys as many coins as it covers (8 dp, rounded down).
  const icanAmount = livePrice && spend > 0 ? Math.floor((spend / livePrice) * 1e8) / 1e8 : 0;
  const cost = livePrice ? Math.round(icanAmount * livePrice * 100) / 100 : 0;
  const enough = walletUgx !== null && cost <= walletUgx;
  const canBuy = icanAmount >= 0.0001 && !!livePrice && enough;

  const handleBuy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canBuy) return;

    setProcessing(true);
    try {
      const result = await buyICANFromWallet({ userId, icanAmount, reference: `MBG-BUY-${Date.now()}` });
      toast.success(`Bought ${formatICAN(result.ican_bought)} IcanEra for UGX ${Number(result.ugx_paid).toLocaleString()} from your IcanEra Wallet.`);
      setUgxAmount('');
      loadWallet();
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
        {/* Wallet the money comes from */}
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-400 mb-1">IcanEra Wallet (pays for this)</div>
          <div className="text-orange-400 text-xl font-bold">
            {walletUgx === null ? '…' : `UGX ${walletUgx.toLocaleString()}`}
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Amount to spend (UGX)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-3 text-gray-400">UGX</span>
            <input
              type="number"
              min="1"
              step="any"
              value={ugxAmount}
              onChange={(e) => setUgxAmount(e.target.value)}
              placeholder="0"
              disabled={processing}
              className="w-full pl-16 pr-16 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:outline-none focus:border-orange-500"
            />
            {walletUgx !== null && walletUgx > 0 && (
              <button
                type="button"
                onClick={() => setUgxAmount(String(Math.floor(walletUgx)))}
                className="absolute right-3 top-3 text-xs text-orange-400 hover:text-orange-300 font-semibold"
              >
                MAX
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {livePrice
              ? `1 IcanEra = UGX ${livePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} (live value)`
              : priceFailed ? "Couldn't load the live price — retrying…" : 'Loading the live price…'}
          </p>
        </div>

        {/* Conversion Display */}
        {icanAmount > 0 && (
          <div className="bg-gray-800 rounded-lg p-4 flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">You Pay</div>
              <div className="text-white font-semibold">
                UGX {cost.toLocaleString()}
              </div>
            </div>
            <div className="text-orange-400 mx-4">→</div>
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">You Get</div>
              <div className="text-orange-400 font-bold text-lg">
                {formatICAN(icanAmount)} IcanEra
              </div>
            </div>
          </div>
        )}

        {icanAmount > 0 && walletUgx !== null && !enough && (
          <p className="text-xs text-rose-400" role="alert">
            Your IcanEra Wallet has UGX {walletUgx.toLocaleString()}, and this costs UGX {cost.toLocaleString()}. Add money to your wallet first, or buy less.
          </p>
        )}

        {/* Info */}
        <div className="bg-orange-900/20 border border-orange-700/30 rounded-lg p-3">
          <p className="text-xs text-orange-200 font-semibold mb-2">ℹ️ How it works</p>
          <ul className="text-xs text-orange-200/80 space-y-1">
            <li>✓ Paid from your IcanEra Wallet balance — no card or mobile money step</li>
            <li>✓ IcanEra arrives in your wallet instantly</li>
            <li>✓ Bought at the live value of IcanEra — never below UGX 5,000</li>
            <li>✓ Use IcanEra to pay for rides or send to others</li>
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
            '💳 Buy IcanEra Now'
          )}
        </button>
      </form>
    </div>
  );
}
