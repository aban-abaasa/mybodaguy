/**
 * RideChatModal — real-time in-app chat between a ride's customer and rider.
 * Backed by mbg_ride_messages + a Supabase Realtime postgres_changes
 * subscription (RLS already restricts rows to the two ride participants).
 *
 * Layout: portalled to <body> at z-[1050] so it always sits above the phone
 * bottom nav (z-60), the floating assistant bubble (z-999) and Leaflet's
 * controls (z-1000) — rendered in place it was being drawn *under* the nav,
 * which covered the composer and the send button. Full-screen on phones
 * (dvh + safe-area insets so the keyboard and notches don't clip it), a
 * centred card from `sm` up. Call/incoming-call overlays are z-[1100]+ so a
 * call can still break through an open chat.
 *
 * Sending is optimistic: a bubble appears at once ("sending"), is swapped for
 * the stored row when the insert returns, and turns into a tap-to-retry
 * bubble if it fails — the sender no longer depends on Realtime echoing their
 * own message back to see it.
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, MessageCircle, Check, Clock, AlertCircle, ArrowDown, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import { Linkify } from '../utils/linkify';
import { ChatAvatar } from '../utils/avatar';
import { useBackLayer } from '../hooks/useBackLayer';

interface RideMessage {
  id: string;
  ride_id: string;
  sender_user_id: string;
  message: string;
  created_at: string;
}

/** A row from the table, or a local one that hasn't been stored (yet). */
interface ChatMessage extends RideMessage {
  status?: 'sending' | 'failed';
}

interface RideChatModalProps {
  rideId: string;
  selfUserId: string;
  peerName: string;
  isOpen: boolean;
  onClose: () => void;
  /** One-tap replies shown above the composer. Pass [] to hide them. */
  quickReplies?: string[];
}

const MAX_LENGTH = 2000; // mbg_ride_messages.message CHECK constraint
const GROUP_GAP_MS = 5 * 60 * 1000;
const STICK_THRESHOLD_PX = 96;

const DEFAULT_QUICK_REPLIES = [
  "I'm on my way 🛵",
  "I've arrived 📍",
  'Where are you?',
  'Please wait a moment',
  'Thank you 🙏',
];

const dayKey = (iso: string) => new Date(iso).toDateString();

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const formatDay = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

const friendlySendError = (error: { code?: string; message?: string }) =>
  // The insert policy only lets participants write while the ride is accepted/in progress.
  error.code === '42501' || /row-level security/i.test(error.message || '')
    ? 'Chat is only open while the ride is active.'
    : error.message || 'Message failed to send';

