import { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import PremiumStatCard from './PremiumStatCard';

interface Props {
  userId: string;
  onGoToWallet?: () => void;
  // 'premium' is the customer Overview's larger engraved-card face; the
  // default compact tile is what the developer/chairperson stat grids expect.
  variant?: 'compact' | 'premium';
}

export default function IcanCoinCard({ userId, onGoToWallet, variant = 'compact' }: Props) {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('ican_user_wallets')
      .select('ican_balance')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => setBalance(data?.ican_balance ?? 0));
  }, [userId]);

  if (variant === 'premium') {
    return (
      <PremiumStatCard
        gradient="from-violet-600 via-purple-700 to-indigo-900"
        glow="rgba(91,33,182,0.55)"
        emblem="₡"
        label="ICAN Coins"
        value={balance === null ? '…' : balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        caption="coins available"
        cta="Open wallet"
        onClick={onGoToWallet}
      />
    );
  }

  return (
    <div
      onClick={onGoToWallet}
      className={`bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl shadow-lg p-1.5 text-white transform transition-all hover:scale-105 hover:shadow-xl ${onGoToWallet ? 'cursor-pointer' : ''}`}
    >
      <div className="flex flex-col items-center text-center">
        <div className="bg-white/20 backdrop-blur-sm p-1 rounded-lg mb-0.5 text-base select-none">₡</div>
        <p className="text-white/80 text-[10px] font-medium">ICAN Coins</p>
        <p className="text-2xl sm:text-3xl font-bold leading-none">
          {balance === null ? '…' : balance.toFixed(2)}
        </p>
        <p className="text-[9px] text-white/70">₡ coins</p>
        {onGoToWallet && (
          <p className="text-[9px] text-white/70 mt-0.5">Tap →</p>
        )}
      </div>
    </div>
  );
}
