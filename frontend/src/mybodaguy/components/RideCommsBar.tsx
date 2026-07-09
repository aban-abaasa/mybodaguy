/**
 * RideCommsBar — drop-in Call / Video / Chat buttons for an active ride.
 * Wires CallController (WebRTC voice/video) and RideChatModal (real-time
 * text) together so both the rider and customer screens can mount one
 * component instead of repeating the plumbing.
 */
import { useState } from 'react';
import { Phone, Video, MessageCircle } from 'lucide-react';
import CallController from './CallController';
import RideChatModal from './RideChatModal';

interface RideCommsBarProps {
  rideId: string;
  selfUserId: string;
  selfName: string;
  peerUserId: string;
  peerName: string;
  className?: string;
}

export default function RideCommsBar({ rideId, selfUserId, selfName, peerUserId, peerName, className }: RideCommsBarProps) {
  const [outgoingRequest, setOutgoingRequest] = useState<'voice' | 'video' | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <>
      <div className={`flex items-center gap-2 ${className || ''}`}>
        <button
          onClick={() => setOutgoingRequest('voice')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-semibold transition-colors"
        >
          <Phone size={15} /> Call
        </button>
        <button
          onClick={() => setOutgoingRequest('video')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold transition-colors"
        >
          <Video size={15} /> Video
        </button>
        <button
          onClick={() => setChatOpen(true)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors"
        >
          <MessageCircle size={15} /> Chat
        </button>
      </div>

      <CallController
        rideId={rideId}
        selfUserId={selfUserId}
        selfName={selfName}
        peerUserId={peerUserId}
        peerName={peerName}
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
    </>
  );
}
