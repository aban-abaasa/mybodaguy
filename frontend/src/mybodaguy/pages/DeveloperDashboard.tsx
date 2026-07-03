import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bike, Users, MapPin, DollarSign, Settings,
  TrendingUp, LogOut, Menu, X, Shield, Search,
  MessageSquare, RefreshCw, Globe, Lock, Trash2, Send, CheckCircle, Mail, Gift,
} from 'lucide-react';
import { toast } from 'sonner';
import { userService } from '../services/userService';
import RegionsManagement from '../components/RegionsManagement';
import IcanCoinCard from '../components/IcanCoinCard';
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
}

export default function DeveloperDashboard({ user, onSignOut }: DeveloperDashboardProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

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

  const tabs = [
    { id: 'overview', label: 'Overview', icon: TrendingUp },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'regions', label: 'Regions', icon: MapPin },
    { id: 'commissions', label: 'Commissions', icon: DollarSign },
    { id: 'public-board', label: 'Public Board', icon: MessageSquare },
    { id: 'messages', label: 'Messages', icon: Mail },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-lg sticky top-0 z-50">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Bike size={28} />
              <div>
                <h1 className="text-xl font-bold">My Boda Guy</h1>
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
          {activeTab === 'overview' && <OverviewTab onSwitchToRegions={() => setActiveTab('regions')} userId={user?.id} />}
          {activeTab === 'users' && <UsersTab users={users} loading={loading} onReload={loadUsers} />}
          {activeTab === 'regions' && <RegionsManagement />}
          {activeTab === 'commissions' && <CommissionsTab />}
          {activeTab === 'public-board' && <PublicBoardTab />}
          {activeTab === 'messages' && <MessagesTab />}
          {activeTab === 'settings' && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ onSwitchToRegions, userId }: { onSwitchToRegions: () => void; userId?: string }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Platform Overview</h2>

      <div className="grid md:grid-cols-5 gap-6 mb-8">
        <StatCard title="Total Users" value="0" icon={<Users className="text-orange-500" />} />
        <StatCard title="Active Riders" value="0" icon={<Bike className="text-orange-500" />} />
        <StatCard title="Total Rides" value="0" icon={<TrendingUp className="text-orange-500" />} />
        <StatCard title="Total Revenue" value="0 UGX" icon={<DollarSign className="text-orange-500" />} />
        {userId && <IcanCoinCard userId={userId} onGoToWallet={() => (window.location.href = '/ican-wallet')} />}
      </div>

      <div className="bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl p-8 text-center">
        <Bike className="w-16 h-16 text-orange-500 mx-auto mb-4" />
        <h3 className="text-2xl font-bold text-slate-800 mb-2">Welcome to Developer Panel</h3>
        <p className="text-slate-600 mb-4">
          You have full control over the My Boda Guy platform. Start by setting up geographic regions 
          and assigning chairpersons.
        </p>
        <div className="flex flex-wrap gap-4 justify-center">
          <button 
            onClick={onSwitchToRegions}
            className="px-6 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-yellow-600 transition-all shadow-md"
          >
            Setup Regions
          </button>
          <button className="px-6 py-2 bg-white text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition-all shadow-md border border-slate-200">
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

function UsersTab({ users, loading, onReload }: { users: any[]; loading: boolean; onReload: () => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

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
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setConversations(await listConversations());
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
      const msg = await sendChatMessage(selectedId, { senderRole: 'dev', senderName: 'My Boda Guy Team', body });
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
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Conversations ({conversations.length})
        </div>
        <div className="max-h-[65vh] overflow-y-auto">
          {conversations.map((c) => (
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
              <div className="mt-1.5 flex items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-600">{c.portal}</span>
                <span className="text-[10px] text-slate-400">{fmtChatTime(c.last_message_at)}</span>
              </div>
              {c.last_message_preview && <p className="mt-1 truncate text-xs text-slate-500">{c.last_message_preview}</p>}
            </button>
          ))}
          {conversations.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-500">No conversations yet.</p>
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
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
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
                placeholder="Reply as My Boda Guy Team…"
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
            Community board messages posted from the My Boda Guy landing page.
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
                            <p className="text-xs font-semibold text-slate-800">{r.sender_role === 'dev' ? 'My Boda Guy Team' : (r.name || 'Website visitor')}</p>
                            {r.reward_reason && (
                              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                                🪙 Correct answer
                              </span>
                            )}
                            <span className="text-[10px] text-slate-400">{fmtBoardTime(r.created_at)}</span>
                          </div>
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700">{r.message}</p>
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
                          placeholder="Reply as My Boda Guy Team…"
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

function CommissionsTab() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Commission Settings</h2>
      <div className="bg-slate-50 rounded-lg p-8 text-center">
        <DollarSign className="w-12 h-12 text-slate-400 mx-auto mb-4" />
        <p className="text-slate-600 mb-4">Commission configuration coming soon</p>
        <p className="text-sm text-slate-500">Configure commission percentages for each level of the hierarchy.</p>
      </div>
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
