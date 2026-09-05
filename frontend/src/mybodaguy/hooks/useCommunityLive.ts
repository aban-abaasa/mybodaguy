/**
 * One-to-many "Go Live" video broadcast — one broadcaster's camera, any
 * number of read-only viewers. Star-shaped WebRTC over Supabase Realtime
 * broadcast (signaling) + presence (who's live / viewer count): the
 * broadcaster holds one send-only RTCPeerConnection per viewer, each viewer
 * holds exactly one receive-only RTCPeerConnection back to the broadcaster.
 * Ported from ICAN's useCommunityLive.js.
 *
 * `scope` namespaces both channels so different audiences (e.g. the public
 * Community board vs. one supermarket's staff-only "My Store" channel)
 * never see each other's live streams or presence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Shared prefix (not app-specific) so a scope like 'community' is the same
// Realtime room across ICAN, digital-city-era, and mybodaguy — they already
// share one Supabase project and one landing_messages table for chat; this
// makes the "who's live" presence/signaling match that.
const presenceChannelFor = (scope: string) => `live-presence:${scope}`;
const signalChannelName = (streamId: string) => `live-signal:${streamId}`;

export interface LiveInfo {
  streamId: string;
  broadcasterId: string;
  broadcasterName: string;
  startedAt: string;
}

export interface UseCommunityLiveOptions {
  selfId: string | null;
  selfName: string;
  canBroadcast: boolean;
  scope?: string;
}

export const useCommunityLive = ({ selfId, selfName, canBroadcast, scope = 'community' }: UseCommunityLiveOptions) => {
  const [liveInfo, setLiveInfo] = useState<LiveInfo | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [role, setRole] = useState<'idle' | 'broadcasting' | 'watching'>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [endReason, setEndReason] = useState('');

  const roleRef = useRef(role);
  const selfIdRef = useRef(selfId);
  const selfNameRef = useRef(selfName);
  const scopeRef = useRef(scope);
  const streamIdRef = useRef('');
  const broadcasterIdRef = useRef('');
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const viewerPcRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceRef = useRef(new Map<string, any[]>());
  const presenceChannelRef = useRef<any>(null);
  const signalChannelRef = useRef<any>(null);
  const elapsedTimerRef = useRef<any>(null);

  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { selfIdRef.current = selfId; }, [selfId]);
  useEffect(() => { selfNameRef.current = selfName; }, [selfName]);
  useEffect(() => { scopeRef.current = scope; }, [scope]);

  const clearElapsedTimer = () => {
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
  };

  const closeSignalChannel = useCallback(() => {
    if (signalChannelRef.current) {
      supabase.removeChannel(signalChannelRef.current);
      signalChannelRef.current = null;
    }
  }, []);

  const teardownMedia = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => { try { pc.close(); } catch { /* already closed */ } });
    peerConnectionsRef.current.clear();
    if (viewerPcRef.current) { try { viewerPcRef.current.close(); } catch { /* already closed */ } viewerPcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null; }
    pendingIceRef.current.clear();
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  const untrackSelfPresence = useCallback(async () => {
    try { await presenceChannelRef.current?.untrack(); } catch { /* not tracked */ }
  }, []);

  const resetToIdle = useCallback((reason = '') => {
    clearElapsedTimer();
    teardownMedia();
    closeSignalChannel();
    untrackSelfPresence();
    streamIdRef.current = '';
    broadcasterIdRef.current = '';
    setElapsed(0);
    setEndReason(reason);
    setRole('idle');
  }, [teardownMedia, closeSignalChannel, untrackSelfPresence]);

  useEffect(() => {
    if (!selfId || !scope) return undefined;
    const channel = supabase.channel(presenceChannelFor(scope), { config: { presence: { key: selfId } } });

    const syncFromState = () => {
      const state = channel.presenceState();
      let broadcaster: any = null;
      let watching = 0;
      Object.values(state).forEach((entries: any) => {
        const entry = entries?.[0];
        if (!entry) return;
        if (entry.role === 'broadcaster') broadcaster = entry;
      });
      if (broadcaster) {
        watching = Object.values(state).reduce((count: number, entries: any) => {
          const entry = entries?.[0];
          return entry?.role === 'viewer' && entry.streamId === broadcaster.streamId ? count + 1 : count;
        }, 0);
        setLiveInfo({ streamId: broadcaster.streamId, broadcasterId: broadcaster.userId, broadcasterName: broadcaster.name, startedAt: broadcaster.startedAt });
        setViewerCount(watching);
      } else {
        setLiveInfo(null);
        setViewerCount(0);
        if (roleRef.current === 'watching') resetToIdle('ended');
      }
    };

    channel.on('presence', { event: 'sync' }, syncFromState).subscribe();
    presenceChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      if (presenceChannelRef.current === channel) presenceChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId, scope]);

  const send = useCallback((event: string, payload: Record<string, any>) => {
    if (!signalChannelRef.current) return;
    signalChannelRef.current.send({ type: 'broadcast', event, payload: { from: selfIdRef.current, ...payload } });
  }, []);

  const createBroadcasterPeer = useCallback((viewerId: string) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (event) => {
      if (event.candidate) send('ice', { target: viewerId, candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        peerConnectionsRef.current.delete(viewerId);
      }
    };
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] }));
    }
    peerConnectionsRef.current.set(viewerId, pc);
    return pc;
  }, [send]);

  const flushPendingIce = useCallback(async (pc: RTCPeerConnection, peerId: string) => {
    const queued = pendingIceRef.current.get(peerId) || [];
    pendingIceRef.current.delete(peerId);
    for (const candidate of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* stale candidate */ }
    }
  }, []);

  const goLive = useCallback(async () => {
    if (!canBroadcast || roleRef.current !== 'idle' || !selfIdRef.current || !scopeRef.current) return;
    if (liveInfo) { setError('Someone is already live right now.'); return; }
    setError('');
    setEndReason('');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
    } catch (err: any) {
      setError(err?.name === 'NotAllowedError' ? 'Camera/microphone permission denied' : 'Could not access camera/microphone');
      return;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setMicOn(true);
    setCamOn(true);

    const streamId = `${scopeRef.current}:${selfIdRef.current}:${Date.now()}`;
    streamIdRef.current = streamId;
    broadcasterIdRef.current = selfIdRef.current;

    const channel = supabase.channel(signalChannelName(streamId), { config: { broadcast: { self: false } } });
    channel
      .on('broadcast', { event: 'viewer-join' }, ({ payload }: any) => {
        if (!payload?.from) return;
        const pc = createBroadcasterPeer(payload.from);
        (async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            send('offer', { target: payload.from, sdp: offer });
          } catch (err) { console.warn('[useCommunityLive] failed to offer viewer:', err); }
        })();
      })
      .on('broadcast', { event: 'answer' }, async ({ payload }: any) => {
        if (!payload || payload.target !== selfIdRef.current) return;
        const pc = peerConnectionsRef.current.get(payload.from);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPendingIce(pc, payload.from);
        } catch (err) { console.warn('[useCommunityLive] failed to apply viewer answer:', err); }
      })
      .on('broadcast', { event: 'ice' }, async ({ payload }: any) => {
        if (!payload || payload.target !== selfIdRef.current || !payload.candidate) return;
        const pc = peerConnectionsRef.current.get(payload.from);
        if (pc?.remoteDescription) {
          try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch { /* stale candidate */ }
        } else {
          const queued = pendingIceRef.current.get(payload.from) || [];
          queued.push(payload.candidate);
          pendingIceRef.current.set(payload.from, queued);
        }
      })
      .on('broadcast', { event: 'viewer-leave' }, ({ payload }: any) => {
        const pc = peerConnectionsRef.current.get(payload?.from);
        if (pc) { try { pc.close(); } catch { /* already closed */ } peerConnectionsRef.current.delete(payload.from); }
      })
      .subscribe(async (status: string) => {
        if (status !== 'SUBSCRIBED') return;
        signalChannelRef.current = channel;
        await presenceChannelRef.current?.track({
          userId: selfIdRef.current,
          name: selfNameRef.current || 'Someone',
          role: 'broadcaster',
          streamId,
          startedAt: new Date().toISOString(),
        });
        setRole('broadcasting');
        elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      });
  }, [canBroadcast, liveInfo, createBroadcasterPeer, send, flushPendingIce]);

  const stopLive = useCallback(() => {
    if (roleRef.current !== 'broadcasting') return;
    send('stream-ended', {});
    resetToIdle('ended');
  }, [send, resetToIdle]);

  const watch = useCallback(() => {
    if (roleRef.current !== 'idle' || !liveInfo || !selfIdRef.current) return;
    setError('');
    setEndReason('');
    const { streamId, broadcasterId } = liveInfo;
    streamIdRef.current = streamId;
    broadcasterIdRef.current = broadcasterId;

    const channel = supabase.channel(signalChannelName(streamId), { config: { broadcast: { self: false } } });
    channel
      .on('broadcast', { event: 'offer' }, async ({ payload }: any) => {
        if (!payload || payload.target !== selfIdRef.current) return;
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        viewerPcRef.current = pc;
        pc.onicecandidate = (event) => {
          if (event.candidate) send('ice', { target: broadcasterId, candidate: event.candidate });
        };
        pc.ontrack = (event) => { const [s] = event.streams; if (s) setRemoteStream(s); };
        pc.onconnectionstatechange = () => {
          if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && roleRef.current === 'watching') {
            resetToIdle('ended');
          }
        };
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPendingIce(pc, broadcasterId);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send('answer', { target: broadcasterId, sdp: answer });
        } catch (err) { console.warn('[useCommunityLive] failed to answer broadcaster:', err); }
      })
      .on('broadcast', { event: 'ice' }, async ({ payload }: any) => {
        if (!payload || payload.target !== selfIdRef.current || !payload.candidate) return;
        const pc = viewerPcRef.current;
        if (pc?.remoteDescription) {
          try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch { /* stale candidate */ }
        } else {
          const queued = pendingIceRef.current.get(broadcasterId) || [];
          queued.push(payload.candidate);
          pendingIceRef.current.set(broadcasterId, queued);
        }
      })
      .on('broadcast', { event: 'stream-ended' }, () => {
        resetToIdle('ended');
      })
      .subscribe(async (status: string) => {
        if (status !== 'SUBSCRIBED') return;
        signalChannelRef.current = channel;
        await presenceChannelRef.current?.track({ userId: selfIdRef.current, name: selfNameRef.current || 'Someone', role: 'viewer', streamId });
        send('viewer-join', {});
        setRole('watching');
        elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      });
  }, [liveInfo, send, flushPendingIce, resetToIdle]);

  const stopWatching = useCallback(() => {
    if (roleRef.current !== 'watching') return;
    send('viewer-leave', {});
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
    setCamOn((prev) => {
      const next = !prev;
      localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = next; });
      return next;
    });
  }, []);

  useEffect(() => () => {
    clearElapsedTimer();
    teardownMedia();
    closeSignalChannel();
    untrackSelfPresence();
  }, [teardownMedia, closeSignalChannel, untrackSelfPresence]);

  return {
    liveInfo,
    viewerCount,
    role,
    localStream,
    remoteStream,
    micOn,
    camOn,
    elapsed,
    error,
    endReason,
    canBroadcast: Boolean(canBroadcast) && role === 'idle',
    canWatch: Boolean(liveInfo && selfId) && role === 'idle',
    isSelfBroadcaster: Boolean(liveInfo && selfId && liveInfo.broadcasterId === selfId),
    goLive,
    stopLive,
    watch,
    stopWatching,
    toggleMic,
    toggleCam,
  };
};

export default useCommunityLive;
