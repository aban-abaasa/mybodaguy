import { useState, useEffect, useCallback, useRef } from 'react';
import { Bike, MessageSquare, Mail, Users, RefreshCw, Trash2, Send, CheckCircle, Globe, Lock } from 'lucide-react';
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

export default function SupportConsole() {
  const [token] = useState(getTokenFromUrl);
  const [status, setStatus] = useState<Status>('checking');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [boardSecret, setBoardSecret] = useState<string | null>(null);
  const [allowedTabs, setAllowedTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');

  const [password, setPassword] = useState('');
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
    const TAB_META: Record<string, { label: string; Icon: any }> = {
      'public-board': { label: 'Public Board', Icon: MessageSquare },
      messages: { label: 'Messages', Icon: Mail },
      users: { label: 'Users', Icon: Users },
    };

    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-lg sticky top-0 z-50">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-3">
                <Bike size={28} />
                <div>
                  <h1 className="text-xl font-bold">BodaGoEra</h1>
                  <p className="text-xs opacity-90">{label || 'Support Console'}</p>
                </div>
              </div>
            </div>
          </div>
        </header>
        <div className="container mx-auto px-4 py-8">
          {allowedTabs.length > 1 && (
            <div className="bg-white rounded-xl shadow-md p-2 mb-8 flex gap-2 overflow-x-auto">
              {allowedTabs.map((id) => {
                const meta = TAB_META[id];
                if (!meta) return null;
                const { label: tabLabel, Icon } = meta;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
                      activeTab === id ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon size={18} /> {tabLabel}
                  </button>
                );
              })}
            </div>
          )}
          <div className="bg-white rounded-xl shadow-lg p-6">
            {activeTab === 'public-board' && <SupportPublicBoardTab secret={boardSecret} />}
            {activeTab === 'messages' && <SupportMessagesTab secret={boardSecret} />}
            {activeTab === 'users' && <SupportUsersTab secret={boardSecret} />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex items-center gap-2 mb-4">
          <Bike className="text-orange-500" size={24} />
          <h1 className="text-lg font-black text-slate-800">BodaGoEra Support Console</h1>
        </div>

        {status === 'checking' && <p className="text-sm text-slate-500">Loading…</p>}

        {status === 'invalid' && (
          <p className="text-sm text-rose-500">{error || 'This link is invalid or has been revoked.'}</p>
        )}

        {status === 'password_required' && (
          <>
            <p className="mb-5 text-sm text-slate-600">
              {label ? `Enter the password for "${label}".` : 'Enter the password you were given for this link.'}
            </p>
            <form onSubmit={handleSubmit} className="space-y-2">
              {error && <p className="text-xs text-rose-500">{error}</p>}
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Password" autoFocus
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
              />
              <button
                type="submit" disabled={verifying || !password.trim()}
                className="w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50 bg-gradient-to-r from-orange-500 to-yellow-500"
              >
                {verifying ? 'Checking…' : 'Enter'}
              </button>
            </form>
          </>
        )}
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

// ── Public Board — reuses the SAME dev_get_landing_messages/reply/mark/
// delete RPCs the real DeveloperDashboard uses, passing board_secret as
// their existing dev_token argument (landing_messages_is_dev() already
// recognizes a valid support-link secret — see ADD_SUPPORT_CONSOLE.sql).
// No "grant ICAN" here — that stays real-developer-only.
function SupportPublicBoardTab({ secret }: { secret: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replying, setReplying] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

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

  const topLevel = items.filter((m) => !m.parent_id);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Public Board</h2>
        <button onClick={refresh} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="max-h-[65vh] divide-y divide-slate-100 overflow-y-auto">
          {topLevel.map((m) => {
            const replies = items.filter((i) => i.parent_id === m.id);
            const isExpanded = expandedId === m.id;
            return (
              <div key={m.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <button onClick={() => { setExpandedId(isExpanded ? null : m.id); setReplyDraft(''); }} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-slate-800">{m.name || 'Website visitor'}</p>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${m.is_public ? 'border-orange-200 bg-orange-50 text-orange-600' : 'border-amber-200 bg-amber-50 text-amber-600'}`}>
                        {m.is_public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        {m.is_public ? 'Public' : 'Private'}
                      </span>
                      <span className="text-[10px] text-slate-400">{fmtTime(m.created_at)}</span>
                      {replies.length > 0 && <span className="text-[10px] text-slate-400">· {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{m.message}</p>
                  </button>
                  <button onClick={() => handleDelete(m.id)} disabled={deletingId === m.id} className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-40">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {isExpanded && (
                  <div className="mt-3 space-y-2 border-l-2 border-slate-100 pl-3">
                    {replies.map((r) => (
                      <div key={r.id} className={`flex items-start justify-between gap-2 rounded-lg px-3 py-2 ${r.sender_role === 'dev' ? 'bg-orange-50' : 'bg-slate-50'}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold text-slate-800">{r.sender_role === 'dev' ? 'BodaGoEra Team' : (r.name || 'Website visitor')}</p>
                            <span className="text-[10px] text-slate-400">{fmtTime(r.created_at)}</span>
                          </div>
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700"><Linkify text={r.message} /></p>
                          {r.sender_role !== 'dev' && r.user_id && !r.rewarded_at && (
                            <button onClick={() => handleMarkCorrect(r.id)} disabled={markingId === r.id} className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 disabled:opacity-40">
                              <CheckCircle className="h-3 w-3" /> {markingId === r.id ? 'Marking…' : 'Mark correct answer'}
                            </button>
                          )}
                        </div>
                        <button onClick={() => handleDelete(r.id)} disabled={deletingId === r.id} className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-40">
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
                          placeholder="Reply as BodaGoEra Team…"
                          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
                        />
                        <button onClick={() => handleReply(m.id)} disabled={replying || !replyDraft.trim()} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-orange-500 to-yellow-500 text-white disabled:opacity-40">
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!loading && topLevel.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">No messages yet.</p>}
        </div>
      </div>
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

  const selected = conversations.find((c) => c.id === selectedId);

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

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Conversations ({conversations.length})</span>
          <button onClick={refresh} className="text-slate-400 hover:text-slate-600"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto">
          {conversations.map((c) => (
            <button
              key={c.id} onClick={() => setSelectedId(c.id)}
              className={`w-full border-b border-slate-100 last:border-0 px-4 py-3 text-left transition ${selectedId === c.id ? 'bg-orange-50' : 'hover:bg-slate-50'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800 truncate">{c.guest_name || c.role || 'Guest'}</p>
                {c.unread_by_dev && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />}
              </div>
              <p className="text-xs text-slate-500 truncate">{c.guest_email}</p>
              <p className="mt-1 text-[10px] text-slate-400">{fmtTime(c.last_message_at)}</p>
            </button>
          ))}
          {!loading && conversations.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">No conversations yet.</p>}
        </div>
      </div>
      <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            <div className="text-center"><MessageSquare className="mx-auto mb-2 h-8 w-8 opacity-40" />Select a conversation to reply</div>
          </div>
        ) : (
          <>
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">{selected.guest_name || 'Guest'}</p>
              <p className="text-xs text-slate-500">{selected.guest_email}</p>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3" style={{ maxHeight: '48vh' }}>
              {messages.map((m) => {
                const fromDev = m.sender_role === 'dev';
                return (
                  <div key={m.id} className={`flex ${fromDev ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${fromDev ? 'bg-gradient-to-br from-orange-500 to-yellow-500 text-white' : 'bg-slate-100 text-slate-800'}`}>
                      {!fromDev && <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{m.sender_name || selected.role}</p>}
                      <p className="whitespace-pre-wrap break-words"><Linkify text={m.body} /></p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-3">
              <input
                value={reply} onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleReply(); }}
                placeholder="Reply as BodaGoEra Team…"
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
              />
              <button onClick={handleReply} disabled={sending || !reply.trim()} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-orange-500 to-yellow-500 text-white disabled:opacity-40">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
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
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-slate-800">Users (read-only)</h2>
        <button onClick={refresh} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      <input
        value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email…"
        className="w-full mb-4 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
      />
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="max-h-[65vh] divide-y divide-slate-100 overflow-y-auto">
          {filtered.map((u) => (
            <div key={u.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800 truncate">{u.full_name || u.email}</p>
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700 capitalize">
                  {(u.committee_role || u.role_type || '').replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-xs text-slate-500 truncate">{u.email}</p>
            </div>
          ))}
          {!loading && filtered.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">No users found.</p>}
        </div>
      </div>
    </div>
  );
}
