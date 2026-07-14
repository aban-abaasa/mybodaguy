/**
 * RideCommsBar — drop-in Call / Video / Chat buttons for an active ride.
 * Wires CallController (WebRTC voice/video) and RideChatModal (real-time
 * text) together so both the rider and customer screens can mount one
 * component instead of repeating the plumbing.
 * RESPONSIVE: Compact on mobile, spacious on desktop.
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
      <div className={`flex items-center gap-1.5 md:gap-2 ${className || ''}`}>
        <button
          onClick={() => setOutgoingRequest('voice')}
          className="flex-1 flex flex-col md:flex-row items-center justify-center gap-0.5 md:gap-1.5 py-1.5 md:py-2 px-2 md:px-3 rounded-lg bg-green-500 hover:bg-green-600 text-white text-[10px] md:text-sm font-semibold transition-all shadow-sm hover:shadow-md"
        >
          <Phone size={14} className="md:w-4 md:h-4" />
          <span className="leading-none">Call</span>
        </button>
        <button
          onClick={() => setOutgoingRequest('video')}
          className="flex-1 flex flex-col md:flex-row items-center justify-center gap-0.5 md:gap-1.5 py-1.5 md:py-2 px-2 md:px-3 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-[10px] md:text-sm font-semibold transition-all shadow-sm hover:shadow-md"
        >
          <Video size={14} className="md:w-4 md:h-4" />
          <span className="leading-none">Video</span>
        </button>
        <button
          onClick={() => setChatOpen(true)}
          className="flex-1 flex flex-col md:flex-row items-center justify-center gap-0.5 md:gap-1.5 py-1.5 md:py-2 px-2 md:px-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[10px] md:text-sm font-semibold transition-all shadow-sm hover:shadow-md"
        >
          <MessageCircle size={14} className="md:w-4 md:h-4" />
          <span className="leading-none">Chat</span>
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
