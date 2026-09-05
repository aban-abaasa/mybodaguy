import { useEffect, useRef } from 'react';
import { PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';

const formatElapsed = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const ToolbarButton = ({ icon, label, active = true, danger = false, onClick, big = false }: any) => (
  <button onClick={onClick} className="flex flex-col items-center gap-1 text-white/90 transition hover:text-white" title={label}>
    <span
      className={`flex items-center justify-center rounded-full transition ${big ? 'h-14 w-14' : 'h-11 w-11'} ${
        danger ? 'bg-red-500 hover:bg-red-600' : active ? 'bg-white/15 hover:bg-white/25' : 'bg-red-500/90 hover:bg-red-500'
      }`}
    >
      {icon}
    </span>
    <span className="text-[10px] font-medium">{label}</span>
  </button>
);

/**
 * Full-page video call view — takes over the whole widget for as long as a
 * video call is ringing-out or active. Audio-only calls and an incoming
 * ring stay on the slim `CallDock` bar instead. Ported from ICAN's
 * CallStage.jsx.
 */
const CallStage = ({ call }: { call: any }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = call.localStream || null;
  }, [call.localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = call.remoteStream || null;
  }, [call.remoteStream]);

  const hasRemote = Boolean(call.remoteStream);
  const isRinging = call.callState === 'ringing-out';

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-black">
      <div className="relative flex-1 bg-slate-900">
        {hasRemote ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-white">
            <span className={`flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-yellow-500 text-2xl font-bold ${isRinging ? 'animate-pulse' : ''}`}>
              {(call.peerName || '?').trim().slice(0, 1).toUpperCase()}
            </span>
            <p className="text-sm font-medium text-white/90">{isRinging ? `Ringing ${call.peerName || ''}…` : `Waiting for ${call.peerName || 'them'} to join…`}</p>
          </div>
        )}

        <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 via-black/30 to-transparent px-4 py-3">
          <div className="flex items-center gap-2 rounded-full bg-black/40 px-2.5 py-1 backdrop-blur-sm">
            <span className={`h-2 w-2 rounded-full ${isRinging ? 'bg-amber-400' : 'bg-red-500'} animate-pulse`} />
            <span className="text-[11px] font-bold uppercase tracking-wider text-white">{isRinging ? 'Ringing' : 'Live'}</span>
          </div>
          <span className="rounded-full bg-black/40 px-2.5 py-1 font-mono text-[11px] tabular-nums text-white/90 backdrop-blur-sm">
            {isRinging ? '' : formatElapsed(call.elapsed)}
          </span>
        </div>

        <div className="absolute bottom-4 left-4 max-w-[60%] rounded-lg bg-black/50 px-2.5 py-1 backdrop-blur-sm">
          <p className="truncate text-sm font-medium text-white">{call.peerName || 'Call'}</p>
        </div>

        <div className="absolute bottom-4 right-4 h-24 w-20 overflow-hidden rounded-xl bg-black ring-2 ring-white/70 shadow-lg sm:h-28 sm:w-24">
          <video ref={localVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          {!call.micOn && (
            <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500">
              <MicOff className="h-3 w-3 text-white" />
            </span>
          )}
        </div>
      </div>

      {call.error && <p className="bg-red-500/90 px-4 py-1.5 text-center text-xs text-white">{call.error}</p>}

      <div className="flex items-center justify-center gap-6 bg-slate-950/95 px-4 py-3.5 backdrop-blur">
        {!isRinging && (
          <ToolbarButton
            icon={call.micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            label={call.micOn ? 'Mute' : 'Unmute'}
            active={call.micOn}
            onClick={call.toggleMic}
          />
        )}
        {!isRinging && (
          <ToolbarButton
            icon={call.camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            label={call.camOn ? 'Stop video' : 'Start video'}
            active={call.camOn}
            onClick={call.toggleCam}
          />
        )}
        <ToolbarButton
          icon={<PhoneOff className="h-6 w-6" />}
          label={isRinging ? 'Cancel' : 'Leave'}
          danger
          big
          onClick={call.endCall}
        />
      </div>
    </div>
  );
};

export default CallStage;
