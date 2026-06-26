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
      className={`bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl shadow p-3 sm:p-5 text-white ${onGoToWallet ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] sm:text-sm text-violet-200 mb-0.5 sm:mb-1">ICAN Coins</p>
          <p className="text-2xl sm:text-3xl font-bold leading-tight">
            {balance === null ? '…' : balance.toFixed(2)}
          </p>
          <p className="text-[9px] sm:text-xs text-violet-200 mt-0.5 sm:mt-1">₡ coins</p>
        </div>
        <div className="bg-white/20 p-2 sm:p-3 rounded-lg text-xl sm:text-2xl select-none">₡</div>
      </div>
      {onGoToWallet && (
        <p className="text-[9px] sm:text-xs text-violet-200 mt-2 sm:mt-3">Tap to open wallet →</p>
      )}
    </div>
  );
}
