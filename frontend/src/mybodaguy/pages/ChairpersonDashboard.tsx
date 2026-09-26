import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bike, Users, DollarSign, MapPin, LogOut, UserPlus, ChevronRight, ChevronDown, TrendingUp, User, X, Check, Search, Calendar, CreditCard, BarChart3, Settings, LayoutGrid } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { chairpersonService, SubordinateChairperson, CommitteeMember, CommissionRecord } from '../services/chairpersonService';
import { riderService, Rider } from '../services/riderService';
import { supabase } from '../services/supabaseClient';
import { userService } from '../services/userService';
import { avatarService } from '../services/avatarService';
import ProfileModal from '../components/ProfileModal';
import IcanCoinCard from '../components/IcanCoinCard';
import { ThemeMenuItem } from '../../components/ThemeToggle';
import { SectionHeading, greetingForHour } from '../components/ClassicBits';
import { toast } from 'sonner';

interface ChairpersonDashboardProps {
  user: any;
  onSignOut: () => void;
  // See CustomerDashboard.tsx's onGoToWallet doc — switches UnifiedDashboard's
  // internal activeRole instead of a hard-navigating to a URL nothing serves.
  onGoToWallet?: () => void;
}

type TabType = 'overview' | 'subordinates' | 'riders' | 'commission';

