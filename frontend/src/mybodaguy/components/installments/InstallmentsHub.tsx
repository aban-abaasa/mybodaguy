import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ChevronRight, Loader, ShoppingBag, Store } from 'lucide-react';
import {
  InstallmentPlan, STATUS_LABELS, formatUGX, getMyBusinessAccounts, getMyInstallmentPlans,
} from '../../services/installmentService';
import InstallmentPlanView from './InstallmentPlanView';
import InstallmentShop from './InstallmentShop';

interface Props {
  customerName?: string | null;
  customerPhone?: string | null;
}

const ORDER: Record<string, number> = { awaiting_deposit: 0, active: 1, ready: 2, pickup_ready: 3, dispatched: 4, completed: 5, cancelled: 6, lapsed: 6 };
type Accounts = Awaited<ReturnType<typeof getMyBusinessAccounts>>;

/**
 * "My payments": every instalment plan the customer is paying off (with any
 * business, on any IcanEra site), the businesses they have an account with,
 * and a shop to start a new plan.
 */
export default function InstallmentsHub({ customerName, customerPhone }: Props) {
  const [view, setView] = useState<'plans' | 'shop'>('plans');
  const [plans, setPlans] = useState<InstallmentPlan[] | null>(null);
  const [accounts, setAccounts] = useState<Accounts>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ code: string; notice?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([getMyInstallmentPlans(), getMyBusinessAccounts()]);
      setPlans(p); setAccounts(a); setError('');
    } catch (err) {
      setError((err as Error).message || 'Could not load your plans');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (open) {
    return (
      <InstallmentPlanView
        code={open.code}
        notice={open.notice}
        onBack={() => { setOpen(null); setView('plans'); setPlans(null); load(); }}
      />
    );
  }

  const sorted = (plans || []).slice().sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
        {([['plans', 'My plans', CalendarClock], ['shop', 'Pay in instalments', ShoppingBag]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setView(id)}
            className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold ${view === id ? 'bg-white text-orange-600 shadow' : 'text-slate-500'}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {view === 'shop' && <InstallmentShop customerName={customerName} customerPhone={customerPhone} onCreated={(code, notice) => setOpen({ code, notice })} />}

      {view === 'plans' && (
        <>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!plans && !error && <div className="flex justify-center py-10"><Loader className="animate-spin text-slate-400" /></div>}

          {accounts.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">My accounts</p>
              <div className="space-y-2">
                {accounts.map(a => (
                  <div key={a.business_profile_id} className="classic-card flex items-center gap-3 p-3">
                    <Store size={20} className="shrink-0 text-orange-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{a.business_name}</p>
                      <p className="text-[11px] text-slate-400">{a.open_plans} open plan{a.open_plans === 1 ? '' : 's'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-emerald-600">Paid {formatUGX(a.paid_ugx)}</p>
                      {a.balance_ugx > 0 && <p className="text-[11px] text-slate-500">Owing {formatUGX(a.balance_ugx)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {plans && (
            sorted.length === 0 ? (
              <div className="py-10 text-center">
                <CalendarClock className="mx-auto mb-3 text-slate-300" size={40} />
                <p className="text-sm text-slate-400">No instalment plans yet.</p>
                <button onClick={() => setView('shop')} className="mt-3 rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 px-5 py-2 text-sm font-medium text-white">Find something to pay for</button>
              </div>
            ) : (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Instalment plans</p>
                <div className="space-y-2">
                  {sorted.map(p => (
                    <button key={p.code} onClick={() => setOpen({ code: p.code })} className="classic-card block w-full p-3 text-left">
                      <div className="flex items-center gap-2">
                        <p className="flex-1 truncate text-sm font-medium text-slate-800">{p.seller_name || 'Order'} · {p.items.map(i => i.name).slice(0, 2).join(', ')}{p.items.length > 2 ? '…' : ''}</p>
                        <ChevronRight size={16} className="shrink-0 text-slate-400" />
                      </div>
                      <div className="mt-1 flex justify-between text-xs">
                        <span className="text-slate-500">{STATUS_LABELS[p.status] || p.status} · {p.code}</span>
                        <span className="text-slate-600">{formatUGX(p.paid_ugx)} of {formatUGX(p.total_ugx)}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-orange-500" style={{ width: `${Math.min(100, Math.round((p.paid_ugx / Math.max(p.total_ugx, 1)) * 100))}%` }} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
