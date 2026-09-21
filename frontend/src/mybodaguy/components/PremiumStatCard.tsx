import { ArrowRight } from 'lucide-react';

interface Props {
  // Tailwind gradient stops for the card face, e.g. "from-violet-600 to-indigo-900"
  gradient: string;
  emblem: React.ReactNode;
  label: string;
  value: string;
  caption: string;
  cta: string;
  onClick?: () => void;
  glow: string; // shadow color under the card, e.g. "rgba(91,33,182,0.55)"
}

// Shared "engraved card" face for the Overview's two currency cards (ICAN
// coins + reward points): gradient body, a darkening wash so white text stays
// legible on light tiers (gold/silver), a gold inner hairline like a bank
// card, and a serif figure. Left-aligned, so the number reads first.
export default function PremiumStatCard({ gradient, emblem, label, value, caption, cta, onClick, glow }: Props) {
  // Long balances (e.g. 12,345.67) step down a size instead of clipping in a
  // ~165px-wide phone column.
  const valueSize = value.length > 8 ? 'text-[22px]' : value.length > 6 ? 'text-[26px]' : 'text-[32px]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{ boxShadow: `0 16px 30px -14px ${glow}` }}
      className={`relative flex min-h-[150px] w-full flex-col justify-between overflow-hidden rounded-[20px] bg-gradient-to-br p-4 text-left text-white transition-transform active:scale-[0.97] disabled:cursor-default ${gradient}`}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-white/10" />
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full border border-white/15" />
      <span aria-hidden className="pointer-events-none absolute -right-5 -top-5 h-20 w-20 rounded-full border border-white/10" />
      <span aria-hidden className="pointer-events-none absolute inset-[5px] rounded-[15px] border border-[#e6c980]/35" />

      <div className="relative flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 select-none place-items-center rounded-full bg-white/15 text-[15px] ring-1 ring-[#e6c980]/60">
          {emblem}
        </span>
        <span className="text-[10px] font-semibold uppercase leading-tight tracking-[0.1em] text-white/80">{label}</span>
      </div>

      <div className="relative mt-3">
        <p className={`font-classic-display font-bold leading-none tabular-nums ${valueSize}`}>{value}</p>
        <p className="mt-1.5 text-[11px] text-white/70">{caption}</p>
      </div>

      {onClick && (
        <div className="relative mt-3 flex items-center justify-between text-[11px] font-semibold text-[#f3dc9b]">
          <span>{cta}</span>
          <span className="grid h-6 w-6 place-items-center rounded-full bg-white/15 ring-1 ring-[#e6c980]/50">
            <ArrowRight size={12} />
          </span>
        </div>
      )}
    </button>
  );
}
