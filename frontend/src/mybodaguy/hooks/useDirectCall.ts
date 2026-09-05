/**
 * Generic 1:1 audio/video call engine over Supabase Realtime broadcast —
 * STUN-only RTCPeerConnection, pending-ICE-candidate queue, ring/accept/
 * decline/end signaling on a broadcast channel per call. Ported from
 * ICAN's useDirectCall.js (see ICAN/frontend/src/hooks/useDirectCall.js).
 *
 * Because a call room only ever has two people in it, this never needs to
 * know the peer's id up front — it treats any broadcast message that isn't
 * from `selfId` as coming from the peer, and learns their id/name from
 * whatever they send first. That's what lets the Support channel work even
 * though the widget side has no idea which developer will answer.
 *
 * `roomId` should be the caller's own stable "personal inbox" — this hook
 * is always listening for an incoming ring regardless of which chat tab
 * happens to be open. Pass a peer's own inbox room as `startCall`'s
 * `dialRoomId` to ring them specifically; the hook joins it for the life of
 * that one call before reverting to listening on `roomId` again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const RING_INTERVAL_MS = 3000;
const RING_TIMEOUT_MS = 45000;

export type CallState = 'idle' | 'ringing-out' | 'ringing-in' | 'active';

export interface UseDirectCallOptions {
  roomId: string | null;
  selfId: string | null;
  selfName: string;
}

export const useDirectCall = ({ roomId, selfId, selfName }: UseDirectCallOptions) => {
  const [callState, setCallState] = useState<CallState>('idle');
  const [isVideo, setIsVideo] = useState(false);
  const [peerName, setPeerName] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [endReason, setEndReason] = useState('');
  const [peerId, setPeerId] = useState('');

  const [subscribedConfig, setSubscribedConfig] = useState<UseDirectCallOptions>({ roomId: null, selfId: null, selfName: '' });

  const callStateRef = useRef(callState);
  const peerIdRef = useRef('');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<any[]>([]);
  const channelRef = useRef<any>(null);
  const ringIntervalRef = useRef<any>(null);
  const ringTimeoutRef = useRef<any>(null);
  const elapsedTimerRef = useRef<any>(null);
  const defaultRoomRef = useRef<UseDirectCallOptions>({ roomId, selfId, selfName });
  const roomReadyRef = useRef(new Map<string, { promise: Promise<void> }>());

  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { defaultRoomRef.current = { roomId, selfId, selfName }; }, [roomId, selfId, selfName]);

  useEffect(() => {
    if (callStateRef.current === 'idle') {
      setSubscribedConfig({ roomId, selfId, selfName });
    }
  }, [roomId, selfId, selfName]);

  const waitForRoomReady = useCallback((rid: string) => new Promise<void>((resolve) => {
    let attempts = 0;
    const check = () => {
      const entry = roomReadyRef.current.get(rid);
      if (entry) { entry.promise.then(resolve); return; }
      attempts += 1;
      if (attempts > 150) { resolve(); return; }
      setTimeout(check, 20);
    };
    check();
  }), []);

  const clearRingTimers = () => {
    if (ringIntervalRef.current) { clearInterval(ringIntervalRef.current); ringIntervalRef.current = null; }
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
  };

  const clearElapsedTimer = () => {
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
  };

  const teardownMedia = useCallback(() => {
    if (pcRef.current) {
      try { pcRef.current.close(); } catch { /* already closed */ }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    pendingIceRef.current = [];
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  const resetToIdle = useCallback((reason = '') => {
    clearRingTimers();
    clearElapsedTimer();
    teardownMedia();
    peerIdRef.current = '';
    setPeerId('');
    setElapsed(0);
    setEndReason(reason);
    setCallState('idle');
    setSubscribedConfig(defaultRoomRef.current);
  }, [teardownMedia]);

  const send = useCallback((event: string, payload: Record<string, any>) => {
    if (!channelRef.current) return;
    channelRef.current.send({ type: 'broadcast', event, payload: { from: subscribedConfig.selfId, ...payload } });
  }, [subscribedConfig.selfId]);

  const ensureLocalMedia = useCallback(async (video: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      audio: true,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      send('webrtc-ice', { candidate: event.candidate });
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) setRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && callStateRef.current === 'active') {
        resetToIdle('ended');
      }
    };

    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    pcRef.current = pc;
    return pc;
  }, [send, resetToIdle]);

  const flushPendingIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const candidate of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* stale candidate */ }
    }
  }, []);

  const startCall = useCallback(async (video: boolean, peerNameHint = '', dialRoomId: string | null = null) => {
    if (callStateRef.current !== 'idle') return;
    const targetRoomId = dialRoomId || subscribedConfig.roomId;
    if (!targetRoomId || !subscribedConfig.selfId) return;
    setError('');
    setEndReason('');

    if (targetRoomId !== subscribedConfig.roomId) {
      setSubscribedConfig({ roomId: targetRoomId, selfId: subscribedConfig.selfId, selfName: subscribedConfig.selfName });
      await waitForRoomReady(targetRoomId);
      if (callStateRef.current !== 'idle') return;
    }
    if (!channelRef.current) return;

    try {
      await ensureLocalMedia(video);
    } catch (err: any) {
      setError(err?.name === 'NotAllowedError' ? 'Camera/microphone permission denied' : 'Could not access camera/microphone');
      return;
    }
    setIsVideo(video);
    setMicOn(true);
    setCamOn(video);
    setPeerName(peerNameHint);
    setCallState('ringing-out');

    const ring = () => send('ring', { fromName: subscribedConfig.selfName, video });
    ring();
    ringIntervalRef.current = setInterval(ring, RING_INTERVAL_MS);
    ringTimeoutRef.current = setTimeout(() => {
      send('end', {});
      resetToIdle('no-answer');
    }, RING_TIMEOUT_MS);
  }, [ensureLocalMedia, send, resetToIdle, waitForRoomReady, subscribedConfig.roomId, subscribedConfig.selfId, subscribedConfig.selfName]);

  const acceptCall = useCallback(async () => {
    if (callStateRef.current !== 'ringing-in') return;
    clearRingTimers();
    setError('');
    try {
      await ensureLocalMedia(isVideo);
    } catch (err: any) {
      setError(err?.name === 'NotAllowedError' ? 'Camera/microphone permission denied' : 'Could not access camera/microphone');
      send('decline', { reason: 'media-error' });
      resetToIdle('ended');
      return;
    }
    setMicOn(true);
    setCamOn(isVideo);
    setCallState('active');
    elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    send('accept', { fromName: subscribedConfig.selfName });
  }, [ensureLocalMedia, isVideo, send, subscribedConfig.selfName, resetToIdle]);

  const declineCall = useCallback(() => {
    if (callStateRef.current !== 'ringing-in') return;
    send('decline', { reason: 'declined' });
    resetToIdle('ended');
  }, [send, resetToIdle]);

  const endCall = useCallback(() => {
    if (callStateRef.current === 'idle') return;
    send('end', {});
    resetToIdle('ended');
  }, [send, resetToIdle]);

  const toggleMic = useCallback(() => {
    setMicOn((prev) => {
      const next = !prev;
      localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = next; });
      return next;
    });
  }, []);

  const toggleCam = useCallback(() => {
    if (!isVideo) return;
    setCamOn((prev) => {
      const next = !prev;
      localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = next; });
      return next;
    });
  }, [isVideo]);

  useEffect(() => {
    const { roomId: rid, selfId: sid } = subscribedConfig;
    if (!rid || !sid) {
      channelRef.current = null;
      return undefined;
    }

    const channel = supabase.channel(`mbg-call:${rid}`, { config: { broadcast: { self: true } } });

    let resolveReady: () => void;
    const readyPromise = new Promise<void>((res) => { resolveReady = res; });
    roomReadyRef.current.set(rid, { promise: readyPromise });

    channel
      .on('broadcast', { event: 'ring' }, async ({ payload }: any) => {
        if (!payload || payload.from === sid) return;
        if (callStateRef.current !== 'idle') {
          if (callStateRef.current !== 'ringing-in' || peerIdRef.current !== payload.from) {
            channel.send({ type: 'broadcast', event: 'decline', payload: { from: sid, reason: 'busy' } });
          }
          return;
        }
        peerIdRef.current = payload.from;
        setPeerId(payload.from);
        setIsVideo(!!payload.video);
        setPeerName(payload.fromName || 'Someone');
        setCallState('ringing-in');
        setError('');
        setEndReason('');
      })
      .on('broadcast', { event: 'accept' }, async ({ payload }: any) => {
        if (!payload || payload.from === sid || callStateRef.current !== 'ringing-out') return;
        peerIdRef.current = payload.from;
        setPeerId(payload.from);
        if (payload.fromName) setPeerName(payload.fromName);
        clearRingTimers();
        setCallState('active');
        elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

        const pc = createPeerConnection();
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          channel.send({ type: 'broadcast', event: 'webrtc-offer', payload: { from: sid, sdp: offer } });
        } catch (err) {
          console.warn('[useDirectCall] failed to create offer:', err);
        }
      })
      .on('broadcast', { event: 'decline' }, ({ payload }: any) => {
        if (!payload || payload.from === sid || callStateRef.current !== 'ringing-out') return;
        resetToIdle(payload.reason === 'busy' ? 'busy' : 'declined');
      })
      .on('broadcast', { event: 'end' }, ({ payload }: any) => {
        if (!payload || payload.from === sid || callStateRef.current === 'idle') return;
        resetToIdle('ended');
      })
      .on('broadcast', { event: 'webrtc-offer' }, async ({ payload }: any) => {
        if (!payload || payload.from === sid || callStateRef.current !== 'active') return;
        const pc = pcRef.current || createPeerConnection();
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPendingIce(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          channel.send({ type: 'broadcast', event: 'webrtc-answer', payload: { from: sid, sdp: answer } });
        } catch (err) {
          console.warn('[useDirectCall] failed to handle offer:', err);
        }
      })
      .on('broadcast', { event: 'webrtc-answer' }, async ({ payload }: any) => {
        if (!payload || payload.from === sid || !pcRef.current) return;
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPendingIce(pcRef.current);
        } catch (err) {
          console.warn('[useDirectCall] failed to handle answer:', err);
        }
      })
      .on('broadcast', { event: 'webrtc-ice' }, async ({ payload }: any) => {
        if (!payload || payload.from === sid || !payload.candidate) return;
        const pc = pcRef.current;
        if (pc && pc.remoteDescription) {
          try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch { /* stale candidate */ }
        } else {
          pendingIceRef.current.push(payload.candidate);
        }
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') resolveReady();
      });

    channelRef.current = channel;

    return () => {
      if (callStateRef.current !== 'idle') {
        try { channel.send({ type: 'broadcast', event: 'end', payload: { from: sid } }); } catch { /* best effort */ }
      }
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
      roomReadyRef.current.delete(rid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribedConfig.roomId, subscribedConfig.selfId, createPeerConnection, flushPendingIce, resetToIdle]);

  useEffect(() => () => {
    clearRingTimers();
    clearElapsedTimer();
    teardownMedia();
  }, [teardownMedia]);

  return {
    callState,
    isVideo,
    peerName,
    peerId,
    elapsed,
    micOn,
    camOn,
    localStream,
    remoteStream,
    error,
    endReason,
    canCall: Boolean(subscribedConfig.roomId && subscribedConfig.selfId) && callState === 'idle',
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMic,
    toggleCam,
  };
};

export default useDirectCall;
