import { useState, useEffect } from 'react';
import { Bike, Users, DollarSign, MapPin, LogOut, UserPlus, ChevronRight, TrendingUp, User, X, Check, Search, Calendar, CreditCard, Menu, BarChart3, Settings } from 'lucide-react';
import { chairpersonService, SubordinateChairperson, CommitteeMember } from '../services/chairpersonService';
import { riderService, Rider } from '../services/riderService';
import { supabase } from '../services/supabaseClient';
import { userService } from '../services/userService';
import ProfileModal from '../components/ProfileModal';
import IcanCoinCard from '../components/IcanCoinCard';
import { toast } from 'sonner';

interface ChairpersonDashboardProps {
  user: any;
  onSignOut: () => void;
}

type TabType = 'overview' | 'subordinates' | 'riders' | 'commission';

export default function ChairpersonDashboard({ user, onSignOut }: ChairpersonDashboardProps) {
  const [myCommitteeInfo, setMyCommitteeInfo] = useState<CommitteeMember | null>(null);
  const [allAssignments, setAllAssignments] = useState<CommitteeMember[]>([]);
  const [subordinates, setSubordinates] = useState<SubordinateChairperson[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showAssignRiderModal, setShowAssignRiderModal] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<CommitteeMember | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [stats, setStats] = useState({
    totalSubordinates: 0,
    activeSubordinates: 0,
    totalCommission: 0,
    monthlyRides: 0,
    totalAssignments: 0
  });

  useEffect(() => {
    loadDashboardData();
  }, [user]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      // Load ALL committee assignments for this user
      const assignments = await chairpersonService.getAllMyCommitteeAssignments(user.id);
      console.log('[ChairpersonDashboard] All assignments:', assignments);
      
      setAllAssignments(assignments);
      
      // If no assignments exist, try auto-setup
      if (assignments.length === 0) {
        console.log('[ChairpersonDashboard] No committee assignments found, auto-setting up...');
        const { data: setupResult, error: setupError } = await supabase
          .rpc('auto_setup_chairperson', { target_user_id: user.id });
        
        if (setupError) {
          console.error('[ChairpersonDashboard] Auto-setup error:', setupError);
        } else if (setupResult?.success) {
          console.log('[ChairpersonDashboard] Auto-setup successful, reloading...');
          // Reload assignments after setup
          const newAssignments = await chairpersonService.getAllMyCommitteeAssignments(user.id);
          setAllAssignments(newAssignments);
          if (newAssignments.length > 0) {
            setMyCommitteeInfo(newAssignments[0]);
            setSelectedAssignment(newAssignments[0]);
          }
        }
      } else {
        // Service already returns levels sorted highest→lowest and fills any gaps.
        setAllAssignments(assignments);
        setMyCommitteeInfo(assignments[0]);     // index 0 = highest level
        setSelectedAssignment(assignments[0]);
      }

      // Load subordinates for ALL assignments
      const allSubordinates = await chairpersonService.getSubordinates(user.id);
      setSubordinates(allSubordinates);

      // Load riders from ALL stage assignments
      const allRiders: Rider[] = [];
      for (const assignment of assignments) {
        if (assignment.region_type === 'stage') {
          const stageRiders = await riderService.getStageRiders(assignment.region_id);
          allRiders.push(...stageRiders);
        }
      }
      setRiders(allRiders);

      // Calculate stats
      const activeSubs = allSubordinates.filter(s => s.is_active);
      const activeRiders = allRiders.filter(r => r.status === 'active');
      const avgCommission = assignments.length > 0
        ? assignments.reduce((sum, a) => sum + (a.commission_rate || 0), 0) / assignments.length
        : 0;
      
      setStats({
        totalSubordinates: allSubordinates.length,
        activeSubordinates: activeSubs.length,
        totalCommission: avgCommission,
        monthlyRides: activeRiders.reduce((sum, r) => sum + (r.total_rides || 0), 0),
        totalAssignments: assignments.length
      });
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatRole = (role: string) => {
    return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const formatRegionType = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
          <p className="mt-4 text-slate-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!myCommitteeInfo) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-lg sticky top-0 z-50">
          <div className="container mx-auto px-2 xs:px-3 sm:px-4">
            <div className="flex items-center justify-between h-12 xs:h-14 sm:h-16">
              <div className="flex items-center gap-1.5 xs:gap-2 sm:gap-3">
                <Bike size={18} className="xs:w-5 xs:h-5 sm:w-7 sm:h-7" />
                <div>
                  <h1 className="text-sm xs:text-base sm:text-xl font-bold leading-tight">BodaGoEra</h1>
                  <p className="text-[9px] xs:text-[10px] sm:text-xs opacity-90 hidden xs:block">Chairperson Dashboard</p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                {/* Desktop View */}
                <button
                  onClick={() => setShowProfileModal(true)}
                  className="hidden md:flex w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 items-center justify-center transition-colors"
                  title="Edit Profile"
                >
                  <User size={20} />
                </button>
                <button
                  onClick={onSignOut}
                  className="hidden md:flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                >
                  <LogOut size={18} />
                  <span>Sign Out</span>
                </button>

                {/* Mobile View - 3 Dots Menu */}
                <button
                  onClick={() => setShowMobileMenu(!showMobileMenu)}
                  className="md:hidden p-1.5 xs:p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                >
                  {showMobileMenu ? <X size={18} className="xs:w-5 xs:h-5" /> : <Menu size={18} className="xs:w-5 xs:h-5" />}
                </button>
              </div>
            </div>

            {/* Mobile Dropdown Menu */}
            {showMobileMenu && (
              <div className="md:hidden absolute right-2 xs:right-3 top-14 xs:top-16 bg-white rounded-lg shadow-xl py-2 min-w-[180px] xs:min-w-[200px] z-50">
                <div className="px-3 xs:px-4 py-2 border-b border-slate-200">
                  <p className="text-[9px] xs:text-xs text-slate-500">Logged in as</p>
                  <p className="text-xs xs:text-sm font-medium text-slate-800 truncate">{user.email}</p>
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
                
                {/* Sign Out */}
                <button
                  onClick={() => {
                    setShowMobileMenu(false);
                    onSignOut();
                  }}
                  className="w-full px-3 xs:px-4 py-2 text-left text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <LogOut size={14} className="xs:w-4 xs:h-4" />
                  <span className="text-xs xs:text-sm font-medium">Sign Out</span>
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="container mx-auto px-4 py-8">
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <Users className="w-16 h-16 text-orange-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-800 mb-2">No Chairperson Assignment</h2>
            <p className="text-slate-600">You haven't been assigned as a chairperson yet.</p>
            <p className="text-sm text-slate-500 mt-2">Contact your administrator for assistance.</p>
          </div>
        </div>

        {/* Profile Modal */}
        <ProfileModal
          user={user}
          userRole="chairperson"
          isOpen={showProfileModal}
          onClose={() => setShowProfileModal(false)}
          onSaved={() => {
            loadDashboardData();
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
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
              active={activeTab === 'subordinates'}
              onClick={() => setActiveTab('subordinates')}
              icon={<Users size={14} className="xs:w-4 xs:h-4 sm:w-[18px] sm:h-[18px]" />}
              label="Chairpersons"
            />
            {allAssignments.some(a => a.region_type === 'stage') && (
              <TabButton
                active={activeTab === 'riders'}
                onClick={() => setActiveTab('riders')}
                icon={<Bike size={14} className="xs:w-4 xs:h-4 sm:w-[18px] sm:h-[18px]" />}
                label="Riders"
              />
            )}
            <TabButton
              active={activeTab === 'commission'}
              onClick={() => setActiveTab('commission')}
              icon={<DollarSign size={14} className="xs:w-4 xs:h-4 sm:w-[18px] sm:h-[18px]" />}
              label="Commission"
            />
          </div>
        </div>
      </div>

      {/* Mobile: Current Tab Indicator with Dropdown */}
      <div className="md:hidden bg-white border-b border-slate-200 sticky top-12 xs:top-14 z-40">
        <div className="container mx-auto px-2 xs:px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {activeTab === 'overview' && <><TrendingUp size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Overview</span></>}
            {activeTab === 'subordinates' && <><Users size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Chairpersons</span></>}
            {activeTab === 'riders' && <><Bike size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Riders</span></>}
            {activeTab === 'commission' && <><DollarSign size={16} className="text-orange-500" /><span className="text-sm font-medium text-slate-800">Commission</span></>}
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
                  setActiveTab('subordinates');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'subordinates' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Users size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Chairpersons</span>
              </button>
              {allAssignments.some(a => a.region_type === 'stage') && (
                <button
                  onClick={() => {
                    setActiveTab('riders');
                    setShowMobileMenu(false);
                  }}
                  className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                    activeTab === 'riders' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Bike size={14} className="xs:w-4 xs:h-4" />
                  <span className="text-xs xs:text-sm font-medium">Riders</span>
                </button>
              )}
              <button
                onClick={() => {
                  setActiveTab('commission');
                  setShowMobileMenu(false);
                }}
                className={`w-full px-3 xs:px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                  activeTab === 'commission' ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <DollarSign size={14} className="xs:w-4 xs:h-4" />
                <span className="text-xs xs:text-sm font-medium">Commission</span>
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

      <div className="container mx-auto px-2 xs:px-3 sm:px-4 py-2 xs:py-3 sm:py-4">
        {/* Tab Content */}
        {activeTab === 'overview' && (
          <>
            {/* Enhanced Welcome Section with Gradient */}
            <div className="bg-gradient-to-br from-orange-500 via-orange-400 to-yellow-400 rounded-2xl shadow-xl p-4 sm:p-5 mb-4 text-white overflow-hidden relative">
              {/* Decorative Background Pattern */}
              <div className="absolute top-0 right-0 opacity-10">
                <Bike size={200} className="transform rotate-12" />
              </div>
              
              <div className="relative z-10">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold mb-1">
                      Welcome Back! 👋
                    </h2>
                    <p className="text-white/90 text-xs sm:text-sm">
                      Here's your chairperson dashboard overview
                    </p>
                  </div>
                  <div className="hidden sm:block bg-white/20 backdrop-blur-sm rounded-xl px-3 py-2">
                    <Calendar size={18} />
                  </div>
                </div>

                {/* Quick Stats Row */}
                <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
                  <div className="bg-white/20 backdrop-blur-sm rounded-xl p-2 sm:p-3">
                    <MapPin size={16} className="mb-1" />
                    <p className="text-lg sm:text-xl font-bold">{allAssignments.length}</p>
                    <p className="text-[9px] sm:text-[10px] text-white/80">Active Role{allAssignments.length !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-xl p-2 sm:p-3">
                    <Users size={16} className="mb-1" />
                    <p className="text-lg sm:text-xl font-bold">{stats.totalSubordinates}</p>
                    <p className="text-[9px] sm:text-[10px] text-white/80">Chairpersons</p>
                  </div>
                  {riders.length > 0 && (
                    <div className="bg-white/20 backdrop-blur-sm rounded-xl p-2 sm:p-3">
                      <Bike size={16} className="mb-1" />
                      <p className="text-lg sm:text-xl font-bold">{riders.length}</p>
                      <p className="text-[9px] sm:text-[10px] text-white/80">Riders</p>
                    </div>
                  )}
                </div>

                {/* Enhanced Role Selector */}
                <div className="bg-white/15 backdrop-blur-md rounded-xl p-3 border border-white/20">
                  <label className="block text-xs font-semibold text-white mb-1.5 flex items-center gap-2">
                    <Settings size={14} />
                    Active Role
                  </label>
                  <select
                    value={selectedAssignment?.id || ''}
                    onChange={(e) => {
                      const assignment = allAssignments.find(a => a.id === e.target.value);
                      if (assignment) {
                        setSelectedAssignment(assignment);
                        setMyCommitteeInfo(assignment);
                        if (assignment.region_type === 'stage') {
                          setActiveTab('riders');
                        }
                      }
                    }}
                    className="w-full px-3 py-2 border-0 rounded-xl focus:ring-2 focus:ring-white/50 bg-white/90 text-slate-800 font-medium shadow-sm backdrop-blur-sm text-sm"
                  >
                    {allAssignments.map((assignment, idx) => {
                      const isTop     = idx === 0;
                      const isVirtual = assignment.id.startsWith('virtual-');
                      const prefix    = isTop ? '⭐ ' : '└ ';
                      const suffix    = isVirtual ? ' (access via top role)' : '';
                      return (
                        <option key={assignment.id} value={assignment.id}>
                          {prefix}{formatRole(assignment.role)}{suffix}
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-[10px] text-white/70 mt-1.5 flex items-center gap-1">
                    <span>💡</span>
                    Select a role to manage its subordinates and riders
                  </p>
                </div>
              </div>
            </div>

            {/* Enhanced Stats Grid with Modern Design */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 mb-4">
              {/* Total Assignments Card */}
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-1.5 text-white transform transition-all hover:scale-105 hover:shadow-xl">
                <div className="flex flex-col items-center text-center">
                  <div className="bg-white/20 backdrop-blur-sm p-1 rounded-lg mb-0.5">
                    <MapPin size={14} />
                  </div>
                  <p className="text-white/80 text-[10px] font-medium">My Roles</p>
                  <p className="text-2xl sm:text-3xl font-bold leading-none">{stats.totalAssignments}</p>
                  <p className="text-[9px] text-white/70">Active</p>
                </div>
              </div>

              {/* Total Subordinates Card */}
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-1.5 text-white transform transition-all hover:scale-105 hover:shadow-xl">
                <div className="flex flex-col items-center text-center">
                  <div className="bg-white/20 backdrop-blur-sm p-1 rounded-lg mb-0.5">
                    <Users size={14} />
                  </div>
                  <p className="text-white/80 text-[10px] font-medium">Total</p>
                  <p className="text-2xl sm:text-3xl font-bold leading-none">{stats.totalSubordinates}</p>
                  <div className="flex items-center gap-1 text-[9px] text-white/70">
                    <span className="w-1 h-1 bg-green-300 rounded-full"></span>
                    <span>{stats.activeSubordinates}</span>
                  </div>
                </div>
              </div>

              {/* Commission Rate Card */}
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl shadow-lg p-1.5 text-white transform transition-all hover:scale-105 hover:shadow-xl">
                <div className="flex flex-col items-center text-center">
                  <div className="bg-white/20 backdrop-blur-sm p-1 rounded-lg mb-0.5">
                    <DollarSign size={14} />
                  </div>
                  <p className="text-white/80 text-[10px] font-medium">Commission</p>
                  <p className="text-2xl sm:text-3xl font-bold leading-none">{stats.totalCommission.toFixed(1)}%</p>
                  <p className="text-[9px] text-white/70">Avg rate</p>
                </div>
              </div>

              {/* Monthly Rides Card */}
              <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl shadow-lg p-1.5 text-white transform transition-all hover:scale-105 hover:shadow-xl">
                <div className="flex flex-col items-center text-center">
                  <div className="bg-white/20 backdrop-blur-sm p-1 rounded-lg mb-0.5">
                    <Bike size={14} />
                  </div>
                  <p className="text-white/80 text-[10px] font-medium">Rides</p>
                  <p className="text-2xl sm:text-3xl font-bold leading-none">{stats.monthlyRides}</p>
                  <p className="text-[9px] text-white/70">Monthly</p>
                </div>
              </div>

              {/* Active Status Card */}
              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-1.5 text-white transform transition-all hover:scale-105 hover:shadow-xl">
                <div className="flex flex-col items-center text-center">
                  <div className="bg-white/20 backdrop-blur-sm p-1 rounded-lg mb-0.5">
                    <TrendingUp size={14} />
                  </div>
                  <p className="text-white/80 text-[10px] font-medium">Active</p>
                  <p className="text-2xl sm:text-3xl font-bold leading-none">{stats.activeSubordinates}</p>
                  <p className="text-[9px] text-white/70">
                    {stats.totalSubordinates > 0 
                      ? `${((stats.activeSubordinates / stats.totalSubordinates) * 100).toFixed(0)}%`
                      : '0%'}
                  </p>
                </div>
              </div>

              {/* ICAN Coins Card */}
              <IcanCoinCard userId={user?.id} onGoToWallet={() => (window.location.href = '/ican-wallet')} />
            </div>

            {/* Quick Actions Section */}
            <div className="flex flex-col items-center gap-2 sm:gap-3 mb-4">
              {/* Quick Action: Manage Subordinates */}
              <div className="bg-white rounded-xl shadow-lg p-2 border-2 border-slate-100 hover:border-orange-300 transition-all inline-flex items-center gap-2">
                <div className="bg-orange-100 p-1.5 rounded-lg flex-shrink-0">
                  <Users className="text-orange-600" size={18} />
                </div>
                <div className="flex-shrink-0">
                  <h3 className="text-sm font-bold text-slate-800 leading-none">Manage Chairpersons</h3>
                  <p className="text-[10px] text-slate-600">View and assign</p>
                </div>
                <button
                  onClick={() => setActiveTab('subordinates')}
                  className="px-2.5 py-1 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg font-medium hover:shadow-lg transition-all flex items-center gap-1 text-xs flex-shrink-0"
                >
                  <span>Go</span>
                  <ChevronRight size={14} />
                </button>
              </div>

              {/* Quick Action: Manage Riders */}
              {allAssignments.some(a => a.region_type === 'stage') && (
                <div className="bg-white rounded-xl shadow-lg p-2 border-2 border-slate-100 hover:border-green-300 transition-all inline-flex items-center gap-2">
                  <div className="bg-green-100 p-1.5 rounded-lg flex-shrink-0">
                    <Bike className="text-green-600" size={18} />
                  </div>
                  <div className="flex-shrink-0">
                    <h3 className="text-sm font-bold text-slate-800 leading-none">Manage Riders</h3>
                    <p className="text-[10px] text-slate-600">View and assign</p>
                  </div>
                  <button
                    onClick={() => setActiveTab('riders')}
                    className="px-2.5 py-1 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg font-medium hover:shadow-lg transition-all flex items-center gap-1 text-xs flex-shrink-0"
                  >
                    <span>Go</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}

              {/* Quick Action: Commission */}
              <div className="bg-white rounded-xl shadow-lg p-2 border-2 border-slate-100 hover:border-purple-300 transition-all inline-flex items-center gap-2">
                <div className="bg-purple-100 p-1.5 rounded-lg flex-shrink-0">
                  <DollarSign className="text-purple-600" size={18} />
                </div>
                <div className="flex-shrink-0">
                  <h3 className="text-sm font-bold text-slate-800 leading-none">Commission</h3>
                  <p className="text-[10px] text-slate-600">Track earnings</p>
                </div>
                <button
                  onClick={() => setActiveTab('commission')}
                  className="px-2.5 py-1 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg font-medium hover:shadow-lg transition-all flex items-center gap-1 text-xs flex-shrink-0"
                >
                  <span>Go</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === 'subordinates' && (
          <>
            {/* Enhanced Header Section with Gradient */}
            <div className="bg-gradient-to-br from-blue-500 via-blue-400 to-indigo-500 rounded-xl shadow-xl p-3 mb-3 text-white relative overflow-hidden">
              {/* Decorative Background */}
              <div className="absolute top-0 right-0 opacity-10">
                <Users size={120} className="transform rotate-12" />
              </div>
              
              <div className="relative z-10">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Users size={24} />
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold leading-none">Your Chairpersons</h2>
                      <p className="text-white/90 text-[10px] sm:text-xs">
                        {selectedAssignment ? `Managing ${formatRegionType(selectedAssignment.region_type)} level` : 'Select a role to manage'}
                      </p>
                    </div>
                  </div>
                  
                  {selectedAssignment?.region_type !== 'stage' && (
                    <button
                      onClick={() => setShowAssignModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition-all shadow-lg font-semibold text-xs flex-shrink-0"
                    >
                      <UserPlus size={16} />
                      <span>Assign</span>
                    </button>
                  )}
                </div>

                {/* Quick Stats Row */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2 text-center">
                    <Users size={14} className="mx-auto mb-0.5" />
                    <p className="text-base sm:text-lg font-bold leading-none">{stats.totalSubordinates}</p>
                    <p className="text-[9px] text-white/80">Total</p>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2 text-center">
                    <Check size={14} className="mx-auto mb-0.5" />
                    <p className="text-base sm:text-lg font-bold leading-none">{stats.activeSubordinates}</p>
                    <p className="text-[9px] text-white/80">Active</p>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2 text-center">
                    <TrendingUp size={14} className="mx-auto mb-0.5" />
                    <p className="text-base sm:text-lg font-bold leading-none">
                      {stats.totalSubordinates > 0 ? `${((stats.activeSubordinates / stats.totalSubordinates) * 100).toFixed(0)}%` : '0%'}
                    </p>
                    <p className="text-[9px] text-white/80">Rate</p>
                  </div>
                </div>

                {/* Role Selector */}
                <div className="bg-white/15 backdrop-blur-md rounded-lg p-2 border border-white/20 mt-3">
                  <label className="block text-[10px] font-semibold text-white mb-1 flex items-center gap-1">
                    <Settings size={12} />
                    Active Role
                  </label>
                  <select
                    value={selectedAssignment?.id || ''}
                    onChange={(e) => {
                      const assignment = allAssignments.find(a => a.id === e.target.value);
                      if (assignment) {
                        setSelectedAssignment(assignment);
                        setMyCommitteeInfo(assignment);
                        if (assignment.region_type === 'stage') {
                          setActiveTab('riders');
                        }
                      }
                    }}
                    className="w-full px-2 py-1.5 border-0 rounded-lg focus:ring-2 focus:ring-white/50 bg-white/90 text-slate-800 font-medium shadow-sm text-xs"
                  >
                    {allAssignments.map((assignment, idx) => {
                      const isTop     = idx === 0;
                      const isVirtual = assignment.id.startsWith('virtual-');
                      const prefix    = isTop ? '⭐ ' : '└ ';
                      const suffix    = isVirtual ? ' (access via top role)' : '';
                      return (
                        <option key={assignment.id} value={assignment.id}>
                          {prefix}{formatRole(assignment.role)}{suffix}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
            </div>

            {/* Chairpersons List */}
            {selectedAssignment?.region_type === 'stage' ? (
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl shadow-lg p-12 text-center border-2 border-dashed border-slate-300">
                <div className="bg-white rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4 shadow-md">
                  <Bike className="w-10 h-10 text-blue-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Switch to Riders</h3>
                <p className="text-slate-600 mb-2">Stage chairpersons don't assign subordinate chairpersons</p>
                <p className="text-sm text-slate-500 mb-6">As a stage chairperson, you manage riders instead</p>
                <button
                  onClick={() => setActiveTab('riders')}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl hover:shadow-lg transition-all font-semibold"
                >
                  <Bike size={20} />
                  Go to Riders
                </button>
              </div>
            ) : subordinates.length === 0 ? (
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl shadow-lg p-8 text-center border-2 border-slate-200">
                <div className="bg-white rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-3 shadow-md">
                  <Users className="w-8 h-8 text-blue-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">No Chairpersons Yet</h3>
                <p className="text-slate-600 mb-1 text-sm">Start building your team</p>
                <p className="text-xs text-slate-500 mb-4">Click "Assign" to add your first subordinate chairperson</p>
                <button
                  onClick={() => setShowAssignModal(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg hover:shadow-lg transition-all font-semibold text-sm"
                >
                  <UserPlus size={16} />
                  Assign First Chairperson
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {subordinates.map((subordinate, index) => (
                  <div
                    key={subordinate.id}
                    className="group bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden border-2 border-slate-100 hover:border-blue-300"
                  >
                    <div className="flex items-center gap-2 p-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {/* Avatar with Gradient */}
                        <div className="relative flex-shrink-0">
                          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 rounded-lg flex items-center justify-center text-white font-bold text-base shadow-lg transform group-hover:scale-110 transition-transform">
                            {subordinate.full_name.charAt(0).toUpperCase()}
                          </div>
                          {/* Status Indicator */}
                          <div className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                            subordinate.is_active ? 'bg-green-500' : 'bg-red-500'
                          } shadow-md`}></div>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-slate-800 text-sm mb-0.5 truncate leading-none">
                            {subordinate.full_name}
                          </h4>
                          <p className="text-xs text-slate-600 mb-1 truncate">{subordinate.email}</p>
                          
                          {/* Badges */}
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 text-[10px] bg-gradient-to-r from-blue-500 to-indigo-500 text-white px-2 py-0.5 rounded-full font-medium">
                              <User size={10} />
                              {formatRole(subordinate.role)}
                            </span>
                            <span className="inline-flex items-center gap-0.5 text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-medium">
                              <MapPin size={10} />
                              {subordinate.region_name}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Commission & Arrow */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <div className="text-center bg-gradient-to-br from-orange-50 to-yellow-50 px-2 py-1 rounded-lg border border-orange-200">
                          <p className="text-[9px] text-slate-600 font-medium">Rate</p>
                          <p className="text-base font-bold bg-gradient-to-r from-orange-500 to-yellow-500 bg-clip-text text-transparent leading-none">
                            {subordinate.commission_rate}%
                          </p>
                        </div>
                        <ChevronRight className="text-slate-300 group-hover:text-blue-500 transition-colors" size={16} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'riders' && allAssignments.some(a => a.region_type === 'stage') && (
          <>
            {/* Enhanced Header Section with Green Gradient */}
            <div className="bg-gradient-to-br from-green-500 via-emerald-500 to-teal-500 rounded-xl shadow-xl p-3 mb-3 text-white relative overflow-hidden">
              {/* Decorative Background */}
              <div className="absolute top-0 right-0 opacity-10">
                <Bike size={120} className="transform -rotate-12" />
              </div>
              
              <div className="relative z-10">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Bike size={24} />
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold leading-none">Your Riders</h2>
                      <p className="text-white/90 text-[10px] sm:text-xs">
                        From {allAssignments.filter(a => a.region_type === 'stage').length} stage assignment{allAssignments.filter(a => a.region_type === 'stage').length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  
                  {selectedAssignment?.region_type === 'stage' && (
                    <button 
                      onClick={() => setShowAssignRiderModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-green-600 rounded-lg hover:bg-green-50 transition-all shadow-lg font-semibold text-xs flex-shrink-0"
                    >
                      <UserPlus size={16} />
                      <span>Assign</span>
                    </button>
                  )}
                </div>

                {/* Quick Stats Row */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2 text-center">
                    <Bike size={14} className="mx-auto mb-0.5" />
                    <p className="text-base sm:text-lg font-bold leading-none">{riders.length}</p>
                    <p className="text-[9px] text-white/80">Total</p>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2 text-center">
                    <Check size={14} className="mx-auto mb-0.5" />
                    <p className="text-base sm:text-lg font-bold leading-none">
                      {riders.filter(r => r.status === 'active').length}
                    </p>
                    <p className="text-[9px] text-white/80">Active</p>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2 text-center">
                    <Calendar size={14} className="mx-auto mb-0.5" />
                    <p className="text-base sm:text-lg font-bold leading-none">
                      {riders.filter(r => r.status === 'pending').length}
                    </p>
                    <p className="text-[9px] text-white/80">Pending</p>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2 text-center">
                    <TrendingUp size={14} className="mx-auto mb-0.5" />
                    <p className="text-base sm:text-lg font-bold leading-none">
                      {riders.reduce((sum, r) => sum + (r.completed_rides || 0), 0)}
                    </p>
                    <p className="text-[9px] text-white/80">Rides</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Riders List */}
            {riders.length === 0 ? (
              <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl shadow-lg p-8 text-center border-2 border-slate-200">
                <div className="bg-white rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-3 shadow-md">
                  <Bike className="w-8 h-8 text-green-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">No Riders Yet</h3>
                <p className="text-slate-600 mb-1 text-sm">
                  {selectedAssignment?.region_type === 'stage' 
                    ? 'Start building your rider network' 
                    : 'Select a stage assignment to manage riders'}
                </p>
                <p className="text-xs text-slate-500 mb-4">
                  {selectedAssignment?.region_type === 'stage' 
                    ? 'Click "Assign" to add your first rider' 
                    : 'Switch to a stage role to assign riders'}
                </p>
                {selectedAssignment?.region_type === 'stage' && (
                  <button
                    onClick={() => setShowAssignRiderModal(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg hover:shadow-lg transition-all font-semibold text-sm"
                  >
                    <UserPlus size={16} />
                    Assign First Rider
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {riders.map((rider) => (
                  <div
                    key={rider.id}
                    className="group bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden border-2 border-slate-100 hover:border-green-300"
                  >
                    <div className="flex items-center gap-2 p-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {/* Avatar with Gradient */}
                        <div className="relative flex-shrink-0">
                          <div className="w-10 h-10 bg-gradient-to-br from-green-500 via-emerald-500 to-teal-500 rounded-lg flex items-center justify-center text-white font-bold text-base shadow-lg transform group-hover:scale-110 transition-transform">
                            {rider.full_name.charAt(0).toUpperCase()}
                          </div>
                          {/* Status Indicator */}
                          <div className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white shadow-md ${
                            rider.status === 'active' ? 'bg-green-500' : 
                            rider.status === 'pending' ? 'bg-yellow-500' : 'bg-red-500'
                          }`}></div>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-slate-800 text-sm mb-0.5 truncate leading-none">
                            {rider.full_name}
                          </h4>
                          <p className="text-xs text-slate-600 mb-1 truncate">{rider.email}</p>
                          
                          {/* Badges */}
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-0.5 text-[10px] bg-gradient-to-r from-green-500 to-emerald-500 text-white px-2 py-0.5 rounded-full font-medium capitalize">
                              <Bike size={10} />
                              {rider.vehicle_type}
                            </span>
                            <span className="inline-flex items-center text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-medium uppercase">
                              {rider.plate_number}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Rating & Rides */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <div className="text-center bg-gradient-to-br from-yellow-50 to-orange-50 px-2 py-1 rounded-lg border border-yellow-200">
                          <p className="text-xs font-bold text-orange-600 leading-none">⭐ {rider.rating.toFixed(1)}</p>
                          <p className="text-[9px] text-slate-600">{rider.completed_rides}</p>
                        </div>
                        <ChevronRight className="text-slate-300 group-hover:text-green-500 transition-colors" size={16} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'commission' && (
          <>
            {/* Enhanced Header with Purple Gradient */}
            <div className="bg-gradient-to-br from-purple-500 via-purple-400 to-pink-500 rounded-xl shadow-xl p-3 mb-3 text-white relative overflow-hidden">
              {/* Decorative Background */}
              <div className="absolute top-0 right-0 opacity-10">
                <DollarSign size={120} className="transform rotate-12" />
              </div>
              
              <div className="relative z-10">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <DollarSign size={24} />
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold leading-none">Commission Overview</h2>
                      <p className="text-white/90 text-[10px] sm:text-xs">Track your earnings and rates</p>
                    </div>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2 flex-shrink-0">
                    <CreditCard size={18} />
                  </div>
                </div>

                {/* Quick Stats Row */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2 text-center">
                    <DollarSign size={14} className="mx-auto mb-0.5" />
                    <p className="text-base sm:text-lg font-bold leading-none">{stats.totalCommission.toFixed(1)}%</p>
                    <p className="text-[9px] text-white/80">Avg Rate</p>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2 text-center">
                    <Calendar size={14} className="mx-auto mb-0.5" />
                    <p className="text-base sm:text-lg font-bold leading-none">{stats.monthlyRides}</p>
                    <p className="text-[9px] text-white/80">Rides</p>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2 text-center">
                    <TrendingUp size={14} className="mx-auto mb-0.5" />
                    <p className="text-base sm:text-lg font-bold leading-none">UGX 0</p>
                    <p className="text-[9px] text-white/80">Earned</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Commission Cards Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Commission Summary Card */}
              <div className="bg-white rounded-2xl shadow-lg p-6 border-2 border-slate-100">
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-gradient-to-br from-purple-100 to-pink-100 p-3 rounded-xl">
                    <BarChart3 className="text-purple-600" size={28} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">Commission Summary</h3>
                    <p className="text-sm text-slate-600">Your earnings breakdown</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
                    <div className="flex items-center gap-3">
                      <div className="bg-blue-500 rounded-lg p-2">
                        <Calendar className="text-white" size={20} />
                      </div>
                      <span className="text-slate-700 font-medium">This Month</span>
                    </div>
                    <span className="font-bold text-slate-800 text-lg">UGX 0</span>
                  </div>
                  
                  <div className="flex justify-between items-center p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border border-purple-100">
                    <div className="flex items-center gap-3">
                      <div className="bg-purple-500 rounded-lg p-2">
                        <Calendar className="text-white" size={20} />
                      </div>
                      <span className="text-slate-700 font-medium">Last Month</span>
                    </div>
                    <span className="font-bold text-slate-800 text-lg">UGX 0</span>
                  </div>
                  
                  <div className="flex justify-between items-center p-4 bg-gradient-to-r from-orange-50 to-yellow-50 rounded-xl border-2 border-orange-200">
                    <div className="flex items-center gap-3">
                      <div className="bg-gradient-to-r from-orange-500 to-yellow-500 rounded-lg p-2">
                        <DollarSign className="text-white" size={20} />
                      </div>
                      <span className="text-slate-700 font-bold">Total Earned</span>
                    </div>
                    <span className="font-bold bg-gradient-to-r from-orange-500 to-yellow-500 bg-clip-text text-transparent text-xl">
                      UGX 0
                    </span>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-sm text-amber-800 flex items-center gap-2">
                    <span>💡</span>
                    <span className="font-medium">Commission tracking coming soon...</span>
                  </p>
                </div>
              </div>

              {/* Recent Activity Card */}
              <div className="bg-white rounded-2xl shadow-lg p-6 border-2 border-slate-100">
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-gradient-to-br from-green-100 to-emerald-100 p-3 rounded-xl">
                    <TrendingUp className="text-green-600" size={28} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">Recent Activity</h3>
                    <p className="text-sm text-slate-600">Latest transactions</p>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center py-12">
                  <div className="bg-slate-100 rounded-full w-16 h-16 flex items-center justify-center mb-4">
                    <BarChart3 className="text-slate-400" size={32} />
                  </div>
                  <p className="text-slate-600 font-medium mb-2">No activity yet</p>
                  <p className="text-sm text-slate-500 text-center max-w-xs">
                    Your commission activity will appear here once rides start generating earnings
                  </p>
                </div>

                <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <p className="text-sm text-blue-800 flex items-center gap-2">
                    <span>📊</span>
                    <span className="font-medium">Activity tracking coming soon...</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Commission Rates by Assignment */}
            <div className="bg-white rounded-2xl shadow-lg p-6 border-2 border-slate-100">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-gradient-to-br from-orange-100 to-yellow-100 p-3 rounded-xl">
                  <MapPin className="text-orange-600" size={28} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-800">Commission Rates by Role</h3>
                  <p className="text-sm text-slate-600">Your rates across different assignments</p>
                </div>
              </div>

              {allAssignments.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-500">No assignments found</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {allAssignments.map((assignment, index) => (
                    <div
                      key={assignment.id}
                      className="group bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-5 border-2 border-slate-200 hover:border-orange-300 hover:shadow-lg transition-all"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="bg-white rounded-lg p-2 shadow-sm">
                          <MapPin className="text-orange-500" size={20} />
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          index === 0 
                            ? 'bg-orange-100 text-orange-700' 
                            : 'bg-slate-200 text-slate-700'
                        }`}>
                          {index === 0 ? '⭐ Primary' : 'Secondary'}
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-800 mb-1 capitalize">
                        {formatRole(assignment.role)}
                      </h4>
                      <p className="text-sm text-slate-600 mb-3 capitalize">
                        {formatRegionType(assignment.region_type)}
                      </p>
                      <div className="flex items-center justify-between pt-3 border-t border-slate-300">
                        <span className="text-sm text-slate-600 font-medium">Commission</span>
                        <span className="text-2xl font-bold bg-gradient-to-r from-orange-500 to-yellow-500 bg-clip-text text-transparent">
                          {assignment.commission_rate}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Profile Modal */}
      <ProfileModal
        user={user}
        userRole="chairperson"
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        onSaved={() => {
          loadDashboardData();
        }}
      />

      {/* Assign Subordinate Modal */}
      {showAssignModal && myCommitteeInfo && (
        <AssignSubordinateModal
          myCommitteeInfo={myCommitteeInfo}
          onClose={() => setShowAssignModal(false)}
          onSuccess={() => {
            setShowAssignModal(false);
            loadDashboardData();
            toast.success('Chairperson assigned successfully!');
          }}
        />
      )}

      {/* Assign Rider Modal */}
      {showAssignRiderModal && selectedAssignment && selectedAssignment.region_type === 'stage' && (
        <AssignRiderModal
          stageId={selectedAssignment.region_id}
          stageName={formatRegionType(selectedAssignment.region_type)}
          onClose={() => setShowAssignRiderModal(false)}
          onSuccess={() => {
            setShowAssignRiderModal(false);
            loadDashboardData();
            toast.success('Rider assigned successfully!');
          }}
        />
      )}
    </div>
  );
}

// Tab Button Component
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

// Assign Subordinate Chairperson Modal
interface AssignSubordinateModalProps {
  myCommitteeInfo: CommitteeMember;
  onClose: () => void;
  onSuccess: () => void;
}

function AssignSubordinateModal({ myCommitteeInfo, onClose, onSuccess }: AssignSubordinateModalProps) {
  const MAX_COMMITTEE_MEMBERS = 10;
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [commissionRate, setCommissionRate] = useState('5.00');
  const [notes, setNotes] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [availableRegions, setAvailableRegions] = useState<any[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState('');
  const [memberCount, setMemberCount] = useState(0);

  useEffect(() => {
    loadUsers();
    loadAvailableRegions();
  }, []);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const [authUsers, committeeResult] = await Promise.all([
        userService.getAuthenticatedUsers(),
        supabase.from('mbg_committee_members').select('user_id').eq('is_active', true)
      ]);
      const assignedIds = new Set((committeeResult.data || []).map((row: any) => row.user_id));
      const availableUsers = authUsers.filter((u: any) => u.role_type !== 'developer' && u.id !== myCommitteeInfo.user_id && !assignedIds.has(u.id));
      setUsers(availableUsers);
      setMemberCount(await chairpersonService.getDirectMemberCount(myCommitteeInfo.id));
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadAvailableRegions = async () => {
    try {
      // Based on current chairperson's level, load subordinate regions
      const myRegionType = myCommitteeInfo.region_type;
      const myRegionId = myCommitteeInfo.region_id;
      
      let regions: any[] = [];
      
      if (myRegionType === 'district') {
        // District chairpersons can assign division chairpersons
        const { data, error } = await supabase
          .from('mbg_divisions')
          .select('*')
          .eq('district_id', myRegionId)
          .order('name');
        
        if (!error && data) {
          regions = data.map(d => ({ ...d, type: 'division' }));
        }
      } else if (myRegionType === 'division') {
        // Division chairpersons can assign subcounty chairpersons
        const { data, error } = await supabase
          .from('mbg_subcounties')
          .select('*')
          .eq('division_id', myRegionId)
          .order('name');
        
        if (!error && data) {
          regions = data.map(d => ({ ...d, type: 'subcounty' }));
        }
      } else if (myRegionType === 'subcounty') {
        // Subcounty chairpersons can assign parish chairpersons
        const { data, error } = await supabase
          .from('mbg_parishes')
          .select('*')
          .eq('subcounty_id', myRegionId)
          .order('name');
        
        if (!error && data) {
          regions = data.map(d => ({ ...d, type: 'parish' }));
        }
      } else if (myRegionType === 'parish') {
        // Parish chairpersons can assign stage chairpersons
        const { data, error } = await supabase
          .from('mbg_stages')
          .select('*')
          .eq('parish_id', myRegionId)
          .order('name');
        
        if (!error && data) {
          regions = data.map(d => ({ ...d, type: 'stage' }));
        }
      }
      
      setAvailableRegions(regions);
      if (regions.length > 0) {
        setSelectedRegionId(regions[0].id);
      }
    } catch (error) {
      console.error('Error loading regions:', error);
      toast.error('Failed to load regions');
    }
  };

  const filteredUsers = users.filter((user) => {
    const searchLower = searchQuery.toLowerCase();
    const email = user.email?.toLowerCase() || '';
    const fullName = (
      user.mbg_user_profiles?.[0]?.full_name ||
      user.email?.split('@')[0] ||
      'User'
    ).toLowerCase();
    return email.includes(searchLower) || fullName.includes(searchLower);
  });

  const getTargetRole = (myRegionType: string) => {
    const roleMap: any = {
      'district': 'division_chairperson',
      'division': 'subcounty_chairperson',
      'subcounty': 'parish_chairperson',
      'parish': 'stage_chairperson'
    };
    return roleMap[myRegionType];
  };

  const getTargetRegionType = (myRegionType: string) => {
    const typeMap: any = {
      'district': 'division',
      'division': 'subcounty',
      'subcounty': 'parish',
      'parish': 'stage'
    };
    return typeMap[myRegionType];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedUserId) {
      toast.error('Please select a user');
      return;
    }

    if (!selectedRegionId && availableRegions.length > 0) {
      toast.error('Please select a region');
      return;
    }

    if (memberCount >= MAX_COMMITTEE_MEMBERS) {
      toast.error(`This committee already has the maximum of ${MAX_COMMITTEE_MEMBERS} members.`);
      return;
    }

    const rate = parseFloat(commissionRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('Commission rate must be between 0 and 100');
      return;
    }

    setAssigning(true);

    const selectedUser = users.find(u => u.id === selectedUserId);
    if (!selectedUser) {
      toast.error('User not found');
      setAssigning(false);
      return;
    }

    const targetRegionType = getTargetRegionType(myCommitteeInfo.region_type);
    const targetRole = getTargetRole(myCommitteeInfo.region_type);

    const result = await chairpersonService.assignChairperson({
      targetUserEmail: selectedUser.email,
      targetRole: targetRole as any,
      targetRegionType: targetRegionType as any,
      targetRegionId: selectedRegionId || myCommitteeInfo.region_id,
      commissionRate: rate,
      notes: notes.trim() || undefined
    });

    setAssigning(false);

    if (result.success) {
      onSuccess();
    } else {
      toast.error(result.error || 'Failed to assign chairperson');
    }
  };

  const formatRegionType = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  const canAssignSubordinates = ['district', 'division', 'subcounty', 'parish'].includes(myCommitteeInfo.region_type);

  if (!canAssignSubordinates) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-800">Cannot Assign</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X size={24} />
            </button>
          </div>
          <div className="text-center py-6">
            <p className="text-slate-600 mb-4">
              Stage chairpersons cannot assign subordinate chairpersons.
            </p>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-slate-500 text-white rounded-lg hover:bg-slate-600 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-slate-800">Assign Subordinate Chairperson</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-blue-700">
            <strong>Your Level:</strong> {formatRegionType(myCommitteeInfo.region_type)}<br/>
            <strong>Can Assign:</strong> {formatRegionType(getTargetRegionType(myCommitteeInfo.region_type))} Chairpersons
          </p>
          <p className="text-xs text-blue-600 mt-2">Committee members: {memberCount}/{MAX_COMMITTEE_MEMBERS}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Region Selector */}
          {availableRegions.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Select Region *
              </label>
              <select
                value={selectedRegionId}
                onChange={(e) => setSelectedRegionId(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                required
              >
                {availableRegions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                {availableRegions.length} region(s) available in your area
              </p>
            </div>
          )}

          {/* User Search and Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Select User *
            </label>
            
            {loadingUsers ? (
              <div className="w-full px-4 py-3 border border-slate-300 rounded-lg bg-slate-50 text-slate-600 text-sm">
                Loading users...
              </div>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name or email..."
                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>
                
                <div className="border border-slate-300 rounded-lg max-h-64 overflow-y-auto">
                  {filteredUsers.length === 0 ? (
                    <div className="p-4 text-sm text-slate-500 text-center">
                      {searchQuery ? 'No users found' : 'No users available'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {filteredUsers.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => setSelectedUserId(user.id)}
                          className={`w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors ${
                            selectedUserId === user.id ? 'bg-orange-50 border-l-4 border-orange-500' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-slate-800">
                                {user.mbg_user_profiles?.[0]?.full_name || user.email.split('@')[0]}
                              </p>
                              <p className="text-sm text-slate-600">{user.email}</p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                Current role: <span className="font-medium">{user.role_type}</span>
                              </p>
                            </div>
                            {selectedUserId === user.id && (
                              <Check size={20} className="text-orange-600" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                
                {selectedUserId && (
                  <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                    <Check size={14} />
                    User selected: {users.find(u => u.id === selectedUserId)?.email}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Commission Rate */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Commission Rate (%) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              placeholder="5.00"
              required
            />
            <p className="text-xs text-slate-500 mt-1">
              Percentage of ride fares this chairperson will earn
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              rows={3}
              placeholder="Add any additional notes or instructions..."
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={assigning}
              className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={assigning || memberCount >= MAX_COMMITTEE_MEMBERS || !selectedUserId || (availableRegions.length > 0 && !selectedRegionId)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
            >
              {assigning ? (
                <>
                  <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Assigning...</span>
                </>
              ) : (
                <>
                  <UserPlus size={18} />
                  <span>{memberCount >= MAX_COMMITTEE_MEMBERS ? 'Committee Full' : 'Assign Chairperson'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// Assign Rider Modal (for Stage Chairpersons)
interface AssignRiderModalProps {
  stageId: string;
  stageName?: string;
  onClose: () => void;
  onSuccess: () => void;
}

function AssignRiderModal({ stageId, stageName, onClose, onSuccess }: AssignRiderModalProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [vehicleType, setVehicleType] = useState<'motorcycle' | 'bicycle' | 'tuktuk'>('motorcycle');
  const [plateNumber, setPlateNumber] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const allUsers = await userService.getAllUsers();
      // Filter out developers, chairpersons, and existing riders
      const availableUsers = allUsers.filter(
        (u: any) => u.role_type !== 'developer' && u.role_type !== 'chairperson'
      );
      setUsers(availableUsers);
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const filteredUsers = users.filter((user) => {
    const searchLower = searchQuery.toLowerCase();
    const email = user.email?.toLowerCase() || '';
    const fullName = (
      user.mbg_user_profiles?.[0]?.full_name ||
      user.email?.split('@')[0] ||
      'User'
    ).toLowerCase();
    return email.includes(searchLower) || fullName.includes(searchLower);
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedUserId) {
      toast.error('Please select a user');
      return;
    }

    if (!plateNumber.trim()) {
      toast.error('Plate number is required');
      return;
    }

    if (!licenseNumber.trim()) {
      toast.error('License number is required');
      return;
    }

    setAssigning(true);

    const selectedUser = users.find(u => u.id === selectedUserId);
    if (!selectedUser) {
      toast.error('User not found');
      setAssigning(false);
      return;
    }

    const result = await riderService.assignRider({
      targetUserEmail: selectedUser.email,
      targetStageId: stageId,
      vehicleType,
      plateNumber: plateNumber.trim().toUpperCase(),
      licenseNumber: licenseNumber.trim(),
      licenseExpiry: licenseExpiry || undefined,
      vehicleModel: vehicleModel.trim() || undefined,
      vehicleYear: vehicleYear ? parseInt(vehicleYear) : undefined,
      vehicleColor: vehicleColor.trim() || undefined
    });

    setAssigning(false);

    if (result.success) {
      onSuccess();
    } else {
      toast.error(result.error || 'Failed to assign rider');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full my-8 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-slate-800">Assign Rider to Stage</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-green-700">
            <strong>Stage Chairperson:</strong> Assign riders who will operate in your stage area
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* User Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Select User *
            </label>
            
            {loadingUsers ? (
              <div className="w-full px-4 py-3 border border-slate-300 rounded-lg bg-slate-50 text-slate-600 text-sm">
                Loading users...
              </div>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name or email..."
                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                
                <div className="border border-slate-300 rounded-lg max-h-48 overflow-y-auto">
                  {filteredUsers.length === 0 ? (
                    <div className="p-4 text-sm text-slate-500 text-center">
                      {searchQuery ? 'No users found' : 'No users available'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {filteredUsers.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => setSelectedUserId(user.id)}
                          className={`w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors ${
                            selectedUserId === user.id ? 'bg-green-50 border-l-4 border-green-500' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-slate-800">
                                {user.mbg_user_profiles?.[0]?.full_name || user.email.split('@')[0]}
                              </p>
                              <p className="text-sm text-slate-600">{user.email}</p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                Current role: <span className="font-medium">{user.role_type}</span>
                              </p>
                            </div>
                            {selectedUserId === user.id && (
                              <Check size={20} className="text-green-600" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                
                {selectedUserId && (
                  <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                    <Check size={14} />
                    User selected: {users.find(u => u.id === selectedUserId)?.email}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Vehicle Information */}
          <div className="border-t border-slate-200 pt-4">
            <h4 className="font-semibold text-slate-700 mb-3">Vehicle Information</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Vehicle Type *
                </label>
                <select
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value as any)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  required
                >
                  <option value="motorcycle">Motorcycle (Boda Boda)</option>
                  <option value="bicycle">Bicycle</option>
                  <option value="tuktuk">Tuktuk</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Plate Number *
                </label>
                <input
                  type="text"
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent uppercase"
                  placeholder="UBD 123A"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  License Number *
                </label>
                <input
                  type="text"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="License number"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  License Expiry
                </label>
                <input
                  type="date"
                  value={licenseExpiry}
                  onChange={(e) => setLicenseExpiry(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Vehicle Model
                </label>
                <input
                  type="text"
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="e.g., Bajaj Boxer"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Vehicle Year
                </label>
                <input
                  type="number"
                  value={vehicleYear}
                  onChange={(e) => setVehicleYear(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="2023"
                  min="1990"
                  max={new Date().getFullYear() + 1}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Vehicle Color
                </label>
                <input
                  type="text"
                  value={vehicleColor}
                  onChange={(e) => setVehicleColor(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="e.g., Red, Blue"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={assigning}
              className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={assigning || !selectedUserId || !plateNumber || !licenseNumber}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
            >
              {assigning ? (
                <>
                  <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Assigning...</span>
                </>
              ) : (
                <>
                  <Bike size={18} />
                  <span>Assign Rider</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
