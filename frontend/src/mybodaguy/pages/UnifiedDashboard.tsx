import { useState, useEffect, useRef } from 'react';
import { Bike, Users, Settings, ChevronRight, User, Menu, X, LogOut, Wallet } from 'lucide-react';
import { userService } from '../services/userService';
import { avatarService } from '../services/avatarService';
import { supabase } from '../../services/supabaseClient';
import ChairpersonDashboard from './ChairpersonDashboard';
import RiderDashboard from './RiderDashboard';
import DeveloperDashboard from './DeveloperDashboard';
import CustomerDashboard from './CustomerDashboard';
import ICANWalletPage from './ICANWalletPage';
import ProfileModal from '../components/ProfileModal';
import { ThemeToggle } from '../../components/ThemeToggle';
import { toast } from 'sonner';
import { consumePendingReferralCode } from '../services/referralService';
import { PhoneBackButton, type PhoneNav } from '../components/common/PhoneRoleNav';
import { useBackLayer, useBackDepth } from '../hooks/useBackLayer';

interface UnifiedDashboardProps {
  user: any;
  onSignOut: () => void;
}

// 'home' is the phone landing for accounts with more than one role: the header
// with every role tab and the Wallet, and cards below it. Each one opens as its
// own full page, and Back returns here.
type RoleType = 'developer' | 'chairperson' | 'rider' | 'customer' | 'ican-wallet' | 'home';

// developer > chairperson > rider > customer. Chairpersons are always also
// riders, so chairperson shows first.
const pickDefaultRole = (roles: string[]): RoleType =>
  roles.includes('developer') ? 'developer'
  : roles.includes('chairperson') ? 'chairperson'
  : roles.includes('rider') ? 'rider'
  : 'customer';

// Set this right before a reload to land on a specific role once, instead
// of whatever the hardcoded developer>chairperson>rider>customer priority
// would otherwise pick — see BecomeOperatorForm.tsx's "Open Driver
// Dashboard" button, which needs to guarantee landing on Rider even for an
// account that also holds a higher-priority role (e.g. chairperson) from
// unrelated earlier testing.
export const PREFERRED_ROLE_KEY = 'mbg_preferred_active_role';

// What each card on the phone home screen says (the label itself comes from getRoleLabel).
const ROLE_CARD: Record<string, { icon: typeof Bike; blurb: string }> = {
  developer: { icon: Settings, blurb: 'Users, regions, applications and platform settings' },
  chairperson: { icon: Users, blurb: 'Your committee, riders and commissions' },
  rider: { icon: Bike, blurb: 'Ride requests, areas and earnings' },
  customer: { icon: User, blurb: 'Book rides and deliveries, shop and pay' },
  'ican-wallet': { icon: Wallet, blurb: 'Balance, send, receive and pay' },
};

