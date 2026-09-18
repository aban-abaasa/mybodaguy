import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bike, Users, MapPin, DollarSign, Settings,
  TrendingUp, LogOut, Menu, X, Shield, Search,
  MessageSquare, RefreshCw, Globe, Lock, Trash2, Send, CheckCircle, Mail, Gift,
  ShoppingBag, ChevronRight, Truck, XCircle, Activity, Share2,
} from 'lucide-react';
import { toast } from 'sonner';
import { userService } from '../services/userService';
import { roleService } from '../services/roleService';
import RegionsManagement from '../components/RegionsManagement';
import IcanCoinCard from '../components/IcanCoinCard';
import SupermarketProductManager from '../components/SupermarketProductManager';
import { supabase } from '../services/supabaseClient';
import { Linkify } from '../utils/linkify';
import {
  devListAllLandingMessages,
  devDeleteLandingMessage,
  devReplyToLandingMessage,
  devMarkCorrectAnswer,
  devGrantLandingBonus,
  type LandingMessage,
} from '../services/landingMessagesService';
import {
  listConversations,
  fetchMessages as fetchChatMessages,
  sendMessage as sendChatMessage,
  markConversationRead,
  subscribeToAllConversations,
  subscribeToMessages as subscribeToChatMessages,
} from '../services/chatService';

interface DeveloperDashboardProps {
  user: any;
  onSignOut: () => void;
  // Set when rendered inside UnifiedDashboard's role-tab view, which already
  // shows its own brand/avatar header above this one — skips this
  // component's own <header> so a multi-role account doesn't get two.
  embedded?: boolean;
  // See CustomerDashboard.tsx's onGoToWallet doc — switches UnifiedDashboard's
  // internal activeRole instead of a hard-navigating to a URL nothing serves.
  onGoToWallet?: () => void;
}

type DevPermissions = { isMain: boolean; allowedTabs: string[] | null };
type DevOperatorRow = { email: string; is_main: boolean; allowed_tabs: string[] | null; added_at: string };

const ALL_DEV_TAB_IDS = ['overview', 'users', 'applications', 'regions', 'commissions', 'supermarkets', 'transport', 'rewards', 'public-board', 'messages', 'settings'];

