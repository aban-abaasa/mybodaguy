/**
 * VehicleArt — small flat illustrations of the four delivery vehicle classes
 * (boda, car, van, truck), drawn inline so they scale crisply and need no
 * image requests. `active` switches to the brand orange palette.
 */
import type { ReactNode } from 'react';

export type VehicleArtKind = 'motorcycle' | 'car' | 'van' | 'truck';

const Wheel = ({ cx, cy = 42, r = 7 }: { cx: number; cy?: number; r?: number }) => (
  <g>
    <circle cx={cx} cy={cy} r={r} fill="#1e293b" />
    <circle cx={cx} cy={cy} r={r * 0.45} fill="#e2e8f0" />
  </g>
);

export default function VehicleArt({ kind, active = false, className = '' }: { kind: VehicleArtKind; active?: boolean; className?: string }) {
  const body = active ? '#f97316' : '#94a3b8';
  const dark = active ? '#c2410c' : '#64748b';
  const light = active ? '#fed7aa' : '#e2e8f0';
  const glass = '#bae6fd';
  let art: ReactNode;

  if (kind === 'motorcycle') {
    art = (
      <>
        {/* delivery box on the rack */}
        <rect x="9" y="14" width="24" height="17" rx="3" fill={body} />
        <rect x="9" y="14" width="24" height="5" rx="2" fill={dark} />
        {/* frame + tank + seat */}
        <path d="M30 36 L40 24 H56 L60 30 H46 L42 36 Z" fill={dark} />
        <rect x="34" y="21" width="16" height="4" rx="2" fill="#334155" />
        {/* front fork + handlebar */}
        <path d="M64 42 L58 24 L52 20" stroke={dark} strokeWidth="3" strokeLinecap="round" fill="none" />
        <path d="M52 20 H60" stroke="#334155" strokeWidth="3" strokeLinecap="round" />
        <circle cx="66" cy="29" r="3" fill="#fde68a" />
        {/* rider */}
        <circle cx="41" cy="11" r="5" fill="#fbbf24" />
        <path d="M41 17 L46 22 L52 21" stroke={dark} strokeWidth="4" strokeLinecap="round" fill="none" />
        <Wheel cx={22} cy={42} r={8} />
        <Wheel cx={66} cy={42} r={8} />
      </>
    );
  } else if (kind === 'car') {
    art = (
      <>
        <path d="M6 38 V30 Q6 27 9 26 L22 24 L32 12 Q34 10 37 10 H58 Q61 10 63 12 L72 24 L82 26 Q88 27 88 31 V38 Z" fill={body} />
        <path d="M27 24 L35 14 H47 V24 Z" fill={glass} />
        <path d="M51 24 V14 H58 L66 24 Z" fill={glass} />
        <rect x="6" y="33" width="82" height="5" fill={dark} opacity="0.35" />
        <rect x="84" y="28" width="4" height="4" rx="1" fill="#fde68a" />
        <rect x="6" y="28" width="3" height="4" rx="1" fill="#fecaca" />
        <Wheel cx={25} cy={39} r={8} />
        <Wheel cx={69} cy={39} r={8} />
      </>
    );
  } else if (kind === 'van') {
    art = (
      <>
        <rect x="4" y="10" width="54" height="29" rx="4" fill={body} />
        <path d="M58 16 H72 Q75 16 77 19 L88 30 V39 H58 Z" fill={dark} />
        <path d="M63 20 H72 L81 30 H63 Z" fill={glass} />
        <rect x="10" y="17" width="42" height="3" rx="1.5" fill={light} opacity="0.8" />
        <rect x="10" y="24" width="28" height="3" rx="1.5" fill={light} opacity="0.55" />
        <rect x="85" y="31" width="4" height="4" rx="1" fill="#fde68a" />
        <Wheel cx={24} cy={40} r={8} />
        <Wheel cx={72} cy={40} r={8} />
      </>
    );
  } else {
    art = (
      <>
        <rect x="2" y="6" width="58" height="33" rx="3" fill={body} />
        <rect x="2" y="6" width="58" height="6" rx="3" fill={dark} opacity="0.45" />
        <path d="M62 14 H76 Q79 14 81 17 L92 29 V39 H62 Z" fill={dark} />
        <path d="M67 18 H76 L85 29 H67 Z" fill={glass} />
        <rect x="9" y="17" width="44" height="3" rx="1.5" fill={light} opacity="0.75" />
        <rect x="9" y="24" width="30" height="3" rx="1.5" fill={light} opacity="0.5" />
        <rect x="89" y="31" width="4" height="4" rx="1" fill="#fde68a" />
        <Wheel cx={14} cy={41} r={7} />
        <Wheel cx={30} cy={41} r={7} />
        <Wheel cx={74} cy={41} r={7} />
      </>
    );
  }

  return (
    <svg viewBox="0 0 96 52" className={className} role="img" aria-hidden focusable="false">
      <ellipse cx="48" cy="50" rx="40" ry="2.5" fill="#0f172a" opacity="0.08" />
      {art}
    </svg>
  );
}
