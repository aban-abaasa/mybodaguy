import { useEffect, useState } from 'react';
import { getRewardSummary, TIER_META, type RewardSummary } from '../services/rewardsService';
import PremiumStatCard from './PremiumStatCard';

interface Props {
  userId: string;
  onOpen?: () => void;
  // 'premium' is the customer Overview's larger engraved-card face; the
  // default compact tile is what the rider stat grid expects.
  variant?: 'compact' | 'premium';
}

// Compact "at a glance" card for the Overview grid — mirrors IcanCoinCard's
// shape/sizing so the two sit side by side, but in a gold/amber gradient to
// read as a distinct currency (loyalty points, not spendable ICAN coins).
export default function RewardsPointsCard({ userId, onOpen, variant = 'compact' }: Props) {
  const [summary, setSummary] = useState<RewardSummary | null>(null);

  useEffect(() => {
    if (!userId) return;
    getRewardSummary(userId).then(setSummary).catch(() => {});
  }, [userId]);

  const tier = TIER_META[summary?.tier ?? 'bronze'];

  if (variant === 'premium') {
    return (
      <PremiumStatCard
        gradient={tier.color}
        glow="rgba(120,53,15,0.5)"
        emblem={tier.emoji}
        label="Reward Points"
        value={summary === null ? '…' : Math.floor(summary.points_balance).toLocaleString()}
        caption={`${tier.label} tier`}
        cta="View rewards"
        onClick={onOpen}
      />
    );
  }

  return (
    <div
      onClick={onOpen}
      className={`bg-gradient-to-br ${tier.color} rounded-xl shadow-lg p-1.5 text-white transform transition-all hover:scale-105 hover:shadow-xl ${onOpen ? 'cursor-pointer' : ''}`}
    >
      <div className="flex flex-col items-center text-center">
        <div className="bg-white/20 backdrop-blur-sm p-1 rounded-lg mb-0.5 text-base select-none">{tier.emoji}</div>
        <p className="text-white/80 text-[10px] font-medium">Reward Points</p>
        <p className="text-2xl sm:text-3xl font-bold leading-none">
          {summary === null ? '…' : Math.floor(summary.points_balance).toLocaleString()}
        </p>
        <p className="text-[9px] text-white/70">{tier.label} tier</p>
        {onOpen && (
          <p className="text-[9px] text-white/70 mt-0.5">Tap →</p>
        )}
      </div>
    </div>
  );
}
