import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Banknote, Check, Copy, Eye, EyeOff, QrCode, RefreshCw, ScanLine, ShoppingCart, X } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'sonner';

/**
 * The classic ivory / ink / gold pieces of the IcanEra wallet page: the engraved
 * balance card, quick actions, the activity strip and the bottom sheet every
 * wallet dialog now sits in.
 */

// ── Bottom sheet ────────────────────────────────────────────────────────────

/** A dialog that rises from the bottom on a phone and centres on a larger screen. */
export function WalletSheet({ title, onClose, children, z = 50 }: { title: string; onClose: () => void; children: ReactNode; z?: number }) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes, and the page behind stops scrolling while the sheet is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="animate-fade-soft fixed inset-0 flex items-end justify-center bg-[#1c150d]/60 backdrop-blur-[2px] sm:items-center sm:p-4"
      style={{ zIndex: z }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet-up relative max-h-[92vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-[28px] border border-[#c4a052]/40 bg-gradient-to-b from-[#fffdf8] to-[#faf3e1] shadow-[0_-18px_50px_-20px_rgba(28,21,13,0.6)] outline-none dark:from-slate-800 dark:to-slate-900 sm:rounded-[28px]"
      >
        <div className="sticky top-0 z-10 bg-gradient-to-b from-[#fffdf8] via-[#fffdf8] to-[#fffdf8]/90 px-4 pb-3 pt-3 min-[380px]:px-5 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800/90">
          <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-[#c4a052]/50 sm:hidden" />
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-classic-display text-[20px] font-bold leading-tight text-slate-800 dark:text-slate-100">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#c4a052]/40 text-[#7a5a12] hover:bg-[#c4a052]/10 dark:text-[#e6c980]"
            >
              <X size={16} />
            </button>
          </div>
          <div className="landing-classic-divider mt-3" />
        </div>
        <div className="px-4 pb-6 pt-2 min-[380px]:px-5 safe-bottom">{children}</div>
      </div>
    </div>
  );
}

// ── compact numbers ─────────────────────────────────────────────────────────

const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });

/** 5793.6514 → "5.79K", 3_400_000 → "3.4M", 5e12 → "5T"; small values keep their decimals. */
export function compactNumber(n: number): string {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1000) return compactFmt.format(v);
  return v.toLocaleString('en', { maximumFractionDigits: abs < 1 ? 4 : 2 });
}

/** The exact 4-decimal amount, until it is too wide for a phone (a million or more), then compact. */
export function formatAmount(n: number): string {
  const v = Number(n) || 0;
  return Math.abs(v) >= 1_000_000 ? compactFmt.format(v) : v.toFixed(4);
}

// ── Balance card ────────────────────────────────────────────────────────────

/** A 16-digit account number reads in fours, like a card: 1002 3456 7890 1234. */
export const displayAddress = (a: string) => (/^\d{16}$/.test(a) ? a.replace(/(\d{4})(?=\d)/g, '$1 ') : a.length > 18 ? `${a.slice(0, 9)}…${a.slice(-6)}` : a);

export interface LocalValue {
  currency: string;
  priceLocal: number;
  balanceLocal: number;
  appreciationPct: number;
}

export function formatLocalMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'code', notation: amount >= 1e9 ? 'compact' : 'standard', maximumFractionDigits: amount < 100 ? 2 : amount >= 1e9 ? 2 : 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