export default function DeveloperDashboard({ user, onSignOut, embedded = false, onGoToWallet }: DeveloperDashboardProps) {
  const goToWallet = onGoToWallet ?? (() => { window.location.href = '/ican-wallet'; });
  const [activeTab, setActiveTab] = useState('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [transportOrders, setTransportOrders] = useState<any[]>([]);
  const [transportLoading, setTransportLoading] = useState(false);

  // null allowedTabs = unrestricted (all tabs) — the graceful default
  // shown while mbg_developer_self() is still loading, matching how
  // pre-existing developers keep full access unless explicitly restricted.
  const [permissions, setPermissions] = useState<DevPermissions>({ isMain: false, allowedTabs: null });
  const [operators, setOperators] = useState<DevOperatorRow[]>([]);
  const [operatorsLoaded, setOperatorsLoaded] = useState(false);
  const [savingTabsFor, setSavingTabsFor] = useState<string | null>(null);

  // Transport was added after the original developer-tab permission rows were
  // created. Keep the monitor visible for existing BodaGo developers; the
  // underlying monitor RPC still rejects anyone who is not an active developer.
  const isTabAllowed = (id: string) =>
    id === 'transport' || permissions.isMain || permissions.allowedTabs == null || permissions.allowedTabs.includes(id);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('mbg_developer_self');
      const self = data?.[0];
      if (self) setPermissions({ isMain: !!self.is_main, allowedTabs: self.allowed_tabs });
    })();
  }, []);

  // If the tabs this developer is allowed to see change (e.g. the main
  // developer just restricted them) and the currently-open tab is no
  // longer one of them, fall back to whatever they can still see instead
  // of showing a blank main area with no highlighted tab.
  useEffect(() => {
    const allowed = ALL_DEV_TAB_IDS.filter(isTabAllowed);
    if (!allowed.includes(activeTab) && allowed.length > 0) {
      setActiveTab(allowed[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions.isMain, permissions.allowedTabs]);

  const loadOperators = useCallback(async () => {
    if (!permissions.isMain) return;
    const { data } = await supabase.rpc('mbg_list_developers');
    setOperators(data || []);
    setOperatorsLoaded(true);
  }, [permissions.isMain]);

  useEffect(() => {
    if (permissions.isMain) loadOperators();
  }, [permissions.isMain, loadOperators]);

  const toggleOperatorTab = async (email: string, tabId: string, currentlyAllowed: boolean) => {
    const op = operators.find(o => o.email === email);
    if (!op) return;
    const base = op.allowed_tabs == null ? [...ALL_DEV_TAB_IDS] : op.allowed_tabs;
    const next = currentlyAllowed ? base.filter(t => t !== tabId) : [...base, tabId];

    setSavingTabsFor(email);
    try {
      await supabase.rpc('mbg_set_developer_tabs', { target_email: email, tabs: next });
      setOperators(prev => prev.map(o => o.email === email ? { ...o, allowed_tabs: next } : o));
    } catch (e) {
      console.error('Failed to update developer tabs:', e);
    } finally {
      setSavingTabsFor(null);
    }
  };

  // Grant developer access by picking a real account — reuses `users`
  // (already fetched via userService.getAllUsers() for the Users tab)
  // client-side instead of a separate search RPC, so this can't fail for
  // reasons unrelated to actually granting access.
  const [accountQuery, setAccountQuery] = useState('');
  const [grantingId, setGrantingId] = useState<string | null>(null);

  const developerEmails = new Set(operators.map(o => o.email.toLowerCase()));
  const accountResults = accountQuery.trim()
    ? users
        .filter((u) => u.email && u.email.toLowerCase().includes(accountQuery.trim().toLowerCase()))
        .slice(0, 25)
    : [];

  const grantDeveloperTo = async (accountId: string) => {
    setGrantingId(accountId);
    try {
      await roleService.promoteToDeveloper(accountId);
      await loadOperators();
    } catch (e) {
      console.error('Failed to grant developer access:', e);
    } finally {
      setGrantingId(null);
    }
  };

  // Signal to ChatWidget that a real developer session is actively viewing
  // this dashboard, so the floating widget hides itself (mirrors the other
  // 3 apps hiding their widget on their hidden dev-token panel) — mybodaguy
  // has no token panel, just a real authenticated developer role instead.
  useEffect(() => {
    try {
      sessionStorage.setItem('mbg_developer_active', 'true');
    } catch {
      // ignore storage errors (private browsing, quota, etc.)
    }
    return () => {
      try {
        sessionStorage.removeItem('mbg_developer_active');
      } catch {
        // ignore
      }
    };
  }, []);

  const loadUsers = async () => {
    try {
      const data = await userService.getAllUsers();
      setUsers(data || []);
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const loadTransportOrders = useCallback(async () => {
    setTransportLoading(true);
    try {
      const { data, error } = await supabase.rpc('ican_dev_get_transport_orders');
      if (error) throw error;
      setTransportOrders(data || []);
    } catch (error: any) {
      console.error('Error loading CMMS transport orders:', error);
      setTransportOrders([]);
      toast.error(error?.message || 'Failed to load transport orders');
    } finally {
      setTransportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'transport') loadTransportOrders();
  }, [activeTab, loadTransportOrders]);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: TrendingUp },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'applications', label: 'Applications', icon: Truck },
    { id: 'regions', label: 'Regions', icon: MapPin },
    { id: 'commissions', label: 'Commissions', icon: DollarSign },
    { id: 'supermarkets', label: 'Supermarkets', icon: ShoppingBag },
    { id: 'transport', label: 'Transport', icon: Activity },
    { id: 'rewards', label: 'Rewards', icon: Gift },
    { id: 'public-board', label: 'Public Board', icon: MessageSquare },
    { id: 'messages', label: 'Messages', icon: Mail },
    { id: 'settings', label: 'Settings', icon: Settings },
  ].filter(t => isTabAllowed(t.id));

  if (permissions.isMain) {
    tabs.push({ id: 'operators', label: 'Developers', icon: Lock });
    tabs.push({ id: 'support-links', label: 'Support Links', icon: Share2 });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header (skipped when embedded — UnifiedDashboard already shows this) */}
      {!embedded && (
        <header className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-lg sticky top-0 z-50">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-3">
                <Bike size={28} />
                <div>
                  <h1 className="text-xl font-bold">BodaGoEra</h1>
                  <p className="text-xs opacity-90">Developer Panel</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="hidden md:flex items-center gap-2 bg-white/20 px-3 py-1 rounded-full">
                  <Shield size={16} />
                  <span className="text-sm font-medium">Developer</span>
                </div>
                <button
                  onClick={onSignOut}
                  className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                >
                  <LogOut size={18} />
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              </div>
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-md p-2 mb-8 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-md'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon size={18} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          {activeTab === 'overview' && <OverviewTab onSwitchToRegions={() => setActiveTab('regions')} onSwitchToCommissions={() => setActiveTab('commissions')} userId={user?.id} onGoToWallet={goToWallet} />}
          {activeTab === 'users' && <UsersTab users={users} loading={loading} onReload={loadUsers} />}
          {activeTab === 'applications' && <ApplicationsTab />}
          {activeTab === 'regions' && <RegionsManagement />}
          {activeTab === 'commissions' && <CommissionsTab />}
          {activeTab === 'supermarkets' && <SupermarketsTab />}
          {activeTab === 'transport' && <TransportOrdersTab orders={transportOrders} loading={transportLoading} onRefresh={loadTransportOrders} />}
          {activeTab === 'rewards' && <RewardsTab />}
          {activeTab === 'public-board' && <PublicBoardTab />}
          {activeTab === 'messages' && <MessagesTab />}
          {activeTab === 'settings' && <SettingsTab />}
          {activeTab === 'operators' && permissions.isMain && (
            <DeveloperAccessTab
              operators={operators}
              operatorsLoaded={operatorsLoaded}
              savingTabsFor={savingTabsFor}
              onToggleTab={toggleOperatorTab}
              accountQuery={accountQuery}
              accountResults={accountResults}
              developerEmails={developerEmails}
              grantingId={grantingId}
              onSearch={setAccountQuery}
              onGrant={grantDeveloperTo}
            />
          )}
          {activeTab === 'support-links' && permissions.isMain && <SupportLinksTab />}
        </div>
      </div>
    </div>
  );
}

function DeveloperAccessTab({
  operators,
  operatorsLoaded,
  savingTabsFor,
  onToggleTab,
  accountQuery,
  accountResults,
  developerEmails,
  grantingId,
  onSearch,
  onGrant,
}: {
  operators: DevOperatorRow[];
  operatorsLoaded: boolean;
  savingTabsFor: string | null;
  onToggleTab: (email: string, tabId: string, currentlyAllowed: boolean) => void;
  accountQuery: string;
  accountResults: any[];
  developerEmails: Set<string>;
  grantingId: string | null;
  onSearch: (query: string) => void;
  onGrant: (accountId: string) => void;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Grant Access</h2>
      <p className="text-sm text-slate-600 mb-4">
        Search users already on this project to grant developer access to.
      </p>
      <input
        type="text"
        value={accountQuery}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search by name or email…"
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
      />
      <div className="mt-3 mb-8 space-y-2">
        {accountResults.map((acc) => {
          const alreadyDeveloper = developerEmails.has((acc.email || '').toLowerCase());
          const fullName = acc.mbg_user_profiles?.[0]?.full_name;
          return (
            <div key={acc.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{fullName || acc.email}</p>
                <p className="truncate text-[11px] text-slate-500">{acc.email}</p>
              </div>
              <button
                onClick={() => onGrant(acc.id)}
                disabled={alreadyDeveloper || grantingId === acc.id}
                className="flex-shrink-0 text-xs px-3 py-1.5 bg-violet-100 text-violet-700 rounded-md hover:bg-violet-200 transition-colors font-medium disabled:opacity-40"
              >
                {alreadyDeveloper ? 'Already has access' : grantingId === acc.id ? 'Granting…' : 'Grant access'}
              </button>
            </div>
          );
        })}
        {accountQuery && accountResults.length === 0 && (
          <p className="text-xs text-slate-500">No matching accounts found.</p>
        )}
      </div>

      <h2 className="text-2xl font-bold text-slate-800 mb-2">Developer Access</h2>
      <p className="text-sm text-slate-600 mb-6">
        Choose which tabs each developer can see. The main developer always sees everything.
        A developer with no tabs checked sees nothing until you grant some.
      </p>

      {!operatorsLoaded ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          {operators.map((op) => (
            <div key={op.email} className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-slate-800">{op.email}</p>
                {op.is_main ? (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-orange-100 text-orange-700 font-semibold uppercase tracking-wide">
                    Main developer
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">
                    {op.allowed_tabs == null ? 'All tabs' : `${op.allowed_tabs.length} tab${op.allowed_tabs.length === 1 ? '' : 's'}`}
                  </span>
                )}
              </div>
              {!op.is_main && (
                <div className="flex flex-wrap gap-2">
                  {ALL_DEV_TAB_IDS.map((tabId) => {
                    const allowed = op.allowed_tabs == null || op.allowed_tabs.includes(tabId);
                    return (
                      <button
                        key={tabId}
                        onClick={() => onToggleTab(op.email, tabId, allowed)}
                        disabled={savingTabsFor === op.email}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium capitalize transition-colors disabled:opacity-40 ${
                          allowed
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {tabId.replace('-', ' ')}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {operators.length === 0 && <p className="text-sm text-slate-500">No developers yet.</p>}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUPPORT LINKS — lets the main developer generate a password-protected link
// (/support-console?key=<token>) that opens a scoped, read/reply-only view of
// Public Board + Messages for someone with no mybodaguy account at all —
// mirrors ICAN's Support Console. Backed by ADD_SUPPORT_CONSOLE.sql. Only
// these two tabs are offered here — see that file's header for why every
// other DeveloperDashboard tab isn't reachable this way yet.
// ============================================================================
type SupportLinkRow = {
  id: string;
  token: string;
  label: string | null;
  allowed_tabs: string[];
  revoked_at: string | null;
  view_count: number;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
};

// Only tabs with a matching mbg_support_* read-only RPC belong here — every
// other DeveloperDashboard tab (Applications, Regions, Commissions,
// Supermarkets, Transport, Rewards, Settings) needs one written first (see
// ADD_SUPPORT_CONSOLE.sql / ADD_SUPPORT_CONSOLE_USERS_READONLY.sql) before
// it can be added to this list — this is pure browser-to-Postgres RPC, no
// backend server involved, so an unwired tab would just show nothing.
const SUPPORT_LINK_TAB_OPTIONS = [
  { id: 'public-board', label: 'Public Board' },
  { id: 'messages', label: 'Messages' },
  { id: 'users', label: 'Users' },
];
const LOW_RISK_SUPPORT_TABS = new Set(['messages', 'public-board']);

function SupportLinksTab() {
  const [links, setLinks] = useState<SupportLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newAllowedTabs, setNewAllowedTabs] = useState<string[]>(['messages', 'public-board']);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [justCreated, setJustCreated] = useState<{ token: string; label: string } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const [editingTabsId, setEditingTabsId] = useState<string | null>(null);
  const [editTabs, setEditTabs] = useState<string[]>([]);
  const [savingTabs, setSavingTabs] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('mbg_dev_list_support_links');
    if (error) console.error('[SupportLinksTab] mbg_dev_list_support_links:', error.message);
    setLinks(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleNewTab = (id: string) => {
    setNewAllowedTabs((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(''); setJustCreated(null);
    if (creating) return;
    if (newPassword.trim().length < 4) {
      setCreateError('Set a password of at least 4 characters.');
      return;
    }
    if (!newAllowedTabs.length) {
      setCreateError('Pick at least one tab for this link to open.');
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.rpc('mbg_dev_create_support_link', {
        p_label: newLabel.trim() || null,
        p_password: newPassword.trim(),
        p_allowed_tabs: newAllowedTabs,
      });
      if (error || !data?.success) { setCreateError(data?.error || error?.message || 'Failed to create link.'); return; }
      setJustCreated({ token: data.token, label: newLabel.trim() });
      setNewLabel(''); setNewPassword(''); setNewAllowedTabs(['messages', 'public-board']);
      await refresh();
    } finally {
      setCreating(false);
    }
  };

  const toggleRevoke = async (row: SupportLinkRow) => {
    setRevokingId(row.id);
    try {
      const fn = row.revoked_at ? 'mbg_dev_reactivate_support_link' : 'mbg_dev_revoke_support_link';
      await supabase.rpc(fn, { p_link_id: row.id });
      await refresh();
    } finally {
      setRevokingId(null);
    }
  };

  const startEditTabs = (row: SupportLinkRow) => { setEditingTabsId(row.id); setEditTabs(row.allowed_tabs); };
  const cancelEditTabs = () => { setEditingTabsId(null); setEditTabs([]); };
  const toggleEditTab = (id: string) => {
    setEditTabs((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };
  const saveEditTabs = async (row: SupportLinkRow) => {
    if (!editTabs.length || savingTabs) return;
    setSavingTabs(true);
    try {
      const { data, error } = await supabase.rpc('mbg_dev_update_support_link_tabs', {
        p_link_id: row.id, p_allowed_tabs: editTabs,
      });
      if (error || !data?.success) return;
      cancelEditTabs();
      await refresh();
    } finally {
      setSavingTabs(false);
    }
  };

  const linkUrl = (token: string) => `${window.location.origin}/support-console?key=${token}`;

  const shareLink = async (row: { token: string; label: string | null }) => {
    const url = linkUrl(row.token);
    const text = row.label ? `BodaGoEra Support Console access for ${row.label}` : 'BodaGoEra Support Console access';
    if ((navigator as any).share) {
      try { await (navigator as any).share({ title: 'BodaGoEra Support Console', text, url }); return; } catch { /* user canceled */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(row.token);
      setTimeout(() => setCopiedToken((prev) => (prev === row.token ? null : prev)), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-bold text-slate-800">Support Links ({links.length})</h2>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <p className="text-sm text-slate-600 mb-4">
        Generate a password-protected link that opens whichever tabs you pick below for someone
        with no mybodaguy account — no sign-in required, just the URL and password you share.
      </p>

      <form onSubmit={handleCreate} className="space-y-2 mb-6 rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap gap-2">
          <input
            value={newLabel} onChange={(e) => setNewLabel(e.target.value)} type="text"
            placeholder="Who's this for? (optional)"
            className="min-w-[160px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
          />
          <input
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="text"
            placeholder="Password (4+ characters)"
            className="min-w-[160px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUPPORT_LINK_TAB_OPTIONS.map((t) => {
            const on = newAllowedTabs.includes(t.id);
            return (
              <button
                key={t.id} type="button" onClick={() => toggleNewTab(t.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  on ? 'border-orange-400 bg-orange-50 text-orange-600' : 'border-slate-200 bg-slate-50 text-slate-500'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {newAllowedTabs.some((id) => !LOW_RISK_SUPPORT_TABS.has(id)) && (
          <p className="text-[11px] leading-snug text-amber-600">
            ⚠️ Anything beyond Messages/Public Board exposes real user data (names, emails, roles) to whoever
            opens this link. Only pick this for someone you'd trust with that.
          </p>
        )}
        <button
          type="submit" disabled={creating}
          className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40 bg-gradient-to-r from-orange-500 to-yellow-500"
        >
          {creating ? 'Creating…' : 'Create link'}
        </button>
      </form>
      {createError && <p className="mb-3 text-xs text-rose-500">{createError}</p>}

      {justCreated && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-bold text-amber-700">Share this link (and the password, separately):</p>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-xs break-all text-slate-800">{linkUrl(justCreated.token)}</p>
            <button
              onClick={() => shareLink(justCreated)}
              className="flex-shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-bold text-white bg-amber-500"
            >
              {copiedToken === justCreated.token ? 'Copied!' : 'Share / Copy'}
            </button>
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      <div className="space-y-2">
        {links.map((row) => {
          const revoked = !!row.revoked_at;
          const locked = row.locked_until && new Date(row.locked_until) > new Date();
          const isEditingTabs = editingTabsId === row.id;
          return (
            <div key={row.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {row.label || 'Untitled link'}
                    {revoked && <span className="ml-1.5 text-[10px] font-bold text-rose-500">revoked</span>}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {row.view_count || 0} {row.view_count === 1 ? 'use' : 'uses'} · created {new Date(row.created_at).toLocaleDateString()}
                    {locked && ' · locked'}
                  </p>
                  {!isEditingTabs && (
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Opens: {row.allowed_tabs.map((id) => SUPPORT_LINK_TAB_OPTIONS.find((t) => t.id === id)?.label || id).join(', ')}
                      {' '}
                      <button onClick={() => startEditTabs(row)} className="underline text-slate-600">edit</button>
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {!revoked && (
                    <button
                      onClick={() => shareLink(row)}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-600"
                    >
                      {copiedToken === row.token ? 'Copied!' : 'Share / Copy'}
                    </button>
                  )}
                  <button
                    onClick={() => toggleRevoke(row)}
                    disabled={revokingId === row.id}
                    className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold disabled:opacity-40 ${
                      !revoked ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-emerald-300 bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    {revokingId === row.id ? '…' : revoked ? 'Reactivate' : 'Revoke'}
                  </button>
                </div>
              </div>

              {isEditingTabs && (
                <div className="mt-2 rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {SUPPORT_LINK_TAB_OPTIONS.map((t) => {
                      const on = editTabs.includes(t.id);
                      return (
                        <button
                          key={t.id} type="button" onClick={() => toggleEditTab(t.id)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            on ? 'border-orange-400 bg-orange-50 text-orange-600' : 'border-slate-200 bg-slate-50 text-slate-500'
                          }`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                  {editTabs.some((id) => !LOW_RISK_SUPPORT_TABS.has(id)) && (
                    <p className="mt-2 text-[11px] leading-snug text-amber-600">
                      ⚠️ Anything beyond Messages/Public Board exposes real user data to whoever holds this link.
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => saveEditTabs(row)} disabled={!editTabs.length || savingTabs}
                      className="rounded-lg px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-40 bg-gradient-to-r from-orange-500 to-yellow-500"
                    >
                      {savingTabs ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={cancelEditTabs} disabled={savingTabs} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!loading && links.length === 0 && <p className="text-sm text-slate-500">No support links created yet.</p>}
      </div>

      <IwosOnboardingSection />
    </div>
  );
}

// Onboard a REAL mybodaguy account (looked up by their own email — not a
// support-link visitor, who has no identity to pay) as a paid contract
// worker of IWOS, the same platform-fee business every app's real fee
// already flows into (fn_credit_platform_fee_to_business — see
// ADD_ICANERA_UNIFIED_PLATFORM_FEE.sql). Mirrors ICAN's own Support Team
// tab. See ADD_SUPPORT_IWOS_ONBOARDING.sql.
function IwosOnboardingSection() {
  const [overview, setOverview] = useState<{ members: any[] }>({ members: [] });
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('UGX');
  const [frequency, setFrequency] = useState('contract');
  const [onboarding, setOnboarding] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.rpc('mbg_dev_get_iwos_overview');
    if (err) console.error('[IwosOnboardingSection] mbg_dev_get_iwos_overview:', err.message);
    setOverview(data || { members: [] });
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setOk(false);
    const amt = parseFloat(amount);
    if (!email.trim() || !amt || amt <= 0 || onboarding) return;
    setOnboarding(true);
    try {
      const { data, error: err } = await supabase.rpc('mbg_dev_onboard_iwos_support_staff', {
        p_target_email: email.trim(),
        p_base_pay_amount: amt,
        p_currency: currency.toUpperCase(),
        p_pay_frequency: frequency,
      });
      if (err || !data?.success) { setError(data?.error || err?.message || 'Failed to onboard.'); return; }
      setOk(true);
      setEmail(''); setAmount('');
      await refresh();
    } finally {
      setOnboarding(false);
    }
  };

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="text-lg font-bold text-slate-800">Onboard as IWOS contractor</h3>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          Independent of the links above — this pays a real mybodaguy account out of IWOS's wallet
          (the same business every app's platform fee flows into), looked up by their account email.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
          <input
            value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="their@account.email"
            className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
          />
          <input
            value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="1" placeholder="Pay amount"
            className="w-28 rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
          />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800 outline-none">
            <option value="UGX">UGX</option>
            <option value="USD">USD</option>
            <option value="KES">KES</option>
          </select>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800 outline-none">
            <option value="contract">Per contract</option>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="daily">Daily</option>
            <option value="hourly">Hourly</option>
          </select>
          <button
            type="submit" disabled={onboarding || !email.trim() || !(parseFloat(amount) > 0)}
            className="rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-40 bg-gradient-to-r from-orange-500 to-yellow-500"
          >
            {onboarding ? 'Onboarding…' : 'Onboard'}
          </button>
        </form>
        {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
        {ok && <p className="mt-2 text-xs text-emerald-600">Onboarded.</p>}
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="text-lg font-bold text-slate-800">IWOS staff on the books ({overview.members?.length || 0})</h3>
        <div className="mt-3 space-y-2">
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading && (overview.members || []).map((m: any) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{m.job_title || 'Staff'}</p>
                <p className="text-[11px] text-slate-500">
                  {m.employment_status} · joined {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '—'}
                </p>
              </div>
            </div>
          ))}
          {!loading && (overview.members || []).length === 0 && (
            <p className="text-sm text-slate-500">No IWOS staff on the books yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function TransportOrdersTab({
  orders,
  loading,
  onRefresh,
}: {
  orders: any[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pending = orders.filter((order) => order.request_status === 'pending').length;
  const active = orders.filter((order) => ['approved', 'dispatched'].includes(order.request_status)).length;
  const completed = orders.filter((order) => order.request_status === 'completed').length;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">CMMS Transport Orders</h2>
          <p className="text-sm text-slate-600 mt-1">
            Monitor company transport orders automatically created from CMMS requisitions.
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title="All orders" value={String(orders.length)} icon={<Truck className="text-orange-500" />} />
        <StatCard title="Pending" value={String(pending)} icon={<Activity className="text-amber-500" />} />
        <StatCard title="In progress" value={String(active)} icon={<RefreshCw className="text-blue-500" />} />
        <StatCard title="Completed" value={String(completed)} icon={<CheckCircle className="text-green-500" />} />
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-500">Loading transport orders...</div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center">
          <Truck className="mx-auto mb-3 text-slate-400" size={36} />
          <p className="font-semibold text-slate-700">No automatic transport orders yet</p>
          <p className="text-sm text-slate-500 mt-1">Linked CMMS transport requisitions will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const isOpen = expandedId === order.request_id;
            return (
              <div key={order.request_id} className="rounded-xl border border-slate-200 hover:border-orange-300 transition-colors overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : order.request_id)}
                  className="w-full text-left p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-800">{order.contract_name || 'Corporate transport contract'}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        BodaGo request {String(order.request_id).slice(0, 8)} · CMMS {order.cmms_requisition_number || 'unlinked'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold capitalize">
                        {order.request_status || 'pending'}
                      </span>
                      <ChevronRight size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-4 text-xs text-slate-600">
                    <span>Rides: <strong>{order.ride_count || 0}</strong></span>
                    <span>Vehicle: <strong>{order.vehicle_type || 'Any'}</strong></span>
                    <span>CMMS status: <strong>{order.cmms_status || '—'}</strong></span>
                    <span>Created: <strong>{order.created_at ? new Date(order.created_at).toLocaleString() : '—'}</strong></span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50 p-4 grid sm:grid-cols-2 gap-3 text-xs text-slate-600">
                    <span>Contract: <strong>{order.contract_name || '—'}</strong></span>
                    <span>Business: <strong>{order.business_name || '—'}</strong></span>
                    <span>CMMS requisition: <strong>{order.cmms_requisition_number || 'unlinked'}</strong></span>
                    <span>CMMS status: <strong>{order.cmms_status || '—'}</strong></span>
                    <span>Pickup location: <strong>{order.pickup_location || '—'}</strong></span>
                    <span>Dropoff location: <strong>{order.dropoff_location || '—'}</strong></span>
                    <span>Scheduled for: <strong>{order.scheduled_for ? new Date(order.scheduled_for).toLocaleString() : '—'}</strong></span>
                    <span>Requested rides: <strong>{order.ride_count || 0}</strong></span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ onSwitchToRegions, onSwitchToCommissions, userId, onGoToWallet }: { onSwitchToRegions: () => void; onSwitchToCommissions: () => void; userId?: string; onGoToWallet: () => void }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Platform Overview</h2>

      <div className="grid md:grid-cols-5 gap-6 mb-8">
        <StatCard title="Total Users" value="0" icon={<Users className="text-orange-500" />} />
        <StatCard title="Active Riders" value="0" icon={<Bike className="text-orange-500" />} />
        <StatCard title="Total Rides" value="0" icon={<TrendingUp className="text-orange-500" />} />
        <StatCard title="Total Revenue" value="0 UGX" icon={<DollarSign className="text-orange-500" />} />
        {userId && <IcanCoinCard userId={userId} onGoToWallet={onGoToWallet} />}
      </div>

      <div className="bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl p-8 text-center">
        <Bike className="w-16 h-16 text-orange-500 mx-auto mb-4" />
        <h3 className="text-2xl font-bold text-slate-800 mb-2">Welcome to Developer Panel</h3>
        <p className="text-slate-600 mb-4">
          You have full control over the BodaGoEra platform. Start by setting up geographic regions 
          and assigning chairpersons.
        </p>
        <div className="flex flex-wrap gap-4 justify-center">
          <button 
            onClick={onSwitchToRegions}
            className="px-6 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all shadow-md"
          >
            Setup Regions
          </button>
          <button
            onClick={onSwitchToCommissions}
            className="px-6 py-2 bg-white text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition-all shadow-md border border-slate-200"
          >
            Configure Commissions
          </button>
        </div>
      </div>
    </div>
  );
}

// Chairperson level hierarchy — index 0 = highest access, index 4 = lowest
const CHAIR_HIERARCHY = [
  'district_chairperson',
  'division_chairperson',
  'subcounty_chairperson',
  'parish_chairperson',
  'stage_chairperson',
] as const;

type ChairLevel = typeof CHAIR_HIERARCHY[number];

/** Returns the specific committee role if the user is a chairperson, otherwise returns role_type */
function effectiveRole(user: any): string {
  return user.role_type === 'chairperson' && user.committee_role
    ? user.committee_role
    : user.role_type;
}

function roleDisplayLabel(role: string): string {
  const labels: Record<string, string> = {
    developer: 'Developer',
    district_chairperson: 'District Chair',
    division_chairperson: 'Division Chair',
    subcounty_chairperson: 'Subcounty Chair',
    parish_chairperson: 'Parish Chair',
    stage_chairperson: 'Stage Chair',
    rider: 'Rider',
    customer: 'Customer',
    chairperson: 'Chairperson',
  };
  return labels[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function roleBadgeClass(role: string): string {
  const classes: Record<string, string> = {
    developer: 'bg-purple-100 text-purple-700',
    district_chairperson: 'bg-indigo-100 text-indigo-700',
    division_chairperson: 'bg-blue-100 text-blue-700',
    subcounty_chairperson: 'bg-sky-100 text-sky-700',
    parish_chairperson: 'bg-cyan-100 text-cyan-700',
    stage_chairperson: 'bg-teal-100 text-teal-700',
    rider: 'bg-green-100 text-green-700',
    chairperson: 'bg-blue-100 text-blue-700',
  };
  return classes[role] ?? 'bg-orange-100 text-orange-700';
}

const ROLE_FILTER_OPTIONS = [
  { value: 'all',                   label: 'All Roles',         hint: '' },
  { value: 'developer',             label: 'Developer',         hint: '' },
  { value: 'district_chairperson',  label: 'District Chair',    hint: 'top level only' },
  { value: 'division_chairperson',  label: 'Division Chair',    hint: '+ above' },
  { value: 'subcounty_chairperson', label: 'Subcounty Chair',   hint: '+ above' },
  { value: 'parish_chairperson',    label: 'Parish Chair',      hint: '+ above' },
  { value: 'stage_chairperson',     label: 'Stage Chair',       hint: 'all chairs' },
  { value: 'rider',                 label: 'Rider',             hint: '' },
  { value: 'customer',              label: 'Customer',          hint: '' },
];

// Reviews "Become a transport service provider" self-applications
// (BecomeOperatorForm.tsx, mbg_operator_applications) — approving one calls
// mbg_review_operator_application, which creates the mbg_riders row itself,
// so this tab only needs to call the RPC and refresh, no separate promotion
// step in the Users tab.
function ApplicationsTab() {
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadApplications = async () => {
    setLoading(true);
    const { data: apps } = await supabase.from('mbg_operator_applications').select('*').order('created_at', { ascending: false });
    const appIds = (apps || []).map((a) => a.id);
    const userIds = [...new Set((apps || []).map((a) => a.user_id))];
    const [{ data: profiles }, { data: conversations }] = await Promise.all([
      userIds.length
        ? supabase.from('mbg_user_profiles').select('user_id, full_name').in('user_id', userIds)
        : Promise.resolve({ data: [] as any[] }),
      appIds.length
        ? supabase.from('chat_conversations').select('id, application_id').in('application_id', appIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const nameByUserId = new Map((profiles || []).map((p) => [p.user_id, p.full_name]));
    const conversationByAppId = new Map((conversations || []).map((c) => [c.application_id, c.id]));
    setApplications((apps || []).map((a) => ({
      ...a,
      applicant: { full_name: nameByUserId.get(a.user_id) },
      conversationId: conversationByAppId.get(a.id) || null,
    })));
    setLoading(false);
  };

  useEffect(() => { loadApplications(); }, []);

  // Backfills a chat thread for applications submitted before
  // ADD_OPERATOR_APPLICATION_CHAT_INTEGRATION.sql existed — those have no
  // conversation yet (mbg_apply_as_operator only creates one going
  // forward), which otherwise shows as "no conversation thread found"
  // instead of a working reply box.
  const startConversation = async (applicationId: string) => {
    try {
      const { data, error } = await supabase.rpc('mbg_ensure_operator_application_conversation', { p_application_id: applicationId });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not start conversation');
      setApplications((prev) => prev.map((a) => (a.id === applicationId ? { ...a, conversationId: data.conversation_id } : a)));
    } catch (err: any) {
      toast.error(err.message || 'Could not start conversation');
    }
  };

  const review = async (id: string, approve: boolean) => {
    if (!approve && !window.confirm('Reject this application?')) return;
    setBusyId(id);
    try {
      const reason = approve ? null : window.prompt('Reason for rejection (optional):') || null;
      const { data, error } = await supabase.rpc('mbg_review_operator_application', {
        p_application_id: id,
        p_approve: approve,
        p_rejection_reason: reason,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Review failed');
      toast.success(approve ? 'Application approved — operator is now active' : 'Application rejected');
      await loadApplications();
    } catch (err: any) {
      toast.error(err.message || 'Review failed');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Loading applications...</p>
      </div>
    );
  }

  const pending = applications.filter((a) => a.status === 'pending');
  const reviewed = applications.filter((a) => a.status !== 'pending');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Operator Applications</h2>
          <p className="text-sm text-slate-600 mt-1">Customers who applied to become a car/van/truck operator via "Become a Driver".</p>
        </div>
        <button onClick={loadApplications} className="px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all">
          Refresh
        </button>
      </div>

      <h3 className="font-semibold text-slate-700 mb-3">Pending ({pending.length})</h3>
      {pending.length === 0 ? (
        <p className="text-sm text-slate-400 mb-8">No pending applications.</p>
      ) : (
        <div className="space-y-3 mb-8">
          {pending.map((app) => {
            const isExpanded = expandedId === app.id;
            return (
              <div key={app.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-slate-800 capitalize">{app.vehicle_type} — {app.plate_number}</div>
                    <div className="text-sm text-slate-500">{app.applicant?.full_name || app.user_id} · {app.operator_country}{app.operator_home_city ? `, ${app.operator_home_city}` : ''}</div>
                    <div className="text-xs text-slate-400 mt-1">License: {app.license_number} · Applied {new Date(app.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : app.id)}
                      className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold flex items-center gap-1"
                    >
                      <Mail size={14} /> {isExpanded ? 'Hide' : 'Review & Message'}
                    </button>
                    <button
                      disabled={busyId === app.id}
                      onClick={() => review(app.id, true)}
                      className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1 disabled:opacity-50"
                    >
                      <CheckCircle size={14} /> Approve
                    </button>
                    <button
                      disabled={busyId === app.id}
                      onClick={() => review(app.id, false)}
                      className="px-3 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm font-semibold flex items-center gap-1 disabled:opacity-50"
                    >
                      <XCircle size={14} /> Reject
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600">
                      <span><span className="text-slate-400">Vehicle model:</span> {app.vehicle_model || '—'}</span>
                      <span><span className="text-slate-400">Vehicle color:</span> {app.vehicle_color || '—'}</span>
                      <span><span className="text-slate-400">Phone:</span> {app.phone || '—'}</span>
                      <span><span className="text-slate-400">Notes:</span> {app.notes || '—'}</span>
                    </div>
                    {app.conversationId ? (
                      <DeveloperApplicationThread conversationId={app.conversationId} />
                    ) : (
                      <div className="text-center py-3">
                        <p className="text-xs text-slate-400 mb-2">This application predates messaging — no thread yet.</p>
                        <button
                          onClick={() => startConversation(app.id)}
                          className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-semibold"
                        >
                          Start conversation
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h3 className="font-semibold text-slate-700 mb-3">Reviewed</h3>
      {reviewed.length === 0 ? (
        <p className="text-sm text-slate-400">No reviewed applications yet.</p>
      ) : (
        <div className="space-y-2">
          {reviewed.map((app) => (
            <div key={app.id} className="bg-slate-50 border border-slate-100 rounded-lg p-3 flex items-center justify-between text-sm">
              <span className="capitalize">{app.vehicle_type} — {app.plate_number} ({app.applicant?.full_name || app.user_id})</span>
              <span className={`font-semibold ${app.status === 'approved' ? 'text-green-600' : 'text-red-600'}`}>{app.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Fulfilment queue for physical reward redemptions (helmet, jacket,
// reflectors, home goods) — points are already debited at redemption time
// (mbg_redeem_points_for_item), this just tracks the offline delivery.
const REDEMPTION_STATUSES = ['pending', 'processing', 'shipped', 'fulfilled', 'cancelled'] as const;

// Matches the CHECK constraints on mbg_reward_catalog in
// ADD_REWARD_POINTS_LOYALTY_SYSTEM.sql — keep these in sync with the DB.
const CATALOG_CATEGORIES = ['safety_gear', 'home'] as const;
const CATALOG_ROLE_SCOPES = ['both', 'customer', 'rider'] as const;

type CatalogItem = {
  id: string;
  category: typeof CATALOG_CATEGORIES[number];
  name: string;
  description: string | null;
  emoji: string;
  points_cost: number;
  role_scope: typeof CATALOG_ROLE_SCOPES[number];
  stock_qty: number | null;
  active: boolean;
  sort_order: number;
};

// Parent tab: what the loyalty program actually looks like right now
// (Overview), what's redeemable and at what price (Catalog — the live
// mbg_reward_catalog table, editable here instead of by hand-written SQL),
// and the existing offline fulfilment queue (Redemptions).
function RewardsTab() {
  const [subTab, setSubTab] = useState<'overview' | 'catalog' | 'redemptions'>('overview');
  const subTabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'catalog' as const, label: 'Catalog' },
    { id: 'redemptions' as const, label: 'Redemptions' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Rewards</h2>
        <p className="text-sm text-slate-600 mt-1">Loyalty points earned automatically from real ICAN ride activity — redeemable for gear or an instant ICAN coin conversion.</p>
      </div>

      <div className="flex gap-2 mb-6 border-b border-slate-200">
        {subTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              subTab === t.id ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'overview' && <RewardsOverviewTab />}
      {subTab === 'catalog' && <RewardsCatalogTab />}
      {subTab === 'redemptions' && <RewardRedemptionsTab />}
    </div>
  );
}

// Read-only snapshot of how the program is actually doing — pulls straight
// from mbg_reward_points and mbg_reward_redemptions (both readable by the
// developer role via RLS: reward_points_admin_read / reward_redemptions_admin_all),
// no separate stats table to keep in sync.
function RewardsOverviewTab() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{
    userCount: number;
    pointsInCirculation: number;
    lifetimePointsIssued: number;
    byTier: Record<string, number>;
    gearByStatus: Record<string, number>;
    gearRedeemed: number;
    coinConversions: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: pointsRows }, { data: redemptionRows }] = await Promise.all([
        supabase.from('mbg_reward_points').select('points_balance, lifetime_points, tier'),
        supabase.from('mbg_reward_redemptions').select('status, item_name'),
      ]);
      if (cancelled) return;

      const byTier: Record<string, number> = {};
      let pointsInCirculation = 0;
      let lifetimePointsIssued = 0;
      for (const r of pointsRows || []) {
        pointsInCirculation += Number(r.points_balance) || 0;
        lifetimePointsIssued += Number(r.lifetime_points) || 0;
        byTier[r.tier] = (byTier[r.tier] || 0) + 1;
      }

      // Coin conversions are always filed as an instantly-'fulfilled' row
      // (mbg_redeem_points_for_coins) — split them out so the status
      // breakdown below reflects gear fulfilment only, not silently
      // inflated by every coin conversion landing in "fulfilled".
      const gearByStatus: Record<string, number> = {};
      let gearRedeemed = 0;
      let coinConversions = 0;
      for (const r of redemptionRows || []) {
        if (r.item_name?.includes('ICAN Coins')) {
          coinConversions += 1;
        } else {
          gearRedeemed += 1;
          gearByStatus[r.status] = (gearByStatus[r.status] || 0) + 1;
        }
      }

      setStats({
        userCount: (pointsRows || []).length,
        pointsInCirculation,
        lifetimePointsIssued,
        byTier,
        gearByStatus,
        gearRedeemed,
        coinConversions,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Loading rewards overview...</p>
      </div>
    );
  }

  if (!stats || stats.userCount === 0) {
    return (
      <p className="text-sm text-slate-400 py-8 text-center">
        Nobody has earned reward points yet — points are awarded automatically the moment a customer pays (or a rider gets paid) in ICAN, not cash. Once real ICAN-wallet rides start flowing, this fills in on its own.
      </p>
    );
  }

  const tierOrder = ['platinum', 'gold', 'silver', 'bronze'] as const;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Members earning points" value={String(stats.userCount)} icon={<Users size={20} className="text-orange-500" />} />
        <StatCard title="Points in circulation" value={stats.pointsInCirculation.toLocaleString()} icon={<TrendingUp size={20} className="text-orange-500" />} />
        <StatCard title="Lifetime points issued" value={stats.lifetimePointsIssued.toLocaleString()} icon={<Gift size={20} className="text-orange-500" />} />
        <StatCard title="ICAN coin conversions" value={String(stats.coinConversions)} icon={<CheckCircle size={20} className="text-orange-500" />} />
      </div>

      <div>
        <h3 className="font-semibold text-slate-700 mb-3">Members by tier</h3>
        <div className="flex flex-wrap gap-3">
          {tierOrder.map((tier) => (
            <div key={tier} className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              <span className="capitalize font-medium text-slate-700">{tier}</span>
              <span className="ml-2 text-slate-500">{stats.byTier[tier] || 0}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-slate-700 mb-3">Gear redemptions by status ({stats.gearRedeemed} total)</h3>
        {stats.gearRedeemed === 0 ? (
          <p className="text-sm text-slate-400">No gear redeemed yet.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {REDEMPTION_STATUSES.map((status) => (
              <div key={status} className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
                <span className="capitalize font-medium text-slate-700">{status}</span>
                <span className="ml-2 text-slate-500">{stats.gearByStatus[status] || 0}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Admin catalog management — the shared reward shop customers and riders
// redeem from. Backed directly by mbg_reward_catalog; the
// reward_catalog_admin_all RLS policy already grants the developer role
// full read/write here, so this is plain Supabase table access, no RPC.
// Deactivating (not deleting) is the intended way to retire an item: a
// redeemed item's name is snapshotted onto its mbg_reward_redemptions row,
// but the FK from redemptions to the catalog row would block a hard delete
// of anything ever redeemed anyway.
function RewardsCatalogTab() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    category: 'safety_gear' as CatalogItem['category'],
    name: '',
    description: '',
    emoji: '🎁',
    points_cost: '',
    role_scope: 'both' as CatalogItem['role_scope'],
    stock_qty: '',
  });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('mbg_reward_catalog')
      .select('*')
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true });
    setItems((data as CatalogItem[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveField = async (id: string, patch: Partial<CatalogItem>) => {
    setBusyId(id);
    try {
      const { error } = await supabase.from('mbg_reward_catalog').update(patch).eq('id', id);
      if (error) throw error;
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
      toast.success('Saved');
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setBusyId(null);
    }
  };

  const addItem = async () => {
    const pointsCost = Number(form.points_cost);
    if (!form.name.trim() || !pointsCost || pointsCost <= 0) {
      toast.error('Name and a points cost above 0 are required');
      return;
    }
    setAdding(true);
    try {
      const { error } = await supabase.from('mbg_reward_catalog').insert({
        category: form.category,
        name: form.name.trim(),
        description: form.description.trim() || null,
        emoji: form.emoji.trim() || '🎁',
        points_cost: pointsCost,
        role_scope: form.role_scope,
        stock_qty: form.stock_qty === '' ? null : Number(form.stock_qty),
        sort_order: items.length,
      });
      if (error) throw error;
      toast.success('Reward added to catalog');
      setForm({ category: 'safety_gear', name: '', description: '', emoji: '🎁', points_cost: '', role_scope: 'both', stock_qty: '' });
      setShowAdd(false);
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not add item — name may already be in use');
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Loading catalog...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-slate-500 max-w-xl">What customers and riders can spend points on. Deactivate an item instead of deleting it — past redemptions keep their own snapshot of the name and don't change.</p>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all whitespace-nowrap"
        >
          {showAdd ? 'Cancel' : '+ Add reward'}
        </button>
      </div>

      {showAdd && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-6 grid sm:grid-cols-2 gap-3">
          <input placeholder="Emoji" value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <input placeholder="Item name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="px-3 py-2 border border-slate-200 rounded-lg text-sm sm:col-span-2" rows={2} />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CatalogItem['category'] })} className="px-3 py-2 border border-slate-200 rounded-lg text-sm capitalize">
            {CATALOG_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
          <select value={form.role_scope} onChange={(e) => setForm({ ...form, role_scope: e.target.value as CatalogItem['role_scope'] })} className="px-3 py-2 border border-slate-200 rounded-lg text-sm capitalize">
            {CATALOG_ROLE_SCOPES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input type="number" min={1} placeholder="Points cost" value={form.points_cost} onChange={(e) => setForm({ ...form, points_cost: e.target.value })} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <input type="number" min={0} placeholder="Stock (blank = unlimited)" value={form.stock_qty} onChange={(e) => setForm({ ...form, stock_qty: e.target.value })} className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button onClick={addItem} disabled={adding} className="sm:col-span-2 px-4 py-2 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-all">
            {adding ? 'Adding...' : 'Add to catalog'}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-slate-400">Catalog is empty.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className={`bg-white border rounded-lg p-4 flex flex-wrap items-center gap-4 ${item.active ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}>
              <div className="text-2xl">{item.emoji}</div>
              <div className="flex-1 min-w-[160px]">
                <div className="font-semibold text-slate-800">{item.name}</div>
                <div className="text-xs text-slate-400 capitalize">{item.category.replace('_', ' ')} · {item.role_scope}</div>
              </div>
              <label className="flex items-center gap-1 text-sm text-slate-600">
                Cost
                <input
                  type="number"
                  min={1}
                  defaultValue={item.points_cost}
                  disabled={busyId === item.id}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v > 0 && v !== item.points_cost) saveField(item.id, { points_cost: v });
                  }}
                  className="w-20 px-2 py-1 border border-slate-200 rounded text-sm"
                />
                pts
              </label>
              <label className="flex items-center gap-1 text-sm text-slate-600">
                Stock
                <input
                  type="number"
                  min={0}
                  placeholder="∞"
                  defaultValue={item.stock_qty ?? ''}
                  disabled={busyId === item.id}
                  onBlur={(e) => {
                    const raw = e.target.value;
                    const v = raw === '' ? null : Number(raw);
                    if (v !== item.stock_qty) saveField(item.id, { stock_qty: v });
                  }}
                  className="w-20 px-2 py-1 border border-slate-200 rounded text-sm"
                />
              </label>
              <select
                value={item.role_scope}
                disabled={busyId === item.id}
                onChange={(e) => saveField(item.id, { role_scope: e.target.value as CatalogItem['role_scope'] })}
                className="px-2 py-1 border border-slate-200 rounded text-sm capitalize"
              >
                {CATALOG_ROLE_SCOPES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button
                onClick={() => saveField(item.id, { active: !item.active })}
                disabled={busyId === item.id}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  item.active ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {item.active ? 'Active' : 'Inactive'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RewardRedemptionsTab() {
  const [redemptions, setRedemptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: rows } = await supabase
      .from('mbg_reward_redemptions')
      .select('*')
      .order('created_at', { ascending: false });
    const userIds = [...new Set((rows || []).map((r) => r.user_id))];
    const { data: profiles } = userIds.length
      ? await supabase.from('mbg_user_profiles').select('user_id, full_name').in('user_id', userIds)
      : { data: [] as any[] };
    const nameByUserId = new Map((profiles || []).map((p) => [p.user_id, p.full_name]));
    setRedemptions((rows || []).map((r) => ({ ...r, recipient: nameByUserId.get(r.user_id) || r.user_id })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const updateStatus = async (id: string, status: string) => {
    setBusyId(id);
    try {
      const { data, error } = await supabase.rpc('mbg_update_redemption_status', {
        p_redemption_id: id,
        p_status: status,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Update failed');
      toast.success(`Marked ${status}`);
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Loading redemptions...</p>
      </div>
    );
  }

  const active = redemptions.filter((r) => r.status !== 'fulfilled' && r.status !== 'cancelled');
  const done = redemptions.filter((r) => r.status === 'fulfilled' || r.status === 'cancelled');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-600">Points-for-gear requests from customers and riders — helmet, jacket, reflectors, home goods, or an instant ICAN coin conversion.</p>
        <button onClick={load} className="px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all whitespace-nowrap">
          Refresh
        </button>
      </div>

      <h3 className="font-semibold text-slate-700 mb-3">Needs Fulfilment ({active.length})</h3>
      {active.length === 0 ? (
        <p className="text-sm text-slate-400 mb-8">Nothing pending.</p>
      ) : (
        <div className="space-y-3 mb-8">
          {active.map((r) => (
            <div key={r.id} className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-800">{r.item_name}</div>
                <div className="text-sm text-slate-500">{r.recipient} · {r.points_spent} pts</div>
                <div className="text-xs text-slate-400 mt-1">
                  {r.delivery_address ? `${r.delivery_address} · ${r.phone || '—'}` : 'No delivery details (instant redemption)'}
                  {' '}· {new Date(r.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={r.status}
                  disabled={busyId === r.id}
                  onChange={(e) => updateStatus(r.id, e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-lg text-sm capitalize"
                >
                  {REDEMPTION_STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="font-semibold text-slate-700 mb-3">History</h3>
      {done.length === 0 ? (
        <p className="text-sm text-slate-400">No completed redemptions yet.</p>
      ) : (
        <div className="space-y-2">
          {done.map((r) => (
            <div key={r.id} className="bg-slate-50 border border-slate-100 rounded-lg p-3 flex items-center justify-between text-sm">
              <span>{r.item_name} — {r.recipient}</span>
              <span className={`font-semibold capitalize ${r.status === 'fulfilled' ? 'text-green-600' : 'text-red-600'}`}>{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline review/reply thread embedded directly in the application card —
// reuses the exact same chat_conversations/chat_messages data and
// chatService.ts functions as the standalone Messages tab, just rendered
// compactly so a developer can review + message without leaving this tab.
function DeveloperApplicationThread({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const msgs = await fetchChatMessages(conversationId);
      if (cancelled) return;
      setMessages(msgs);
      await markConversationRead(conversationId, 'dev');
    })();
    const unsub = subscribeToChatMessages(conversationId, (msg) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    });
    return () => { cancelled = true; unsub(); };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async () => {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const msg = await sendChatMessage(conversationId, { senderRole: 'dev', senderName: 'BodaGoEra Team', body });
      setMessages((prev) => [...prev, msg]);
      setReply('');
    } catch (e) {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border rounded-lg bg-white flex flex-col" style={{ maxHeight: 280 }}>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 ? (
          <p className="text-xs text-slate-400 text-center">No messages yet.</p>
        ) : (
          messages.map((m) => {
            const fromDev = m.sender_role === 'dev';
            return (
              <div key={m.id} className={`flex ${fromDev ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${fromDev ? 'bg-gradient-to-br from-orange-500 to-yellow-500 text-white' : 'bg-slate-100 text-slate-800'}`}>
                  {!fromDev && <p className="mb-0.5 text-[10px] font-semibold uppercase text-slate-500">{m.sender_name || 'Applicant'}</p>}
                  <p className="whitespace-pre-wrap break-words"><Linkify text={m.body} /></p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <div className="border-t p-2 flex gap-2">
        <input
          className="flex-1 border rounded-lg p-2 text-sm bg-white text-slate-900 placeholder-slate-400"
          placeholder="Message the applicant…"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        />
        <button onClick={send} disabled={sending || !reply.trim()} className="bg-orange-500 disabled:bg-slate-300 text-white rounded-lg px-3 flex items-center justify-center">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

function UsersTab({ users, loading, onReload }: { users: any[]; loading: boolean; onReload: () => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [promotingId, setPromotingId] = useState<string | null>(null);

  const makeDeveloper = async (userId: string, email: string) => {
    if (!window.confirm(`Grant developer/dev-panel access to ${email}?`)) return;
    setPromotingId(userId);
    try {
      await roleService.promoteToDeveloper(userId);
      toast.success(`${email} is now a developer`);
      onReload();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to grant developer access');
    } finally {
      setPromotingId(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Loading users...</p>
      </div>
    );
  }

  const q = searchQuery.toLowerCase();
  const filteredUsers = users.filter((u) => {
    const fullName = u.mbg_user_profiles?.[0]?.full_name ?? '';
    const eRole = effectiveRole(u);

    // Text search
    const matchesSearch = !q || (
      u.email?.toLowerCase().includes(q) ||
      fullName.toLowerCase().includes(q) ||
      roleDisplayLabel(eRole).toLowerCase().includes(q)
    );

    // Role filter — higher-level chairs have all lower-level access automatically.
    // Selecting "Stage Chair" shows ALL chairs (everyone has stage-level access at minimum).
    // Selecting "District Chair" shows only district chairs (only they have district-level access).
    let matchesRole = true;
    if (roleFilter !== 'all') {
      const filterIdx = CHAIR_HIERARCHY.indexOf(roleFilter as ChairLevel);
      if (filterIdx !== -1) {
        const userIdx = CHAIR_HIERARCHY.indexOf(eRole as ChairLevel);
        // User matches if their highest role index is <= filterIdx
        // (lower index = higher access = has this level AND everything below)
        matchesRole = userIdx !== -1 && userIdx <= filterIdx;
      } else {
        matchesRole = eRole === roleFilter;
      }
    }

    return matchesSearch && matchesRole;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">User Management</h2>
          <p className="text-sm text-slate-600 mt-1">
            All users start as <span className="font-semibold text-orange-600">customers</span> and can order rides/deliveries.
            Promote them to riders or chairpersons below.
          </p>
        </div>
        <button
          onClick={onReload}
          className="px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all"
        >
          Refresh
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h4 className="font-semibold text-blue-800 mb-2">🎯 How It Works</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>✅ <strong>Customers:</strong> Anyone can sign up and immediately order rides/deliveries</li>
          <li>✅ <strong>Riders:</strong> Must be assigned by Stage Chairperson or Developer after signing up</li>
          <li>✅ <strong>Chairpersons:</strong> Must be assigned by higher-level Chairperson or Developer</li>
        </ul>
      </div>

      {/* Search + Role Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email or role…"
            className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="relative">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent cursor-pointer"
          >
            {ROLE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}{opt.hint ? ` (${opt.hint})` : ''}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">▼</span>
        </div>
      </div>

      {/* Active filter hint for chairperson levels */}
      {CHAIR_HIERARCHY.includes(roleFilter as ChairLevel) && (() => {
        const filterIdx = CHAIR_HIERARCHY.indexOf(roleFilter as ChairLevel);
        // Levels that match: district (0) down to filterIdx (inclusive)
        const visibleLevels = CHAIR_HIERARCHY.slice(0, filterIdx + 1);
        return (
          <div className="mb-3 text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-3 py-1.5">
            Showing chairpersons who have <strong>{roleDisplayLabel(roleFilter)}</strong> access or higher:
            {' '}{visibleLevels.map(roleDisplayLabel).join(' · ')}
          </div>
        );
      })()}

      {filteredUsers.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-lg">
          <Users className="w-12 h-12 text-slate-400 mx-auto mb-4" />
          <p className="text-slate-600">
            {searchQuery || roleFilter !== 'all' ? 'No users match the current filters' : 'No users yet'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <p className="text-xs text-slate-500 mb-2">
            Showing {filteredUsers.length} of {users.length} user{users.length !== 1 ? 's' : ''}
          </p>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Email</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Full Name</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Role</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Status</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Created</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const eRole = effectiveRole(user);
                return (
                  <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4 text-sm text-slate-800">{user.email}</td>
                    <td className="py-3 px-4 text-sm text-slate-800">
                      {user.mbg_user_profiles?.[0]?.full_name || 'N/A'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${roleBadgeClass(eRole)}`}>
                        {roleDisplayLabel(eRole)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                        user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {user.role_type === 'customer' && user.email !== 'abanabaasa2@gmail.com' && (
                          <button className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors font-medium">
                            Promote
                          </button>
                        )}
                        {user.role_type === 'developer' && (
                          <span className="text-xs text-slate-400">Super Admin</span>
                        )}
                        {user.role_type === 'chairperson' && (
                          <span className="text-xs text-slate-400">
                            {CHAIR_HIERARCHY.indexOf(eRole as ChairLevel) === 0 ? 'Top Level' : 'Chairperson'}
                          </span>
                        )}
                        {user.role_type !== 'developer' && (
                          <button
                            onClick={() => makeDeveloper(user.id, user.email)}
                            disabled={promotingId === user.id}
                            className="text-xs px-3 py-1 bg-violet-100 text-violet-700 rounded-md hover:bg-violet-200 transition-colors font-medium disabled:opacity-50"
                          >
                            {promotingId === user.id ? 'Granting…' : 'Make Developer'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const fmtBoardTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return date.toLocaleDateString();
};

// ─── Public landing-page message board (moderation) ────────────────────
// No dev_token needed — this dashboard is already only shown to real
// mbg_users.role_type = 'developer' accounts; landing_messages_is_dev()
// checks auth.uid() against that directly.
const fmtChatTime = (d?: string) => {
  if (!d) return '';
  const date = new Date(d);
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return date.toLocaleDateString();
};

function MessagesTab() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  // Applications open their own automated thread the moment someone
  // applies (see ADD_OPERATOR_APPLICATION_CHAT_INTEGRATION.sql) — reviewing
  // and replying to those normally happens inline in the Applications tab
  // itself, but this toggle lets a developer browse them here too (e.g.
  // after they're already resolved).
  const [kindFilter, setKindFilter] = useState<'support' | 'operator_application'>('support');
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setConversations(await listConversations({ kind: undefined as any }));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    return subscribeToAllConversations((payload: any) => {
      const row = payload.new;
      if (!row || row.kind === 'team') return;
      setConversations((prev) =>
        [row, ...prev.filter((c) => c.id !== row.id)]
          .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
      );
    });
  }, []);

  const visibleConversations = conversations.filter((c) => (c.kind || 'support') === kindFilter);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    let cancelled = false;
    (async () => {
      const msgs = await fetchChatMessages(selectedId);
      if (cancelled) return;
      setMessages(msgs);
      await markConversationRead(selectedId, 'dev');
      setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, unread_by_dev: false } : c)));
    })();
    const unsub = subscribeToChatMessages(selectedId, (msg) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    });
    return () => { cancelled = true; unsub(); };
  }, [selectedId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const selected = conversations.find((c) => c.id === selectedId);

  const handleReply = async () => {
    const body = reply.trim();
    if (!body || !selectedId || sending) return;
    setSending(true);
    try {
      const msg = await sendChatMessage(selectedId, { senderRole: 'dev', senderName: 'BodaGoEra Team', body });
      setMessages((prev) => [...prev, msg]);
      setReply('');
    } catch (e) {
      console.error('[MessagesTab] reply failed:', e);
      toast.error('Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setKindFilter('support')}
            className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider ${kindFilter === 'support' ? 'text-orange-600 border-b-2 border-orange-500' : 'text-slate-400'}`}
          >
            Support ({conversations.filter((c) => (c.kind || 'support') === 'support').length})
          </button>
          <button
            onClick={() => setKindFilter('operator_application')}
            className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider ${kindFilter === 'operator_application' ? 'text-orange-600 border-b-2 border-orange-500' : 'text-slate-400'}`}
          >
            Applications ({conversations.filter((c) => c.kind === 'operator_application').length})
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto">
          {visibleConversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full border-b border-slate-100 last:border-0 px-4 py-3 text-left transition ${
                selectedId === c.id ? 'bg-orange-50' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800 truncate">{c.guest_name || c.role || 'Guest'}</p>
                {c.unread_by_dev && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />}
              </div>
              <p className="text-xs text-slate-500 truncate">{c.guest_email}</p>
              {c.kind === 'operator_application' && c.subject && (
                <p className="text-[10px] font-medium text-orange-600 capitalize mt-0.5">{c.subject}</p>
              )}
              <div className="mt-1.5 flex items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-600">{c.portal}</span>
                <span className="text-[10px] text-slate-400">{fmtChatTime(c.last_message_at)}</span>
              </div>
              {c.last_message_preview && <p className="mt-1 truncate text-xs text-slate-500">{c.last_message_preview}</p>}
            </button>
          ))}
          {visibleConversations.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-500">No {kindFilter === 'operator_application' ? 'application' : 'support'} conversations yet.</p>
          )}
        </div>
      </div>

      <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-2 h-8 w-8 opacity-40" />
              Select a conversation to reply
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">{selected.guest_name || 'Guest'}</p>
              <p className="text-xs text-slate-500">{selected.guest_email} · {selected.portal}</p>
            </div>
            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3" style={{ maxHeight: '48vh' }}>
              {messages.map((m) => {
                const fromDev = m.sender_role === 'dev';
                return (
                  <div key={m.id} className={`flex ${fromDev ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                        fromDev ? 'bg-gradient-to-br from-orange-500 to-yellow-500 text-white' : 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      {!fromDev && (
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {m.sender_name || selected.role}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words"><Linkify text={m.body} /></p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-3">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleReply(); }}
                placeholder="Reply as BodaGoEra Team…"
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
              />
              <button
                onClick={handleReply}
                disabled={sending || !reply.trim()}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-orange-500 to-yellow-500 text-white transition disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PublicBoardTab() {
  const [items, setItems] = useState<LandingMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replying, setReplying] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [grantTargetId, setGrantTargetId] = useState<string | null>(null);
  const [grantAmount, setGrantAmount] = useState('');
  const [grantingId, setGrantingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await devListAllLandingMessages());
    } catch (e) {
      console.error('[PublicBoardTab] failed to load messages:', e);
      toast.error('Failed to load public board messages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await devDeleteLandingMessage(id);
      if (expandedId === id) setExpandedId(null);
      await refresh();
    } catch (e) {
      console.error('[PublicBoardTab] failed to delete message:', e);
      toast.error('Failed to delete message');
    } finally {
      setDeletingId(null);
    }
  };

  const handleReply = async (id: string) => {
    const body = replyDraft.trim();
    if (!body || replying) return;
    setReplying(true);
    try {
      await devReplyToLandingMessage(id, body);
      setReplyDraft('');
      await refresh();
    } catch (e) {
      console.error('[PublicBoardTab] failed to reply:', e);
      toast.error('Failed to send reply');
    } finally {
      setReplying(false);
    }
  };

  const handleMarkCorrect = async (id: string) => {
    if (markingId) return;
    setMarkingId(id);
    try {
      await devMarkCorrectAnswer(id);
      await refresh();
    } catch (e) {
      console.error('[PublicBoardTab] failed to mark correct answer:', e);
      toast.error((e as Error)?.message || 'Failed to mark as correct answer');
    } finally {
      setMarkingId(null);
    }
  };

  const handleOpenGrant = (id: string) => {
    setGrantTargetId((prev) => (prev === id ? null : id));
    setGrantAmount('');
  };

  const handleGrant = async (item: LandingMessage) => {
    const amt = parseFloat(grantAmount);
    if (!amt || amt <= 0 || grantingId || !item.user_id) return;
    setGrantingId(item.id);
    try {
      await devGrantLandingBonus(item.user_id, amt, 'Manual grant from Public Board');
      setGrantTargetId(null);
      setGrantAmount('');
      await refresh();
    } catch (e) {
      console.error('[PublicBoardTab] failed to grant bonus:', e);
      toast.error((e as Error)?.message || 'Failed to grant ICAN');
    } finally {
      setGrantingId(null);
    }
  };

  const topLevel = items.filter((m) => !m.parent_id);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Landing Page Messages</h2>
          <p className="text-sm text-slate-600 mt-1">
            Community board messages posted from the BodaGoEra landing page.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <span>Messages ({topLevel.length})</span>
        </div>
        <div className="max-h-[65vh] divide-y divide-slate-100 overflow-y-auto">
          {topLevel.map((m) => {
            const replies = items.filter((i) => i.parent_id === m.id);
            const isExpanded = expandedId === m.id;
            return (
              <div key={m.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <button
                    onClick={() => { setExpandedId(isExpanded ? null : m.id); setReplyDraft(''); }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-slate-800">{m.name || 'Website visitor'}</p>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        m.is_public
                          ? 'border-orange-200 bg-orange-50 text-orange-600'
                          : 'border-amber-200 bg-amber-50 text-amber-600'
                      }`}>
                        {m.is_public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        {m.is_public ? 'Public' : 'Private'}
                      </span>
                      {m.origin_app && (
                        <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-600">
                          {m.origin_app}
                        </span>
                      )}
                      {m.reward_reason === 'popular' && (
                        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                          🪙 Popular
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400">{fmtBoardTime(m.created_at)}</span>
                      {replies.length > 0 && (
                        <span className="text-[10px] text-slate-400">· {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
                      )}
                    </div>
                    {m.email && <p className="text-xs text-slate-500">{m.email}</p>}
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{m.message}</p>
                  </button>
                  <button
                    onClick={() => handleDelete(m.id)}
                    disabled={deletingId === m.id}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-rose-500 transition hover:bg-rose-50 disabled:opacity-40"
                    title="Delete message"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-3 space-y-2 border-l-2 border-slate-100 pl-3">
                    {m.user_id && (
                      <div>
                        <button
                          onClick={() => handleOpenGrant(m.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600 transition hover:bg-amber-100"
                        >
                          <Gift className="h-3 w-3" /> Grant ICAN to {m.name || 'this poster'}
                        </button>
                        {grantTargetId === m.id && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={grantAmount}
                              onChange={(e) => setGrantAmount(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleGrant(m); }}
                              placeholder="Amount"
                              className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-amber-400"
                            />
                            <button
                              onClick={() => handleGrant(m)}
                              disabled={grantingId === m.id || !grantAmount}
                              className="rounded-lg bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-white transition disabled:opacity-40"
                            >
                              {grantingId === m.id ? 'Granting…' : 'Confirm'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {replies.map((r) => (
                      <div key={r.id} className={`flex items-start justify-between gap-2 rounded-lg px-3 py-2 ${r.sender_role === 'dev' ? 'bg-orange-50' : 'bg-slate-50'}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold text-slate-800">{r.sender_role === 'dev' ? 'BodaGoEra Team' : (r.name || 'Website visitor')}</p>
                            {r.reward_reason && (
                              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                                🪙 Correct answer
                              </span>
                            )}
                            <span className="text-[10px] text-slate-400">{fmtBoardTime(r.created_at)}</span>
                          </div>
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700"><Linkify text={r.message} /></p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {r.sender_role !== 'dev' && r.user_id && !r.rewarded_at && (
                              <button
                                onClick={() => handleMarkCorrect(r.id)}
                                disabled={markingId === r.id}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 transition hover:bg-emerald-100 disabled:opacity-40"
                              >
                                <CheckCircle className="h-3 w-3" /> {markingId === r.id ? 'Marking…' : 'Mark correct answer (+1 ICAN)'}
                              </button>
                            )}
                            {r.sender_role !== 'dev' && r.user_id && (
                              <button
                                onClick={() => handleOpenGrant(r.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600 transition hover:bg-amber-100"
                              >
                                <Gift className="h-3 w-3" /> Grant ICAN
                              </button>
                            )}
                          </div>
                          {grantTargetId === r.id && (
                            <div className="mt-1.5 flex items-center gap-2">
                              <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={grantAmount}
                                onChange={(e) => setGrantAmount(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleGrant(r); }}
                                placeholder="Amount"
                                className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-amber-400"
                              />
                              <button
                                onClick={() => handleGrant(r)}
                                disabled={grantingId === r.id || !grantAmount}
                                className="rounded-lg bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-white transition disabled:opacity-40"
                              >
                                {grantingId === r.id ? 'Granting…' : 'Confirm'}
                              </button>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleDelete(r.id)}
                          disabled={deletingId === r.id}
                          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-rose-500 transition hover:bg-rose-50 disabled:opacity-40"
                          title="Delete reply"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {replies.length === 0 && <p className="text-xs text-slate-500">No replies yet.</p>}

                    {m.is_public && (
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          value={replyDraft}
                          onChange={(e) => setReplyDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleReply(m.id); }}
                          placeholder="Reply as BodaGo Team…"
                          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
                        />
                        <button
                          onClick={() => handleReply(m.id)}
                          disabled={replying || !replyDraft.trim()}
                          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 text-white transition disabled:opacity-40"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!loading && topLevel.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-500">No landing page messages yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface SupermarketRow {
  id: string;
  name: string;
  location: string | null;
  owner_user_id: string | null;
}

function SupermarketsTab() {
  const [supermarkets, setSupermarkets] = useState<SupermarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SupermarketRow | null>(null);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [savingOwner, setSavingOwner] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('supermarkets')
      .select('id, name, location, owner_user_id')
      .order('name');
    if (error) {
      toast.error('Failed to load supermarkets');
    } else {
      setSupermarkets(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const assignOwner = async () => {
    if (!selected || !ownerEmail.trim()) return;
    setSavingOwner(true);
    try {
      const { data: authUsers, error: authError } = await supabase.rpc('get_all_auth_users');
      if (authError) throw authError;
      const match = (authUsers || []).find((u: any) => u.email?.toLowerCase() === ownerEmail.trim().toLowerCase());
      if (!match) throw new Error('No user found with that email — they need to sign up first');

      const { error } = await supabase
        .from('supermarkets')
        .update({ owner_user_id: match.id })
        .eq('id', selected.id);
      if (error) throw error;

      toast.success(`${ownerEmail} can now manage ${selected.name}'s products`);
      setOwnerEmail('');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to assign owner');
    } finally {
      setSavingOwner(false);
    }
  };

  if (selected) {
    return (
      <div>
        <button
          onClick={() => setSelected(null)}
          className="text-sm text-orange-600 hover:text-orange-700 mb-4 flex items-center gap-1"
        >
          ← Back to Supermarkets
        </button>

        <div className="bg-slate-50 rounded-lg p-4 mb-6">
          <p className="text-sm font-medium text-slate-700 mb-2">Store Owner Access</p>
          <p className="text-xs text-slate-500 mb-3">
            {selected.owner_user_id
              ? 'This store already has an assigned owner. Enter a different email to reassign.'
              : 'No owner assigned yet — this store has no self-service product manager.'}
          </p>
          <div className="flex gap-2">
            <input
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@example.com"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 outline-none"
            />
            <button
              onClick={assignOwner}
              disabled={savingOwner || !ownerEmail.trim()}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
            >
              {savingOwner ? 'Saving…' : 'Assign'}
            </button>
          </div>
        </div>

        <SupermarketProductManager supermarketId={selected.id} supermarketName={selected.name} />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Supermarkets</h2>
      {loading ? (
        <p className="text-center text-slate-400 py-10">Loading…</p>
      ) : supermarkets.length === 0 ? (
        <p className="text-center text-slate-500 py-10">No supermarkets found.</p>
      ) : (
        <div className="space-y-2">
          {supermarkets.map((sm) => (
            <button
              key={sm.id}
              onClick={() => setSelected(sm)}
              className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors text-left"
            >
              <div>
                <p className="font-semibold text-slate-800">{sm.name}</p>
                <p className="text-xs text-slate-500">{sm.location || 'No location set'}</p>
                <p className="text-xs mt-0.5">
                  {sm.owner_user_id ? (
                    <span className="text-green-600">Owner assigned</span>
                  ) : (
                    <span className="text-slate-400">No owner — manage products directly</span>
                  )}
                </p>
              </div>
              <ChevronRight className="text-slate-400" size={18} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type CommissionSetting = {
  key: string;
  value: string;
  description: string | null;
};

function CommissionsTab() {
  const [settings, setSettings] = useState<CommissionSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('mbg_dev_get_commission_settings');
      if (error) throw error;
      const rows: CommissionSetting[] = data || [];
      setSettings(rows);
      setDrafts(Object.fromEntries(rows.map((row) => [row.key, row.value])));
    } catch (error: any) {
      console.error('Error loading commission settings:', error);
      toast.error(error?.message || 'Failed to load commission settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveSetting = async (key: string) => {
    const raw = drafts[key];
    const numeric = Number(raw);
    if (!raw || Number.isNaN(numeric) || numeric < 0 || numeric > 100) {
      toast.error('Enter a percentage between 0 and 100');
      return;
    }
    setSavingKey(key);
    try {
      const { error } = await supabase.rpc('mbg_dev_update_commission_setting', {
        p_key: key,
        p_value: numeric,
      });
      if (error) throw error;
      setSettings((prev) => prev.map((row) => (row.key === key ? { ...row, value: String(numeric) } : row)));
      toast.success('Commission percentage updated');
    } catch (error: any) {
      console.error('Error updating commission setting:', error);
      toast.error(error?.message || 'Failed to update commission percentage');
    } finally {
      setSavingKey(null);
    }
  };

  const labelFor = (setting: CommissionSetting) => setting.description || setting.key;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Commission Settings</h2>
          <p className="text-sm text-slate-600 mt-1">Configure commission percentages for each level of the hierarchy.</p>
        </div>
        <button
          onClick={loadSettings}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-500">Loading commission settings...</div>
      ) : settings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center">
          <DollarSign className="mx-auto mb-3 text-slate-400" size={36} />
          <p className="font-semibold text-slate-700">No commission settings found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {settings.map((setting) => {
            const isDirty = drafts[setting.key] !== setting.value;
            return (
              <div key={setting.key} className="rounded-xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-slate-800">{labelFor(setting)}</p>
                  <p className="text-xs text-slate-500 mt-1 font-mono">{setting.key}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={drafts[setting.key] ?? ''}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [setting.key]: e.target.value }))}
                      className="w-28 pr-7 pl-3 py-2 border border-slate-300 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
                  </div>
                  <button
                    onClick={() => saveSetting(setting.key)}
                    disabled={!isDirty || savingKey === setting.key}
                    className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
                  >
                    {savingKey === setting.key ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Platform Settings</h2>
      <div className="bg-slate-50 rounded-lg p-8 text-center">
        <Settings className="w-12 h-12 text-slate-400 mx-auto mb-4" />
        <p className="text-slate-600 mb-4">Platform settings coming soon</p>
        <p className="text-sm text-slate-500">Configure global platform settings and preferences.</p>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-gradient-to-br from-white to-slate-50 rounded-xl p-6 shadow-md border border-slate-100">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-600">{title}</h3>
        {icon}
      </div>
      <p className="text-3xl font-bold text-slate-800">{value}</p>
    </div>
  );
}
