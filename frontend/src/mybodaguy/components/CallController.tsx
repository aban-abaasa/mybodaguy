/**
 * CallController — 1:1 voice/video calling between a ride's customer and rider.
 *
 * Ports the proven WebRTC + Supabase Realtime signaling pattern from ICAN's
 * LiveBoardroom (browser RTCPeerConnection + STUN, offer/answer/ICE relayed
 * over a Supabase broadcast channel) down to a self-contained 1:1 version —
 * no group presence, no screen share, no external dependency on ICAN's
 * AuthContext/services, since none of that is needed for a rider<->customer call.
 *
 * One channel per ride (`mbg-call:{rideId}`) carries both the ringing
 * handshake (ring / call-accepted / call-declined / call-ended) and the
 * WebRTC signal messages (offer / answer / ice-candidate).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';

type CallMode = 'voice' | 'video';
type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'active';

interface CallControllerProps {
  rideId: string;
  selfUserId: string;
  selfName: string;
  peerUserId: string;
  peerName: string;
  /** Set to 'voice' or 'video' to place an outgoing call; consumed then cleared by the parent. */
  outgoingRequest: CallMode | null;
  onOutgoingConsumed: () => void;
}

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function useRingtone() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback((pattern: 'incoming' | 'outgoing') => {
    stop();
    const AudioCtxCls = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxCls) return;
    if (!audioCtxRef.current) audioCtxRef.current = new AudioCtxCls();
    const ctx = audioCtxRef.current;

    const beep = () => {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = pattern === 'incoming' ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    };

    beep();
    intervalRef.current = window.setInterval(beep, pattern === 'incoming' ? 1200 : 2000);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { start, stop };
}