export function BalanceCard({
  balanceText,
  exactText,
  hidden,
  onToggleHidden,
  onRefresh,
  refreshing,
  local,
  fallbackUgx,
  address,
  onCopyAddress,
  onShowQr,
}: {
  balanceText: string;
  /** The full-precision figure, shown as a tooltip when balanceText is abbreviated. */
  exactText?: string;
  hidden: boolean;
  onToggleHidden: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  local: LocalValue | null;
  fallbackUgx: number;
  address: string | null;
  onCopyAddress: () => void;
  onShowQr: () => void;
}) {
  // A long balance steps down a size instead of wrapping on a phone.
  const size = balanceText.length > 11
    ? 'text-[26px] min-[380px]:text-[30px]'
    : balanceText.length > 8 ? 'text-[30px] min-[380px]:text-[36px]' : 'text-[36px] min-[380px]:text-[44px]';

  return (
    <section
      className="relative overflow-hidden rounded-[26px] p-4 text-white min-[380px]:p-5"
      style={{
        background: 'linear-gradient(135deg, #1c150d 0%, #2f2415 48%, #4a3418 100%)',
        boxShadow: '0 24px 44px -20px rgba(44, 36, 22, 0.75)',
      }}
      aria-label="IcanEra wallet balance"
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-white/5" />
      <span aria-hidden className="pointer-events-none absolute -right-14 -top-14 h-48 w-48 rounded-full border border-[#c4a052]/25" />
      <span aria-hidden className="pointer-events-none absolute -right-7 -top-7 h-32 w-32 rounded-full border border-[#c4a052]/20" />
      <span aria-hidden className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full border border-[#c4a052]/15" />
      <span aria-hidden className="pointer-events-none absolute inset-[6px] rounded-[21px] border border-[#e6c980]/30" />

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 select-none place-items-center rounded-full bg-white/5 text-[18px] text-[#e6c980] ring-1 ring-[#c4a052]/60">₡</span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase leading-none tracking-[0.24em] text-[#e6c980]">IcanEra Wallet</p>
            <p className="mt-1 truncate font-classic-display text-[15px] font-semibold leading-tight text-white/90">BodaGoEra</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleHidden}
            aria-label={hidden ? 'Show balance' : 'Hide balance'}
            aria-pressed={hidden}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/5 text-[#e6c980] ring-1 ring-[#c4a052]/40 hover:bg-white/10"
          >
            {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh balance"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/5 text-[#e6c980] ring-1 ring-[#c4a052]/40 hover:bg-white/10 disabled:opacity-60"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="relative mt-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#e6c980]/80">Balance</p>
        <p className="mt-1.5 flex items-baseline gap-2 font-classic-display font-bold leading-none tabular-nums lining-nums" aria-live="polite">
          <span className={size} title={hidden ? undefined : exactText}>{hidden ? '••••••' : balanceText}</span>
        </p>
        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-white/75">
          <span>{hidden ? '••••' : `≈ ${local ? formatLocalMoney(local.balanceLocal, local.currency) : formatLocalMoney(fallbackUgx, 'UGX')}`}</span>
          {!hidden && local && local.appreciationPct > 0 && (
            <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">+{local.appreciationPct.toFixed(2)}%</span>
          )}
        </p>
        {local && local.priceLocal > 0 && (
          <p className="mt-1 text-[11px] text-white/50">1 IcanEra = {formatLocalMoney(local.priceLocal, local.currency)} · live rate</p>
        )}
      </div>

      {address && (
        <div className="relative mt-5 flex items-center gap-2 rounded-2xl bg-black/20 px-3 py-2 ring-1 ring-[#c4a052]/25">
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-[#e6c980]/70 min-[360px]:inline">Account</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] tabular-nums tracking-tight text-white/85">{displayAddress(address)}</span>
          <button type="button" onClick={onCopyAddress} aria-label="Copy wallet address" className="grid h-8 w-8 place-items-center rounded-full text-[#e6c980] hover:bg-white/10">
            <Copy size={14} />
          </button>
          <button type="button" onClick={onShowQr} aria-label="Show wallet QR code" className="grid h-8 w-8 place-items-center rounded-full text-[#e6c980] hover:bg-white/10">
            <QrCode size={15} />
          </button>
        </div>
      )}
    </section>
  );
}

// ── Quick actions ───────────────────────────────────────────────────────────

export type WalletAction = 'pay' | 'send' | 'receive' | 'buy' | 'sell' | 'sendout';

const PRIMARY: Array<{ key: WalletAction; label: string; Icon: typeof ArrowUp }> = [
  { key: 'pay', label: 'Pay', Icon: ScanLine },
  { key: 'send', label: 'Send', Icon: ArrowUp },
  { key: 'receive', label: 'Receive', Icon: ArrowDown },
  { key: 'buy', label: 'Buy', Icon: ShoppingCart },
];

export function QuickActions({ onAction }: { onAction: (a: WalletAction) => void }) {
  return (
    <section className="classic-card p-4" aria-label="Wallet actions">
      <div className="grid grid-cols-4 gap-2">
        {PRIMARY.map(({ key, label, Icon }) => (
          <button key={key} type="button" onClick={() => onAction(key)} className="group flex flex-col items-center gap-1.5 rounded-2xl py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c4a052]">
            <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-gradient-to-br from-[#231b12] to-[#3d2e18] text-[#e6c980] shadow-[0_10px_20px_-12px_rgba(0,0,0,0.7)] ring-1 ring-inset ring-[#c4a052]/60 transition-transform group-active:scale-95">
              <Icon size={20} />
            </span>
            <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">{label}</span>
          </button>
        ))}
      </div>
      <div className="landing-classic-divider my-4" />
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" onClick={() => onAction('sell')} className="classic-btn classic-btn-outline !min-h-[44px] !text-[13px]">
          <Banknote size={16} /> Sell IcanEra
        </button>
        <button type="button" onClick={() => onAction('sendout')} className="classic-btn classic-btn-outline !min-h-[44px] !text-[13px]">
          <ArrowUp size={16} /> Cash out
        </button>
      </div>
      <p className="mt-2.5 text-center text-[11px] text-slate-500 dark:text-slate-400">Cash out sends to Mobile Money or a bank account.</p>
    </section>
  );
}

// ── Activity strip ──────────────────────────────────────────────────────────

export interface DayFlow { label: string; in: number; out: number }

/** Money in / out per day for the last 7 days — a tiny, honest bar chart. */
export function ActivityStrip({ days, earned, spent, tithe, hidden, format }: { days: DayFlow[]; earned: string; spent: string; tithe: string; hidden: boolean; format: (n: number) => string }) {
  const max = Math.max(...days.flatMap((d) => [d.in, d.out]), 0);
  const quiet = max === 0;

  return (
    <section className="classic-card p-4" aria-label="Wallet activity">
      <div className="grid grid-cols-3 divide-x divide-[#c4a052]/25 text-center">
        {[
          { label: 'Earned', value: earned },
          { label: 'Spent', value: spent },
          { label: 'Tithe', value: tithe },
        ].map((s) => (
          <div key={s.label} className="min-w-0 px-1.5 min-[380px]:px-2">
            <p className="classic-eyebrow !text-[9.5px]">{s.label}</p>
            <p className="mt-1 truncate font-classic-display text-[13px] font-bold tabular-nums lining-nums text-slate-800 dark:text-slate-100 min-[380px]:text-[15px]">{hidden ? '••••' : s.value}</p>
          </div>
        ))}
      </div>

      <div className="landing-classic-divider my-4" />

      <div className="flex items-center justify-between">
        <p className="classic-eyebrow">Last 7 days</p>
        <p className="flex items-center gap-3 text-[10.5px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-[#3f7d58]" /> In</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-[#a17c28]" /> Out</span>
        </p>
      </div>

      <div className="mt-3 flex h-[72px] items-end gap-1.5" role="img" aria-label={quiet ? 'No wallet movement in the last 7 days' : 'Money in and out per day over the last 7 days'}>
        {days.map((d) => (
          <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={hidden ? undefined : `${d.label}: +${format(d.in)} / -${format(d.out)}`}>
            <div className="flex h-full w-full items-end justify-center gap-[3px]">
              <span className="w-[42%] rounded-t-[3px] bg-[#3f7d58]" style={{ height: `${max ? Math.max(hidden ? 0 : (d.in / max) * 100, d.in > 0 ? 6 : 0) : 0}%` }} />
              <span className="w-[42%] rounded-t-[3px] bg-[#a17c28]" style={{ height: `${max ? Math.max(hidden ? 0 : (d.out / max) * 100, d.out > 0 ? 6 : 0) : 0}%` }} />
            </div>
            <span className="text-[9.5px] font-medium uppercase tracking-wide text-slate-400">{d.label}</span>
          </div>
        ))}
      </div>
      {quiet && <p className="mt-2 text-center text-[11.5px] text-slate-500 dark:text-slate-400">No movement this week yet.</p>}
    </section>
  );
}

// ── Small shared bits ───────────────────────────────────────────────────────

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          toast.success('Copied');
          setTimeout(() => setDone(false), 1500);
        }).catch(() => toast.error('Could not copy'));
      }}
      className="classic-btn classic-btn-outline !min-h-[44px] !text-[13px]"
    >
      {done ? <Check size={15} /> : <Copy size={15} />} {done ? 'Copied' : label}
    </button>
  );
}

/** The wallet address as a scannable code, so another IcanEra app can pay it without typing. */
export function AddressQr({ address }: { address: string }) {
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto w-fit rounded-2xl border border-[#c4a052]/50 bg-white p-4 shadow-[0_14px_28px_-18px_rgba(44,36,22,0.5)]">
        <QRCodeCanvas value={address} size={196} level="M" fgColor="#231b12" bgColor="#ffffff" />
      </div>
      <p className="font-mono text-[14px] tabular-nums tracking-wider text-slate-700 dark:text-slate-200">{displayAddress(address)}</p>
      <p className="text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">Share this account number to receive IcanEra from any IcanEra app.</p>
      <CopyButton text={address} label="Copy address" />
    </div>
  );
}
