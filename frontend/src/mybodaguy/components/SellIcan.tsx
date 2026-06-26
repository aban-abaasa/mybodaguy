import { useState } from 'react';
import { toast } from 'sonner';

interface SellIcanProps {
  userId: string;
  onSuccess: () => void;
}

export default function SellIcan({ userId, onSuccess }: SellIcanProps) {
  const [amount, setAmount] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSell = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (!phoneNumber) {
      toast.error('Please enter your phone number');
      return;
    }

    setLoading(true);
    try {
      // TODO: Implement actual sell logic with payment gateway
      toast.info('Sell ICAN feature coming soon!');
      // onSuccess();
    } catch (error: any) {
      toast.error(error.message || 'Failed to sell ICAN');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
        <p className="text-amber-800 text-sm">
          Sell your ICAN coins and receive payment via Mobile Money.
          <br />
          Rate: 1 ICAN = UGX 5,000
        </p>
      </div>

      <div>
        <label className="text-slate-600 text-sm font-medium mb-1 block">
          Amount (ICAN)
        </label>
        <input
          type="number"
          step="0.0001"
          min="0.0001"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0000"
          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400"
        />
        {amount && (
          <p className="text-slate-400 text-xs mt-1">
            You'll receive: UGX {(parseFloat(amount || '0') * 5000).toLocaleString()}
          </p>
        )}
      </div>

      <div>
        <label className="text-slate-600 text-sm font-medium mb-1 block">
          Mobile Money Number
        </label>
        <input
          type="tel"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="256XXXXXXXXX"
          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400"
        />
      </div>

      <button
        onClick={handleSell}
        disabled={loading || !amount || !phoneNumber}
        className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-60"
      >
        {loading ? 'Processing...' : 'Sell ICAN'}
      </button>

      <p className="text-slate-400 text-xs text-center">
        Feature in development. Payout integration coming soon.
      </p>
    </div>
  );
}
