import { useState } from 'react';
import { toast } from 'sonner';

interface BuyIcanProps {
  userId: string;
  onSuccess: () => void;
}

export default function BuyIcan({ userId, onSuccess }: BuyIcanProps) {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const handleBuy = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    setLoading(true);
    try {
      // TODO: Implement actual buy logic with payment gateway
      toast.info('Buy ICAN feature coming soon!');
      // onSuccess();
    } catch (error: any) {
      toast.error(error.message || 'Failed to buy ICAN');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
        <p className="text-blue-800 text-sm">
          Buy ICAN coins using Mobile Money or Bank Transfer.
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
            Total: UGX {(parseFloat(amount || '0') * 5000).toLocaleString()}
          </p>
        )}
      </div>

      <button
        onClick={handleBuy}
        disabled={loading || !amount}
        className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-60"
      >
        {loading ? 'Processing...' : 'Buy ICAN'}
      </button>

      <p className="text-slate-400 text-xs text-center">
        Feature in development. Payment integration coming soon.
      </p>
    </div>
  );
}
