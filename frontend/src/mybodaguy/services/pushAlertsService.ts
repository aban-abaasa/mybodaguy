import { supabase } from './supabaseClient';

// Phone/PC alerts through the ICANera push relay. One VAPID key pair, one relay
// (the "wallet-push" Edge Function) and one device table serve every app in the
// shared Supabase project; each device row is tagged with the app it came from
// so the relay can send ride requests, messages and calls to THIS app's phone
// (see ICAN/backend/ICAN_APP_PUSH_REGISTRATION.sql and
// backend/database/ADD_BODAGOERA_PUSH_NOTIFICATIONS.sql).
export const PUSH_APP_ID = 'mybodaguy';

// A VAPID key pasted into a hosting dashboard often gains a trailing newline or
// wrapping quotes, which makes atob() throw an unhelpful error - clean it first.
const base64UrlToUint8Array = (value: unknown): Uint8Array => {
  const cleaned = String(value || '').trim().replace(/^["']|["']$/g, '');
  if (!/^[A-Za-z0-9_-]+$/.test(cleaned)) {
    throw new Error('Alerts are misconfigured for this app (invalid push key).');
  }
  const padding = '='.repeat((4 - (cleaned.length % 4)) % 4);
  const base64 = (cleaned + padding).replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch {
    throw new Error('Alerts are misconfigured for this app (invalid push key).');
  }
};

export const supportsPush = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export interface PushStatus {
  supported: boolean;
  enabled: boolean;
  permission: NotificationPermission | 'unsupported';
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!supportsPush()) return { supported: false, enabled: false, permission: 'unsupported' };
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  return {
    supported: true,
    enabled: Notification.permission === 'granted' && Boolean(subscription),
    permission: Notification.permission,
  };
}

const registerWithServer = async (subscription: PushSubscription) => {
  const { error } = await supabase.rpc('ican_register_app_push_subscription', {
    p_subscription: subscription.toJSON(),
    p_application_id: PUSH_APP_ID,
  });
  if (error) throw error;
};

// Must run from a tap/click: browsers ignore the permission prompt otherwise.
export async function enablePushAlerts(): Promise<PushSubscription> {
  if (!supportsPush()) {
    throw new Error('This browser does not support alerts. On iPhone, add the app to the Home Screen first.');
  }
  const vapidKey = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY;
  if (!vapidKey) throw new Error('Alerts are not configured for this app yet.');

  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(vapidKey) as BufferSource,
    });
  }
  await registerWithServer(subscription);
  return subscription;
}

// Called on sign-in: the same phone can be used by a different person (a rider
// hands over, a customer signs out), and a browser can rotate its endpoint.
// The RPC is an upsert, so this simply re-attaches the device to whoever is
// signed in now.
export async function refreshPushRegistration(): Promise<boolean> {
  try {
    const status = await getPushStatus();
    if (!status.enabled) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (!subscription) return false;
    await registerWithServer(subscription);
    return true;
  } catch (error) {
    console.warn('Push registration refresh failed:', (error as Error)?.message || error);
    return false;
  }
}

export async function disablePushAlerts(): Promise<boolean> {
  if (!supportsPush()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription) return false;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  await supabase.from('ican_wallet_push_subscriptions').update({ is_active: false }).eq('endpoint', endpoint);
  return true;
}
