/**
 * Minimal message thread + call buttons for one booking. Reuses the same
 * chat_conversations/chat_messages tables and useDirectCall hook the rest of
 * mybodaguy already uses — a booking's room is `booking:<bookingId>`, the
 * same convention digital-city-era's port of this component uses, so a
 * booking made in either app is messageable/callable from the other
 * (call audio/video itself is same-app only for now — see useDirectCall's
 * `mbg-call:` vs digital-city-era's `dce-call:` channel prefix).
 */
import { useEffect, useRef, useState } from 'react';
import { Phone, Video, Send } from 'lucide-react';
import { fetchMessages, sendMessage, subscribeToMessages } from '../../services/chatService';
import { useDirectCall } from '../../hooks/useDirectCall';
import CallDock from '../calls/CallDock';
import { Linkify } from '../../utils/linkify';

interface BookingChatCallPanelProps {
  bookingId: string;
  conversationId: string | null;
  selfId: string | null;
  selfName: string;
  senderRole?: string;
}

export default function BookingChatCallPanel({
  bookingId, conversationId, selfId, selfName, senderRole = 'customer',
}: BookingChatCallPanelProps) {
  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const call = useDirectCall({
    roomId: bookingId ? `booking:${bookingId}` : null,
    selfId,
    selfName,
  });

  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    fetchMessages(conversationId).then((data) => {
      if (active) setMessages(data);
    });
    const unsubscribe = subscribeToMessages(conversationId, (msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending || !conversationId) return;
    setSending(true);
    setDraft('');
    try {
      await sendMessage(conversationId, { senderRole, senderName: selfName, body });
    } finally {
      setSending(false);
    }
  };

  if (!conversationId) return null;

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between bg-gray-50 px-3 py-2 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-700">Message</span>
        {call?.canCall && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => call.startCall(false)} className="rounded-full p-1.5 text-gray-600 hover:bg-gray-200 transition" title="Audio call">
              <Phone className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => call.startCall(true)} className="rounded-full p-1.5 text-gray-600 hover:bg-gray-200 transition" title="Video call">
              <Video className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <CallDock call={call} />

      <div className="max-h-56 overflow-y-auto px-3 py-2 space-y-2 bg-white">
        {messages.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No messages yet — say hello.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender_role === senderRole ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${m.sender_role === senderRole ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
              <Linkify text={m.body} />
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-gray-200 px-3 py-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button type="submit" disabled={!draft.trim() || sending} className="rounded-lg bg-blue-600 text-white p-2 disabled:opacity-50">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