export default function RideChatModal({
  rideId,
  selfUserId,
  peerName,
  isOpen,
  onClose,
  quickReplies = DEFAULT_QUICK_REPLIES,
}: RideChatModalProps) {
  useBackLayer(isOpen, onClose);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [live, setLive] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stickRef = useRef(true); // is the reader parked at the bottom of the thread?
  const prevLenRef = useRef(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('mbg_ride_messages')
      .select('*')
      .eq('ride_id', rideId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) {
      setLoadError(true);
    } else {
      setLoadError(false);
      // Keep anything still local (sending / failed) after the stored rows.
      setMessages((prev) => [...(data || []), ...prev.filter((m) => m.status)]);
    }
    setLoading(false);
  }, [rideId]);

  useEffect(() => {
    if (!isOpen || !rideId) return;
    setMessages([]);
    setLoading(true);
    setLoadError(false);
    setUnseen(0);
    stickRef.current = true;
    prevLenRef.current = 0;
    load();

    const channel = supabase
      .channel(`mbg-ride-messages:${rideId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mbg_ride_messages', filter: `ride_id=eq.${rideId}` },
        (payload) => {
          const row = payload.new as RideMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            if (row.sender_user_id === selfUserId) {
              // Our own echo arrived before the insert call returned — it replaces the local bubble.
              const i = prev.findIndex((m) => m.status === 'sending' && m.message === row.message);
              if (i !== -1) {
                const next = [...prev];
                next[i] = row;
                return next;
              }
            }
            return [...prev, row];
          });
        }
      )
      .subscribe((status) => {
        setLive(status === 'SUBSCRIBED');
        // Anything sent between the first load and the socket coming up (or
        // while it was reconnecting) would otherwise be missed.
        if (status === 'SUBSCRIBED') load();
      });

    return () => {
      setLive(false);
      supabase.removeChannel(channel);
    };
  }, [isOpen, rideId, selfUserId, load]);

  // Lock the page behind the sheet and let Escape close it.
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    stickRef.current = true;
    setUnseen(0);
  }, []);

  // Follow the conversation only while the reader is at the bottom (or wrote the
  // message); otherwise leave their scroll position alone and count what's new.
  useLayoutEffect(() => {
    const last = messages[messages.length - 1];
    const added = messages.length - prevLenRef.current;
    prevLenRef.current = messages.length;
    if (!last) return;
    const firstFill = added === messages.length;
    if (firstFill || stickRef.current || last.sender_user_id === selfUserId) {
      scrollToBottom(firstFill ? 'auto' : 'smooth');
    } else if (added > 0) {
      setUnseen((n) => n + added);
    }
  }, [messages, selfUserId, scrollToBottom]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    stickRef.current = atBottom;
    if (atBottom) setUnseen(0);
  };

  // Grow the composer with its content (up to ~5 lines).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft, isOpen]);

  const deliver = useCallback(async (localId: string, text: string) => {
    const { data, error } = await supabase
      .from('mbg_ride_messages')
      .insert({ ride_id: rideId, sender_user_id: selfUserId, message: text })
      .select()
      .single();
    if (error || !data) {
      setMessages((prev) => prev.map((m) => (m.id === localId ? { ...m, status: 'failed' } : m)));
      toast.error(friendlySendError(error || {}));
      return;
    }
    const row = data as RideMessage;
    setMessages((prev) =>
      // Realtime may already have delivered the stored row — then just drop the local bubble.
      prev.some((m) => m.id === row.id)
        ? prev.filter((m) => m.id !== localId)
        : prev.map((m) => (m.id === localId ? row : m))
    );
  }, [rideId, selfUserId]);

  const sendText = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMessages((prev) => [
      ...prev,
      {
        id: localId,
        ride_id: rideId,
        sender_user_id: selfUserId,
        message: text,
        created_at: new Date().toISOString(),
        status: 'sending',
      },
    ]);
    deliver(localId, text);
  }, [rideId, selfUserId, deliver]);

  const send = () => {
    if (!draft.trim()) return;
    sendText(draft);
    setDraft('');
    inputRef.current?.focus(); // keep the keyboard up for the next message
  };

  const retry = (m: ChatMessage) => {
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: 'sending' } : x)));
    deliver(m.id, m.message);
  };

  const discard = (m: ChatMessage) => setMessages((prev) => prev.filter((x) => x.id !== m.id));

  if (!isOpen) return null;

  const showQuickReplies = quickReplies.length > 0 && !draft.trim() && !loading;

  return createPortal(
    <div
      className="fixed inset-0 z-[1050] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Chat with ${peerName}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[640px] sm:max-h-[90dvh] sm:max-w-md sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-100 bg-white px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3">
          <ChatAvatar id={rideId} name={peerName} size="h-10 w-10 text-sm" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-bold leading-tight text-slate-800">{peerName}</h3>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-green-500' : 'animate-pulse bg-amber-400'}`} />
              {live ? 'Ride chat · live' : 'Connecting…'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close chat"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={22} />
          </button>
        </div>

        {/* Thread */}
        <div className="relative min-h-0 flex-1 bg-slate-50">
          <div
            ref={scrollerRef}
            onScroll={onScroll}
            className="h-full overflow-y-auto overscroll-contain px-3 py-3"
            aria-live="polite"
          >
            {loading ? (
              <div className="space-y-3 pt-2" aria-label="Loading messages">
                {[['w-40', false], ['w-56', true], ['w-32', false], ['w-48', true]].map(([w, mine], i) => (
                  <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`h-9 animate-pulse rounded-2xl bg-slate-200 ${w}`} />
                  </div>
                ))}
              </div>
            ) : loadError && messages.length === 0 ? (
              <div className="mt-12 flex flex-col items-center gap-3 px-6 text-center">
                <AlertCircle size={28} className="text-slate-400" />
                <p className="text-sm text-slate-500">Couldn't load this conversation.</p>
                <button
                  onClick={() => { setLoading(true); load(); }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
                >
                  <RotateCw size={14} /> Try again
                </button>
              </div>
            ) : messages.length === 0 ? (
              <div className="mt-12 flex flex-col items-center gap-2 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-100">
                  <MessageCircle size={26} className="text-orange-500" />
                </div>
                <p className="font-semibold text-slate-700">No messages yet</p>
                <p className="text-sm text-slate-500">Say hello to {peerName} — or tap a quick reply below.</p>
              </div>
            ) : (
              messages.map((m, i) => {
                const mine = m.sender_user_id === selfUserId;
                const prev = messages[i - 1];
                const next = messages[i + 1];
                const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                const startsGroup =
                  newDay ||
                  prev.sender_user_id !== m.sender_user_id ||
                  new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_GAP_MS;
                const endsGroup =
                  !next ||
                  next.sender_user_id !== m.sender_user_id ||
                  dayKey(next.created_at) !== dayKey(m.created_at) ||
                  new Date(next.created_at).getTime() - new Date(m.created_at).getTime() > GROUP_GAP_MS;

                return (
                  <div key={m.id}>
                    {newDay && (
                      <div className={`flex justify-center ${i === 0 ? 'mb-1' : 'my-3'}`}>
                        <span className="rounded-full bg-slate-200 px-3 py-0.5 text-[11px] font-medium text-slate-600">
                          {formatDay(m.created_at)}
                        </span>
                      </div>
                    )}
                    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} ${startsGroup && !newDay ? 'mt-3' : 'mt-0.5'}`}>
                      <div className="flex max-w-[82%] flex-col">
                        <div
                          className={`px-3 py-2 text-[15px] leading-snug ${
                            mine
                              ? `bg-orange-500 text-white rounded-2xl ${endsGroup ? 'rounded-br-md' : ''} ${m.status === 'sending' ? 'opacity-70' : ''}`
                              : `border border-slate-200 bg-white text-slate-800 rounded-2xl ${endsGroup ? 'rounded-bl-md' : ''}`
                          }`}
                        >
                          <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                            <Linkify text={m.message} />
                          </div>
                          {(endsGroup || m.status) && (
                            <div className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${mine ? 'text-white/80' : 'text-slate-400'}`}>
                              {formatTime(m.created_at)}
                              {mine && m.status === 'sending' && <Clock size={11} aria-label="Sending" />}
                              {mine && !m.status && <Check size={12} aria-label="Sent" />}
                            </div>
                          )}
                        </div>
                        {m.status === 'failed' && (
                          <div className="mt-1 flex items-center justify-end gap-2 text-xs text-red-600">
                            <AlertCircle size={13} /> Not sent
                            <button onClick={() => retry(m)} className="font-semibold underline underline-offset-2">Retry</button>
                            <button onClick={() => discard(m)} className="text-slate-500 underline underline-offset-2">Delete</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {unseen > 0 && (
            <button
              onClick={() => scrollToBottom()}
              className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-orange-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-orange-600"
            >
              <ArrowDown size={13} /> {unseen} new {unseen === 1 ? 'message' : 'messages'}
            </button>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-slate-100 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          {showQuickReplies && (
            <div className="flex gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {quickReplies.map((q) => (
                <button
                  key={q}
                  onClick={() => sendText(q)}
                  className="flex-shrink-0 whitespace-nowrap rounded-full border border-orange-200 bg-white px-3 py-1.5 text-xs font-medium text-orange-600 transition-colors hover:bg-orange-50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 px-3">
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={MAX_LENGTH}
              enterKeyHint="send"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type a message…"
              aria-label="Message"
              // text-base (16px) stops iOS zooming the page when the field is focused.
              className="max-h-[120px] min-h-[44px] flex-1 resize-none rounded-3xl border border-slate-300 px-4 py-[10px] text-base leading-6 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <button
              onClick={send}
              disabled={!draft.trim()}
              aria-label="Send message"
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 text-white transition-colors hover:bg-orange-600 disabled:opacity-40"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
