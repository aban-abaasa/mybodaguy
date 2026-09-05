import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Headphones, Globe, ThumbsUp, Phone, Video as VideoIcon, Radio } from 'lucide-react';
import {
  resolveChatIdentity,
  getGuestIdentity,
  setGuestIdentity,
  getStoredConversationId,
  storeConversationId,
  createConversation,
  fetchConversation,
  fetchMessages,
  sendMessage,
  markConversationRead,
  subscribeToMessages,
  subscribeToConversation,
  type ChatIdentity,
} from '../services/chatService';
import {
  createLandingMessage,
  fetchPublicThreads,
  getOrCreateGuestLikeKey,
  likeMessage,
  replyToLandingMessage,
  subscribeToPublicLandingMessages,
  type LandingThread,
  type LandingMessage,
} from '../services/landingMessagesService';
import { useDirectCall } from '../hooks/useDirectCall';
import { useCommunityLive } from '../hooks/useCommunityLive';
import CallDock from './calls/CallDock';
import CallStage from './calls/CallStage';
import IncomingCallOverlay from './calls/IncomingCallOverlay';
import CommunityLiveStage from './community/CommunityLiveStage';

type Identity = (ChatIdentity & { isGuest: false }) | ({ name: string; email: string; isGuest: true });

const dedupe = (list: any[], item: any) => (list.some((m) => m.id === item.id) ? list : [...list, item]);

// Small audio/video call-launch buttons, shown next to the Support header
// once a conversation exists — hidden once a call is already in progress.
const CallButtons = ({ call, onAudio, onVideo }: { call: any; onAudio: () => void; onVideo: () => void }) => {
  if (!call?.canCall) return null;
  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      <button onClick={onAudio} className="rounded-full p-1.5 text-white transition hover:bg-white/20" title="Audio call">
        <Phone className="h-4 w-4" />
      </button>
      <button onClick={onVideo} className="rounded-full p-1.5 text-white transition hover:bg-white/20" title="Video call">
        <VideoIcon className="h-4 w-4" />
      </button>
    </div>
  );
};

const WIDGET_POSITION_KEY = 'mbg_chat_widget_position';
const getSavedPosition = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(WIDGET_POSITION_KEY) || 'null');
    if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) return saved;
  } catch { /* Use the default position. */ }
  return { left: Math.max(12, window.innerWidth - 76), top: Math.max(12, window.innerHeight - 76) };
};

const DEV_SESSION_KEY = 'mbg_developer_active';