export default function ChairpersonDashboard({ user, onSignOut, onGoToWallet }: ChairpersonDashboardProps) {
  const goToWallet = onGoToWallet ?? (() => { window.location.href = '/ican-wallet'; });
  const [myCommitteeInfo, setMyCommitteeInfo] = useState<CommitteeMember | null>(null);
  const [allAssignments, setAllAssignments] = useState<CommitteeMember[]>([]);
  const [subordinates, setSubordinates] = useState<SubordinateChairperson[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [commissions, setCommissions] = useState<CommissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showAssignRiderModal, setShowAssignRiderModal] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<CommitteeMember | null>(null);
  const [selectedSubordinate, setSelectedSubordinate] = useState<SubordinateChairperson | null>(null);
  const [selectedRider, setSelectedRider] = useState<Rider | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [openCommissionSection, setOpenCommissionSection] = useState<'summary' | 'activity' | 'rates' | null>('summary');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalSubordinates: 0,
    activeSubordinates: 0,
    totalCommission: 0,
    monthlyRides: 0,
    totalAssignments: 0
  });

  useEffect(() => {
    loadDashboardData();
    loadAvatar();
  }, [user]);

  const loadAvatar = async () => {
    try {
      setAvatarUrl(await avatarService.getAvatarUrl(user.id));
    } catch (error) {
      console.error('[ChairpersonDashboard] Error loading avatar:', error);
    }
  };

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

      // Load this chairperson's own real commission earnings (mbg_commissions)
      const myCommissions = await chairpersonService.getMyCommissions(user.id);
      setCommissions(myCommissions);

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

  const formatUGX = (amount: number) => `UGX ${amount.toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;

  // Real earnings derived from mbg_commissions (ADD_CHAIRPERSON_COMMISSION_READ_ACCESS.sql
  // opened read access to a chairperson's own rows here) — only 'paid' rows count as earned.
  const paidCommissions = commissions.filter(c => c.status === 'paid');
  const now = new Date();
  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const thisMonthKey = monthKey(now);
  const lastMonthKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const earnedInMonth = (key: string) => paidCommissions
    .filter(c => monthKey(new Date(c.paid_at || c.created_at)) === key)
    .reduce((sum, c) => sum + Number(c.commission_amount), 0);
  const thisMonthEarned = earnedInMonth(thisMonthKey);
  const lastMonthEarned = earnedInMonth(lastMonthKey);
  const totalEarned = paidCommissions.reduce((sum, c) => sum + Number(c.commission_amount), 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
          <p className="mt-4 text-slate-600 dark:text-slate-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!myCommitteeInfo) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
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
              <div className="relative">
                {/* Profile Avatar Menu */}
                <button
                  onClick={() => setShowMobileMenu(!showMobileMenu)}
                  className="flex items-center justify-center w-8 h-8 xs:w-9 xs:h-9 rounded-full bg-white/90 text-slate-800 font-bold text-xs xs:text-sm hover:bg-white transition-colors flex-shrink-0 overflow-hidden"
                  title={user.email}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    (user.email || '?').charAt(0).toUpperCase()
                  )}
                </button>

                {/* Account Dropdown Menu */}
                {showMobileMenu && (
                  <div className="absolute right-0 top-full mt-2 bg-white dark:bg-slate-800 rounded-lg shadow-xl py-2 min-w-[200px] z-50">
                    <div className="px-3 xs:px-4 py-2 border-b border-slate-200 dark:border-slate-700">
                      <p className="text-[9px] xs:text-xs text-slate-500 dark:text-slate-400">Logged in as</p>
                      <p className="text-xs xs:text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{user.email}</p>
                    </div>

                    {/* Profile */}
                    <button
                      onClick={() => {
                        setShowMobileMenu(false);
                        setShowProfileModal(true);
                      }}
                      className="w-full px-3 xs:px-4 py-2 text-left text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700 flex items-center gap-2"
                    >
                      <User size={14} className="xs:w-4 xs:h-4" />
                      <span className="text-xs xs:text-sm font-medium">My Profile</span>
                    </button>

                    <ThemeMenuItem onClick={() => setShowMobileMenu(false)} />

                    {/* Sign Out */}
                    <button
                      onClick={() => {
                        setShowMobileMenu(false);
                        onSignOut();
                      }}
                      className="w-full px-3 xs:px-4 py-2 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30 flex items-center gap-2"
                    >
                      <LogOut size={14} className="xs:w-4 xs:h-4" />
                      <span className="text-xs xs:text-sm font-medium">Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="container mx-auto px-4 py-8">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 text-center">
            <Users className="w-16 h-16 text-orange-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">No Chairperson Assignment</h2>
            <p className="text-slate-600 dark:text-slate-400">You haven't been assigned as a chairperson yet.</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Contact your administrator for assistance.</p>
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
            loadAvatar();
          }}
        />
      </div>
    );
  }

  const greeting = greetingForHour(new Date().getHours());
  const displayName: string =
    user?.user_metadata?.full_name || user?.user_metadata?.name || (user?.email ? String(user.email).split('@')[0] : 'Chairperson');
  const hasStageRole = allAssignments.some(a => a.region_type === 'stage');
  const activePct = stats.totalSubordinates > 0
    ? `${((stats.activeSubordinates / stats.totalSubordinates) * 100).toFixed(0)}%`
    : '0%';

  const tabs: { id: TabType; label: string; icon: LucideIcon }[] = [
    { id: 'overview', label: 'Overview', icon: TrendingUp },
    { id: 'subordinates', label: 'Chairpersons', icon: Users },
    ...(hasStageRole ? [{ id: 'riders' as TabType, label: 'Riders', icon: Bike }] : []),
    { id: 'commission', label: 'Commission', icon: DollarSign },
  ];
  const activeTabMeta = tabs.find(t => t.id === activeTab) ?? tabs[0];
  const ActiveTabIcon = activeTabMeta.icon;

  // Picking a stage role jumps straight to its riders, as before.
  const handleRoleChange = (assignmentId: string) => {
    const assignment = allAssignments.find(a => a.id === assignmentId);
    if (!assignment) return;
    setSelectedAssignment(assignment);
    setMyCommitteeInfo(assignment);
    if (assignment.region_type === 'stage') setActiveTab('riders');
  };

  const roleCard = (
    <div className="classic-card p-4">
      <label htmlFor="chairperson-active-role" className="classic-label flex items-center gap-1.5">
        <Settings size={12} /> Active role
      </label>
      <select
        id="chairperson-active-role"
        value={selectedAssignment?.id || ''}
        onChange={(e) => handleRoleChange(e.target.value)}
        className="classic-input"
      >
        {allAssignments.map((assignment, idx) => {
          const prefix = idx === 0 ? '⭐ ' : '└ ';
          const suffix = assignment.id.startsWith('virtual-') ? ' (access via top role)' : '';
          return (
            <option key={assignment.id} value={assignment.id}>
              {prefix}{formatRole(assignment.role)}{suffix}
            </option>
          );
        })}
      </select>
      <p className="mt-2 text-xs text-slate-500">Select a role to manage its subordinates and riders.</p>
    </div>
  );

  const assignButtonClass = 'classic-btn classic-btn-primary !w-auto !min-h-[40px] !gap-1.5 !rounded-full !px-4 !py-2 !text-[13px] flex-shrink-0';

  return (
    <div className="min-h-screen classic-page">
      {/* Content without header - header is in UnifiedDashboard */}

      {/* Navigation Tabs - Desktop Only */}
      <div className="hidden md:block bg-white border-b border-[#c4a052]/25 dark:border-slate-700 sticky top-12 xs:top-14 sm:top-16 z-40">
        <div className="container mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide">
            {tabs.map(t => (
              <TabButton
                key={t.id}
                active={activeTab === t.id}
                onClick={() => setActiveTab(t.id)}
                icon={<t.icon size={16} />}
                label={t.label}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Mobile section bar — this dashboard is always rendered inside
          UnifiedDashboard, which already shows the real profile avatar above,
          so this is the current section in serif plus one Menu trigger (the
          "Profile Avatar Menu" on the no-committee fallback screen is the
          exception, untouched). */}
      <div className="md:hidden bg-white border-b border-[#c4a052]/25 dark:border-slate-700 sticky top-12 xs:top-14 z-40">
        <div className="px-4 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ActiveTabIcon size={17} className="flex-shrink-0 text-orange-500" />
            <h1 className="font-classic-display text-[18px] font-semibold leading-none text-slate-800 truncate">
              {activeTabMeta.label}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            aria-label="Open menu"
            aria-expanded={showMobileMenu}
            className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full border border-[#c4a052]/40 bg-[#faf8f3] px-3.5 text-xs font-semibold text-slate-700 shadow-sm active:scale-95 transition-transform dark:border-slate-600 dark:bg-slate-800"
          >
            <LayoutGrid size={14} className="text-orange-500" /> Menu
            <ChevronDown size={14} className={`text-slate-400 transition-transform ${showMobileMenu ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {showMobileMenu && (
          <>
            {/* Tap anywhere outside to dismiss */}
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setShowMobileMenu(false)}
            />
            <div className="classic-card absolute right-3 top-full z-50 mt-1 min-w-[210px] overflow-hidden !rounded-2xl py-1.5">
              {tabs.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(t.id);
                    setShowMobileMenu(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    activeTab === t.id
                      ? 'bg-[#fbf3dc] text-[#7a5a12] dark:bg-[#c4a052]/15 dark:text-[#f0d68f]'
                      : 'text-slate-700 hover:bg-[#faf8f3] dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <t.icon size={16} className={activeTab === t.id ? '' : 'text-orange-500'} />
                  <span className="font-classic-display text-[15px] font-semibold">{t.label}</span>
                </button>
              ))}
              <div className="landing-classic-divider my-1.5" />
              <button
                type="button"
                onClick={() => {
                  setShowMobileMenu(false);
                  setShowProfileModal(true);
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-slate-700 hover:bg-[#faf8f3] dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <User size={16} className="text-orange-500" />
                <span className="text-sm font-medium">My Profile</span>
              </button>
              <ThemeMenuItem onClick={() => setShowMobileMenu(false)} />
            </div>
          </>
        )}
      </div>

      {/* Generous bottom padding so the floating chat button never sits on
          top of the last card when scrolled to the end. */}
      <div className="container mx-auto px-4 pt-5 pb-28">
        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Greeting */}
            <div>
              <h2 className="font-classic-display leading-tight">
                <span className="block text-[18px] font-medium text-slate-500">{greeting},</span>
                <span className="block break-words text-[30px] font-bold tracking-tight text-slate-900">{displayName}</span>
              </h2>
              <p className="mt-1 text-sm text-slate-500">Here's your chairperson dashboard overview.</p>
              <div className="landing-classic-divider mt-4" />
            </div>

            {/* Standing at a glance */}
            <LedgerStats
              items={[
                { label: `Active role${allAssignments.length !== 1 ? 's' : ''}`, value: allAssignments.length, icon: MapPin },
                { label: 'Chairpersons', value: stats.totalSubordinates, icon: Users },
                ...(riders.length > 0 ? [{ label: 'Riders', value: riders.length, icon: Bike }] : []),
              ]}
            />

            {roleCard}

            <div className="space-y-3">
              <SectionHeading>At a glance</SectionHeading>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile icon={DollarSign} tone="bg-orange-50 text-orange-600" label="Commission" value={`${stats.totalCommission.toFixed(1)}%`} caption="Average rate" />
                <StatTile icon={Bike} tone="bg-emerald-50 text-emerald-600" label="Rides" value={stats.monthlyRides} caption="Monthly" />
                <StatTile icon={TrendingUp} tone="bg-sky-50 text-sky-600" label="Active" value={stats.activeSubordinates} caption={`${activePct} of your chairpersons`} />
                <IcanCoinCard variant="premium" userId={user?.id} onGoToWallet={goToWallet} />
              </div>
            </div>

            {/* Quick actions */}
            <div className="space-y-3">
              <SectionHeading>Manage</SectionHeading>
              <div className="space-y-3">
                {[
                  { label: 'Manage Chairpersons', desc: 'View and assign', icon: Users, tile: 'bg-sky-50 text-sky-600', tab: 'subordinates' as TabType, show: true },
                  { label: 'Manage Riders', desc: 'View and assign', icon: Bike, tile: 'bg-emerald-50 text-emerald-600', tab: 'riders' as TabType, show: hasStageRole },
                  { label: 'Commission', desc: 'Track earnings', icon: DollarSign, tile: 'bg-amber-50 text-amber-600', tab: 'commission' as TabType, show: true },
                ].filter(a => a.show).map(a => (
                  <button
                    key={a.tab}
                    type="button"
                    onClick={() => setActiveTab(a.tab)}
                    className="classic-card group flex w-full items-center gap-3 p-4 text-left transition-all active:scale-[0.99] hover:border-orange-300"
                  >
                    <span className={`grid h-11 w-11 flex-shrink-0 place-items-center rounded-2xl ring-1 ring-inset ring-black/5 ${a.tile}`}>
                      <a.icon size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-classic-display text-[17px] font-semibold leading-tight text-slate-800">{a.label}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{a.desc}</span>
                    </span>
                    <ChevronRight size={18} className="flex-shrink-0 text-[#c4a052] transition-transform group-hover:translate-x-0.5" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'subordinates' && (
          <div className="space-y-5">
            <ClassicHeader
              eyebrow="Your team"
              title="Chairpersons"
              subtitle={selectedAssignment ? `Managing ${formatRegionType(selectedAssignment.region_type)} level` : 'Select a role to manage'}
              action={selectedAssignment?.region_type !== 'stage' && (
                <button type="button" onClick={() => setShowAssignModal(true)} className={assignButtonClass}>
                  <UserPlus size={16} /> Assign
                </button>
              )}
            />

            <LedgerStats
              items={[
                { label: 'Total', value: stats.totalSubordinates, icon: Users },
                { label: 'Active', value: stats.activeSubordinates, icon: Check },
                { label: 'Rate', value: activePct, icon: TrendingUp },
              ]}
            />

            {roleCard}

            {/* Chairpersons List */}
            {selectedAssignment?.region_type === 'stage' ? (
              <EmptyState
                icon={Bike}
                title="Switch to Riders"
                lines={["Stage chairpersons don't assign subordinate chairpersons", 'As a stage chairperson, you manage riders instead']}
              >
                <button type="button" onClick={() => setActiveTab('riders')} className="classic-btn classic-btn-primary !w-auto !rounded-full !px-6">
                  <Bike size={18} /> Go to Riders
                </button>
              </EmptyState>
            ) : subordinates.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No Chairpersons Yet"
                lines={['Start building your team', 'Click "Assign" to add your first subordinate chairperson']}
              >
                <button type="button" onClick={() => setShowAssignModal(true)} className="classic-btn classic-btn-primary !w-auto !rounded-full !px-6">
                  <UserPlus size={16} /> Assign First Chairperson
                </button>
              </EmptyState>
            ) : (
              <div className="space-y-3">
                {subordinates.map((subordinate) => (
                  <button
                    key={subordinate.id}
                    type="button"
                    onClick={() => setSelectedSubordinate(subordinate)}
                    className="classic-card group flex w-full items-center gap-3 p-3.5 text-left transition-all active:scale-[0.99] hover:border-orange-300"
                  >
                    <ClassicAvatar name={subordinate.full_name} dot={subordinate.is_active ? 'bg-emerald-500' : 'bg-red-500'} />

                    <div className="min-w-0 flex-1">
                      <h4 className="font-classic-display text-base font-semibold leading-tight text-slate-800 truncate">
                        {subordinate.full_name}
                      </h4>
                      <p className="mt-0.5 text-xs text-slate-500 truncate">{subordinate.email}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#fbf3dc] px-2 py-0.5 text-[10px] font-semibold text-[#7a5a12] ring-1 ring-inset ring-[#c4a052]/40">
                          <User size={10} /> {formatRole(subordinate.role)}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                          <MapPin size={10} /> {subordinate.region_name}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      <div className="text-center">
                        <p className="classic-eyebrow !text-[9px] !tracking-[0.16em]">Rate</p>
                        <p className="font-classic-display text-xl font-bold leading-none text-slate-900">{subordinate.commission_rate}%</p>
                      </div>
                      <ChevronRight size={16} className="text-[#c4a052] transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'riders' && hasStageRole && (
          <div className="space-y-5">
            <ClassicHeader
              eyebrow="Your stage"
              title="Riders"
              subtitle={`From ${allAssignments.filter(a => a.region_type === 'stage').length} stage assignment${allAssignments.filter(a => a.region_type === 'stage').length !== 1 ? 's' : ''}`}
              action={selectedAssignment?.region_type === 'stage' && (
                <button type="button" onClick={() => setShowAssignRiderModal(true)} className={assignButtonClass}>
                  <UserPlus size={16} /> Assign
                </button>
              )}
            />

            <LedgerStats
              items={[
                { label: 'Total', value: riders.length, icon: Bike },
                { label: 'Active', value: riders.filter(r => r.status === 'active').length, icon: Check },
                { label: 'Pending', value: riders.filter(r => r.status === 'pending').length, icon: Calendar },
                { label: 'Rides', value: riders.reduce((sum, r) => sum + (r.completed_rides || 0), 0), icon: TrendingUp },
              ]}
            />

            {/* Riders List */}
            {riders.length === 0 ? (
              <EmptyState
                icon={Bike}
                title="No Riders Yet"
                lines={[
                  selectedAssignment?.region_type === 'stage' ? 'Start building your rider network' : 'Select a stage assignment to manage riders',
                  selectedAssignment?.region_type === 'stage' ? 'Click "Assign" to add your first rider' : 'Switch to a stage role to assign riders',
                ]}
              >
                {selectedAssignment?.region_type === 'stage' && (
                  <button type="button" onClick={() => setShowAssignRiderModal(true)} className="classic-btn classic-btn-primary !w-auto !rounded-full !px-6">
                    <UserPlus size={16} /> Assign First Rider
                  </button>
                )}
              </EmptyState>
            ) : (
              <div className="space-y-3">
                {riders.map((rider) => (
                  <button
                    key={rider.id}
                    type="button"
                    onClick={() => setSelectedRider(rider)}
                    className="classic-card group flex w-full items-center gap-3 p-3.5 text-left transition-all active:scale-[0.99] hover:border-orange-300"
                  >
                    <ClassicAvatar
                      name={rider.full_name}
                      dot={rider.status === 'active' ? 'bg-emerald-500' : rider.status === 'pending' ? 'bg-amber-400' : 'bg-red-500'}
                    />

                    <div className="min-w-0 flex-1">
                      <h4 className="font-classic-display text-base font-semibold leading-tight text-slate-800 truncate">
                        {rider.full_name}
                      </h4>
                      <p className="mt-0.5 text-xs text-slate-500 truncate">{rider.email}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#fbf3dc] px-2 py-0.5 text-[10px] font-semibold capitalize text-[#7a5a12] ring-1 ring-inset ring-[#c4a052]/40">
                          <Bike size={10} /> {rider.vehicle_type}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                          {rider.plate_number}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      <div className="text-center">
                        <p className="font-classic-display text-sm font-bold leading-none text-slate-900">⭐ {rider.rating.toFixed(1)}</p>
                        <p className="mt-1 text-[10px] text-slate-500">{rider.completed_rides} rides</p>
                      </div>
                      <ChevronRight size={16} className="text-[#c4a052] transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'commission' && (
          <div className="space-y-5">
            <ClassicHeader eyebrow="Earnings" title="Commission" subtitle="Track your earnings and rates" />

            {/* Total earned — the one number this tab exists for */}
            <div className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#231b12] via-[#2f2415] to-[#4a3418] p-5 text-white shadow-[0_18px_34px_-16px_rgba(0,0,0,0.65)] ring-1 ring-inset ring-[#c4a052]/40">
              <span aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full border border-[#c4a052]/25" />
              <span aria-hidden className="pointer-events-none absolute -right-5 -top-5 h-28 w-28 rounded-full border border-[#c4a052]/20" />
              <span aria-hidden className="pointer-events-none absolute -bottom-14 -left-10 h-40 w-40 rounded-full bg-orange-500/20 blur-2xl" />
              <div className="relative">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#e6c980]">Total earned</p>
                <p className="mt-1 break-words font-classic-display text-[30px] font-bold leading-tight">{formatUGX(totalEarned)}</p>
                <div className="mt-4 flex items-center gap-4 border-t border-[#c4a052]/30 pt-3 text-xs text-white/75">
                  <span className="flex items-center gap-1.5"><DollarSign size={13} className="text-[#e6c980]" /> {stats.totalCommission.toFixed(1)}% avg rate</span>
                  <span className="flex items-center gap-1.5"><Bike size={13} className="text-[#e6c980]" /> {stats.monthlyRides} rides</span>
                </div>
              </div>
            </div>

            {/* Commission Cards — collapsible on mobile (tap header to open), always expanded side-by-side from lg up */}
            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-6">
              <CommissionSection
                open={openCommissionSection === 'summary'}
                onToggle={() => setOpenCommissionSection(openCommissionSection === 'summary' ? null : 'summary')}
                icon={BarChart3}
                tone="bg-orange-50 text-orange-600 ring-orange-100"
                title="Commission Summary"
                subtitle="Your earnings breakdown"
              >
                <div className="space-y-3.5">
                  {[
                    { label: 'This month', amount: thisMonthEarned, strong: false },
                    { label: 'Last month', amount: lastMonthEarned, strong: false },
                    { label: 'Total earned', amount: totalEarned, strong: true },
                  ].map(line => (
                    <div key={line.label} className={`flex items-end ${line.strong ? 'border-t border-[#c4a052]/40 pt-3.5' : ''}`}>
                      <span className={`whitespace-nowrap ${line.strong ? 'font-classic-display text-base font-bold text-slate-900' : 'text-sm text-slate-600'}`}>{line.label}</span>
                      <span className="classic-leader" />
                      <span className={`whitespace-nowrap ${line.strong ? 'font-classic-display text-lg font-bold text-[#7a5a12]' : 'text-sm font-semibold text-slate-800'}`}>{formatUGX(line.amount)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-xl border border-[#c4a052]/40 bg-[#fbf3dc] p-3.5 dark:bg-[#c4a052]/10">
                  <p className="flex items-start gap-2 text-[13px] leading-snug text-[#7a5a12] dark:text-[#f0d68f]">
                    <span aria-hidden>💡</span>
                    <span className="font-medium">Commission credits automatically when a rider completes a ride or settles cash owed.</span>
                  </p>
                </div>
              </CommissionSection>

              <CommissionSection
                open={openCommissionSection === 'activity'}
                onToggle={() => setOpenCommissionSection(openCommissionSection === 'activity' ? null : 'activity')}
                icon={TrendingUp}
                tone="bg-emerald-50 text-emerald-600 ring-emerald-100"
                title="Recent Activity"
                subtitle="Latest transactions"
              >
                {commissions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <span className="grid h-14 w-14 place-items-center rounded-full bg-[#faf8f3] ring-1 ring-[#c4a052]/40 dark:bg-slate-700">
                      <BarChart3 className="text-[#c4a052]" size={26} />
                    </span>
                    <p className="mt-3 font-classic-display text-base font-semibold text-slate-800">No activity yet</p>
                    <p className="mt-1 max-w-xs text-sm text-slate-500">
                      Your commission activity will appear here once rides start generating earnings
                    </p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto pr-1">
                    {commissions.slice(0, 10).map((c, i) => (
                      <div
                        key={c.id}
                        className={`flex items-center justify-between gap-3 py-3 ${i > 0 ? 'border-t border-[#c4a052]/20' : ''}`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">
                            {formatUGX(c.commission_amount)}
                            <span className="text-xs font-normal text-slate-500"> ({c.commission_percentage}% of {formatUGX(c.ride_fare)})</span>
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {new Date(c.paid_at || c.created_at).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                        </div>
                        <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize ${
                          c.status === 'paid' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:ring-emerald-800' :
                          c.status === 'pending' ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-800' :
                          'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-900/30 dark:text-red-400 dark:ring-red-800'
                        }`}>
                          {c.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CommissionSection>
            </div>

            {/* Commission Rates by Assignment */}
            <CommissionSection
              open={openCommissionSection === 'rates'}
              onToggle={() => setOpenCommissionSection(openCommissionSection === 'rates' ? null : 'rates')}
              icon={MapPin}
              tone="bg-amber-50 text-amber-600 ring-amber-100"
              title="Commission Rates by Role"
              subtitle="Your rates across different assignments"
            >
              {allAssignments.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No assignments found</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {allAssignments.map((assignment, index) => (
                    <div
                      key={assignment.id}
                      className={`classic-tile p-4 ${index === 0 ? 'is-active' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-[#faf8f3] ring-1 ring-[#c4a052]/40 dark:bg-slate-700">
                          <MapPin className="text-orange-500" size={16} />
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                          index === 0
                            ? 'bg-[#c4a052] text-white'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        }`}>
                          {index === 0 ? '⭐ Primary' : 'Secondary'}
                        </span>
                      </div>
                      <h4 className="mt-3 font-classic-display text-base font-semibold capitalize text-slate-800">
                        {formatRole(assignment.role)}
                      </h4>
                      <p className="text-xs capitalize text-slate-500">
                        {formatRegionType(assignment.region_type)}
                      </p>
                      <div className="mt-3 flex items-end border-t border-[#c4a052]/30 pt-3">
                        <span className="classic-eyebrow !tracking-[0.16em]">Commission</span>
                        <span className="classic-leader" />
                        <span className="font-classic-display text-2xl font-bold leading-none text-slate-900">{assignment.commission_rate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CommissionSection>
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
          loadAvatar();
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
          stageName={selectedAssignment.region_name || undefined}
          onClose={() => setShowAssignRiderModal(false)}
          onSuccess={() => {
            setShowAssignRiderModal(false);
            loadDashboardData();
            toast.success('Rider assigned successfully!');
          }}
        />
      )}

      {/* Manage Subordinate Chairperson Modal */}
      {selectedSubordinate && (
        <ManageSubordinateModal
          subordinate={selectedSubordinate}
          onClose={() => setSelectedSubordinate(null)}
          onSuccess={() => {
            setSelectedSubordinate(null);
            loadDashboardData();
          }}
        />
      )}

      {/* Manage Rider Modal */}
      {selectedRider && (
        <ManageRiderModal
          rider={selectedRider}
          onClose={() => setSelectedRider(null)}
          onSuccess={() => {
            setSelectedRider(null);
            loadDashboardData();
          }}
        />
      )}
    </div>
  );
}

// ── Classic-look building blocks for this page (ivory / ink / gold — see index.css `classic-*`) ──

// Gold eyebrow, serif title, hairline; optional action (e.g. Assign) on the right.
function ClassicHeader({ eyebrow, title, subtitle, action }: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="classic-eyebrow">{eyebrow}</p>
          <h2 className="mt-1 font-classic-display text-[28px] font-bold leading-tight tracking-tight text-slate-900">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {action || null}
      </div>
      <div className="landing-classic-divider mt-4" />
    </div>
  );
}

// A row of headline figures in one card, split by gold hairlines.
function LedgerStats({ items }: { items: { label: string; value: React.ReactNode; icon: LucideIcon }[] }) {
  return (
    <div
      className="classic-card grid divide-x divide-[#c4a052]/25 dark:divide-slate-700"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map(item => (
        <div key={item.label} className="min-w-0 px-2 py-4 text-center">
          <item.icon size={16} className="mx-auto text-orange-500" />
          <p className="mt-2 truncate font-classic-display text-[22px] font-bold leading-none text-slate-900 sm:text-[26px]">{item.value}</p>
          <p className="classic-eyebrow mt-2 truncate !tracking-[0.14em]">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

function StatTile({ icon: Icon, tone, label, value, caption }: {
  icon: LucideIcon;
  tone: string;
  label: string;
  value: React.ReactNode;
  caption: string;
}) {
  return (
    <div className="classic-card p-4">
      <span className={`grid h-10 w-10 place-items-center rounded-2xl ring-1 ring-inset ring-black/5 ${tone}`}>
        <Icon size={18} />
      </span>
      <p className="mt-3 font-classic-display text-[28px] font-bold leading-none text-slate-900">{value}</p>
      <p className="mt-1.5 text-[13px] font-semibold text-slate-700">{label}</p>
      <p className="text-xs text-slate-400">{caption}</p>
    </div>
  );
}

// Initial in a gold-ringed circle, with a status dot (green / amber / red).
function ClassicAvatar({ name, dot }: { name: string; dot: string }) {
  return (
    <div className="relative flex-shrink-0">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 font-classic-display text-xl font-bold text-white ring-2 ring-[#e6c980] ring-offset-2 ring-offset-white dark:ring-offset-slate-800">
        {name.charAt(0).toUpperCase()}
      </span>
      <span className={`absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-slate-800 ${dot}`} />
    </div>
  );
}

function EmptyState({ icon: Icon, title, lines, children }: {
  icon: LucideIcon;
  title: string;
  lines: string[];
  children?: React.ReactNode;
}) {
  return (
    <div className="classic-card px-6 py-9 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#faf8f3] ring-1 ring-[#c4a052]/50 dark:bg-slate-700">
        <Icon className="text-[#c4a052]" size={28} strokeWidth={1.6} />
      </span>
      <h3 className="mt-4 font-classic-display text-xl font-semibold text-slate-800">{title}</h3>
      <div className="landing-classic-divider mx-auto my-3 max-w-[140px]" />
      {lines.map(line => (
        <p key={line} className="text-sm text-slate-500">{line}</p>
      ))}
      {children && <div className="mt-5 flex justify-center">{children}</div>}
    </div>
  );
}

// Collapsible on mobile (tap the header), always open from lg up.
function CommissionSection({ open, onToggle, icon: Icon, tone, title, subtitle, children }: {
  open: boolean;
  onToggle: () => void;
  icon: LucideIcon;
  tone: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="classic-card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left lg:cursor-default"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-full ring-1 ring-inset ${tone}`}>
            <Icon size={17} />
          </span>
          <span className="min-w-0">
            <span className="block font-classic-display text-lg font-semibold leading-tight text-slate-800">{title}</span>
            <span className="block text-xs text-slate-500">{subtitle}</span>
          </span>
        </span>
        <ChevronDown size={18} className={`flex-shrink-0 text-slate-400 transition-transform lg:hidden ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`${open ? 'block' : 'hidden'} lg:block px-4 pb-4`}>
        <div className="landing-classic-divider mb-4" />
        {children}
      </div>
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
      className={`flex items-center gap-2 px-4 py-3 font-classic-display font-semibold transition-all relative whitespace-nowrap text-[15px] ${
        active
          ? 'text-[#7a5a12] dark:text-[#f0d68f]'
          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
      }`}
    >
      <span className={active ? 'text-orange-500' : ''}>{icon}</span>
      {label}
      {active && (
        <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-[#c4a052]" />
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

  const selectedUser = users.find(u => u.id === selectedUserId);
  const displayName = (u: any) => u?.mbg_user_profiles?.[0]?.full_name || u?.email?.split('@')[0] || 'User';
  const canSubmit = !assigning && !!selectedUserId && !!plateNumber && !!licenseNumber;
  const vehicleOptions: { value: 'motorcycle' | 'bicycle' | 'tuktuk'; label: string; emoji: string }[] = [
    { value: 'motorcycle', label: 'Boda', emoji: '🏍️' },
    { value: 'bicycle', label: 'Bicycle', emoji: '🚲' },
    { value: 'tuktuk', label: 'Tuktuk', emoji: '🛺' },
  ];

  // Lock background scroll while the sheet is open so the page behind it
  // can't drift and push the sheet's top out of view on small phones.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Portal to <body> so no transformed/sticky ancestor or the z-50 header can
  // clip or cover the top of the sheet.
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !assigning) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="classic-card flex w-full max-h-[92vh] max-h-[92dvh] flex-col overflow-hidden !rounded-b-none sm:max-w-2xl sm:max-h-[90vh] sm:max-h-[90dvh] sm:!rounded-b-[20px]"
      >
        {/* Header — stays put while the form scrolls */}
        <div className="shrink-0 border-b border-slate-200 px-4 pb-3 pt-2 sm:px-6 sm:pt-5">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="classic-eyebrow">Stage chairperson</p>
              <h3 className="font-classic-display text-lg font-bold leading-tight text-slate-800 sm:text-xl">Assign Rider</h3>
              {stageName && <p className="mt-0.5 truncate text-xs text-slate-500">{stageName}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={assigning}
              aria-label="Close"
              className="-mr-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {/* User Selection */}
          <section>
            <label className="classic-label">Select user *</label>

            {loadingUsers ? (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-orange-500" />
                Loading users...
              </div>
            ) : selectedUser ? (
              <div className="flex items-center gap-3 rounded-xl border border-green-300 bg-green-50 p-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-500 font-bold text-white">
                  {displayName(selectedUser).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{displayName(selectedUser)}</p>
                  <p className="truncate text-xs text-slate-600">{selectedUser.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedUserId('')}
                  className="flex-shrink-0 rounded-full px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search name or email"
                    className="classic-input !pl-10"
                  />
                </div>

                <div className="max-h-[38vh] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 sm:max-h-56">
                  {filteredUsers.length === 0 ? (
                    <div className="p-4 text-center text-sm text-slate-500">
                      {searchQuery ? 'No users found' : 'No users available'}
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredUsers.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => setSelectedUserId(user.id)}
                          className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
                        >
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-600">
                            {displayName(user).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-800">{displayName(user)}</p>
                            <p className="truncate text-xs text-slate-500">{user.email}</p>
                          </div>
                          <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-600">
                            {user.role_type}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>

          {/* Vehicle Information */}
          <section className="space-y-4 border-t border-slate-200 pt-4">
            <h4 className="text-sm font-semibold text-slate-700">Vehicle information</h4>

            <div>
              <label className="classic-label">Vehicle type *</label>
              <div className="grid grid-cols-3 gap-2">
                {vehicleOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setVehicleType(opt.value)}
                    aria-pressed={vehicleType === opt.value}
                    className={`flex min-h-[56px] flex-col items-center justify-center rounded-xl border px-1 py-2 text-xs font-semibold transition-colors ${
                      vehicleType === opt.value
                        ? 'border-orange-400 bg-orange-50 text-orange-700 ring-1 ring-orange-400'
                        : 'border-slate-200 text-slate-600 hover:border-orange-200'
                    }`}
                  >
                    <span className="text-lg leading-none">{opt.emoji}</span>
                    <span className="mt-1">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="classic-label">Plate number *</label>
                <input
                  type="text"
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                  className="classic-input uppercase"
                  placeholder="UBD 123A"
                  autoCapitalize="characters"
                  autoComplete="off"
                  required
                />
              </div>

              <div>
                <label className="classic-label">License number *</label>
                <input
                  type="text"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  className="classic-input"
                  placeholder="License number"
                  autoComplete="off"
                  required
                />
              </div>

              <div>
                <label className="classic-label">License expiry</label>
                <input
                  type="date"
                  value={licenseExpiry}
                  onChange={(e) => setLicenseExpiry(e.target.value)}
                  className="classic-input"
                />
              </div>

              <div>
                <label className="classic-label">Vehicle model</label>
                <input
                  type="text"
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  className="classic-input"
                  placeholder="e.g., Bajaj Boxer"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="min-w-0">
                <label className="classic-label">Year</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={vehicleYear}
                  onChange={(e) => setVehicleYear(e.target.value)}
                  className="classic-input"
                  placeholder="2023"
                  min="1990"
                  max={new Date().getFullYear() + 1}
                />
              </div>

              <div className="min-w-0">
                <label className="classic-label">Color</label>
                <input
                  type="text"
                  value={vehicleColor}
                  onChange={(e) => setVehicleColor(e.target.value)}
                  className="classic-input"
                  placeholder="e.g., Red"
                />
              </div>
            </div>
          </section>
        </div>

        {/* Footer — always reachable above the keyboard / home indicator */}
        <div className="flex shrink-0 gap-2 border-t border-slate-200 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-3 sm:px-6 sm:pb-4">
          <button
            type="button"
            onClick={onClose}
            disabled={assigning}
            className="classic-btn classic-btn-outline !w-auto flex-shrink-0 !px-4"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="classic-btn classic-btn-primary min-w-0 flex-1"
          >
            {assigning ? (
              <>
                <div className="inline-block h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                <span>Assigning...</span>
              </>
            ) : (
              <>
                <Bike size={18} />
                <span className="truncate">Assign Rider</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

// Manage a specific subordinate chairperson — edit commission rate, activate/deactivate
interface ManageSubordinateModalProps {
  subordinate: SubordinateChairperson;
  onClose: () => void;
  onSuccess: () => void;
}

function ManageSubordinateModal({ subordinate, onClose, onSuccess }: ManageSubordinateModalProps) {
  const [commissionRate, setCommissionRate] = useState(String(subordinate.commission_rate));
  const [savingRate, setSavingRate] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);

  const formatRole = (role: string) => role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const handleSaveRate = async () => {
    const rate = parseFloat(commissionRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('Commission rate must be between 0 and 100');
      return;
    }
    setSavingRate(true);
    const result = await chairpersonService.updateSubordinate(subordinate.id, { commissionRate: rate });
    setSavingRate(false);
    if (result.success) {
      toast.success('Commission rate updated');
      onSuccess();
    } else {
      toast.error(result.error || 'Failed to update commission rate');
    }
  };

  const handleToggleStatus = async () => {
    setTogglingStatus(true);
    const result = await chairpersonService.updateSubordinate(subordinate.id, { isActive: !subordinate.is_active });
    setTogglingStatus(false);
    if (result.success) {
      toast.success(subordinate.is_active ? 'Chairperson deactivated' : 'Chairperson reactivated');
      onSuccess();
    } else {
      toast.error(result.error || 'Failed to update status');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-slate-800">Manage Chairperson</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        {/* Profile */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg flex-shrink-0">
            {subordinate.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h4 className="font-bold text-slate-800 truncate">{subordinate.full_name}</h4>
            <p className="text-sm text-slate-600 truncate">{subordinate.email}</p>
            {subordinate.phone && <p className="text-xs text-slate-500">{subordinate.phone}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-500 font-medium">Role</p>
            <p className="font-semibold text-slate-800">{formatRole(subordinate.role)}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-500 font-medium">Region</p>
            <p className="font-semibold text-slate-800">{subordinate.region_name || '—'}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-500 font-medium">Status</p>
            <p className={`font-semibold ${subordinate.is_active ? 'text-green-600' : 'text-red-600'}`}>
              {subordinate.is_active ? 'Active' : 'Inactive'}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-500 font-medium">Appointed</p>
            <p className="font-semibold text-slate-800">
              {new Date(subordinate.appointed_at).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Commission Rate */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">Commission Rate (%)</label>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
            <button
              onClick={handleSaveRate}
              disabled={savingRate || commissionRate === String(subordinate.commission_rate)}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50 text-sm font-medium flex-shrink-0"
            >
              {savingRate ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2 border-t border-slate-200">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors mt-4"
          >
            Close
          </button>
          <button
            onClick={handleToggleStatus}
            disabled={togglingStatus}
            className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 mt-4 ${
              subordinate.is_active
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
          >
            {togglingStatus ? 'Updating...' : subordinate.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Manage a specific rider — approve / suspend / reactivate
interface ManageRiderModalProps {
  rider: Rider;
  onClose: () => void;
  onSuccess: () => void;
}

function ManageRiderModal({ rider, onClose, onSuccess }: ManageRiderModalProps) {
  const [updating, setUpdating] = useState(false);

  const handleSetStatus = async (status: 'active' | 'suspended' | 'inactive') => {
    setUpdating(true);
    const result = await riderService.updateRiderStatus(rider.id, status);
    setUpdating(false);
    if (result.success) {
      toast.success(`Rider ${status === 'active' ? 'approved' : status === 'suspended' ? 'suspended' : 'deactivated'}`);
      onSuccess();
    } else {
      toast.error(result.error || 'Failed to update rider status');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-slate-800">Manage Rider</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        {/* Profile */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-14 h-14 bg-gradient-to-br from-green-500 via-emerald-500 to-teal-500 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg flex-shrink-0">
            {rider.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h4 className="font-bold text-slate-800 truncate">{rider.full_name}</h4>
            <p className="text-sm text-slate-600 truncate">{rider.email}</p>
            {rider.phone && <p className="text-xs text-slate-500">{rider.phone}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-500 font-medium">Vehicle</p>
            <p className="font-semibold text-slate-800 capitalize">{rider.vehicle_type}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-500 font-medium">Plate Number</p>
            <p className="font-semibold text-slate-800 uppercase">{rider.plate_number}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-500 font-medium">License</p>
            <p className="font-semibold text-slate-800">{rider.license_number}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-500 font-medium">Status</p>
            <p className={`font-semibold capitalize ${
              rider.status === 'active' ? 'text-green-600' :
              rider.status === 'pending' ? 'text-yellow-600' : 'text-red-600'
            }`}>
              {rider.status}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-500 font-medium">Rating</p>
            <p className="font-semibold text-slate-800">⭐ {rider.rating.toFixed(1)}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-500 font-medium">Completed Rides</p>
            <p className="font-semibold text-slate-800">{rider.completed_rides}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2 border-t border-slate-200 mt-2">
          {rider.status === 'pending' && (
            <button
              onClick={() => handleSetStatus('active')}
              disabled={updating}
              className="w-full mt-4 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 font-medium"
            >
              {updating ? 'Updating...' : 'Approve Rider'}
            </button>
          )}
          {rider.status === 'active' && (
            <button
              onClick={() => handleSetStatus('suspended')}
              disabled={updating}
              className="w-full mt-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 font-medium"
            >
              {updating ? 'Updating...' : 'Suspend Rider'}
            </button>
          )}
          {(rider.status === 'suspended' || rider.status === 'inactive') && (
            <button
              onClick={() => handleSetStatus('active')}
              disabled={updating}
              className="w-full mt-4 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 font-medium"
            >
              {updating ? 'Updating...' : 'Reactivate Rider'}
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
