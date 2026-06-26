import { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

interface Props {
  userId: string;
  onGoToWallet?: () => void;
}

export default function IcanCoinCard({ userId, onGoToWallet }: Props) {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('ican_user_wallets')
      .select('ican_balance')
      .eq('user_id', userId)
      .single()
      .then(({ data }) => setBalance(data?.ican_balance ?? 0));
  }, [userId]);

  return (
    <div
      onClick={onGoToWallet}
      className={`bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl shadow p-4 sm:p-6 text-white ${onGoToWallet ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-violet-200 mb-1">ICAN Coins</p>
          <p className="text-3xl font-bold">
            {balance === null ? '…' : balance.toFixed(2)}
          </p>
          <p className="text-xs text-violet-200 mt-1">₡ coins</p>
        </div>
        <div className="bg-white/20 p-3 rounded-lg text-2xl select-none">₡</div>
      </div>
      {onGoToWallet && (
        <p className="text-xs text-violet-200 mt-3">Tap to open wallet →</p>
      )}
    </div>
  );
}
