import { useState, useEffect } from 'react';
import { Bike, Users, Settings, ChevronRight, User, Menu, X, LogOut, Wallet } from 'lucide-react';
import { userService } from '../services/userService';
import ChairpersonDashboard from './ChairpersonDashboard';
import RiderDashboard from './RiderDashboard';
import DeveloperDashboard from './DeveloperDashboard';
import CustomerDashboard from './CustomerDashboard';
import ICANWalletPage from './ICANWalletPage';
import { toast } from 'sonner';

interface UnifiedDashboardProps {
  user: any;
  onSignOut: () => void;
}

type RoleType = 'developer' | 'chairperson' | 'rider' | 'customer' | 'ican-wallet';

export default function UnifiedDashboard({ user, onSignOut }: UnifiedDashboardProps) {
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [activeRole, setActiveRole] = useState<RoleType>('customer');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUserRoles();
  }, [user]);

  const loadUserRoles = async () => {
    setLoading(true);
    try {
      const roles = await userService.getUserRoles(user.id);
      console.log('[UnifiedDashboard] User roles:', roles);
      setUserRoles(roles);
      
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
      case 'rider': return 'Rider';
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
  if (userRoles.length === 1) {
    switch (activeRole) {
      case 'developer':
        return <DeveloperDashboard user={user} onSignOut={onSignOut} />;
      case 'chairperson':
        return <ChairpersonDashboard user={user} onSignOut={onSignOut} />;
      case 'rider':
        return <RiderDashboard user={user} onSignOut={onSignOut} />;
      case 'customer':
        return <CustomerDashboard user={user} onSignOut={onSignOut} />;
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
                <h1 className="text-sm xs:text-base sm:text-xl font-bold leading-tight">My Boda Guy</h1>
                <p className="text-[9px] xs:text-[10px] sm:text-xs opacity-90 hidden xs:block">
                  {getRoleLabel(activeRole)} Dashboard
                </p>
              </div>
            </div>

            {/* Right: Profile & Sign Out */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Desktop View */}
              <div className="hidden md:flex items-center gap-2 bg-white/20 px-3 py-1 rounded-full">
                <span className="text-sm font-medium truncate max-w-[150px]">{user.email}</span>
              </div>
              <button
                onClick={onSignOut}
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
              >
                <LogOut size={18} />
                <span>Sign Out</span>
              </button>

              {/* Mobile View - Sign Out Button */}
              <button
                onClick={onSignOut}
                className="md:hidden p-1.5 xs:p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
              >
                <LogOut size={18} className="xs:w-5 xs:h-5" />
              </button>
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
        {activeRole === 'developer' && <DeveloperDashboard user={user} onSignOut={onSignOut} />}
        {activeRole === 'chairperson' && <ChairpersonDashboard user={user} onSignOut={onSignOut} />}
        {activeRole === 'rider' && <RiderDashboard user={user} onSignOut={onSignOut} />}
        {activeRole === 'customer' && <CustomerDashboard user={user} onSignOut={onSignOut} />}
        {activeRole === 'ican-wallet' && <ICANWalletPage user={user} />}
      </div>
    </div>
  );
}
