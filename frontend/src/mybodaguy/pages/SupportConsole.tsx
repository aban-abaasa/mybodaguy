import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bike, MessageSquare, Mail, Users, RefreshCw, Trash2, Send, CheckCircle, Globe, Lock,
  Search, Eye, EyeOff, Loader2, ShieldAlert, AlertTriangle, ChevronLeft, LogOut,
} from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { Linkify } from '../utils/linkify';

// Passwordless entry point into a SCOPED, read-mostly slice of
// DeveloperDashboard, reachable at /support-console?key=<token> — see
// backend/database/ADD_SUPPORT_CONSOLE.sql +
// ADD_SUPPORT_CONSOLE_USERS_READONLY.sql.
//
// Pure browser-to-Postgres RPC, same as ICAN's dev panel — no backend
// server involved at all. A correct password unlocks `board_secret`
// (never exposed before that), which every call below passes as the
// existing dev_token/p_dev_secret/p_token argument these RPCs already
// accept. Revocation is real and immediate: every RPC re-checks
// mbg_support_links.revoked_at on every call, not a cached session.
//
// Only tabs with a real read-only RPC are wired here — see
// DeveloperDashboard.tsx's SUPPORT_LINK_TAB_OPTIONS for the current list.

const getTokenFromUrl = (): string => {
  try {
    return new URLSearchParams(window.location.search).get('key') || '';
  } catch {
    return '';
  }
};

type Status = 'checking' | 'invalid' | 'password_required' | 'granted';

const TAB_META: Record<string, { label: string; Icon: any }> = {
  'public-board': { label: 'Public Board', Icon: MessageSquare },
  messages: { label: 'Messages', Icon: Mail },
  users: { label: 'Users', Icon: Users },
};

// Same ivory / ink / gold look as the customer + rider dashboards
// (.classic-* in index.css): serif headings, gold hairlines, rounded cards.
const GOLD_BORDER = 'border-[rgba(196,160,82,0.35)]';