// Phone-width viewport (below Tailwind's `sm`), tracked live so rotating a
// phone or resizing a window switches layouts without a reload.
function useIsPhone() {
  const query = '(max-width: 639px)';
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setIsPhone(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isPhone;
}

export default function UnifiedDashboard({ user, onSignOut }: UnifiedDashboardProps) {
  const isPhone = useIsPhone();
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [activeRole, setActiveRole] = useState<RoleType>('customer');
  // Roles the user has moved through, newest last — what the phone Back arrow
  // returns to. Moving to the role on top of the trail counts as going back, so
  // Customer → Rider → Customer doesn't pile up entries.
  const [roleTrail, setRoleTrail] = useState<RoleType[]>([]);
  const [loading, setLoading] = useState(true);
  // 'rider' is one role_type/user_roles value for both boda riders
  // (motorcycle/bicycle/tuktuk) and car/van/truck operators approved via
  // "Become a Driver" — the tab label distinguishes them without needing a
  // separate role at the data-model level.
  const [riderVehicleType, setRiderVehicleType] = useState<string | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadUserRoles();
    loadAvatar();
  }, [user]);

  // Redeem a referral code picked up from a shared ?ref= link. A no-op unless
  // one is pending; the server decides eligibility (must be before the
  // account's first ICAN deposit) and pays the referrer later, on that deposit.
  useEffect(() => {
    if (!user?.id) return;
    consumePendingReferralCode()
      .then((res) => {
        if (res.applied) toast.success(`🎉 You joined through ${res.referrerName}'s invite!`);
        else if (res.message) toast.info(res.message);
      })
      .catch((e) => console.warn('[UnifiedDashboard] Referral redeem failed (will retry next load):', e));
  }, [user?.id]);

  const loadAvatar = async () => {
    try {
      setAvatarUrl(await avatarService.getAvatarUrl(user.id));
    } catch (error) {
      console.error('[UnifiedDashboard] Error loading avatar:', error);
    }
  };

  // Close the account menu on an outside click
  useEffect(() => {
    if (!showAccountMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAccountMenu]);

  const loadUserRoles = async () => {
    setLoading(true);
    try {
      const roles = await userService.getUserRoles(user.id);
      console.log('[UnifiedDashboard] User roles:', roles);
      setUserRoles(roles);

      if (roles.includes('rider')) {
        // Read the account-level pointer, not mbg_riders directly — since
        // multi-vehicle support (ADD_MULTI_VEHICLE_SUPPORT.sql) a person can
        // hold more than one mbg_riders row, so a plain
        // .eq('user_id', ...).maybeSingle() would throw once they do.
        const { data: mu } = await supabase.from('mbg_users').select('active_vehicle_type').eq('id', user.id).maybeSingle();
        setRiderVehicleType(mu?.active_vehicle_type ?? null);
      }

      // A caller can request landing on a specific role after a reload
      // (see BecomeOperatorForm.tsx's "Open Driver Dashboard" button) —
      // otherwise the hardcoded priority below always wins, e.g. a newly
      // approved rider who is ALSO a chairperson from unrelated earlier
      // testing would always land back on Chairperson, never Rider.
      const requestedRole = sessionStorage.getItem(PREFERRED_ROLE_KEY);
      sessionStorage.removeItem(PREFERRED_ROLE_KEY);
      // On a phone, a multi-role account lands on the home screen (header with
      // every role + Wallet); a requested role opens straight from it, so Back still has somewhere to go.
      const phoneHub = isPhone && roles.length > 1;
      if (requestedRole && roles.includes(requestedRole)) {
        setActiveRole(requestedRole as RoleType);
        setRoleTrail(phoneHub ? ['home'] : []);
        return;
      }

      if (roles.includes('chairperson') && !roles.includes('rider')) {
        // Ensure rider role exists since all chairpersons must be riders
        console.warn('[UnifiedDashboard] Chairperson without rider role detected!');
      }
      setRoleTrail([]);
      setActiveRole(phoneHub ? 'home' : pickDefaultRole(roles));
    } catch (error) {
      console.error('[UnifiedDashboard] Error loading user roles:', error);
      toast.error('Failed to load user roles');
      setUserRoles(['customer']);
      setActiveRole('customer');
    } finally {
      setLoading(false);
    }
  };

  // The home screen only exists on phones — on a wider screen fall back to the usual default role.
  useEffect(() => {
    if (!isPhone && !loading && activeRole === 'home') setActiveRole(pickDefaultRole(userRoles));
  }, [isPhone, loading, activeRole, userRoles]);

  const goToRole = (next: RoleType) => {
    if (next === activeRole) return;
    setRoleTrail((trail) => (trail[trail.length - 1] === next ? trail.slice(0, -1) : [...trail, activeRole]));
    setActiveRole(next);
  };

  const goBackRole = () => {
    const prev = roleTrail[roleTrail.length - 1];
    if (!prev) return;
    setRoleTrail(roleTrail.slice(0, -1));
    setActiveRole(prev);
  };

  // Phone/browser Back walks the role trail (Wallet → Rider → Customer…) one step at a time.
  useBackDepth(roleTrail.length, goBackRole);
  useBackLayer(showAccountMenu, () => setShowAccountMenu(false));

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'developer': return 'Developer';
      case 'chairperson': return 'Chairperson';
      case 'rider':
        if (riderVehicleType === 'car') return 'Car Driver';
        if (riderVehicleType === 'van') return 'Van Driver';
        if (riderVehicleType === 'truck') return 'Truck Driver';
        return 'Rider';
      case 'customer': return 'Customer';
      case 'ican-wallet': return '₡ Wallet';
      case 'home': return 'Home';
      default: return role;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'developer':
        return 'from-blue-500 to-indigo-500';
      case 'chairperson':
        return 'from-orange-500 to-yellow-500';
      case 'rider':
        return 'from-green-500 to-emerald-500';
      case 'customer':
        return 'from-purple-500 to-pink-500';
      case 'home':
        return 'from-orange-500 to-yellow-500';
      default:
        return 'from-slate-500 to-gray-500';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-600">Loading your dashboards...</p>
        </div>
      </div>
    );
  }

  // If user has only one role, render that dashboard directly without tabs
  // — except 'rider': RiderDashboard.tsx has no header of its own at all
  // (it's only ever meant to be wrapped by the header below), and except
  // 'ican-wallet': that's not a real role, just where the wallet button
  // above sends a single-role user, and this fast path has no tab bar to
  // get back with — so it falls through to the full header treatment below
  // instead, same as 'rider' does.
  if (userRoles.length === 1 && activeRole !== 'rider' && activeRole !== 'ican-wallet') {
    switch (activeRole) {
      case 'developer':
        return <DeveloperDashboard user={user} onSignOut={onSignOut} onGoToWallet={() => goToRole('ican-wallet')} />;
      case 'chairperson':
        return <ChairpersonDashboard user={user} onSignOut={onSignOut} onGoToWallet={() => goToRole('ican-wallet')} />;
      case 'customer':
        return <CustomerDashboard user={user} onSignOut={onSignOut} onGoToWallet={() => goToRole('ican-wallet')} />;
    }
  }

  // Phones: Customer, Rider, Chairperson and the Wallet take the whole screen.
  // The shared brand header + role-tab strip would cost ~90px of a small
  // viewport on top of each dashboard's own section bar and bottom tabs, so
  // they render alone; Back, "Switch role" and Sign Out live in their own bar
  // and Menu instead (PhoneRoleNav.tsx). Developer keeps the header + tabs.
  if (isPhone && (activeRole === 'customer' || activeRole === 'rider' || activeRole === 'chairperson' || activeRole === 'ican-wallet')) {
    const phoneNav: PhoneNav = {
      // 'Home' returns to the header with every role + Wallet.
      roles: [
        ...(userRoles.length > 1 ? [{ id: 'home', label: 'All roles' }] : []),
        ...userRoles.filter((r) => r !== activeRole).map((r) => ({ id: r, label: getRoleLabel(r) })),
      ],
      onSwitchRole: (r) => goToRole(r as RoleType),
      onBackToRole: roleTrail.length > 0 ? goBackRole : undefined,
      onSignOut,
    };
    const toWallet = () => goToRole('ican-wallet');

    if (activeRole === 'ican-wallet') {
      // The wallet isn't a role, so Back always has somewhere to go.
      const fromWallet = roleTrail.length > 0 ? goBackRole : () => setActiveRole((userRoles[0] || 'customer') as RoleType);
      return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50">
          <header className="safe-top sticky top-0 z-40 border-b border-[#c4a052]/25 bg-white shadow-md dark:border-slate-700">
            <div className="flex h-12 items-center gap-2 px-4">
              <PhoneBackButton nav={{ ...phoneNav, onBackToRole: fromWallet }} atHome onHome={fromWallet} />
              <Wallet size={17} className="flex-shrink-0 text-violet-600" />
              <h1 className="font-classic-display truncate text-[18px] font-semibold leading-none text-slate-800">ICAN Wallet</h1>
            </div>
          </header>
          <ICANWalletPage user={user} />
        </div>
      );
    }
    if (activeRole === 'rider') return <RiderDashboard user={user} onSignOut={onSignOut} phoneNav={phoneNav} onGoToWallet={toWallet} />;
    if (activeRole === 'chairperson') return <ChairpersonDashboard user={user} onSignOut={onSignOut} phoneNav={phoneNav} onGoToWallet={toWallet} />;
    return <CustomerDashboard user={user} onSignOut={onSignOut} phoneNav={phoneNav} onGoToWallet={toWallet} />;
  }

  // User has multiple roles - show tabs
  return (
    <div className={`min-h-screen bg-gradient-to-br ${
      activeRole === 'developer' ? 'from-blue-50 to-indigo-50' :
      activeRole === 'chairperson' ? 'from-orange-50 to-yellow-50' :
      activeRole === 'rider' ? 'from-green-50 to-emerald-50' :
      activeRole === 'home' ? 'from-orange-50 to-yellow-50' :
      'from-purple-50 to-pink-50'
    }`}>
      {/* Unified Header with Role Tabs */}
      <header className={`bg-gradient-to-r ${getRoleColor(activeRole)} text-white shadow-lg sticky top-0 z-50`}>
        <div className="container mx-auto px-2 xs:px-3 sm:px-4">
          <div className="flex items-center justify-between h-12 xs:h-14 sm:h-16">
            {/* Left: Logo */}
            <div className="flex items-center gap-1.5 xs:gap-2 sm:gap-3">
              <Bike size={18} className="xs:w-5 xs:h-5 sm:w-7 sm:h-7" />
              <div>
                <h1 className="text-sm xs:text-base sm:text-xl font-bold leading-tight">BodaGoEra</h1>
                <p className="text-[9px] xs:text-[10px] sm:text-xs opacity-90 hidden xs:block">
                  {activeRole === 'home' ? 'Choose where to go' : `${getRoleLabel(activeRole)} Dashboard`}
                </p>
              </div>
            </div>

            {/* Right: Theme toggle + Profile Avatar Menu */}
            <div className="flex items-center gap-1.5 xs:gap-2">
              <ThemeToggle className="!bg-white/20 hover:!bg-white/30 !text-white w-8 h-8 xs:w-9 xs:h-9" />
              <div className="relative" ref={accountMenuRef}>
                <button
                  onClick={() => setShowAccountMenu((prev) => !prev)}
                  className="flex items-center justify-center w-8 h-8 xs:w-9 xs:h-9 rounded-full bg-white/90 text-slate-800 font-bold text-xs xs:text-sm hover:bg-white transition-colors flex-shrink-0 overflow-hidden"
                  title={user.email}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    (user.email || '?').charAt(0).toUpperCase()
                  )}
                </button>

                {showAccountMenu && (
                <div className="absolute right-0 top-full mt-2 bg-white rounded-lg shadow-xl py-2 min-w-[220px] z-50 text-slate-800">
                  <div className="px-4 py-2 border-b border-slate-200">
                    <p className="text-xs text-slate-500">Signed in as</p>
                    <p className="text-sm font-medium truncate">{user.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowAccountMenu(false);
                      setShowProfileModal(true);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
                  >
                    <User size={16} />
                    <span className="text-sm font-medium">My Profile</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowAccountMenu(false);
                      onSignOut();
                    }}
                    className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <LogOut size={16} />
                    <span className="text-sm font-medium">Sign Out</span>
                  </button>
                </div>
                )}
              </div>
            </div>
          </div>

          {/* Role Tabs - Clean Functional Interface */}
          <div className="flex gap-1 pb-2 overflow-x-auto scrollbar-hide">
            {userRoles.map((role) => (
              <button
                key={role}
                onClick={() => goToRole(role as RoleType)}
                className={`px-3 xs:px-4 py-1.5 xs:py-2 text-xs xs:text-sm font-medium transition-all whitespace-nowrap ${
                  activeRole === role
                    ? 'text-white border-b-2 border-white'
                    : 'text-white/70 hover:text-white/90'
                }`}
              >
                {getRoleLabel(role)}
              </button>
            ))}
            {/* ICAN Wallet — always visible for all roles */}
            <button
              onClick={() => goToRole('ican-wallet')}
              className={`flex items-center gap-1 px-3 xs:px-4 py-1.5 xs:py-2 text-xs xs:text-sm font-medium transition-all whitespace-nowrap ml-auto ${
                activeRole === 'ican-wallet'
                  ? 'text-white border-b-2 border-white'
                  : 'text-white/70 hover:text-white/90'
              }`}
            >
              <Wallet size={14} />
              ₡ Wallet
            </button>
          </div>
        </div>
      </header>

      {/* Dashboard Content - Render active role's dashboard WITHOUT its own header */}
      <div className="dashboard-content">
        {activeRole === 'developer' && <DeveloperDashboard user={user} onSignOut={onSignOut} embedded onGoToWallet={() => goToRole('ican-wallet')} />}
        {activeRole === 'chairperson' && <ChairpersonDashboard user={user} onSignOut={onSignOut} onGoToWallet={() => goToRole('ican-wallet')} />}
        {activeRole === 'rider' && <RiderDashboard user={user} onSignOut={onSignOut} onGoToWallet={() => goToRole('ican-wallet')} />}
        {activeRole === 'customer' && <CustomerDashboard user={user} onSignOut={onSignOut} embedded onGoToWallet={() => goToRole('ican-wallet')} />}
        {activeRole === 'ican-wallet' && <ICANWalletPage user={user} />}
        {activeRole === 'home' && (
          <div className="container mx-auto space-y-3 px-4 pb-10 pt-5">
            <p className="font-classic-display text-xl font-semibold text-slate-800">Where to?</p>
            {[
              ...userRoles.map((r) => ({ id: r, ...ROLE_CARD[r] })),
              { id: 'ican-wallet', ...ROLE_CARD['ican-wallet'] },
            ].filter((c) => c.icon).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => goToRole(c.id as RoleType)}
                className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-inset ring-[#c4a052]/25 transition-transform active:scale-[0.99]"
              >
                <span className={`grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br text-white shadow-md ${getRoleColor(c.id)}`}>
                  <c.icon size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-classic-display text-lg font-semibold leading-tight text-slate-800">{getRoleLabel(c.id)}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{c.blurb}</span>
                </span>
                <ChevronRight size={20} className="flex-shrink-0 text-slate-300" />
              </button>
            ))}
          </div>
        )}
      </div>
      <ProfileModal
        user={user}
        userRole={activeRole === 'ican-wallet' || activeRole === 'home' ? (userRoles[0] || 'customer') : activeRole}
        userRoles={userRoles}
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        onSaved={loadAvatar}
      />
    </div>
  );
}
