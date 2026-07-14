/**
 * RideCommsBar — drop-in Call / Video / Chat / Send Money buttons for an
 * active ride. Wires CallController (WebRTC voice/video), RideChatModal
 * (real-time text) and a direct peer-to-peer ICAN transfer together so
 * both the rider and customer screens can mount one component instead of
 * repeating the plumbing.
 */
import { useState } from 'react';
import { Phone, Video, MessageCircle, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import CallController from './CallController';
import RideChatModal from './RideChatModal';
import { sendICAN, formatICAN } from '../services/icanWalletService';

interface RideCommsBarProps {
  rideId: string;
  selfUserId: string;
  selfName: string;
  peerUserId: string;
  peerName: string;
  peerPhone?: string | null;
  className?: string;
}

export default function RideCommsBar({ rideId, selfUserId, selfName, peerUserId, peerName, peerPhone, className }: RideCommsBarProps) {
  const [outgoingRequest, setOutgoingRequest] = useState<'voice' | 'video' | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendAmount, setSendAmount] = useState('');
  const [sending, setSending] = useState(false);

  const submitSend = async () => {
    const amount = parseFloat(sendAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setSending(true);
    try {
      const result = await sendICAN({
        fromUserId: selfUserId,
        toUserId: peerUserId,
        amount,
        note: `Sent during ride ${rideId}`,
        referenceId: rideId,
      });
      toast.success(`✅ Sent ${formatICAN(amount)} ICAN to ${peerName} (they received ${formatICAN(result.recipient_received)} after tithe)`);
      setSendOpen(false);
      setSendAmount('');
    } catch (e: any) {
      toast.error(e.message || 'Failed to send ICAN');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className={`grid grid-cols-4 gap-2 ${className || ''}`}>
        <button
          onClick={() => setOutgoingRequest('voice')}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-semibold transition-colors"
        >
          <Phone size={15} /> Call
        </button>
        <button
          onClick={() => setOutgoingRequest('video')}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold transition-colors"
        >
          <Video size={15} /> Video
        </button>
        <button
          onClick={() => setChatOpen(true)}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors"
        >
          <MessageCircle size={15} /> Chat
        </button>
        <button
          onClick={() => setSendOpen(true)}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white text-sm font-semibold transition-colors"
        >
          <Send size={15} /> Send
        </button>
      </div>

      <CallController
        rideId={rideId}
        selfUserId={selfUserId}
        selfName={selfName}
        peerUserId={peerUserId}
        peerName={peerName}
        peerPhone={peerPhone}
        outgoingRequest={outgoingRequest}
        onOutgoingConsumed={() => setOutgoingRequest(null)}
      />

      <RideChatModal
        rideId={rideId}
        selfUserId={selfUserId}
        peerName={peerName}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
      />

      {sendOpen && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">Send ICAN to {peerName}</h3>
              <button onClick={() => setSendOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Amount (ICAN)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={sendAmount}
              onChange={(e) => setSendAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg text-lg font-bold focus:border-purple-500 focus:outline-none mb-2"
            />
            <p className="text-[11px] text-slate-400 mb-4">A standard 10% tithe applies, same as any personal transfer — {peerName} receives 90% of what you send.</p>
            <button
              onClick={submitSend}
              disabled={sending}
              className="w-full py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-bold rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
