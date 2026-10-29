import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import { findNewMarkets, describeNewMarkets, loadKnownMarkets, saveKnownMarkets, type MarketRef } from '../utils/markets';

// Realtime tells us the moment a business is registered; the poll is the safety
// net for when the table isn't published to realtime or the socket has dropped
// (same belt-and-braces SupermarketDeliveryPool uses for its own feed).
const POLL_MS = 60_000;

/**
 * Tells a rider the moment a new business opens on the platform: a toast with a
 * "View" shortcut, a system notification when the app is in the background, and
 * `freshIds` so the Markets tab can badge and mark the new ones. Always mounted
 * (from the dashboard), so it keeps watching whichever tab the rider is on.
 *
 * `version` bumps whenever something new arrives, so an open Markets list can reload.
 */
export function useNewMarketAlerts(riderId: string | undefined, onView: () => void) {
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());
  const [version, setVersion] = useState(0);
  const onViewRef = useRef(onView);
  onViewRef.current = onView;

  const clearFresh = useCallback(() => setFreshIds(prev => (prev.size ? new Set() : prev)), []);

  const check = useCallback(async () => {
    if (!riderId) return;
    const { data, error } = await supabase
      .from('supermarkets')
      .select('id, name, location, business_type')
      .eq('is_active', true);
    if (error || !data) return; // quiet: the next poll or event tries again

    // Read, compare and write in one synchronous step so two overlapping checks never announce twice.
    const before = loadKnownMarkets(riderId);
    const { fresh, known } = findNewMarkets(before, data as MarketRef[]);
    if (before === null || known.size !== before.size) saveKnownMarkets(riderId, known);
    if (fresh.length === 0) return;

    setFreshIds(prev => new Set([...prev, ...fresh.map(m => m.id)]));
    setVersion(v => v + 1);
    announce(fresh, () => onViewRef.current());
  }, [riderId]);

  useEffect(() => {
    if (!riderId) return;
    check();
    const interval = setInterval(check, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);

    const channel = supabase
      .channel(`mbg_new_markets_${riderId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'supermarkets' }, () => check())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'supermarkets' }, () => check()) // reactivated / approved
      .subscribe();

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [riderId, check]);

  return { freshIds, version, clearFresh };
}

function announce(fresh: readonly MarketRef[], onView: () => void) {
  const { title, body } = describeNewMarkets(fresh);

  toast.success(title, {
    id: 'new-markets',
    description: body || undefined,
    duration: 12_000,
    action: { label: 'View', onClick: onView },
  });

  try { navigator.vibrate?.([120, 60, 120]); } catch { /* not supported */ }

  // Only worth a system notification when the rider can't see the toast.
  if (document.visibilityState === 'visible' || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const options: NotificationOptions = { body, tag: 'mbg-new-market' };
  navigator.serviceWorker?.getRegistration()
    .then(reg => (reg ? reg.showNotification(title, options) : void new Notification(title, options)))
    .catch(() => { try { new Notification(title, options); } catch { /* blocked */ } });
}
