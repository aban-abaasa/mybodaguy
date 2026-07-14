import { useState, useEffect, useRef } from 'react';
import { Bike, MapPin, DollarSign, TrendingUp, LogOut, Settings, Map, ShoppingBag, Menu, X, User, Package, Bell, ChevronDown, Car, Truck } from 'lucide-react';
import { toast } from 'sonner';
import RiderLocationManager from '../components/RiderLocationManager';
import RiderModeSelector from '../components/RiderModeSelector';
import SupermarketPartnership from '../components/SupermarketPartnership';
import ProfileModal from '../components/ProfileModal';
import RiderICANEarnings from '../components/RiderICANEarnings';
import SupermarketDeliveryPool from '../components/SupermarketDeliveryPool';
import RiderRideRequests from '../components/RiderRideRequests';
import { supabase } from '../services/supabaseClient';

interface RiderDashboardProps {
  user: any;
  onSignOut: () => void;
}

type TabType = 'overview' | 'requests' | 'mode' | 'locations' | 'partnerships' | 'deliveries';

// Keeps mbg_riders.current_lat/current_lng fresh so the real matching engine
// (mbg_find_available_riders) can rank this rider by actual live distance
// instead of only their static home-marked area.
function useLiveLocationPing(userId: string | undefined) {
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!userId || !navigator.geolocation) return;

    const ping = () => {
      const now = Date.now();
      if (now - lastSentRef.current < 45000) return; // throttle to ~45s
      lastSentRef.current = now;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          supabase
            .from('mbg_riders')
            .update({
              current_lat: pos.coords.latitude,
              current_lng: pos.coords.longitude,
              location_updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId)
            .then(() => {});
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000 }
      );
    };

    ping();
    const interval = setInterval(ping, 60000);
    return () => clearInterval(interval);
  }, [userId]);
}