export default function CallController({
  rideId, selfUserId, selfName, peerUserId, peerName, outgoingRequest, onOutgoingConsumed,
}: CallControllerProps) {
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [mode, setMode] = useState<CallMode>('voice');
  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const isCallerRef = useRef(false);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const outgoingTimeoutRef = useRef<number | null>(null);
  const callTimerRef = useRef<number | null>(null);

  const ringtone = useRingtone();

  const send = useCallback(async (event: string, payload: Record<string, any>) => {
    if (!channelRef.current) return;
    try {
      await channelRef.current.send({ type: 'broadcast', event, payload: { from: selfUserId, ...payload } });
    } catch (err) {
      console.warn('[CallController] send failed:', err);
    }
  }, [selfUserId]);

  const ensureLocalStream = useCallback(async (wantVideo: boolean) => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantVideo });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    return stream;
  }, []);

  const stopLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
  }, []);

  const closePeerConnection = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    pendingIceRef.current = [];
    setRemoteConnected(false);
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  }, []);

  const resetToIdle = useCallback(() => {
    ringtone.stop();
    if (outgoingTimeoutRef.current) { window.clearTimeout(outgoingTimeoutRef.current); outgoingTimeoutRef.current = null; }
    if (callTimerRef.current) { window.clearInterval(callTimerRef.current); callTimerRef.current = null; }
    closePeerConnection();
    stopLocalStream();
    setCallSeconds(0);
    setPhase('idle');
  }, [ringtone, closePeerConnection, stopLocalStream]);

  const createPeerConnection = useCallback(async (wantVideo: boolean) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      send('webrtc-signal', { signalType: 'ice-candidate', candidate: event.candidate });
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      setRemoteConnected(true);
      if (wantVideo && remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        setRemoteConnected(false);
      }
    };

    const stream = await ensureLocalStream(wantVideo);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pcRef.current = pc;
    return pc;
  }, [ensureLocalStream, send]);

  const startCallTimer = useCallback(() => {
    if (callTimerRef.current) window.clearInterval(callTimerRef.current);
    callTimerRef.current = window.setInterval(() => setCallSeconds(s => s + 1), 1000);
  }, []);

  // Subscribe once for the lifetime of the ride — this is how incoming calls
  // are detected even before the user opens anything.
  useEffect(() => {
    if (!rideId || !selfUserId) return;
    const channel = supabase.channel(`mbg-call:${rideId}`, { config: { broadcast: { self: true } } });

    channel
      .on('broadcast', { event: 'ring' }, ({ payload }) => {
        if (payload.from !== peerUserId) return;
        setMode(payload.mode === 'video' ? 'video' : 'voice');
        isCallerRef.current = false;
        setPhase('incoming');
        ringtone.start('incoming');
      })
      .on('broadcast', { event: 'call-accepted' }, async ({ payload }) => {
        if (payload.from !== peerUserId) return;
        ringtone.stop();
        setPhase(p => {
          if (p !== 'outgoing') return p;
          return 'active';
        });
      })
      .on('broadcast', { event: 'call-declined' }, ({ payload }) => {
        if (payload.from !== peerUserId) return;
        ringtone.stop();
        toast.info(`${peerName} declined the call`);
        resetToIdle();
      })
      .on('broadcast', { event: 'call-ended' }, ({ payload }) => {
        if (payload.from !== peerUserId) return;
        toast.info('Call ended');
        resetToIdle();
      })
      .on('broadcast', { event: 'webrtc-signal' }, async ({ payload }) => {
        if (payload.from !== peerUserId) return;
        const { signalType, offer, answer, candidate } = payload;
        try {
          if (signalType === 'offer' && offer) {
            const pc = pcRef.current || await createPeerConnection(mode === 'video');
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            for (const c of pendingIceRef.current) {
              try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
            }
            pendingIceRef.current = [];
            const ans = await pc.createAnswer();
            await pc.setLocalDescription(ans);
            await send('webrtc-signal', { signalType: 'answer', answer: ans });
          } else if (signalType === 'answer' && answer && pcRef.current) {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
            for (const c of pendingIceRef.current) {
              try { await pcRef.current.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
            }
            pendingIceRef.current = [];
          } else if (signalType === 'ice-candidate' && candidate) {
            if (pcRef.current?.remoteDescription) {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
              pendingIceRef.current.push(candidate);
            }
          }
        } catch (err) {
          console.warn('[CallController] signal handling error:', err);
        }
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, selfUserId, peerUserId]);

  // Once we've been accepted (or once we accept an incoming call as callee),
  // the caller creates the actual offer.
  useEffect(() => {
    if (phase !== 'active' || pcRef.current) return;
    startCallTimer();
    if (!isCallerRef.current) return; // callee waits for the offer
    (async () => {
      const pc = await createPeerConnection(mode === 'video');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await send('webrtc-signal', { signalType: 'offer', offer });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Parent asked us to place an outgoing call.
  useEffect(() => {
    if (!outgoingRequest) return;
    isCallerRef.current = true;
    setMode(outgoingRequest);
    setPhase('outgoing');
    ringtone.start('outgoing');
    send('ring', { fromName: selfName, mode: outgoingRequest });

    outgoingTimeoutRef.current = window.setTimeout(() => {
      setPhase(p => {
        if (p !== 'outgoing') return p;
        toast.info(`${peerName} didn't answer`);
        resetToIdle();
        return 'idle';
      });
    }, 30000);

    onOutgoingConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outgoingRequest]);

  useEffect(() => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = micOn; });
  }, [micOn]);

  useEffect(() => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = videoOn; });
  }, [videoOn]);

  useEffect(() => () => { resetToIdle(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const acceptIncoming = () => {
    ringtone.stop();
    isCallerRef.current = false;
    setMicOn(true);
    setVideoOn(true);
    setPhase('active');
    send('call-accepted', {});
  };

  const declineIncoming = () => {
    ringtone.stop();
    send('call-declined', {});
    resetToIdle();
  };

  const cancelOutgoing = () => {
    send('call-declined', {});
    resetToIdle();
  };

  const endActiveCall = () => {
    send('call-ended', {});
    resetToIdle();
  };

  const formatDuration = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  if (phase === 'idle') return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {phase === 'incoming' && (
          <div className="p-8 text-center">
            <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-orange-400 to-yellow-400 flex items-center justify-center text-white text-3xl font-bold mb-4 animate-pulse">
              {peerName.charAt(0).toUpperCase()}
            </div>
            <h3 className="text-lg font-bold text-slate-800">{peerName}</h3>
            <p className="text-sm text-slate-500 mb-6">Incoming {mode === 'video' ? 'video' : 'voice'} call…</p>
            <div className="flex justify-center gap-6">
              <button onClick={declineIncoming} className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg">
                <PhoneOff size={22} />
              </button>
              <button onClick={acceptIncoming} className="w-14 h-14 rounded-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center shadow-lg">
                <Phone size={22} />
              </button>
            </div>
          </div>
        )}

        {phase === 'outgoing' && (
          <div className="p-8 text-center">
            <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-orange-400 to-yellow-400 flex items-center justify-center text-white text-3xl font-bold mb-4 animate-pulse">
              {peerName.charAt(0).toUpperCase()}
            </div>
            <h3 className="text-lg font-bold text-slate-800">{peerName}</h3>
            <p className="text-sm text-slate-500 mb-6">Calling…</p>
            <button onClick={cancelOutgoing} className="w-14 h-14 mx-auto rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg">
              <PhoneOff size={22} />
            </button>
          </div>
        )}

        {phase === 'active' && (
          <div>
            {mode === 'video' ? (
              <div className="relative bg-slate-900 h-72">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                {!remoteConnected && (
                  <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
                    Connecting…
                  </div>
                )}
                <video ref={localVideoRef} autoPlay playsInline muted className="absolute bottom-3 right-3 w-20 h-28 object-cover rounded-lg border-2 border-white/70" />
                <button onClick={endActiveCall} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="p-8 text-center bg-slate-50">
                <audio ref={remoteAudioRef} autoPlay />
                <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white text-3xl font-bold mb-4">
                  {peerName.charAt(0).toUpperCase()}
                </div>
                <h3 className="text-lg font-bold text-slate-800">{peerName}</h3>
                <p className="text-sm text-slate-500">{remoteConnected ? formatDuration(callSeconds) : 'Connecting…'}</p>
              </div>
            )}

            <div className="flex items-center justify-center gap-4 p-4 border-t border-slate-100">
              <button
                onClick={() => setMicOn(m => !m)}
                className={`w-12 h-12 rounded-full flex items-center justify-center ${micOn ? 'bg-slate-200 text-slate-700' : 'bg-red-100 text-red-600'}`}
              >
                {micOn ? <Mic size={18} /> : <MicOff size={18} />}
              </button>
              {mode === 'video' && (
                <button
                  onClick={() => setVideoOn(v => !v)}
                  className={`w-12 h-12 rounded-full flex items-center justify-center ${videoOn ? 'bg-slate-200 text-slate-700' : 'bg-red-100 text-red-600'}`}
                >
                  {videoOn ? <Video size={18} /> : <VideoOff size={18} />}
                </button>
              )}
              <button onClick={endActiveCall} className="w-12 h-12 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center">
                <PhoneOff size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