// mybodaguy has no hidden dev-token panel — the closest equivalent hide
// signal is a real developer actively viewing DeveloperDashboard, which
// sets this flag (see DeveloperDashboard.tsx) so the widget doesn't show
// itself to the team while they're already in their moderation view.
const isDeveloperViewActive = () => {
  try {
    return sessionStorage.getItem(DEV_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
};

export default function ChatWidget() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [identityReady, setIdentityReady] = useState(false);
  const [guestForm, setGuestForm] = useState({ name: '', email: '' });
  const [guestFormError, setGuestFormError] = useState('');
  const [guestLikeKey] = useState<string>(() => getOrCreateGuestLikeKey());

  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<'support' | 'community'>('support');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [position, setPosition] = useState(() => getSavedPosition());
  const [dragging, setDragging] = useState(false);

  const [supportConvId, setSupportConvId] = useState<string | null>(null);
  const [supportMessages, setSupportMessages] = useState<any[]>([]);
  const [supportUnread, setSupportUnread] = useState(false);

  const [communityThreads, setCommunityThreads] = useState<LandingThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const [liveChatDraft, setLiveChatDraft] = useState('');
  const [liveChatSending, setLiveChatSending] = useState(false);
  const [liveChatError, setLiveChatError] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  const channelRef = useRef(channel);
  const dragRef = useRef<{ startX: number; startY: number; left: number; top: number } | null>(null);
  const dragMovedRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => { channelRef.current = channel; }, [channel]);

  useEffect(() => {
    const keepWidgetVisible = () => {
      setPosition((current) => ({
        left: Math.min(Math.max(8, current.left), Math.max(8, window.innerWidth - 64)),
        top: Math.min(Math.max(8, current.top), Math.max(8, window.innerHeight - 64)),
      }));
    };
    window.addEventListener('resize', keepWidgetVisible);
    return () => window.removeEventListener('resize', keepWidgetVisible);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(WIDGET_POSITION_KEY, JSON.stringify(position)); } catch { /* Storage is optional. */ }
  }, [position]);

  const hidden = isDeveloperViewActive();
  const scopeKey = identity ? (identity.isGuest ? 'guest' : `user_${(identity as any).userId}`) : null;

  // 1:1 Support call — rings whoever's on the other end of this conversation
  // (there's no fixed "dev" id to dial, same as ICAN's Support channel), so
  // the room is simply the conversation's own inbox.
  const selfName = identity?.name || 'Guest';
  const supportSelfId = (identity as any)?.userId || (identity as any)?.authId || guestLikeKey;
  const supportRoomId = supportConvId ? `support:${supportConvId}` : null;
  const supportCall = useDirectCall({ roomId: supportRoomId, selfId: supportSelfId, selfName });
  const showCallStage = supportCall.isVideo && (supportCall.callState === 'ringing-out' || supportCall.callState === 'active');

  // Community "Go Live" broadcast — no 1:1 calling between community
  // members, only this one shared group broadcast. Guests can watch but not
  // go live.
  const communityLive = useCommunityLive({
    selfId: (identity as any)?.userId || (identity as any)?.authId || guestLikeKey,
    selfName,
    canBroadcast: Boolean(identity && !identity.isGuest),
    scope: 'community',
  });
  const showCommunityLiveStage = communityLive.role === 'broadcasting' || communityLive.role === 'watching';

  const handleSendLiveChat = async () => {
    const body = liveChatDraft.trim();
    if (!body || liveChatSending) return;
    const who = ensureIdentity();
    if (!who) return;
    setLiveChatSending(true);
    setLiveChatError('');
    try {
      const senderAuthId = who.isGuest ? null : (who as any).authId;
      await createLandingMessage({ name: who.name, email: who.email, authId: senderAuthId, message: body, isPublic: true });
      setCommunityThreads(await fetchPublicThreads(50, { authId: senderAuthId, guestKey: guestLikeKey }));
      setLiveChatDraft('');
    } catch (err) {
      console.error('[ChatWidget] live chat send failed:', err);
      setLiveChatError('Could not send — try again.');
    } finally {
      setLiveChatSending(false);
    }
  };

  const startDrag = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    dragMovedRef.current = false;
    dragRef.current = { startX: event.clientX, startY: event.clientY, left: position.left, top: position.top };
    setDragging(true);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const left = Math.min(Math.max(8, drag.left + event.clientX - drag.startX), Math.max(8, window.innerWidth - 64));
    const top = Math.min(Math.max(8, drag.top + event.clientY - drag.startY), Math.max(8, window.innerHeight - 64));
    if (Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4) {
      dragMovedRef.current = true;
    }
    setPosition({ left, top });
  };

  const endDrag = () => { dragRef.current = null; setDragging(false); };

  useEffect(() => {
    if (hidden) { setIdentityReady(true); return; }
    let cancelled = false;
    (async () => {
      const resolved = await resolveChatIdentity();
      if (cancelled) return;
      if (resolved) {
        setIdentity({ ...resolved, isGuest: false });
      } else {
        const stored = getGuestIdentity();
        if (stored?.name) setIdentity({ ...stored, isGuest: true });
      }
      setIdentityReady(true);
    })();
    return () => { cancelled = true; };
  }, [hidden]);

  useEffect(() => {
    setSupportMessages([]);
    setSupportConvId(null);
    setSupportUnread(false);
    if (!scopeKey) return;
    const storedId = getStoredConversationId(scopeKey);
    if (!storedId) return;

    let cancelled = false;
    (async () => {
      const conv = await fetchConversation(storedId);
      if (!conv || cancelled) return;
      setSupportConvId(conv.id);
      setSupportUnread(!!conv.unread_by_user);
    })();
    return () => { cancelled = true; };
  }, [scopeKey]);

  useEffect(() => {
    if (!supportConvId) return;
    let cancelled = false;
    (async () => {
      const msgs = await fetchMessages(supportConvId);
      if (!cancelled) setSupportMessages(msgs);
    })();

    const unsubMessages = subscribeToMessages(supportConvId, (msg) => {
      setSupportMessages((prev) => dedupe(prev, msg));
      if (msg.sender_role === 'dev' && !(openRef.current && channelRef.current === 'support')) {
        setSupportUnread(true);
      }
    });
    const unsubConversation = subscribeToConversation(supportConvId, (conv) => {
      if (conv.unread_by_user && !(openRef.current && channelRef.current === 'support')) {
        setSupportUnread(true);
      }
    });

    return () => { cancelled = true; unsubMessages(); unsubConversation(); };
  }, [supportConvId]);

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    const authId = identity && !identity.isGuest ? (identity as any).authId : null;
    const load = () => fetchPublicThreads(50, { authId, guestKey: guestLikeKey })
      .then((rows) => { if (!cancelled) setCommunityThreads(rows); }).catch(() => {});
    load();
    const unsubscribe = subscribeToPublicLandingMessages(() => load());
    return () => { cancelled = true; unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, identity, guestLikeKey]);

  const selectedThread = communityThreads.find((t) => t.id === selectedThreadId) || null;

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [supportMessages, communityThreads, selectedThreadId, open, channel]);

  const markChannelRead = (ch: 'support' | 'community') => {
    if (ch === 'support') {
      setSupportUnread(false);
      if (supportConvId) markConversationRead(supportConvId, 'user');
    }
  };

  const handleOpen = () => {
    setOpen(true);
    markChannelRead(channel);
  };

  const handleSwitchChannel = (ch: 'support' | 'community') => {
    setChannel(ch);
    markChannelRead(ch);
  };

  const ensureIdentity = (): Identity | null => {
    if (identity) return identity;
    const name = guestForm.name.trim();
    const email = guestForm.email.trim();
    if (!name || !email) {
      setGuestFormError('Please enter your name and email so we can reply.');
      return null;
    }
    const guest: Identity = { name, email, isGuest: true };
    setGuestIdentity({ name, email });
    setIdentity(guest);
    return guest;
  };

  const handleLike = async (messageId: string) => {
    const authId = identity && !identity.isGuest ? (identity as any).authId : null;
    setCommunityThreads((prev) => prev.map((t) => {
      const bump = (m: LandingMessage) => (m.id === messageId && !m.likedByMe
        ? { ...m, likeCount: (m.likeCount || 0) + 1, likedByMe: true }
        : m);
      return { ...bump(t), replies: t.replies.map(bump) };
    }));
    try {
      await likeMessage({ messageId, authId, guestKey: guestLikeKey });
    } catch (err) {
      console.error('[ChatWidget] failed to like message:', err);
    }
  };

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;

    const who = ensureIdentity();
    if (!who) return;

    setSending(true);
    try {
      if (channel === 'community') {
        const senderAuthId = who.isGuest ? null : (who as any).authId;
        if (selectedThreadId) {
          await replyToLandingMessage({ parentId: selectedThreadId, name: who.name, email: who.email, authId: senderAuthId, message: body });
        } else {
          await createLandingMessage({ name: who.name, email: who.email, authId: senderAuthId, message: body, isPublic: true });
        }
        setCommunityThreads(await fetchPublicThreads(50, { authId: senderAuthId, guestKey: guestLikeKey }));
      } else {
        const key = who.isGuest ? 'guest' : `user_${(who as any).userId}`;
        let convId = supportConvId;
        if (!convId) {
          const conv = await createConversation({
            name: who.name,
            email: who.email,
            userId: who.isGuest ? null : (who as any).userId,
            role: who.isGuest ? 'guest' : (who as any).role,
            portal: 'landing',
            subject: 'Support chat',
          });
          convId = conv.id;
          storeConversationId(key, convId);
          setSupportConvId(convId);
        }
        const senderRole = who.isGuest ? 'guest' : ((who as any).role || 'guest');
        const msg = await sendMessage(convId, { senderRole, senderName: who.name, body });
        setSupportMessages((prev) => dedupe(prev, msg));
      }
      setDraft('');
    } catch (err) {
      console.error('[ChatWidget] send failed:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (hidden || !identityReady) return null;

  const needsGuestForm = !identity;

  return (
    <>
      <IncomingCallOverlay call={supportCall} onAccept={() => { setOpen(true); setChannel('support'); supportCall.acceptCall(); }} />
      {showCommunityLiveStage && (
        <CommunityLiveStage
          live={communityLive}
          messages={selectedThread ? selectedThread.replies : communityThreads}
          onLike={handleLike}
          draft={liveChatDraft}
          onDraftChange={setLiveChatDraft}
          onSend={handleSendLiveChat}
          sending={liveChatSending}
          error={liveChatError}
          scopeLabel="Community"
        />
      )}
      <div className="fixed z-[999]" style={{ left: position.left, top: position.top }}>
      {open && (
        <div className="relative mb-3 flex h-[28rem] w-[22rem] max-w-[90vw] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-gradient-to-r from-orange-500 to-yellow-500 px-4 py-3 text-white">
            <div>
              <p className="text-sm font-semibold">{channel === 'community' ? 'Community' : 'BodaGoEra Support'}</p>
              <p className="text-[11px] text-white/80">
                {channel === 'community' ? 'Public Q&A — everyone can read this' : 'We usually reply within a few minutes'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {channel === 'support' && (
                <CallButtons call={supportCall} onAudio={() => supportCall.startCall(false, 'Support team')} onVideo={() => supportCall.startCall(true, 'Support team')} />
              )}
              {channel === 'community' && communityLive.canBroadcast && (
                <button onClick={communityLive.goLive} className="rounded-full p-1.5 text-white transition hover:bg-white/20" title="Go live">
                  <Radio className="h-4 w-4" />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 hover:bg-white/20 transition">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {channel === 'community' && communityLive.canWatch && (
            <button
              onClick={communityLive.watch}
              className="flex items-center justify-center gap-1.5 bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-600"
            >
              <Radio className="h-3 w-3 animate-pulse" /> {communityLive.liveInfo?.broadcasterName || 'Someone'} is live — {communityLive.viewerCount} watching · tap to watch
            </button>
          )}

          {channel === 'support' && showCallStage && <CallStage call={supportCall} />}
          {channel === 'support' && !showCallStage && <CallDock call={supportCall} />}

          <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <button
              onClick={() => handleSwitchChannel('support')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                channel === 'support' ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <Headphones className="h-3.5 w-3.5" /> Support
              {supportUnread && channel !== 'support' && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
            </button>
            <button
              onClick={() => handleSwitchChannel('community')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                channel === 'community' ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <Globe className="h-3.5 w-3.5" /> Community
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-slate-50 px-3 py-3">
            {channel === 'community' ? (
              selectedThread ? (
                <>
                  <button onClick={() => setSelectedThreadId(null)} className="mb-1 text-[11px] font-medium text-orange-600">
                    ← Back to Community
                  </button>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
                    <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-500">
                      {selectedThread.name || 'Website visitor'}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{selectedThread.message}</p>
                    <button
                      onClick={() => handleLike(selectedThread.id)}
                      disabled={selectedThread.likedByMe}
                      className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        selectedThread.likedByMe ? 'text-orange-500' : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      <ThumbsUp className="h-3 w-3" /> {selectedThread.likeCount || 0}
                    </button>
                  </div>
                  {selectedThread.replies.map((r) => (
                    <div
                      key={r.id}
                      className={`ml-4 mt-2 rounded-xl px-3 py-2 text-sm ${
                        r.sender_role === 'dev' ? 'bg-gradient-to-br from-orange-500 to-yellow-500 text-white' : 'border border-slate-200 bg-white text-slate-800'
                      }`}
                    >
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-80">
                        {r.sender_role === 'dev' ? 'BodaGoEra Team' : (r.name || 'Website visitor')}
                        {r.reward_reason && ' · 🪙'}
                      </p>
                      <p className="whitespace-pre-wrap break-words">{r.message}</p>
                      <button
                        onClick={() => handleLike(r.id)}
                        disabled={r.likedByMe}
                        className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          r.likedByMe ? 'text-orange-200' : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        <ThumbsUp className="h-3 w-3" /> {r.likeCount || 0}
                      </button>
                    </div>
                  ))}
                  {selectedThread.replies.length === 0 && (
                    <p className="mt-3 text-center text-xs text-slate-400">No replies yet — be the first to reply.</p>
                  )}
                </>
              ) : communityThreads.length === 0 ? (
                <p className="mt-6 text-center text-xs text-slate-400">No public questions yet — ask something below.</p>
              ) : (
                communityThreads.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedThreadId(t.id)}
                    className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 transition hover:bg-slate-50"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-500">{t.name || 'Website visitor'}</p>
                    <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words">{t.message}</p>
                    {t.replies.length > 0 && (
                      <p className="mt-1 text-[10px] text-slate-400">{t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}</p>
                    )}
                  </button>
                ))
              )
            ) : (
              <>
                {supportMessages.length === 0 && (
                  <p className="mt-6 text-center text-xs text-slate-400">Send us a message — a real person from the team will reply here.</p>
                )}
                {supportMessages.map((m) => {
                  const isMe = m.sender_role !== 'dev';
                  return (
                    <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                          isMe ? 'bg-gradient-to-br from-orange-500 to-yellow-500 text-white' : 'border border-slate-200 bg-white text-slate-800'
                        }`}
                      >
                        {!isMe && <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-500">Team</p>}
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {needsGuestForm && (
            <div className="space-y-2 border-t border-slate-200 px-3 py-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={guestForm.name}
                  onChange={(e) => setGuestForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Your name"
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
                />
                <input
                  value={guestForm.email}
                  onChange={(e) => setGuestForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="Your email"
                  type="email"
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
              {guestFormError && <p className="text-[11px] text-red-500">{guestFormError}</p>}
            </div>
          )}

          <div className="border-t border-slate-200 px-3 py-3">
            {channel === 'community' && selectedThread && (
              <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-orange-600">
                <span className="truncate">Replying to: "{selectedThread.message}"</span>
                <button onClick={() => setSelectedThreadId(null)} className="flex-shrink-0 underline">Cancel</button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  channel === 'community'
                    ? (selectedThreadId ? 'Write a reply…' : 'Ask something publicly…')
                    : 'Type your message…'
                }
                rows={1}
                className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-orange-400"
              />
              <button
                onClick={handleSend}
                disabled={sending || !draft.trim()}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-yellow-500 text-white shadow-lg transition disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => {
          if (dragMovedRef.current) return;
          open ? setOpen(false) : handleOpen();
        }}
        className={`relative flex h-14 w-14 touch-none items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-yellow-500 text-white shadow-2xl transition ${dragging ? 'cursor-grabbing' : 'cursor-grab hover:scale-105'}`}
        title="Chat with us"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {!open && supportUnread && (
          <span className="absolute -top-1 -right-1 h-4 w-4 animate-pulse rounded-full border-2 border-white bg-red-500" />
        )}
      </button>
      </div>
    </>
  );
}