// On/off slider for the rider's working time — toggles mbg_riders.is_available,
// the same flag the matching engine (mbg_find_available_riders) filters on.
// Scoped by vehicleType, not just userId — a person can hold more than one
// mbg_riders row now (multi-vehicle), and only the ACTIVE one should ever
// flip online; the inactive one(s) must stay offline regardless (enforced
// server-side too, by mbg_switch_active_vehicle).
function WorkingTimeToggle({ userId, vehicleType }: { userId: string; vehicleType: string | null }) {
  const [isAvailable, setIsAvailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId || !vehicleType) return;
    supabase
      .from('mbg_riders')
      .select('is_available')
      .eq('user_id', userId)
      .eq('vehicle_type', vehicleType)
      .maybeSingle()
      .then(({ data }) => {
        setIsAvailable(!!data?.is_available);
        setLoaded(true);
      });
  }, [userId, vehicleType]);

  const toggle = async () => {
    if (!vehicleType) return;
    const next = !isAvailable;
    setIsAvailable(next);
    setSaving(true);
    const { error } = await supabase
      .from('mbg_riders')
      .update({ is_available: next, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('vehicle_type', vehicleType);
    setSaving(false);
    if (error) {
      setIsAvailable(!next);
      toast.error(error.message || 'Failed to update working status');
    } else {
      toast.success(next ? "You're online — customers can now request rides" : "You're offline — no new requests will come in");
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isAvailable}
      onClick={toggle}
      disabled={!loaded || saving}
      className={`w-full rounded-lg xs:rounded-xl shadow-md p-3 xs:p-4 sm:p-6 flex items-center justify-between gap-3 transition-colors disabled:opacity-60 ${
        isAvailable ? 'bg-gradient-to-r from-green-500 to-emerald-500' : 'bg-white border-2 border-slate-200'
      }`}
    >
      <span className="min-w-0 text-left">
        <span className={`block font-bold text-xs xs:text-sm sm:text-lg ${isAvailable ? 'text-white' : 'text-slate-800'}`}>
          {isAvailable ? "You're Online" : "You're Offline"}
        </span>
        <span className={`block text-[9px] xs:text-[11px] sm:text-sm truncate ${isAvailable ? 'text-white/80' : 'text-slate-500'}`}>
          {isAvailable ? 'Accepting ride requests' : 'Turn on to start working'}
        </span>
      </span>
      <span
        className={`relative flex-shrink-0 w-11 h-6 xs:w-14 xs:h-8 rounded-full transition-colors ${
          isAvailable ? 'bg-white/30' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 xs:top-1 left-0.5 xs:left-1 w-5 h-5 xs:w-6 xs:h-6 rounded-full bg-white shadow-md transition-transform ${
            isAvailable ? 'translate-x-5 xs:translate-x-6' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

// Compact "UGX 45k" style formatting for the earnings stat card.
function formatEarnings(amount: number): string {
  if (amount >= 1_000_000) return `UGX ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `UGX ${Math.round(amount / 1000)}k`;
  return `UGX ${Math.round(amount)}`;
}

// Registered role is only visible via mbg_riders.vehicle_type/operator_type
// (approved via "Become a Driver" -> dev panel review) — nothing in this
// dashboard surfaced it before, so a car/van/truck operator saw the exact
// same boda-branded screen as a motorcycle rider with no confirmation of
// which role they actually hold.
const VEHICLE_TYPE_META: Record<string, { label: string; icon: typeof Bike; use: string }> = {
  motorcycle: { label: 'Motorcycle', icon: Bike, use: 'Boda passenger rides' },
  bicycle:    { label: 'Bicycle',    icon: Bike, use: 'Short-distance passenger rides' },
  tuktuk:     { label: 'Tuktuk',     icon: Car,  use: 'Passenger rides for small groups' },
  car:        { label: 'Car',        icon: Car,  use: 'Passenger rides' },
  van:        { label: 'Van',        icon: Truck, use: 'Goods delivery for supermarkera/supplier orders' },
  truck:      { label: 'Truck',      icon: Truck, use: 'Larger goods delivery and cross-border cargo' },
};

interface RiderStats {
  earningsTodayUGX: number;
  ridesDone: number;
  rating: number;
  mode: string;
  vehicleType: string | null;
  operatorType: string | null;
}

interface RiderVehicle {
  vehicleType: string;
  operatorType: string | null;
}

// Pulls real numbers for the overview stat cards straight from Supabase.
// A person can hold more than one mbg_riders row now (multi-vehicle — see
// ADD_MULTI_VEHICLE_SUPPORT.sql), so this fetches ALL of them plus
// mbg_users.active_vehicle_type to know which one is currently live,
// instead of assuming exactly one row per user.
function useRiderStats(userId: string | undefined) {
  const [stats, setStats] = useState<RiderStats | null>(null);
  const [allVehicles, setAllVehicles] = useState<RiderVehicle[]>([]);
  const [activeVehicleType, setActiveVehicleType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!userId) return;
    setLoading(true);

    const [{ data: riderRows }, { data: mu }] = await Promise.all([
      supabase.from('mbg_riders').select('id, rating, completed_rides, mode, vehicle_type, operator_type').eq('user_id', userId),
      supabase.from('mbg_users').select('active_vehicle_type').eq('id', userId).maybeSingle(),
    ]);

    const rows = riderRows || [];
    setAllVehicles(rows.map((r: any) => ({ vehicleType: r.vehicle_type, operatorType: r.operator_type })));

    if (rows.length === 0) {
      setActiveVehicleType(null);
      setStats({ earningsTodayUGX: 0, ridesDone: 0, rating: 0, mode: 'normal', vehicleType: null, operatorType: null });
      setLoading(false);
      return;
    }

    // Prefer mbg_users.active_vehicle_type; fall back to the only vehicle
    // they have (covers accounts from before this column was backfilled).
    const active = rows.find((r: any) => r.vehicle_type === mu?.active_vehicle_type) || rows[0];
    setActiveVehicleType(active.vehicle_type);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const { data: todaysRides } = await supabase
      .from('mbg_rides')
      .select('fare')
      .eq('rider_id', active.id)
      .eq('status', 'completed')
      .gte('completed_at', startOfToday.toISOString());

    const earningsTodayUGX = (todaysRides || []).reduce((sum, r: any) => sum + (Number(r.fare) || 0), 0);

    setStats({
      earningsTodayUGX,
      ridesDone: active.completed_rides || 0,
      rating: Number(active.rating) || 0,
      mode: active.mode || 'normal',
      vehicleType: active.vehicle_type || null,
      operatorType: active.operator_type || null,
    });
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { stats, loading, allVehicles, activeVehicleType, reload: load };
}

export default function RiderDashboard({ user, onSignOut }: RiderDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [quickStartOpen, setQuickStartOpen] = useState(false);
  const { stats: riderStats, loading: riderStatsLoading, allVehicles, activeVehicleType, reload: reloadRiderStats } = useRiderStats(user?.id);
  const [switchingVehicle, setSwitchingVehicle] = useState(false);

  useLiveLocationPing(user?.id);

  const switchVehicle = async (vehicleType: string) => {
    if (vehicleType === activeVehicleType || switchingVehicle) return;
    setSwitchingVehicle(true);
    try {
      const { data, error } = await supabase.rpc('mbg_switch_active_vehicle', { p_vehicle_type: vehicleType });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not switch vehicle');
      toast.success(`Switched to ${VEHICLE_TYPE_META[vehicleType]?.label || vehicleType} mode`);
      await reloadRiderStats();
    } catch (e: any) {
      toast.error(e.message || 'Failed to switch vehicle');
    } finally {
      setSwitchingVehicle(false);
    }
  };

  return (
    <div>
      {/* Content without header - header is in UnifiedDashboard */}
      
      {/* Navigation Tabs - Desktop Only */}
      <div className="hidden md:block bg-white border-b border-slate-200 sticky top-12 xs:top-14 sm:top-16 z-40">
        <div className="container mx-auto px-1 xs:px-2 sm:px-4">
          <div className="flex gap-0.5 overflow-x-auto scrollbar-hide">
            <TabButton
              active={activeTab === 'overview'}
              onClick={() => setActiveTab('overview')}
              icon={<TrendingUp size={14} className="xs:w-4 xs:h-4 sm:w-[18px] sm:h-[18px]" />}
              label="Overview"
            />
            <TabButton
              active={activeTab === 'requests'}
              onClick={() => setActiveTab('requests')}
              icon={<Bell size={14} className="xs:w-4 xs:h-4 sm:w-[18px] sm:h-[18px]" />}
              label="Requests"
            />
            <TabButton
              active={activeTab === 'mode'}
              onClick={() => setActiveTab('mode')}
              icon={<Settings size={14} className="xs:w-4 xs:h-4 sm:w-[18px] sm:h-[18px]" />}
              label="Work Mode"
            />
            <TabButton
              active={activeTab === 'locations'}
              onClick={() => setActiveTab('locations')}
              icon={<Map size={14} className="xs:w-4 xs:h-4 sm:w-[18px] sm:h-[18px]" />}
              label="Areas"
            />
            <TabButton
              active={activeTab === 'partnerships'}
              onClick={() => setActiveTab('partnerships')}
              icon={<ShoppingBag size={14} className="xs:w-4 xs:h-4 sm:w-[18px] sm:h-[18px]" />}
              label="Markets"
            />
          </div>
        </div>
      </div>

      {/* Mobile: Current Tab Indicator with Dropdown */}
      <div className="md:hidden bg-white border-b border-slate-200 sticky top-12 xs:top-14 z-40">
        <div className="container mx-auto px-2 xs:px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {activeTab === 'overview' && <><TrendingUp size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Overview</span></>}
            {activeTab === 'requests' && <><Bell size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Requests</span></>}
            {activeTab === 'mode' && <><Settings size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Work Mode</span></>}
            {activeTab === 'locations' && <><Map size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Areas</span></>}
            {activeTab === 'partnerships' && <><ShoppingBag size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Markets</span></>}
          </div>
          
          {/* Mobile Menu Button */}
          <button
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            {showMobileMenu ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>

        {/* Mobile Dropdown Menu */}
        {showMobileMenu && (
          <div className="absolute right-2 xs:right-3 top-14 bg-white rounded-lg shadow-xl py-2 min-w-[180px] xs:min-w-[200px] z-50">
            {/* Navigation Items */}
            <div className="py-1 border-b border-slate-200">
              <button
                onClick={() => {
                  setActiveTab('overview');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'overview' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <TrendingUp size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Overview</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('requests');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'requests' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Bell size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Requests</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('mode');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'mode' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Settings size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Work Mode</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('locations');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'locations' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Map size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Areas</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('partnerships');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'partnerships' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <ShoppingBag size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Markets</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('deliveries');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'deliveries' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Package size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Deliveries</span>
              </button>
            </div>

            {/* Profile */}
            <button
              onClick={() => {
                setShowMobileMenu(false);
                setShowProfileModal(true);
              }}
              className="w-full px-3 xs:px-4 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            >
              <User size={14} className="xs:w-4 xs:h-4" />
              <span className="text-xs xs:text-sm font-medium">My Profile</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-2 xs:px-3 sm:px-4 py-3 xs:py-4 sm:py-8">
        {activeTab === 'overview' && (
          <div className="space-y-4 sm:space-y-6">
            {/* Registered role — confirms which vehicle type this account
                was approved for, since the rest of this dashboard doesn't
                otherwise distinguish car/van/truck from a plain boda rider.
                When someone holds more than one vehicle (multi-vehicle —
                see ADD_MULTI_VEHICLE_SUPPORT.sql), this becomes a switcher
                instead of a passive label. */}
            {riderStats?.vehicleType && (() => {
              const meta = VEHICLE_TYPE_META[riderStats.vehicleType] || { label: riderStats.vehicleType, icon: Bike, use: '' };
              const Icon = meta.icon;

              if (allVehicles.length <= 1) {
                return (
                  <div className="bg-white rounded-lg xs:rounded-xl shadow-lg p-3 xs:p-4 flex items-center gap-3">
                    <div className="p-2 bg-orange-100 rounded-lg text-orange-600"><Icon size={20} /></div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">You're driving as: {meta.label}</p>
                      <p className="text-xs text-slate-500">{meta.use}{riderStats.operatorType === 'cargo' ? ' · Cargo operator' : ''}</p>
                    </div>
                  </div>
                );
              }

              return (
                <div className="bg-white rounded-lg xs:rounded-xl shadow-lg p-3 xs:p-4">
                  <p className="text-sm font-semibold text-slate-800 mb-2">Driving as:</p>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${allVehicles.length}, minmax(0, 1fr))` }}>
                    {allVehicles.map((v) => {
                      const vMeta = VEHICLE_TYPE_META[v.vehicleType] || { label: v.vehicleType, icon: Bike, use: '' };
                      const VIcon = vMeta.icon;
                      const isActive = v.vehicleType === activeVehicleType;
                      return (
                        <button
                          key={v.vehicleType}
                          onClick={() => switchVehicle(v.vehicleType)}
                          disabled={switchingVehicle}
                          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs sm:text-sm font-semibold border-2 transition-all disabled:opacity-50 ${
                            isActive ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
                          }`}
                        >
                          <VIcon size={14} /> {vMeta.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-500 mt-2">{meta.use}{riderStats.operatorType === 'cargo' ? ' · Cargo operator' : ''}</p>
                </div>
              );
            })()}

            {/* Working Time — online/offline slider */}
            <WorkingTimeToggle userId={user.id} vehicleType={activeVehicleType} />

            {/* Stats Cards — live from Supabase (mbg_riders / mbg_rides) */}
            <div className="grid grid-cols-2 xs:gap-3 gap-2 sm:grid-cols-4 sm:gap-6">
              <StatCard
                title="Today's Earnings"
                value={riderStatsLoading ? '…' : formatEarnings(riderStats?.earningsTodayUGX || 0)}
                icon={<DollarSign size={20} className="sm:w-6 sm:h-6" />}
                color="green"
              />
              <StatCard
                title="Rides Done"
                value={riderStatsLoading ? '…' : String(riderStats?.ridesDone ?? 0)}
                icon={<Bike size={20} className="sm:w-6 sm:h-6" />}
                color="blue"
              />
              <StatCard
                title="Rating"
                value={riderStatsLoading ? '…' : `${(riderStats?.rating ?? 0).toFixed(1)} ⭐`}
                icon={<TrendingUp size={20} className="sm:w-6 sm:h-6" />}
                color="yellow"
              />
              <StatCard
                title="Mode"
                value={riderStatsLoading ? '…' : (riderStats?.mode || 'normal').replace(/^\w/, c => c.toUpperCase())}
                icon={<Settings size={20} className="sm:w-6 sm:h-6" />}
                color="purple"
              />
            </div>

            {/* ICAN Wallet Earnings */}
            <RiderICANEarnings user={user} />

            {/* Quick Actions — collapsible, compact on small phones */}
            <div className="bg-white rounded-lg xs:rounded-xl shadow-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setQuickStartOpen(o => !o)}
                className="w-full flex items-center justify-between p-3 xs:p-4 sm:p-6"
              >
                <h3 className="text-sm xs:text-base sm:text-xl font-bold text-slate-800">Quick Start</h3>
                <ChevronDown
                  size={18}
                  className={`text-slate-400 transition-transform xs:w-5 xs:h-5 ${quickStartOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {quickStartOpen && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 xs:gap-3 sm:gap-4 px-3 xs:px-4 sm:px-6 pb-3 xs:pb-4 sm:pb-6">
                  <button
                    onClick={() => setActiveTab('requests')}
                    className="p-2.5 xs:p-3 sm:p-6 bg-gradient-to-br from-orange-100 to-yellow-100 rounded-lg xs:rounded-xl border-2 border-orange-300 hover:border-orange-400 transition-all text-left"
                  >
                    <Bell className="text-orange-600 mb-1 xs:mb-1.5 sm:mb-3" size={18} />
                    <h4 className="font-bold text-[11px] xs:text-xs sm:text-base text-slate-800 mb-0.5 sm:mb-1 leading-tight">Ride Requests</h4>
                    <p className="hidden xs:block text-[10px] sm:text-xs text-slate-600 leading-tight">Accept real requests near you</p>
                  </button>
                  <button
                    onClick={() => setActiveTab('mode')}
                    className="p-2.5 xs:p-3 sm:p-6 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg xs:rounded-xl border-2 border-purple-200 hover:border-purple-400 transition-all text-left"
                  >
                    <Settings className="text-purple-500 mb-1 xs:mb-1.5 sm:mb-3" size={18} />
                    <h4 className="font-bold text-[11px] xs:text-xs sm:text-base text-slate-800 mb-0.5 sm:mb-1 leading-tight">Set Work Mode</h4>
                    <p className="hidden xs:block text-[10px] sm:text-xs text-slate-600 leading-tight">VIP, Normal, Discount, or Return</p>
                  </button>
                  <button
                    onClick={() => setActiveTab('locations')}
                    className="p-2.5 xs:p-3 sm:p-6 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg xs:rounded-xl border-2 border-blue-200 hover:border-blue-400 transition-all text-left"
                  >
                    <Map className="text-blue-500 mb-1 xs:mb-1.5 sm:mb-3" size={18} />
                    <h4 className="font-bold text-[11px] xs:text-xs sm:text-base text-slate-800 mb-0.5 sm:mb-1 leading-tight">Manage Areas</h4>
                    <p className="hidden xs:block text-[10px] sm:text-xs text-slate-600 leading-tight">Mark locations you know well</p>
                  </button>
                  <button
                    onClick={() => setActiveTab('partnerships')}
                    className="p-2.5 xs:p-3 sm:p-6 bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg xs:rounded-xl border-2 border-orange-200 hover:border-orange-400 transition-all text-left"
                  >
                    <ShoppingBag className="text-orange-500 mb-1 xs:mb-1.5 sm:mb-3" size={18} />
                    <h4 className="font-bold text-[11px] xs:text-xs sm:text-base text-slate-800 mb-0.5 sm:mb-1 leading-tight">Partnerships</h4>
                    <p className="hidden xs:block text-[10px] sm:text-xs text-slate-600 leading-tight">Work for supermarkets</p>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'requests' && (
          <RiderRideRequests riderId={user.id} vehicleType={activeVehicleType} />
        )}

        {activeTab === 'mode' && (
          <RiderModeSelector riderId={user.id} vehicleType={activeVehicleType} />
        )}

        {activeTab === 'locations' && (
          <RiderLocationManager riderId={user.id} />
        )}

        {activeTab === 'partnerships' && (
          <SupermarketPartnership riderId={user.id} vehicleType={activeVehicleType} />
        )}

        {activeTab === 'deliveries' && (
          <SupermarketDeliveryPool user={user} />
        )}
      </div>

      {/* Profile Modal */}
      <ProfileModal
        user={user}
        userRole="rider"
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        onSaved={() => {
          // Optional: Reload rider data if needed
        }}
      />
    </div>
  );
}

function TabButton({ 
  active, 
  onClick, 
  icon, 
  label 
}: { 
  active: boolean; 
  onClick: () => void; 
  icon: React.ReactNode; 
  label: string; 
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 sm:gap-2 px-2 xs:px-2.5 sm:px-4 py-1.5 xs:py-2 sm:py-3 font-medium transition-all relative whitespace-nowrap text-[10px] xs:text-xs sm:text-sm ${
        active
          ? 'text-orange-500'
          : 'text-slate-600 hover:text-slate-800'
      }`}
    >
      {icon}
      <span className="hidden xs:inline">{label}</span>
      {active && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
      )}
    </button>
  );
}

function StatCard({ 
  title, 
  value, 
  icon, 
  color 
}: { 
  title: string; 
  value: string; 
  icon: React.ReactNode; 
  color: string; 
}) {
  return (
    <div className="bg-white rounded-lg xs:rounded-xl shadow-md p-2.5 xs:p-3 sm:p-6">
      <div className="flex items-center justify-between mb-1.5 xs:mb-2 sm:mb-3">
        <div className={`w-7 h-7 xs:w-8 xs:h-8 sm:w-12 sm:h-12 rounded-full bg-${color}-100 flex items-center justify-center text-${color}-600`}>
          {icon}
        </div>
      </div>
      <h4 className="text-[9px] xs:text-[10px] sm:text-sm text-slate-600 mb-0.5 truncate leading-tight">{title}</h4>
      <p className="text-base xs:text-lg sm:text-2xl font-bold text-slate-800 truncate">{value}</p>
    </div>
  );
}
