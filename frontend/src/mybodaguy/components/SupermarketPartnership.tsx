import { useState, useEffect } from 'react';
import { Check, ChevronDown, RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import { BUSINESS_TYPE_EMOJI, businessTypeLabel } from '../utils/markets';

interface Supermarket {
  id: string;
  name: string;
  location: string;
  address: string | null;
  phone: string | null;
  business_type: string;
  is_applied: boolean;
  application_id?: string;
  application_status?: 'pending' | 'approved' | 'rejected';
}

interface SupermarketPartnershipProps {
  riderId: string;
  vehicleType: string | null;
  /** Markets that opened since the rider last looked: marked "New" and listed first. */
  freshIds?: ReadonlySet<string>;
  /** Changes whenever a new market arrives, so an open list reloads itself. */
  refreshKey?: number;
}

const STATUS_ORDER = { approved: 0, pending: 1, rejected: 2 } as const;

// Markets — a plain, classic list on the page itself: no card around it, one line
// per business, details folded away until the row is tapped.
export default function SupermarketPartnership({ riderId, vehicleType, freshIds, refreshKey = 0 }: SupermarketPartnershipProps) {
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'available' | 'applied'>('available');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Which business row is open — one at a time.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpanded = (id: string) => setExpandedId(cur => (cur === id ? null : id));

  useEffect(() => {
    loadSupermarkets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riderId, refreshKey]);

  const loadSupermarkets = async () => {
    setLoading(true);
    try {
      const [{ data: markets, error: marketsError }, { data: applications, error: appsError }] = await Promise.all([
        supabase
          .from('supermarkets')
          .select('id, name, location, address, phone, business_type')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase
          .from('rider_supermarket_applications')
          .select('id, supermarket_id, status')
          .eq('rider_user_id', riderId),
      ]);

      if (marketsError) throw marketsError;
      if (appsError) throw appsError;

      const appBySupermarket = new Map((applications || []).map(a => [a.supermarket_id, a]));

      setSupermarkets(
        (markets || []).map((sm: any) => {
          const app = appBySupermarket.get(sm.id);
          return {
            id: sm.id,
            name: sm.name,
            location: sm.location,
            address: sm.address,
            phone: sm.phone,
            business_type: sm.business_type || 'supermarket',
            is_applied: !!app,
            application_id: app?.id,
            application_status: app?.status,
          };
        })
      );
    } catch (error) {
      console.error('[SupermarketPartnership] Failed to load supermarkets:', error);
      toast.error("Couldn't load markets");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (supermarketId: string) => {
    setLoading(true);
    try {
      const [{ data: authUser }, { data: profile }, { data: rider }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('mbg_user_profiles').select('full_name, phone').eq('user_id', riderId).maybeSingle(),
        // Scoped by vehicleType too — a person can hold more than one
        // mbg_riders row now, so this must record the vehicle they're
        // currently active as, not an arbitrary one of possibly several.
        supabase.from('mbg_riders').select('vehicle_type, license_number').eq('user_id', riderId).eq('vehicle_type', vehicleType).maybeSingle(),
      ]);

      const { error } = await supabase.from('rider_supermarket_applications').insert({
        supermarket_id: supermarketId,
        rider_user_id: riderId,
        rider_name: profile?.full_name || authUser?.user?.email?.split('@')[0] || 'Rider',
        rider_email: authUser?.user?.email || null,
        rider_phone: profile?.phone || null,
        vehicle_type: rider?.vehicle_type || null,
        license_number: rider?.license_number || null,
      });

      if (error) throw error;

      toast.success('Applied');
      await loadSupermarkets();
    } catch (error: any) {
      toast.error(error?.message || "Couldn't apply");
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawApplication = async (supermarketId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('rider_supermarket_applications')
        .delete()
        .eq('supermarket_id', supermarketId)
        .eq('rider_user_id', riderId);

      if (error) throw error;

      toast.success('Withdrawn');
      await loadSupermarkets();
    } catch (error: any) {
      toast.error(error?.message || "Couldn't withdraw");
    } finally {
      setLoading(false);
    }
  };

  const query = searchQuery.trim().toLowerCase();
  const matchesSearch = (sm: Supermarket) =>
    !query ||
    [sm.name, sm.location, sm.address, sm.phone, businessTypeLabel(sm.business_type)]
      .some(v => v?.toLowerCase().includes(query));

  const isFresh = (id: string) => !!freshIds?.has(id);

  // New markets first, then by name (the query already sorts by name).
  const available = supermarkets
    .filter(sm => !sm.is_applied && matchesSearch(sm))
    .sort((a, b) => Number(isFresh(b.id)) - Number(isFresh(a.id)));
  // Approved first: those are the ones the rider can already work for.
  const applied = supermarkets
    .filter(sm => sm.is_applied && matchesSearch(sm))
    .sort((a, b) => STATUS_ORDER[a.application_status || 'pending'] - STATUS_ORDER[b.application_status || 'pending']);

  const tabList = selectedTab === 'available' ? available : applied;

  // Only the kinds of business actually on this tab, so there's never a filter that empties the list.
  const types = Array.from(new Set(tabList.map(sm => sm.business_type)));
  const activeType = types.includes(typeFilter) ? typeFilter : 'all';
  const shown = activeType === 'all' ? tabList : tabList.filter(sm => sm.business_type === activeType);

  const closeSearch = () => { setSearchOpen(false); setSearchQuery(''); };
  const switchTab = (tab: 'available' | 'applied') => { setSelectedTab(tab); setExpandedId(null); };

  return (
    <section className="mx-auto w-full max-w-2xl">
      <div className="flex items-center gap-3">
        <h2 className="font-classic-display text-xl font-semibold text-slate-800 dark:text-slate-100">Markets</h2>
        <div className="landing-classic-divider flex-1" />
        <button
          type="button"
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          aria-label={searchOpen ? 'Close search' : 'Search'}
          aria-expanded={searchOpen}
          className={`grid h-8 w-8 place-items-center rounded-full transition-colors ${searchOpen ? 'text-orange-600' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
        >
          <Search size={17} />
        </button>
        <button
          type="button"
          onClick={loadSupermarkets}
          disabled={loading}
          aria-label="Refresh"
          className="grid h-8 w-8 place-items-center rounded-full text-slate-500 transition-colors hover:text-slate-800 disabled:opacity-60 dark:hover:text-slate-200"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {searchOpen && (
        <div className="relative mt-3">
          <input
            type="search"
            autoFocus
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') closeSearch(); }}
            placeholder="Name, type or place"
            aria-label="Search markets"
            className="w-full border-0 border-b border-[#c4a052]/60 bg-transparent py-2 pr-8 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-orange-500 dark:text-slate-100"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-0 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      <div role="tablist" className="mt-3 flex gap-6 border-b border-[#c4a052]/25">
        {([['available', 'Open', available.length], ['applied', 'Applied', applied.length]] as const).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selectedTab === id}
            onClick={() => switchTab(id)}
            className={`relative -mb-px border-b-2 pb-2 pt-1 text-sm font-semibold transition-colors ${
              selectedTab === id ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {label} <span className="font-normal text-slate-400">{count}</span>
          </button>
        ))}
      </div>

      {types.length > 1 && (
        <div className="scrollbar-hide -mx-1 mt-2 flex gap-4 overflow-x-auto px-1 text-xs">
          {['all', ...types].map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              aria-pressed={activeType === t}
              className={`flex-shrink-0 whitespace-nowrap py-1.5 font-medium transition-colors ${activeType === t ? 'text-orange-600 underline decoration-[#c4a052] decoration-2 underline-offset-[6px]' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
            >
              {t === 'all' ? 'All' : businessTypeLabel(t)}
            </button>
          ))}
        </div>
      )}

      {loading && supermarkets.length === 0 ? (
        <ul className="mt-2" aria-hidden>
          {[0, 1, 2, 3].map(i => (
            <li key={i} className="flex animate-pulse items-center gap-3 border-b border-[#c4a052]/15 py-3.5">
              <div className="h-6 w-6 rounded bg-slate-200/70" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-2/5 rounded bg-slate-200/70" />
                <div className="h-3 w-1/4 rounded bg-slate-200/50" />
              </div>
            </li>
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">
          {query
            ? 'No match'
            : selectedTab === 'available' ? 'Nothing new right now' : 'No applications yet'}
        </p>
      ) : (
        <ul className="mt-1">
          {shown.map(sm => selectedTab === 'available' ? (
            <MarketRow
              key={sm.id}
              market={sm}
              fresh={isFresh(sm.id)}
              expanded={expandedId === sm.id}
              onToggle={() => toggleExpanded(sm.id)}
              action={
                <button
                  type="button"
                  onClick={() => handleApply(sm.id)}
                  disabled={loading}
                  className="flex-shrink-0 rounded-full border border-orange-400 px-3.5 py-1 text-xs font-semibold text-orange-600 transition-colors hover:bg-orange-50 active:scale-95 disabled:opacity-50"
                >
                  Apply
                </button>
              }
            />
          ) : (
            <MarketRow
              key={sm.id}
              market={sm}
              fresh={false}
              expanded={expandedId === sm.id}
              onToggle={() => toggleExpanded(sm.id)}
              action={<StatusWord status={sm.application_status || 'pending'} />}
              extra={sm.application_status === 'pending' || !sm.application_status ? (
                <button
                  type="button"
                  onClick={() => handleWithdrawApplication(sm.id)}
                  disabled={loading}
                  className="text-xs font-medium text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  Withdraw application
                </button>
              ) : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusWord({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  if (status === 'approved') return <span className="flex flex-shrink-0 items-center gap-1 text-xs font-semibold text-green-700"><Check size={13} />Approved</span>;
  if (status === 'rejected') return <span className="flex-shrink-0 text-xs font-semibold text-red-600">Declined</span>;
  return <span className="flex-shrink-0 text-xs font-semibold text-amber-600">Pending</span>;
}

// One line per business. Tapping the name opens its details in place; the action
// (Apply / status) stays on the right so it is always one tap away. A row with
// nothing more to show is not expandable, so there is never an empty drawer.
function MarketRow({
  market, fresh, expanded, onToggle, action, extra,
}: {
  market: Supermarket;
  fresh: boolean;
  expanded: boolean;
  onToggle: () => void;
  action: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const address = market.address && market.address !== market.location ? market.address : null;
  const expandable = !!(address || market.phone || extra);

  const lead = (
    <>
      <span className="w-7 flex-shrink-0 text-center text-xl" aria-hidden>{BUSINESS_TYPE_EMOJI[market.business_type] || '🏪'}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={`font-classic-display text-[15px] font-semibold text-slate-800 dark:text-slate-100 ${expanded ? 'break-words' : 'truncate'}`}>{market.name}</span>
          {fresh && <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-orange-600">New</span>}
        </span>
        <span className={`block text-xs text-slate-500 ${expanded ? 'break-words' : 'truncate'}`}>
          {[market.location, businessTypeLabel(market.business_type)].filter(Boolean).join(' · ')}
        </span>
      </span>
    </>
  );

  return (
    <li className={`border-b border-[#c4a052]/20 last:border-0 ${fresh ? 'shadow-[inset_2px_0_0_#fb923c]' : ''}`}>
      <div className="flex items-center gap-3 py-3">
        {expandable ? (
          <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            {lead}
            <ChevronDown size={15} className={`flex-shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">{lead}</div>
        )}
        {action}
      </div>

      {expanded && expandable && (
        <div className="space-y-1.5 pb-3 pl-10 text-sm text-slate-600 dark:text-slate-300">
          {address && <p className="break-words">{address}</p>}
          {market.phone && <p><a href={`tel:${market.phone}`} className="font-medium text-orange-600 hover:underline">{market.phone}</a></p>}
          {extra && <p>{extra}</p>}
        </div>
      )}
    </li>
  );
}
