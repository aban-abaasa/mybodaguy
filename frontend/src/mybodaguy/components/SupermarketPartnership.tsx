import { useState, useEffect } from 'react';
import { ShoppingBag, Check, X, Clock, Search, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';

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

const BUSINESS_TYPE_EMOJI: Record<string, string> = {
  supermarket: '🏪', hotel: '🏨', boutique: '👗', restaurant_cafe: '🍽️',
};

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  supermarket: 'Supermarket', hotel: 'Hotel', boutique: 'Boutique', restaurant_cafe: 'Restaurant & Café',
};

// Known types get a proper label; anything new falls back to a readable
// version of its raw value ("pharmacy_shop" -> "Pharmacy shop").
const businessTypeLabel = (type: string) =>
  BUSINESS_TYPE_LABEL[type] || type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

interface SupermarketPartnershipProps {
  riderId: string;
  vehicleType: string | null;
}

export default function SupermarketPartnership({ riderId, vehicleType }: SupermarketPartnershipProps) {
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'available' | 'applied'>('available');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Which business row is open — one at a time, like the customer's order list.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpanded = (id: string) => setExpandedId(cur => (cur === id ? null : id));

  useEffect(() => {
    loadSupermarkets();
  }, [riderId]);

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
      toast.error('Failed to load businesses');
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

      toast.success('Application submitted successfully');
      await loadSupermarkets();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to submit application');
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

      toast.success('Application withdrawn');
      await loadSupermarkets();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to withdraw application');
    } finally {
      setLoading(false);
    }
  };

  const query = searchQuery.trim().toLowerCase();
  const matchesSearch = (sm: Supermarket) =>
    !query ||
    [sm.name, sm.location, sm.address, sm.phone, businessTypeLabel(sm.business_type)]
      .some(v => v?.toLowerCase().includes(query));

  const availableSupermarkets = supermarkets.filter(sm => !sm.is_applied && matchesSearch(sm));
  const appliedSupermarkets = supermarkets.filter(sm => sm.is_applied && matchesSearch(sm));

  const closeSearch = () => { setSearchOpen(false); setSearchQuery(''); };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl font-bold text-slate-800 mb-2">Business Partnerships</h3>
          <p className="text-sm text-slate-600">Apply to work for businesses and earn commissions on deliveries</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            aria-label={searchOpen ? 'Close search' : 'Search businesses'}
            aria-expanded={searchOpen}
            className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${
              searchOpen ? 'bg-orange-50 text-orange-600' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            }`}
          >
            <Search size={18} />
          </button>
          <button
            onClick={loadSupermarkets}
            disabled={loading}
            className="text-sm text-orange-600 hover:text-orange-700 font-medium disabled:opacity-50 whitespace-nowrap px-1"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Search — opened by the icon above; filters both tabs by name, type,
          location or phone */}
      {searchOpen && (
        <div className="relative mb-4">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            autoFocus
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') closeSearch(); }}
            placeholder="Search by name, type or place"
            aria-label="Search businesses"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-10 text-sm text-slate-800 outline-none transition-colors focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-2 border-b border-slate-200">
        <button
          onClick={() => setSelectedTab('available')}
          className={`px-4 py-2 font-medium transition-all relative ${
            selectedTab === 'available'
              ? 'text-orange-500'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          Available ({availableSupermarkets.length})
          {selectedTab === 'available' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
          )}
        </button>
        <button
          onClick={() => setSelectedTab('applied')}
          className={`px-4 py-2 font-medium transition-all relative ${
            selectedTab === 'applied'
              ? 'text-orange-500'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          My Applications ({appliedSupermarkets.length})
          {selectedTab === 'applied' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
          )}
        </button>
      </div>

      {/* Content — a plain list, one row per business */}
      {loading && supermarkets.length === 0 ? (
        <div className="text-center py-8">
          <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full mx-auto" />
        </div>
      ) : (
        <div>
          {selectedTab === 'available' && (
            availableSupermarkets.length === 0 ? (
              <EmptyState
                title={query ? `No businesses match “${searchQuery.trim()}”` : 'No available businesses'}
                hint={query ? 'Try a different name or place' : "You've applied to all registered businesses"}
              />
            ) : (
              availableSupermarkets.map((supermarket) => (
                <BusinessRow
                  key={supermarket.id}
                  supermarket={supermarket}
                  expanded={expandedId === supermarket.id}
                  onToggle={() => toggleExpanded(supermarket.id)}
                  onApply={handleApply}
                  loading={loading}
                />
              ))
            )
          )}

          {selectedTab === 'applied' && (
            appliedSupermarkets.length === 0 ? (
              <EmptyState
                title={query ? `No applications match “${searchQuery.trim()}”` : 'No applications yet'}
                hint={query ? 'Try a different name or place' : 'Apply to businesses to start earning commissions'}
              />
            ) : (
              appliedSupermarkets.map((supermarket) => (
                <ApplicationRow
                  key={supermarket.id}
                  supermarket={supermarket}
                  expanded={expandedId === supermarket.id}
                  onToggle={() => toggleExpanded(supermarket.id)}
                  onWithdraw={handleWithdrawApplication}
                  loading={loading}
                />
              ))
            )
          )}
        </div>
      )}

      {/* Info Box */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>How it works:</strong> Apply to any registered business on the platform.
          Once approved, you'll receive delivery requests from customers ordering from that business.
          Earn commission on every successful delivery!
        </p>
      </div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="text-center py-8 mt-2 bg-slate-50 rounded-lg">
      <ShoppingBag className="w-12 h-12 text-slate-400 mx-auto mb-3" />
      <p className="text-slate-600 px-4 break-words">{title}</p>
      <p className="text-sm text-slate-500">{hint}</p>
    </div>
  );
}

function DetailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="flex-shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right font-medium text-slate-800">{children}</span>
    </div>
  );
}

// One row of the list. Tapping the left side (emoji, name, place) opens the
// business's details in place; the action (Apply / status) stays on the right
// so it's always one tap away without opening anything.
function ListRow({
  supermarket, expanded, onToggle, action, sub, subClass,
}: {
  supermarket: Supermarket;
  expanded: boolean;
  onToggle: () => void;
  action: React.ReactNode;
  // Replaces the default "Type · Place" line (e.g. an application's status note)
  sub?: string;
  subClass?: string;
}) {
  const address = supermarket.address && supermarket.address !== supermarket.location ? supermarket.address : null;

  return (
    <div className="border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-3 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
        >
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-orange-50 text-lg ring-1 ring-inset ring-orange-100">
            {BUSINESS_TYPE_EMOJI[supermarket.business_type] || '🏪'}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-sm font-semibold text-slate-800 ${expanded ? 'break-words' : 'truncate'}`}>{supermarket.name}</span>
            <span className={`block text-xs ${subClass || 'text-slate-500'} ${expanded ? 'break-words' : 'truncate'}`}>
              {sub ?? [businessTypeLabel(supermarket.business_type), supermarket.location].filter(Boolean).join(' · ')}
            </span>
          </span>
          <ChevronDown size={16} className={`flex-shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {action}
      </div>

      {expanded && (
        <div className="mb-3 rounded-xl bg-slate-50 px-3 py-1.5 text-sm">
          <DetailLine label="Type">{businessTypeLabel(supermarket.business_type)}</DetailLine>
          {supermarket.location && <DetailLine label="Location">{supermarket.location}</DetailLine>}
          {address && <DetailLine label="Address">{address}</DetailLine>}
          {supermarket.phone && (
            <DetailLine label="Phone">
              <a href={`tel:${supermarket.phone}`} className="text-orange-600 hover:underline">{supermarket.phone}</a>
            </DetailLine>
          )}
        </div>
      )}
    </div>
  );
}

function BusinessRow({
  supermarket,
  expanded,
  onToggle,
  onApply,
  loading
}: {
  supermarket: Supermarket;
  expanded: boolean;
  onToggle: () => void;
  onApply: (id: string) => void;
  loading: boolean;
}) {
  return (
    <ListRow
      supermarket={supermarket}
      expanded={expanded}
      onToggle={onToggle}
      action={
        <button
          onClick={() => onApply(supermarket.id)}
          disabled={loading}
          className="flex-shrink-0 rounded-full bg-gradient-to-r from-orange-500 to-yellow-500 px-4 py-2 text-xs font-semibold text-white transition-all hover:from-orange-600 hover:to-yellow-600 active:scale-95 disabled:opacity-50"
        >
          Apply
        </button>
      }
    />
  );
}

const APPLICATION_STATUS = {
  pending:  { icon: Clock, text: 'Pending',  chip: 'bg-yellow-100 text-yellow-700', sub: undefined,                                         subClass: undefined },
  approved: { icon: Check, text: 'Approved', chip: 'bg-green-100 text-green-700',   sub: 'You can accept their delivery requests',           subClass: 'text-green-700' },
  rejected: { icon: X,     text: 'Rejected', chip: 'bg-red-100 text-red-700',       sub: 'Not approved — you can try again later',           subClass: 'text-red-600' },
} as const;

function ApplicationRow({
  supermarket,
  expanded,
  onToggle,
  onWithdraw,
  loading
}: {
  supermarket: Supermarket;
  expanded: boolean;
  onToggle: () => void;
  onWithdraw: (id: string) => void;
  loading: boolean;
}) {
  const state = supermarket.application_status || 'pending';
  const status = APPLICATION_STATUS[state];
  const StatusIcon = status.icon;

  return (
    <ListRow
      supermarket={supermarket}
      expanded={expanded}
      onToggle={onToggle}
      sub={status.sub}
      subClass={status.subClass}
      action={
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.chip}`}>
            <StatusIcon size={12} />
            {status.text}
          </span>
          {state === 'pending' && (
            <button
              onClick={() => onWithdraw(supermarket.id)}
              disabled={loading}
              className="text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline disabled:opacity-50"
            >
              Withdraw
            </button>
          )}
        </div>
      }
    />
  );
}
