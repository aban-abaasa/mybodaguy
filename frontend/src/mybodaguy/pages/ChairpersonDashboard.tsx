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
                  <h1 className="text-sm xs:text-base sm:text-xl font-bold leading-tight">My Boda Guy</h1>
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

      <div className="container mx-auto px-2 xs:px-3 sm:px-4 py-3 xs:py-4 sm:py-8">
        {/* Tab Content */}
        {activeTab === 'overview' && (
          <>
            {/* Welcome Section - Clean and Simple */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h2 className="text-2xl font-bold text-slate-800 mb-2">
                Welcome, Chairperson!
              </h2>
              <div className="flex items-center gap-2 text-slate-600 mb-4">
                <MapPin size={18} />
                <span>{allAssignments.length} Active Role{allAssignments.length !== 1 ? 's' : ''}</span>
                <span className="text-slate-400">•</span>
                <span>Managing {stats.totalSubordinates} Chairperson{stats.totalSubordinates !== 1 ? 's' : ''}</span>
                {riders.length > 0 && (
                  <>
                    <span className="text-slate-400">•</span>
                    <span>{riders.length} Rider{riders.length !== 1 ? 's' : ''}</span>
                  </>
                )}
              </div>

              {/* Role Selector — always visible */}
              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Active Role
                </label>
                <select
                  value={selectedAssignment?.id || ''}
                  onChange={(e) => {
                    const assignment = allAssignments.find(a => a.id === e.target.value);
                    if (assignment) {
                      setSelectedAssignment(assignment);
                      setMyCommitteeInfo(assignment);
                    }
                  }}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white text-slate-800"
                >
                  {allAssignments.map((assignment, idx) => {
                    const isTop     = idx === 0;
                    const isVirtual = assignment.id.startsWith('virtual-');
                    const prefix    = isTop ? '★ ' : '└ ';
                    const suffix    = isVirtual ? ' (access via top role)' : '';
                    return (
                      <option key={assignment.id} value={assignment.id}>
                        {prefix}{formatRole(assignment.role)}{suffix}
                      </option>
                    );
                  })}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Select a role to manage its subordinates and riders
                </p>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
              {/* Total Assignments */}
              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">My Roles</p>
                    <p className="text-3xl font-bold text-slate-800">{stats.totalAssignments}</p>
                  </div>
                  <div className="bg-purple-100 p-3 rounded-lg">
                    <MapPin className="text-purple-600" size={24} />
                  </div>
                </div>
              </div>
              {/* Total Subordinates */}
              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Total Chairpersons</p>
                    <p className="text-3xl font-bold text-slate-800">{stats.totalSubordinates}</p>
                  </div>
                  <div className="bg-blue-100 p-3 rounded-lg">
                    <Users className="text-blue-600" size={24} />
                  </div>
                </div>
              </div>

              {/* Active Subordinates */}
              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Active</p>
                    <p className="text-3xl font-bold text-green-600">{stats.activeSubordinates}</p>
                  </div>
                  <div className="bg-green-100 p-3 rounded-lg">
                    <TrendingUp className="text-green-600" size={24} />
                  </div>
                </div>
              </div>

              {/* Commission Rate */}
              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Commission Rate</p>
                    <p className="text-3xl font-bold text-orange-600">{stats.totalCommission}%</p>
                  </div>
                  <div className="bg-orange-100 p-3 rounded-lg">
                    <DollarSign className="text-orange-600" size={24} />
                  </div>
                </div>
              </div>

              {/* Monthly Rides */}
              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Monthly Rides</p>
                    <p className="text-3xl font-bold text-purple-600">{stats.monthlyRides}</p>
                  </div>
                  <div className="bg-purple-100 p-3 rounded-lg">
                    <Bike className="text-purple-600" size={24} />
                  </div>
                </div>
              </div>

              {/* ICAN Coins */}
              <IcanCoinCard userId={user?.id} onGoToWallet={() => (window.location.href = '/ican-wallet')} />
            </div>
          </>
        )}

        {activeTab === 'subordinates' && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-slate-800 mb-2">
            Welcome, Chairperson!
          </h2>
          <div className="flex items-center gap-2 text-slate-600 mb-4">
            <MapPin size={18} />
            <span>{allAssignments.length} Active Role{allAssignments.length !== 1 ? 's' : ''}</span>
            <span className="text-slate-400">•</span>
            <span>Managing {stats.totalSubordinates} Chairperson{stats.totalSubordinates !== 1 ? 's' : ''}</span>
            {riders.length > 0 && (
              <>
                <span className="text-slate-400">•</span>
                <span>{riders.length} Rider{riders.length !== 1 ? 's' : ''}</span>
              </>
            )}
          </div>

          {/* Role Selector — always visible */}
          <div className="border-t pt-4">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Active Role
            </label>
            <select
              value={selectedAssignment?.id || ''}
              onChange={(e) => {
                const assignment = allAssignments.find(a => a.id === e.target.value);
                if (assignment) {
                  setSelectedAssignment(assignment);
                  setMyCommitteeInfo(assignment);
                }
              }}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white text-slate-800"
            >
              {allAssignments.map((assignment, idx) => {
                const isTop     = idx === 0;
                const isVirtual = assignment.id.startsWith('virtual-');
                const prefix    = isTop ? '★ ' : '└ ';
                const suffix    = isVirtual ? ' (access via top role)' : '';
                return (
                  <option key={assignment.id} value={assignment.id}>
                    {prefix}{formatRole(assignment.role)}{suffix}
                  </option>
                );
              })}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Select a role to manage its subordinates and riders
            </p>
          </div>
        </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          {/* Total Assignments */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">My Roles</p>
                <p className="text-3xl font-bold text-slate-800">{stats.totalAssignments}</p>
              </div>
              <div className="bg-purple-100 p-3 rounded-lg">
                <MapPin className="text-purple-600" size={24} />
              </div>
            </div>
          </div>
          {/* Total Subordinates */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Total Chairpersons</p>
                <p className="text-3xl font-bold text-slate-800">{stats.totalSubordinates}</p>
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <Users className="text-blue-600" size={24} />
              </div>
            </div>
          </div>

          {/* Active Subordinates */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Active</p>
                <p className="text-3xl font-bold text-green-600">{stats.activeSubordinates}</p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <TrendingUp className="text-green-600" size={24} />
              </div>
            </div>
          </div>

          {/* Commission Rate */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Commission Rate</p>
                <p className="text-3xl font-bold text-orange-600">{stats.totalCommission}%</p>
              </div>
              <div className="bg-orange-100 p-3 rounded-lg">
                <DollarSign className="text-orange-600" size={24} />
              </div>
            </div>
          </div>

          {/* Monthly Rides */}
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Monthly Rides</p>
                <p className="text-3xl font-bold text-purple-600">{stats.monthlyRides}</p>
              </div>
              <div className="bg-purple-100 p-3 rounded-lg">
                <Bike className="text-purple-600" size={24} />
              </div>
            </div>
          </div>
        </div>

        {activeTab === 'subordinates' && (
          /* Higher-level Chairperson - Manage Subordinates */
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-bold text-slate-800">Your Chairpersons</h3>
                <p className="text-sm text-slate-600">
                  {selectedAssignment ? `Managing ${formatRegionType(selectedAssignment.region_type)} level` : 'Select a role'}
                </p>
              </div>
              <button 
                onClick={() => setShowAssignModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
              >
                <UserPlus size={18} />
                <span className="hidden sm:inline">Assign Chairperson</span>
                <span className="sm:hidden">Assign</span>
              </button>
            </div>

            {subordinates.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600 mb-2">No chairpersons assigned yet</p>
                <p className="text-sm text-slate-500">Click "Assign Chairperson" to add your first subordinate</p>
              </div>
            ) : (
              <div className="space-y-3">
                {subordinates.map((subordinate) => (
                <div
                  key={subordinate.id}
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center text-white font-bold text-lg">
                      {subordinate.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-800">{subordinate.full_name}</h4>
                      <p className="text-sm text-slate-600">{subordinate.email}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                          {formatRole(subordinate.role)}
                        </span>
                        <span className="text-xs text-slate-500">{subordinate.region_name}</span>
                        <span className={`text-xs px-2 py-1 rounded ${
                          subordinate.is_active 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {subordinate.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm text-slate-600">Commission</p>
                      <p className="font-semibold text-orange-600">{subordinate.commission_rate}%</p>
                    </div>
                    <ChevronRight className="text-slate-400" size={20} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {activeTab === 'riders' && allAssignments.some(a => a.region_type === 'stage') && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-bold text-slate-800">Your Riders</h3>
                <p className="text-sm text-slate-600">
                  From {allAssignments.filter(a => a.region_type === 'stage').length} stage assignment{allAssignments.filter(a => a.region_type === 'stage').length !== 1 ? 's' : ''}
                </p>
              </div>
              {selectedAssignment?.region_type === 'stage' && (
                <button 
                  onClick={() => setShowAssignRiderModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                >
                  <UserPlus size={18} />
                  <span className="hidden sm:inline">Assign Rider</span>
                  <span className="sm:hidden">Assign</span>
                </button>
              )}
            </div>

            {riders.length === 0 ? (
              <div className="text-center py-12">
                <Bike className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600 mb-2">No riders assigned yet</p>
                <p className="text-sm text-slate-500">
                  {selectedAssignment?.region_type === 'stage' 
                    ? 'Click "Assign Rider" to add your first rider' 
                    : 'Select a stage assignment to assign riders'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {riders.map((rider) => (
                  <div
                    key={rider.id}
                    className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-gradient-to-br from-green-400 to-blue-400 rounded-full flex items-center justify-center text-white font-bold text-lg">
                        {rider.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="font-semibold text-slate-800">{rider.full_name}</h4>
                        <p className="text-sm text-slate-600">{rider.email}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded capitalize">
                            {rider.vehicle_type}
                          </span>
                          <span className="text-xs text-slate-500">{rider.plate_number}</span>
                          <span className={`text-xs px-2 py-1 rounded ${
                            rider.status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : rider.status === 'pending'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {rider.status}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm text-slate-600">Rating</p>
                        <p className="font-semibold text-orange-600">⭐ {rider.rating.toFixed(1)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-slate-600">Rides</p>
                        <p className="font-semibold text-slate-800">{rider.completed_rides}</p>
                      </div>
                      <ChevronRight className="text-slate-400" size={20} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'commission' && (
          /* Commission Summary */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4">Commission Summary</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center pb-3 border-b">
                  <span className="text-slate-600">This Month</span>
                  <span className="font-semibold text-slate-800">UGX 0</span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b">
                  <span className="text-slate-600">Last Month</span>
                  <span className="font-semibold text-slate-800">UGX 0</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Total Earned</span>
                  <span className="font-bold text-orange-600">UGX 0</span>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-4">
                Commission tracking coming soon...
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4">Recent Activity</h3>
              <div className="space-y-3">
                <p className="text-slate-600 text-center py-8">
                  No recent activity
                </p>
              </div>
              <p className="text-xs text-slate-500 mt-4">
                Activity tracking coming soon...
              </p>
            </div>
          </div>
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
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [commissionRate, setCommissionRate] = useState('5.00');
  const [notes, setNotes] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [availableRegions, setAvailableRegions] = useState<any[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState('');

  useEffect(() => {
    loadUsers();
    loadAvailableRegions();
  }, []);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const allUsers = await userService.getAllUsers();
      // Filter out developers and existing chairpersons
      const availableUsers = allUsers.filter((u: any) => u.role_type !== 'developer');
      setUsers(availableUsers);
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
              disabled={assigning || !selectedUserId || (availableRegions.length > 0 && !selectedRegionId)}
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
                  <span>Assign Chairperson</span>
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
