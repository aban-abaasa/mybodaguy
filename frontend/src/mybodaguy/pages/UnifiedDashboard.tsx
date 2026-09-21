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

interface UnifiedDashboardProps {
  user: any;
  onSignOut: () => void;
}

type RoleType = 'developer' | 'chairperson' | 'rider' | 'customer' | 'ican-wallet';

// Set this right before a reload to land on a specific role once, instead
// of whatever the hardcoded developer>chairperson>rider>customer priority
// would otherwise pick — see BecomeOperatorForm.tsx's "Open Driver
// Dashboard" button, which needs to guarantee landing on Rider even for an
// account that also holds a higher-priority role (e.g. chairperson) from
// unrelated earlier testing.
export const PREFERRED_ROLE_KEY = 'mbg_preferred_active_role';

export default function UnifiedDashboard({ user, onSignOut }: UnifiedDashboardProps) {
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [activeRole, setActiveRole] = useState<RoleType>('customer');
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
      if (requestedRole && roles.includes(requestedRole)) {
        setActiveRole(requestedRole as RoleType);
        return;
      }

      // Set active role based on priority: developer > chairperson > rider > customer
      // NOTE: Chairpersons are always also riders, so show chairperson first
      if (roles.includes('developer')) {
        setActiveRole('developer');
      } else if (roles.includes('chairperson')) {
        setActiveRole('chairperson');
        // Ensure rider role exists since all chairpersons must be riders
        if (!roles.includes('rider')) {
          console.warn('[UnifiedDashboard] Chairperson without rider role detected!');
        }
      } else if (roles.includes('rider')) {
        setActiveRole('rider');
      } else {
        setActiveRole('customer');
      }
    } catch (error) {
      console.error('[UnifiedDashboard] Error loading user roles:', error);
      toast.error('Failed to load user roles');
      setUserRoles(['customer']);
      setActiveRole('customer');
    } finally {
      setLoading(false);
    }
  };

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
        return <DeveloperDashboard user={user} onSignOut={onSignOut} onGoToWallet={() => setActiveRole('ican-wallet')} />;
      case 'chairperson':
        return <ChairpersonDashboard user={user} onSignOut={onSignOut} onGoToWallet={() => setActiveRole('ican-wallet')} />;
      case 'customer':
        return <CustomerDashboard user={user} onSignOut={onSignOut} onGoToWallet={() => setActiveRole('ican-wallet')} />;
    }
  }

  // User has multiple roles - show tabs
  return (
    <div className={`min-h-screen bg-gradient-to-br ${
      activeRole === 'developer' ? 'from-blue-50 to-indigo-50' :
      activeRole === 'chairperson' ? 'from-orange-50 to-yellow-50' :
      activeRole === 'rider' ? 'from-green-50 to-emerald-50' :
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
                  {getRoleLabel(activeRole)} Dashboard
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
                onClick={() => setActiveRole(role as RoleType)}
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
              onClick={() => setActiveRole('ican-wallet')}
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
        {activeRole === 'developer' && <DeveloperDashboard user={user} onSignOut={onSignOut} embedded onGoToWallet={() => setActiveRole('ican-wallet')} />}
        {activeRole === 'chairperson' && <ChairpersonDashboard user={user} onSignOut={onSignOut} onGoToWallet={() => setActiveRole('ican-wallet')} />}
        {activeRole === 'rider' && <RiderDashboard user={user} onSignOut={onSignOut} onGoToWallet={() => setActiveRole('ican-wallet')} />}
        {activeRole === 'customer' && <CustomerDashboard user={user} onSignOut={onSignOut} embedded onGoToWallet={() => setActiveRole('ican-wallet')} />}
        {activeRole === 'ican-wallet' && <ICANWalletPage user={user} />}
      </div>
      <ProfileModal
        user={user}
        userRole={activeRole === 'ican-wallet' ? (userRoles[0] || 'customer') : activeRole}
        userRoles={userRoles}
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        onSaved={loadAvatar}
      />
    </div>
  );
}
