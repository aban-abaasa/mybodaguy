import { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from 'lucide-react';

const formatElapsed = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * Presentational call bar for a `useDirectCall` instance — sits as a slim
 * sticky strip inside the chat widget rather than taking over the screen.
 * Renders nothing while `call.callState === 'idle'`. Ported from ICAN's
 * CallDock.jsx.
 */
const CallDock = ({ call, tint = 'amber' }: { call: any; tint?: 'amber' | 'indigo' }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = call.localStream || null;
  }, [call.localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = call.remoteStream || null;
  }, [call.remoteStream]);

  useEffect(() => {
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = call.remoteStream || null;
  }, [call.remoteStream]);

  if (call.callState === 'idle') return null;

  const gradient = tint === 'amber' ? 'from-amber-500 to-orange-600' : 'from-indigo-500 to-purple-600';
  const hasRemote = call.callState === 'active' && Boolean(call.remoteStream);

  const videoStage = call.isVideo && call.callState !== 'ringing-in' && (
    <div className={`relative mb-2 h-40 w-full overflow-hidden rounded-xl bg-black ${!hasRemote ? 'flex items-center justify-center' : ''}`}>
      {hasRemote && <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />}
      <video
        ref={localVideoRef}
        autoPlay
        playsInline
        muted
        className={hasRemote ? 'absolute bottom-2 right-2 h-16 w-24 rounded-lg object-cover ring-2 ring-white/60 shadow-lg' : 'h-full w-full object-cover'}
      />
      {!hasRemote && call.callState === 'active' && (
        <p className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">Waiting for {call.peerName || 'them'}…</p>
      )}
    </div>
  );

  return (
    <div className="border-b border-slate-200 bg-slate-100 px-3 py-2.5">
      {!call.isVideo && <audio ref={remoteAudioRef} autoPlay />}
      {call.error && <p className="mb-1.5 text-[11px] text-red-500">{call.error}</p>}

      {call.callState === 'ringing-out' && (
        <div>
          {videoStage}
          <div className="flex items-center gap-3">
            {!call.isVideo && (
              <span className={`flex h-9 w-9 flex-shrink-0 animate-pulse items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-white`}>
                <Phone className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">Calling {call.peerName || 'them'}…</p>
              <p className="text-[11px] text-slate-400">{call.isVideo ? 'Video call' : 'Audio call'}</p>
            </div>
            <button
              onClick={call.endCall}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow transition hover:bg-red-600"
              title="Cancel"
            >
              <PhoneOff className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {call.callState === 'ringing-in' && (
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 flex-shrink-0 animate-bounce items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-white`}>
            {call.isVideo ? <Video className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">{call.peerName || 'Someone'} is calling</p>
            <p className="text-[11px] text-slate-400">{call.isVideo ? 'Video call' : 'Audio call'}</p>
          </div>
          <button
            onClick={call.declineCall}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow transition hover:bg-red-600"
            title="Decline"
          >
            <PhoneOff className="h-4 w-4" />
          </button>
          <button
            onClick={call.acceptCall}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow transition hover:bg-emerald-600"
            title="Accept"
          >
            <Phone className="h-4 w-4" />
          </button>
        </div>
      )}

      {call.callState === 'active' && (
        <div>
          {videoStage}
          <div className="flex items-center gap-3">
            {!call.isVideo && (
              <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-white`}>
                <Phone className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{call.peerName || 'Call'}</p>
              <p className="text-[11px] font-mono tabular-nums text-slate-400">{formatElapsed(call.elapsed)}</p>
            </div>
            <button
              onClick={call.toggleMic}
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition ${call.micOn ? 'bg-slate-200 text-slate-700' : 'bg-red-500 text-white'}`}
              title={call.micOn ? 'Mute mic' : 'Unmute mic'}
            >
              {call.micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
            </button>
            {call.isVideo && (
              <button
                onClick={call.toggleCam}
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition ${call.camOn ? 'bg-slate-200 text-slate-700' : 'bg-red-500 text-white'}`}
                title={call.camOn ? 'Turn camera off' : 'Turn camera on'}
              >
                {call.camOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              onClick={call.endCall}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow transition hover:bg-red-600"
              title="Hang up"
            >
              <PhoneOff className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CallDock;
