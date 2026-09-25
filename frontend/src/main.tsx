import { createRoot } from "react-dom/client";
import { injectSpeedInsights } from "@vercel/speed-insights";
import "./index.css";
import "leaflet/dist/leaflet.css";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import PWAInstallPrompt from "./components/PWAInstallPrompt";
import PushAlertsPrompt from "./components/PushAlertsPrompt";
import VerifyReceiptPage from "./mybodaguy/components/VerifyReceiptPage";
import TicketVerifyPage from "./mybodaguy/components/TicketVerifyPage";
import SupportConsole from "./mybodaguy/pages/SupportConsole";
import { captureReferralFromUrl } from "./mybodaguy/services/referralService";

// A shared referral link (/?ref=CODE) can land anywhere, signed in or not —
// remember the code now, redeem it once the visitor has an account
// (UnifiedDashboard calls consumePendingReferralCode).
captureReferralFromUrl();

// Vercel Speed Insights (no-op outside a Vercel deployment).
injectSpeedInsights();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[BodaGoEra PWA] Service worker ready');

        // This app ships one big bundle (no route code-splitting), so a
        // stale cached index.html doesn't fail to load — it silently
        // renders whatever old JS/CSS it references, with no error to
        // catch. A tab left open across a deploy needs something to
        // actively notice the update: sw.js calls skipWaiting()+
        // clients.claim() on every install, so the moment a new deploy's
        // service worker takes over, 'controllerchange' fires here and we
        // reload once to pick it up.
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });

        // Proactively poll for a new deploy every 5 minutes instead of
        // only checking when the browser happens to re-navigate.
        setInterval(() => registration.update().catch(() => undefined), 5 * 60 * 1000);
      })
      .catch((error) => console.error('[BodaGoEra PWA] Service worker registration failed', error));
  });
}

// Public QR-verification page (https://bodagoera.icanera.space/verify/<code>)
// short-circuits before the auth-gated <App/> tree — no login required to
// scan a delivery receipt. There's no router wired up in this app (same
// precedent as the existing /supermarketera pathname check in index.html),
// so this is a plain pathname check.
let verifyMatch = window.location.pathname.match(/^\/verify\/([A-Za-z0-9]+)/);

// Support Console (?key=<token>, see ADD_SUPPORT_CONSOLE.sql /
// SupportConsole.tsx) — a password-gated link into Public Board + Messages
// for someone with no mybodaguy account. Same plain-pathname-check
// precedent as /verify above; no router wired up in this app.
// Air ticket QR (https://bodagoera.icanera.space/ticket/<code>) — public, same pattern as /verify.
const ticketMatch = window.location.pathname.match(/^\/ticket\/([A-Za-z0-9]+)/);

const isSupportConsole = window.location.pathname === '/support-console';

// VerifyReceiptPage's "Sign in with Google to Approve" passes
// redirectTo: window.location.href, so Google should bounce straight back
// to /verify/<code> — but if this Supabase project's OAuth redirect
// allow-list only covers the site root, it lands on "/" instead (with the
// auth tokens still in the URL hash). Recover by bouncing to the verify
// page we stashed before leaving, carrying the hash along so Supabase's
// client (detectSessionInUrl: true) still picks up the session there.
if (!verifyMatch && window.location.hash.includes('access_token')) {
  const pendingCode = sessionStorage.getItem('icanera_verify_return_code');
  if (pendingCode) {
    sessionStorage.removeItem('icanera_verify_return_code');
    window.location.replace(`/verify/${pendingCode}${window.location.hash}`);
  }
}

createRoot(document.getElementById("root")!).render(
  verifyMatch ? (
    <VerifyReceiptPage code={verifyMatch[1]} />
  ) : ticketMatch ? (
    <TicketVerifyPage code={ticketMatch[1]} />
  ) : isSupportConsole ? (
    <SupportConsole />
  ) : (
    <ThemeProvider>
      <App />
      <PWAInstallPrompt />
      <PushAlertsPrompt />
    </ThemeProvider>
  )
);