function Avatar({ name, size = 40 }: { name?: string | null; size?: number }) {
  const initials = (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
  return (
    <span
      className="grid flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 font-classic-display font-bold text-white ring-2 ring-[#e6c980]"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  );
}

function Brand({ label }: { label?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-500 to-amber-500 text-white ring-2 ring-[#e6c980] shadow-md">
        <Bike size={20} />
      </span>
      <div className="min-w-0">
        <p className="font-classic-display text-[20px] font-bold leading-none tracking-tight text-slate-900">BodaGoEra</p>
        <p className="classic-eyebrow mt-1 truncate">{label || 'Support Console'}</p>
      </div>
    </div>
  );
}

export default function SupportConsole() {
  const [token] = useState(getTokenFromUrl);
  const [status, setStatus] = useState<Status>('checking');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [boardSecret, setBoardSecret] = useState<string | null>(null);
  const [allowedTabs, setAllowedTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    if (!token) { setStatus('invalid'); setError('This link is missing its access key.'); return; }

    (async () => {
      const { data, error: err } = await supabase.rpc('mbg_support_get_link_access', { p_token: token });
      if (err || !data || data.status === 'invalid') {
        setStatus('invalid');
        setError('This link is invalid or has been revoked.');
        return;
      }
      setLabel(data.label || '');
      setStatus('password_required');
    })();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!password.trim() || verifying) return;
    setVerifying(true);
    try {
      const { data, error: err } = await supabase.rpc('mbg_support_verify_link_password', {
        p_token: token, p_password: password.trim(),
      });
      if (err || !data?.success) { setError(data?.error || err?.message || 'Could not verify.'); return; }

      const tabs: string[] = Array.isArray(data.allowed_tabs) && data.allowed_tabs.length ? data.allowed_tabs : [];
      setLabel(data.label || label);
      setBoardSecret(data.board_secret);
      setAllowedTabs(tabs);
      setActiveTab(tabs[0] || '');
      setStatus('granted');
    } finally {
      setVerifying(false);
    }
  };

  if (status === 'granted' && boardSecret) {
    const tabs = allowedTabs.filter((id) => TAB_META[id]);
    return (
      <div className="classic-page min-h-[100dvh]">
        <header className={`sticky top-0 z-30 border-b ${GOLD_BORDER} bg-[#faf8f3]/90 backdrop-blur`} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
            <Brand label={label} />
            <button onClick={() => window.location.reload()} className="classic-btn classic-btn-ghost" aria-label="Lock console">
              <LogOut size={16} /> <span className="hidden sm:inline">Lock</span>
            </button>
          </div>
          {/* desktop / tablet tabs */}
          {tabs.length > 1 && (
            <div className="mx-auto hidden max-w-6xl gap-2 px-4 pb-3 md:flex">
              {tabs.map((id) => {
                const { label: tabLabel, Icon } = TAB_META[id];
                return (
                  <button key={id} onClick={() => setActiveTab(id)} aria-current={activeTab === id ? 'page' : undefined}
                    className={`classic-chip ${activeTab === id ? 'is-active' : ''}`}>
                    <Icon size={14} /> {tabLabel}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        <main className={`mx-auto max-w-6xl px-4 py-5 ${tabs.length > 1 ? 'pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-8' : 'pb-8'}`}>
          {activeTab === 'public-board' && <SupportPublicBoardTab secret={boardSecret} />}
          {activeTab === 'messages' && <SupportMessagesTab secret={boardSecret} />}
          {activeTab === 'users' && <SupportUsersTab secret={boardSecret} />}
        </main>

        {/* mobile bottom tab bar — same pattern as the customer / rider apps */}
        {tabs.length > 1 && (
          <nav className={`fixed inset-x-0 bottom-0 z-30 border-t ${GOLD_BORDER} bg-[#fffdf8]/95 backdrop-blur md:hidden`} style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="flex">
              {tabs.map((id) => {
                const { label: tabLabel, Icon } = TAB_META[id];
                const active = activeTab === id;
                return (
                  <button key={id} onClick={() => { setActiveTab(id); window.scrollTo({ top: 0 }); }} aria-current={active ? 'page' : undefined}
                    className={`relative flex min-w-[72px] flex-1 flex-col items-center gap-0.5 py-2 transition active:scale-95 ${active ? 'text-[#7a5a12]' : 'text-slate-500'}`}>
                    {active && <span className="absolute inset-x-6 top-0 h-0.5 rounded-b-full bg-[#c4a052]" />}
                    <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${active ? 'bg-[#fbf3dc]' : ''}`}><Icon size={19} /></span>
                    <span className="text-[10px] font-bold leading-none">{tabLabel}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}
      </div>
    );
  }

  return (
    <div className="classic-page flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-orange-500 to-amber-500 text-white ring-4 ring-[#e6c980]/70 shadow-lg">
            <Bike size={30} />
          </span>
          <p className="classic-eyebrow">Support Console</p>
          <h1 className="mt-1 font-classic-display text-[30px] font-bold leading-tight tracking-tight text-slate-900">BodaGoEra</h1>
          <div className="landing-classic-divider mx-auto mt-3 w-40" />
        </div>

        <div className="classic-card p-5 sm:p-6">
          {status === 'checking' && (
            <div className="flex flex-col items-center gap-3 py-6" role="status">
              <Loader2 size={26} className="animate-spin text-[#c4a052]" />
              <p className="text-sm text-slate-500">Checking your link…</p>
            </div>
          )}

          {status === 'invalid' && (
            <div className="flex flex-col items-center gap-3 py-3 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-rose-50 text-rose-500 ring-1 ring-rose-200"><ShieldAlert size={22} /></span>
              <p className="font-classic-display text-lg font-semibold text-slate-800">Link not available</p>
              <p className="text-sm text-rose-500">{error || 'This link is invalid or has been revoked.'}</p>
              <p className="text-xs text-slate-500">Ask the BodaGoEra team to send you a fresh support link.</p>
            </div>
          )}

          {status === 'password_required' && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <h2 className="font-classic-display text-xl font-semibold text-slate-800">Welcome back</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  {label ? `Enter the password for “${label}”.` : 'Enter the password you were given for this link.'}
                </p>
              </div>
              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-600">
                  <AlertTriangle size={14} className="mt-px flex-shrink-0" /> <span>{error}</span>
                </div>
              )}
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a17c28]" />
                <input
                  type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password" autoFocus autoComplete="current-password" aria-label="Password"
                  className="classic-input !pl-10 !pr-11"
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:text-[#7a5a12] active:scale-90">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button type="submit" disabled={verifying || !password.trim()} className="classic-btn classic-btn-primary">
                {verifying ? <><Loader2 size={16} className="animate-spin" /> Checking…</> : 'Enter console'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <Lock size={11} /> Secured access · BodaGoEra support team only
        </p>
      </div>
    </div>
  );
}

const fmtTime = (d?: string | null) => {
  if (!d) return '';
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(d).toLocaleDateString();
};

const fmtClock = (d?: string | null) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

const dayLabel = (d: string) => {
  const date = new Date(d);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(date)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

function SectionTitle({ title, sub, onRefresh, loading }: { title: string; sub?: string; onRefresh: () => void; loading: boolean }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-classic-display text-2xl font-bold leading-tight text-slate-900">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
        </div>
        <button onClick={onRefresh} disabled={loading} aria-label={`Refresh ${title}`} className="classic-btn classic-btn-outline !w-11 !min-h-[44px] !p-0 flex-shrink-0">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="landing-classic-divider mt-3" />
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a17c28]" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="classic-input !pl-10" />
    </div>
  );
}

function EmptyState({ title, hint, Icon = MessageSquare }: { title: string; hint?: string; Icon?: any }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-[#fbf3dc] text-[#a17c28] ring-1 ring-[#e6c980]"><Icon size={22} /></span>
      <p className="font-classic-display text-lg font-semibold text-slate-800">{title}</p>
      {hint && <p className="max-w-xs text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 px-4 py-4">
          <div className="h-11 w-11 rounded-full bg-[#f3e9d2]" />
          <div className="flex-1 space-y-2"><div className="h-3 w-2/5 rounded bg-[#f3e9d2]" /><div className="h-3 w-4/5 rounded bg-[#f7f0e1]" /></div>
        </div>
      ))}
    </>
  );
}

// ── Public Board — reuses the SAME dev_get_landing_messages/reply/mark/
// delete RPCs the real DeveloperDashboard uses, passing board_secret as
// their existing dev_token argument (landing_messages_is_dev() already
// recognizes a valid support-link secret — see ADD_SUPPORT_CONSOLE.sql).
// No "grant ICAN" here — that stays real-developer-only.
type BoardFilter = 'all' | 'needs_reply' | 'public' | 'private';

function SupportPublicBoardTab({ secret }: { secret: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replying, setReplying] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<BoardFilter>('all');
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('dev_get_landing_messages', { dev_token: secret });
    if (error) console.error('[SupportPublicBoardTab] load failed:', error.message);
    setItems(data || []);
    setLoading(false);
  }, [secret]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await supabase.rpc('dev_delete_landing_message', { dev_token: secret, message_id: id });
      if (expandedId === id) setExpandedId(null);
      await refresh();
    } finally {
      setDeletingId(null);
    }
  };

  const handleReply = async (id: string) => {
    const body = replyDraft.trim();
    if (!body || replying) return;
    setReplying(true);
    try {
      await supabase.rpc('dev_reply_landing_message', { dev_token: secret, parent_id: id, body, team_name: 'BodaGoEra Team' });
      setReplyDraft('');
      await refresh();
    } finally {
      setReplying(false);
    }
  };

  const handleMarkCorrect = async (id: string) => {
    if (markingId) return;
    setMarkingId(id);
    try {
      await supabase.rpc('dev_mark_correct_answer', { dev_token: secret, reply_id: id });
      await refresh();
    } finally {
      setMarkingId(null);
    }
  };

  const allTop = items.filter((m) => !m.parent_id);
  const hasTeamReply = (m: any) => items.some((i) => i.parent_id === m.id && i.sender_role === 'dev');
  const needsReply = allTop.filter((m) => m.is_public && !hasTeamReply(m)).length;
  const q = query.trim().toLowerCase();
  const topLevel = allTop.filter((m) =>
    (filter === 'all' ||
      (filter === 'public' && m.is_public) ||
      (filter === 'private' && !m.is_public) ||
      (filter === 'needs_reply' && m.is_public && !hasTeamReply(m))) &&
    (!q || [m.name, m.email, m.message].some((v) => String(v || '').toLowerCase().includes(q)))
  );

  const filters: { id: BoardFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'needs_reply', label: `Needs reply${needsReply ? ` (${needsReply})` : ''}` },
    { id: 'public', label: 'Public' },
    { id: 'private', label: 'Private' },
  ];

  return (
    <div className="space-y-4">
      <SectionTitle title="Public Board" sub={`Landing page messages · ${allTop.length} total`} onRefresh={refresh} loading={loading} />
      <SearchBox value={query} onChange={setQuery} placeholder="Search name, email or message…" />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" style={{ scrollbarWidth: 'none' }}>
        {filters.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`classic-chip flex-shrink-0 ${filter === f.id ? 'is-active' : ''}`}>{f.label}</button>
        ))}
      </div>

      {loading && <div className="classic-card divide-y divide-[rgba(196,160,82,0.2)]"><ListSkeleton /></div>}

      {!loading && topLevel.length === 0 && (
        <div className="classic-card">
          <EmptyState
            title={allTop.length === 0 ? 'No messages yet' : 'No messages match'}
            hint={allTop.length === 0 ? 'Questions from the landing page will show up here.' : 'Try another filter or clear the search.'}
          />
        </div>
      )}

      {topLevel.map((m) => {
        const replies = items.filter((i) => i.parent_id === m.id);
        const isExpanded = expandedId === m.id;
        return (
          <div key={m.id} className="classic-card p-4">
            <div className="flex items-start gap-3">
              <Avatar name={m.name || 'Website visitor'} />
              <button onClick={() => { setExpandedId(isExpanded ? null : m.id); setReplyDraft(''); }} className="min-w-0 flex-1 text-left" aria-expanded={isExpanded}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="font-classic-display text-base font-semibold text-slate-900">{m.name || 'Website visitor'}</p>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${m.is_public ? 'border-orange-200 bg-orange-50 text-orange-600' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    {m.is_public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {m.is_public ? 'Public' : 'Private'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  {fmtTime(m.created_at)}{replies.length > 0 && ` · ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
                  {m.email && ` · ${m.email}`}
                </p>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-700">{m.message}</p>
              </button>
              <button onClick={() => handleDelete(m.id)} disabled={deletingId === m.id} aria-label="Delete message"
                className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl text-rose-500 transition hover:bg-rose-50 active:scale-90 disabled:opacity-40">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {isExpanded && (
              <div className="mt-3 space-y-2 border-l-2 border-[#e6c980] pl-3">
                {replies.map((r) => (
                  <div key={r.id} className={`flex items-start justify-between gap-2 rounded-xl px-3 py-2 ${r.sender_role === 'dev' ? 'bg-[#fbf3dc]' : 'bg-slate-50'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold text-slate-800">{r.sender_role === 'dev' ? 'BodaGoEra Team' : (r.name || 'Website visitor')}</p>
                        <span className="text-[10px] text-slate-400">{fmtTime(r.created_at)}</span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700"><Linkify text={r.message} /></p>
                      {r.sender_role !== 'dev' && r.user_id && !r.rewarded_at && (
                        <button onClick={() => handleMarkCorrect(r.id)} disabled={markingId === r.id}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-40">
                          <CheckCircle className="h-3 w-3" /> {markingId === r.id ? 'Marking…' : 'Mark correct answer'}
                        </button>
                      )}
                    </div>
                    <button onClick={() => handleDelete(r.id)} disabled={deletingId === r.id} aria-label="Delete reply"
                      className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-rose-500 transition hover:bg-rose-50 disabled:opacity-40">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {replies.length === 0 && <p className="text-xs text-slate-500">No replies yet.</p>}
                {m.is_public && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleReply(m.id); }}
                      placeholder="Reply as BodaGoEra Team…" aria-label="Reply"
                      className="classic-input"
                    />
                    <button onClick={() => handleReply(m.id)} disabled={replying || !replyDraft.trim()} aria-label="Send reply"
                      className="classic-btn classic-btn-primary !w-12 !min-h-[46px] flex-shrink-0 !p-0">
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Messages — token-gated equivalents of chatService's real-developer
// functions (see ADD_SUPPORT_CONSOLE.sql's mbg_support_list_conversations /
// mbg_support_fetch_messages / mbg_support_send_message /
// mbg_support_mark_conversation_read). No realtime subscription here — RLS
// wouldn't deliver postgres_changes to a session with no auth.uid(), so
// this relies on the manual Refresh button instead.
function SupportMessagesTab({ secret }: { secret: string }) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('mbg_support_list_conversations', { p_dev_secret: secret });
    if (error) console.error('[SupportMessagesTab] load failed:', error.message);
    setConversations(data || []);
    setLoading(false);
  }, [secret]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc('mbg_support_fetch_messages', { p_dev_secret: secret, p_conversation_id: selectedId });
      if (cancelled) return;
      setMessages(data || []);
      await supabase.rpc('mbg_support_mark_conversation_read', { p_dev_secret: secret, p_conversation_id: selectedId });
      setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, unread_by_dev: false } : c)));
    })();
    return () => { cancelled = true; };
  }, [selectedId, secret]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Composer grows with its content (up to ~5 lines)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [reply, selectedId]);

  // Full-screen chat on phones: stop the page behind it scrolling
  useEffect(() => {
    if (!selectedId || window.matchMedia('(min-width: 1024px)').matches) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [selectedId]);

  const selected = conversations.find((c) => c.id === selectedId);
  const unreadCount = conversations.filter((c) => c.unread_by_dev).length;
  const q = query.trim().toLowerCase();
  const visible = conversations.filter((c) =>
    (!unreadOnly || c.unread_by_dev) &&
    (!q || [c.guest_name, c.guest_email, c.last_message_preview].some((v) => String(v || '').toLowerCase().includes(q)))
  );

  const handleReply = async () => {
    const body = reply.trim();
    if (!body || !selectedId || sending) return;
    setSending(true);
    try {
      const { data } = await supabase.rpc('mbg_support_send_message', {
        p_dev_secret: secret, p_conversation_id: selectedId, p_sender_name: 'BodaGoEra Team', p_body: body,
      });
      if (data) setMessages((prev) => [...prev, data]);
      setReply('');
    } finally {
      setSending(false);
    }
  };

  // Enter sends on desktop; on touch keyboards Enter is a newline.
  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || (e.nativeEvent as any).isComposing) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    e.preventDefault();
    handleReply();
  };

  type Row = { type: 'day'; key: string; label: string } | { type: 'msg'; key: string; m: any; first: boolean };
  const timeline: Row[] = [];
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    if (!prev || dayLabel(prev.created_at) !== dayLabel(m.created_at)) {
      timeline.push({ type: 'day', key: `day-${m.id}`, label: dayLabel(m.created_at) });
    }
    timeline.push({ type: 'msg', key: m.id, m, first: !prev || prev.sender_role !== m.sender_role || timeline[timeline.length - 1].type === 'day' });
  });

  return (
    <div className="space-y-4">
      <div className={selectedId ? 'hidden lg:block' : ''}>
        <SectionTitle title="Messages" sub={`${conversations.length} conversations${unreadCount ? ` · ${unreadCount} unread` : ''}`} onRefresh={refresh} loading={loading} />
      </div>

      <div className="grid gap-4 lg:h-[calc(100dvh-14rem)] lg:min-h-[480px] lg:grid-cols-[340px_1fr]">
        {/* conversation list */}
        <div className={`${selectedId ? 'hidden lg:flex' : 'flex'} classic-card min-h-0 flex-col overflow-hidden`}>
          <div className="space-y-2.5 border-b border-[rgba(196,160,82,0.25)] p-3">
            <SearchBox value={query} onChange={setQuery} placeholder="Search conversations…" />
            <div className="flex gap-2">
              <button onClick={() => setUnreadOnly(false)} className={`classic-chip ${!unreadOnly ? 'is-active' : ''}`}>All</button>
              <button onClick={() => setUnreadOnly(true)} className={`classic-chip ${unreadOnly ? 'is-active' : ''}`}>Unread{unreadCount ? ` (${unreadCount})` : ''}</button>
            </div>
          </div>
          <div className="max-h-[calc(100dvh-22rem)] flex-1 divide-y divide-[rgba(196,160,82,0.2)] overflow-y-auto overscroll-contain lg:max-h-none">
            {loading && conversations.length === 0 && <ListSkeleton rows={4} />}
            {visible.map((c) => {
              const active = selectedId === c.id;
              return (
                <button key={c.id} onClick={() => setSelectedId(c.id)}
                  className={`relative flex w-full items-center gap-3 px-4 py-3 text-left transition active:bg-[#fbf3dc] ${active ? 'bg-[#fbf3dc]' : 'hover:bg-[#fffdf8]'}`}>
                  {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-[#c4a052]" />}
                  <Avatar name={c.guest_name || c.role || 'Guest'} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`truncate font-classic-display text-[15px] text-slate-900 ${c.unread_by_dev ? 'font-bold' : 'font-semibold'}`}>{c.guest_name || c.role || 'Guest'}</p>
                      <span className={`flex-shrink-0 text-[10px] ${c.unread_by_dev ? 'font-semibold text-orange-600' : 'text-slate-400'}`}>{fmtTime(c.last_message_at)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className={`truncate text-xs ${c.unread_by_dev ? 'text-slate-700' : 'text-slate-500'}`}>{c.last_message_preview || c.guest_email || 'No messages yet'}</p>
                      {c.unread_by_dev && <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-orange-500" />}
                    </div>
                  </div>
                </button>
              );
            })}
            {!loading && visible.length === 0 && (
              <EmptyState title={conversations.length === 0 ? 'No conversations yet' : 'No matches'}
                hint={conversations.length === 0 ? 'New chats will appear here — tap refresh to check.' : 'Try a different search or switch back to All.'} />
            )}
          </div>
        </div>

        {/* chat pane — full screen on phones */}
        <div className={`${selectedId ? 'fixed inset-0 z-50 flex lg:relative lg:inset-auto lg:z-auto' : 'hidden lg:flex lg:relative'} classic-page min-h-0 flex-col overflow-hidden lg:rounded-[20px] lg:border lg:border-[rgba(196,160,82,0.26)]`}
          style={selectedId ? { paddingTop: 'env(safe-area-inset-top)' } : undefined}>
          {!selected ? (
            <div className="flex flex-1 items-center justify-center bg-white/60">
              <EmptyState title="Select a conversation" hint="Pick a chat on the left to read and reply." />
            </div>
          ) : (
            <>
              <div className={`flex items-center gap-2 border-b ${GOLD_BORDER} bg-[#faf8f3]/95 px-3 py-2.5 backdrop-blur`}>
                <button onClick={() => setSelectedId(null)} aria-label="Back to conversations"
                  className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full text-slate-600 transition active:scale-90 lg:hidden">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <Avatar name={selected.guest_name || 'Guest'} size={38} />
                <div className="min-w-0">
                  <p className="truncate font-classic-display text-base font-semibold text-slate-900">{selected.guest_name || 'Guest'}</p>
                  <p className="truncate text-[11px] text-slate-500">{selected.guest_email}</p>
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
                {messages.length === 0 && <p className="py-10 text-center text-xs text-slate-500">No messages yet.</p>}
                {timeline.map((row) => {
                  if (row.type === 'day') {
                    return (
                      <div key={row.key} className="my-3 flex items-center gap-3">
                        <div className="landing-classic-divider flex-1" />
                        <span className="classic-eyebrow !text-[10px]">{row.label}</span>
                        <div className="landing-classic-divider flex-1" />
                      </div>
                    );
                  }
                  const { m, first } = row;
                  const fromDev = m.sender_role === 'dev';
                  return (
                    <div key={row.key} className={`flex ${fromDev ? 'justify-end' : 'justify-start'} ${first ? 'mt-3' : 'mt-0.5'}`}>
                      <div className={`max-w-[85%] px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${fromDev
                        ? 'rounded-2xl rounded-br-md bg-gradient-to-br from-orange-500 to-amber-500 text-white'
                        : 'rounded-2xl rounded-bl-md border border-[rgba(196,160,82,0.3)] bg-white text-slate-800'}`}>
                        {!fromDev && first && <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-[#a17c28]">{m.sender_name || selected.role}</p>}
                        <p className="whitespace-pre-wrap break-words"><Linkify text={m.body} /></p>
                        <p className={`mt-0.5 text-right text-[10px] leading-none ${fromDev ? 'text-white/75' : 'text-slate-400'}`}>{fmtClock(m.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={`flex items-end gap-2 border-t ${GOLD_BORDER} bg-[#faf8f3]/95 px-3 pt-2.5`} style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}>
                <textarea ref={inputRef} rows={1} value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={onComposerKeyDown}
                  placeholder="Reply as BodaGoEra Team…" aria-label="Reply"
                  className="classic-input max-h-[120px] min-h-[44px] flex-1 resize-none !rounded-2xl" />
                <button onClick={handleReply} disabled={sending || !reply.trim()} aria-label="Send reply"
                  className="classic-btn classic-btn-primary !w-11 !min-h-[44px] flex-shrink-0 !rounded-full !p-0">
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Users — read-only (see ADD_SUPPORT_CONSOLE_USERS_READONLY.sql). No
// promote-to-developer or any other write action; that stays real-
// developer-only.
function SupportUsersTab({ secret }: { secret: string }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('mbg_support_list_users', { p_token: secret });
    if (error) console.error('[SupportUsersTab] load failed:', error.message);
    setUsers(data || []);
    setLoading(false);
  }, [secret]);

  useEffect(() => { refresh(); }, [refresh]);

  const q = query.toLowerCase();
  const filtered = users.filter((u) =>
    !q || u.email?.toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q)
  );

  return (
    <div className="space-y-4">
      <SectionTitle title="Users" sub={`Read-only · ${users.length} total`} onRefresh={refresh} loading={loading} />
      <SearchBox value={query} onChange={setQuery} placeholder="Search by name or email…" />
      <div className="classic-card divide-y divide-[rgba(196,160,82,0.2)] overflow-hidden">
        {loading && <ListSkeleton rows={4} />}
        {filtered.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={u.full_name || u.email} size={42} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-classic-display text-[15px] font-semibold text-slate-900">{u.full_name || u.email}</p>
              <p className="truncate text-xs text-slate-500">{u.email}</p>
            </div>
            <span className="flex-shrink-0 rounded-full border border-[#e6c980] bg-[#fbf3dc] px-2.5 py-0.5 text-[10px] font-semibold capitalize text-[#7a5a12]">
              {(u.committee_role || u.role_type || '').replace(/_/g, ' ')}
            </span>
          </div>
        ))}
        {!loading && filtered.length === 0 && <EmptyState title="No users found" Icon={Users} hint={users.length ? 'Try a different search.' : undefined} />}
      </div>
    </div>
  );
}
