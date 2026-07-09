/**
 * RideChatModal — real-time in-app chat between a ride's customer and rider.
 * Backed by mbg_ride_messages + a Supabase Realtime postgres_changes
 * subscription (RLS already restricts rows to the two ride participants).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';

interface RideMessage {
  id: string;
  ride_id: string;
  sender_user_id: string;
  message: string;
  created_at: string;
}

interface RideChatModalProps {
  rideId: string;
  selfUserId: string;
  peerName: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function RideChatModal({ rideId, selfUserId, peerName, isOpen, onClose }: RideChatModalProps) {
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('mbg_ride_messages')
      .select('*')
      .eq('ride_id', rideId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (!error) setMessages(data || []);
  }, [rideId]);

  useEffect(() => {
    if (!isOpen || !rideId) return;
    load();

    const channel = supabase
      .channel(`mbg-ride-messages:${rideId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mbg_ride_messages', filter: `ride_id=eq.${rideId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as RideMessage])
      )
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [isOpen, rideId, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setDraft('');
    const { error } = await supabase.from('mbg_ride_messages').insert({
      ride_id: rideId,
      sender_user_id: selfUserId,
      message: text,
    });
    setSending(false);
    if (error) {
      toast.error(error.message || 'Message failed to send');
      setDraft(text);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[55] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-2xl flex flex-col h-[75vh] sm:h-[560px]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <MessageCircle size={18} className="text-orange-500" />
            <h3 className="font-bold text-slate-800">{peerName}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-slate-50">
          {messages.length === 0 ? (
            <p className="text-center text-sm text-slate-400 mt-8">Say hello 👋</p>
          ) : (
            messages.map((m) => {
              const mine = m.sender_user_id === selfUserId;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
                    mine ? 'bg-orange-500 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                  }`}>
                    {m.message}
                    <div className={`text-[10px] mt-0.5 ${mine ? 'text-white/70' : 'text-slate-400'}`}>
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex items-center gap-2 p-3 border-t border-slate-100">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !sending) send(); }}
            placeholder="Type a message…"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            className="w-10 h-10 rounded-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white flex items-center justify-center flex-shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
