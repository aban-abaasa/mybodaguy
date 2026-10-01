import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Headphones, Globe, ThumbsUp, Phone, Video as VideoIcon, Radio, Image as ImageIcon, Loader2 } from 'lucide-react';
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
import { Linkify } from '../utils/linkify';
import { uploadChatImage, type ChatAttachment } from '../services/chatAttachmentService';
import ImageLightbox from './common/ImageLightbox';
import { ChatAvatar } from '../utils/avatar';
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

// Classic ivory/gold look shared with the ICAN chat widget. Scoped to
// .ican-classic-chat so the tailwind colour overrides never leak elsewhere.
const CLASSIC_CHAT_CSS = `
.ican-classic-chat { animation: ican-pop .22s ease both; background: #fffdf8; border-color: rgba(196,160,82,.55); color: #1e293b; box-shadow: 0 24px 48px -20px rgba(122,90,18,.45); }
@keyframes ican-pop { from { opacity: 0; scale: .96; } to { opacity: 1; scale: 1; } }
@keyframes ican-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.ican-classic-head { background: linear-gradient(180deg, #fffdf8, #f6ecd2); border-bottom: 1px solid rgba(196,160,82,.55); color: #5c430d; position: relative; }
.ican-classic-head::after { content: ''; position: absolute; left: 50%; bottom: -4px; width: 7px; height: 7px; background: #c4a052; transform: translateX(-50%) rotate(45deg); box-shadow: 0 0 0 3px #fffdf8; z-index: 2; }
.ican-classic-head button, .ican-classic-head button svg { color: #7a5a12 !important; }
.ican-classic-head button:hover { background: rgba(196,160,82,.18) !important; }
.ican-title { font-family: "Playfair Display", Georgia, "Times New Roman", serif; font-weight: 700; font-size: .95rem; color: #1e293b; }
.ican-sub { font-size: .68rem; color: #8a6a1f; letter-spacing: .02em; }
.ican-medallion { display: grid; place-items: center; flex: none; width: 2.1rem; height: 2.1rem; border-radius: 999px; background: radial-gradient(circle at 30% 28%, #fff, #f1e2b8); border: 1px solid rgba(184,137,43,.55); box-shadow: inset 0 0 0 3px #fff, 0 4px 10px -6px #b8892b; }
.ican-medallion svg { color: #b8892b; }
.ican-tabs { background: #fbf5e4; border-bottom: 1px solid rgba(196,160,82,.35); padding-top: .65rem; }
.ican-ctab { border-radius: 999px; border: 1px solid rgba(196,160,82,.4); background: #fffdf8; color: #7a5a12; font-weight: 700; transition: background-color .15s ease, box-shadow .15s ease; }
.ican-ctab:hover { background: rgba(196,160,82,.14); }
.ican-ctab.is-active { background: linear-gradient(135deg, #d9b765, #b8892b); border-color: #b8892b; color: #fff; box-shadow: 0 6px 14px -8px #b8892b; }
.ican-body { background: #fffdf8; }
.ican-fab { background: radial-gradient(circle at 30% 28%, #fffaf0, #e8d49a 70%, #c4a052); color: #7a5a12; border: 1px solid #b8892b; box-shadow: inset 0 0 0 3px #fffdf8, 0 10px 24px -8px rgba(122,90,18,.6); }
.ican-classic-chat .bg-gradient-to-br, .ican-classic-chat .bg-gradient-to-r { background-image: linear-gradient(135deg, #d9b765, #b8892b) !important; color: #fff; box-shadow: 0 6px 14px -8px #b8892b; }
.ican-classic-chat .bg-white { background-color: #fffdf8 !important; }
.ican-classic-chat .bg-slate-50 { background-color: #fbf5e4 !important; }
.ican-classic-chat .border-slate-200 { border-color: rgba(196,160,82,.4) !important; }
.ican-classic-chat .text-slate-800 { color: #2b2210 !important; }
.ican-classic-chat .text-slate-400, .ican-classic-chat .text-slate-500 { color: #8a7a52 !important; }
.ican-classic-chat [class*="text-orange-"] { color: #8a6a1f !important; }
.ican-classic-chat [class*="focus:ring-orange"]:focus { --tw-ring-color: rgba(196,160,82,.45); border-color: #b8892b !important; }
.ican-classic-chat .hover\\:bg-slate-100:hover, .ican-classic-chat .hover\\:bg-slate-50:hover { background-color: rgba(196,160,82,.14) !important; }
.ican-classic-chat .uppercase { font-family: "Playfair Display", Georgia, serif; letter-spacing: .14em; }
.ican-classic-chat textarea, .ican-classic-chat input { font-family: Georgia, "Times New Roman", serif; }
.ican-classic-chat .overflow-y-auto > * { animation: ican-rise .35s ease both; }
@media (prefers-reduced-motion: reduce) { .ican-classic-chat, .ican-classic-chat .overflow-y-auto > * { animation: none; } }
`;

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
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState(() => getSavedPosition());
  const [dragging, setDragging] = useState(false);

  const [supportConvId, setSupportConvId] = useState<string | null>(null);
  const [supportMessages, setSupportMessages] = useState<any[]>([]);
  const [supportUnread, setSupportUnread] = useState(false);

  const [communityThreads, setCommunityThreads] = useState<LandingThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

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

  // Smart auto-scroll: always jump to the latest message on open/channel/
  // thread switches (deliberate navigation), but once you've scrolled up to
  // read older messages, a new one arriving shouldn't yank you back down —
  // only re-pin to the bottom if you were already near it (tracked by
  // handleListScroll below, which reflects your position BEFORE the new
  // message renders).
  const isNearBottomRef = useRef(true);
  const handleListScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      isNearBottomRef.current = true;
    }
  }, [open, channel, selectedThreadId]);

  useEffect(() => {
    if (open && scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [supportMessages, communityThreads]);

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

  const handlePickImage = () => fileInputRef.current?.click();

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAttachmentError('');
    setAttachmentUploading(true);
    try {
      setPendingAttachment(await uploadChatImage(file));
    } catch (err: any) {
      setAttachmentError(err?.message || 'Could not upload image');
    } finally {
      setAttachmentUploading(false);
    }
  };

  const handleSend = async () => {
    const body = draft.trim();
    if ((!body && !pendingAttachment) || sending || attachmentUploading) return;

    const who = ensureIdentity();
    if (!who) return;

    setSending(true);
    isNearBottomRef.current = true;
    try {
      const attachment = pendingAttachment;
      const senderAvatarUrl = who.isGuest ? null : ((who as any).avatarUrl || null);
      if (channel === 'community') {
        const senderAuthId = who.isGuest ? null : (who as any).authId;
        if (selectedThreadId) {
          await replyToLandingMessage({ parentId: selectedThreadId, name: who.name, email: who.email, authId: senderAuthId, message: body, attachment, senderAvatarUrl });
        } else {
          await createLandingMessage({ name: who.name, email: who.email, authId: senderAuthId, message: body, isPublic: true, attachment, senderAvatarUrl });
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
        const msg = await sendMessage(convId, { senderRole, senderName: who.name, senderAvatarUrl, body, attachment });
        setSupportMessages((prev) => dedupe(prev, msg));
      }
      setDraft('');
      setPendingAttachment(null);
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
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
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
      <style>{CLASSIC_CHAT_CSS}</style>
      {open && (
        <div aria-hidden="true" onClick={() => setOpen(false)} className="fixed inset-0 bg-[#2b2210]/40 backdrop-blur-[2px]" />
      )}
      {open && (
        <div className="ican-classic-chat fixed left-1/2 top-1/2 flex h-[min(28rem,calc(100dvh-2rem))] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[18px] border shadow-2xl">
          <div className="ican-classic-head flex items-center justify-between gap-2 px-4 py-3">
            <span className="ican-medallion" aria-hidden="true">{channel === 'community' ? <Globe className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}</span>
            <div className="min-w-0 flex-1">
              <p className="ican-title truncate">{channel === 'community' ? 'Community' : 'BodaGoEra Support'}</p>
              <p className="ican-sub">
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

          <div className="ican-tabs flex gap-1.5 px-3 py-2">
            <button
              onClick={() => handleSwitchChannel('support')}
              className={`ican-ctab flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-xs ${
                channel === 'support' ? 'is-active' : ''
              }`}
            >
              <Headphones className="h-3.5 w-3.5" /> Support
              {supportUnread && channel !== 'support' && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
            </button>
            <button
              onClick={() => handleSwitchChannel('community')}
              className={`ican-ctab flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-xs ${
                channel === 'community' ? 'is-active' : ''
              }`}
            >
              <Globe className="h-3.5 w-3.5" /> Community
            </button>
          </div>

          <div ref={scrollRef} onScroll={handleListScroll} className="ican-body flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {channel === 'community' ? (
              selectedThread ? (
                <>
                  <button onClick={() => setSelectedThreadId(null)} className="mb-1 text-[11px] font-medium text-orange-600">
                    ← Back to Community
                  </button>
                  <div className="flex items-start gap-2">
                    <ChatAvatar id={selectedThread.user_id || selectedThread.email || selectedThread.name} name={selectedThread.name} url={selectedThread.sender_avatar_url} size="mt-0.5 h-7 w-7 text-[10px]" />
                    <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-500">
                        {selectedThread.name || 'Website visitor'}
                      </p>
                      {selectedThread.attachment_url && (
                        <img
                          src={selectedThread.attachment_url}
                          alt=""
                          className="mb-1.5 max-h-52 cursor-pointer rounded-lg object-cover"
                          onClick={() => setLightboxSrc(selectedThread.attachment_url)}
                        />
                      )}
                      {selectedThread.message && <p className="whitespace-pre-wrap break-words"><Linkify text={selectedThread.message} /></p>}
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
                  </div>
                  {selectedThread.replies.map((r) => (
                    <div key={r.id} className="ml-4 mt-2 flex items-start gap-2">
                      <ChatAvatar id={r.user_id || r.email || r.name} name={r.sender_role === 'dev' ? 'BodaGoEra Team' : r.name} url={r.sender_avatar_url} size="mt-0.5 h-6 w-6 text-[9px]" />
                      <div
                        className={`min-w-0 flex-1 rounded-xl px-3 py-2 text-sm ${
                          r.sender_role === 'dev' ? 'bg-gradient-to-br from-orange-500 to-yellow-500 text-white' : 'border border-slate-200 bg-white text-slate-800'
                        }`}
                      >
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-80">
                          {r.sender_role === 'dev' ? 'BodaGoEra Team' : (r.name || 'Website visitor')}
                          {r.reward_reason && ' · 🪙'}
                        </p>
                        {r.attachment_url && (
                          <img
                            src={r.attachment_url}
                            alt=""
                            className="mb-1.5 max-h-52 cursor-pointer rounded-lg object-cover"
                            onClick={() => setLightboxSrc(r.attachment_url)}
                          />
                        )}
                        {r.message && <p className="whitespace-pre-wrap break-words"><Linkify text={r.message} /></p>}
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
                    <div className="flex items-start gap-2">
                      <ChatAvatar id={t.user_id || t.email || t.name} name={t.name} url={t.sender_avatar_url} size="mt-0.5 h-7 w-7 text-[10px]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-500">{t.name || 'Website visitor'}</p>
                        <div className="mt-0.5 flex items-start gap-2">
                          {t.attachment_url && (
                            <img src={t.attachment_url} alt="" className="h-8 w-8 flex-shrink-0 rounded object-cover" />
                          )}
                          <p className="line-clamp-2 whitespace-pre-wrap break-words">{t.message || (t.attachment_url ? 'Photo' : '')}</p>
                        </div>
                      </div>
                    </div>
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
                    <div key={m.id} className={`flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                      {!isMe && <ChatAvatar id="team" name="Team" url={m.sender_avatar_url} size="h-6 w-6 text-[9px]" />}
                      <div
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                          isMe ? 'bg-gradient-to-br from-orange-500 to-yellow-500 text-white' : 'border border-slate-200 bg-white text-slate-800'
                        }`}
                      >
                        {!isMe && <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-500">Team</p>}
                        {m.attachment_url && (
                          <img
                            src={m.attachment_url}
                            alt=""
                            className="mb-1.5 max-h-52 cursor-pointer rounded-lg object-cover"
                            onClick={() => setLightboxSrc(m.attachment_url)}
                          />
                        )}
                        {m.body && <p className="whitespace-pre-wrap break-words"><Linkify text={m.body} /></p>}
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
            {(pendingAttachment || attachmentUploading) && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                {attachmentUploading ? (
                  <>
                    <Loader2 className="h-8 w-8 flex-shrink-0 animate-spin text-slate-400 p-1.5" />
                    <span className="text-xs text-slate-500">Uploading…</span>
                  </>
                ) : (
                  <>
                    <img src={pendingAttachment!.url} alt="" className="h-8 w-8 flex-shrink-0 rounded object-cover" />
                    <span className="flex-1 truncate text-xs text-slate-500">{pendingAttachment!.name}</span>
                    <button onClick={() => setPendingAttachment(null)} className="flex-shrink-0 text-slate-400 hover:text-slate-600" title="Remove image">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            )}
            {attachmentError && <p className="mb-1.5 text-[11px] text-red-500">{attachmentError}</p>}
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelected} className="hidden" />
              <button
                onClick={handlePickImage}
                disabled={attachmentUploading}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-orange-500 disabled:opacity-40"
                title="Attach an image"
              >
                <ImageIcon className="h-4 w-4" />
              </button>
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
                disabled={sending || attachmentUploading || (!draft.trim() && !pendingAttachment)}
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
        className={`relative flex h-14 w-14 touch-none items-center justify-center rounded-full ican-fab shadow-2xl transition ${dragging ? 'cursor-grabbing' : 'cursor-grab hover:scale-105'}`}
        title="Chat with us"
      >
        <style>{`
          @keyframes ican-chat-ring-spin { to { transform: rotate(360deg); } }
          @keyframes ican-chat-ring-hue { to { filter: hue-rotate(360deg); } }
          .ican-chat-ring {
            background: conic-gradient(from 0deg, #8a6a1f, #e6c980, #c4a052, #fff3c4, #b8892b, #e6c980, #8a6a1f);
            -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
            mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
            animation: ican-chat-ring-spin 3s linear infinite, ican-chat-ring-hue 6s linear infinite;
          }
          @media (prefers-reduced-motion: reduce) { .ican-chat-ring { animation: none; } }
        `}</style>
        <span aria-hidden="true" className="ican-chat-ring pointer-events-none absolute -inset-[4px] rounded-full" />
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {!open && supportUnread && (
          <span className="absolute -top-1 -right-1 h-4 w-4 animate-pulse rounded-full border-2 border-white bg-red-500" />
        )}
      </button>
      </div>
    </>
  );
}
