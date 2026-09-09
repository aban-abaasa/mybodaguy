import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import PWAInstallPrompt from "./components/PWAInstallPrompt";
import VerifyReceiptPage from "./mybodaguy/components/VerifyReceiptPage";

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('[BodaGoEra PWA] Service worker ready'))
      .catch((error) => console.error('[BodaGoEra PWA] Service worker registration failed', error));
  });
}

// Public QR-verification page (https://bodagoera.icanera.space/verify/<code>)
// short-circuits before the auth-gated <App/> tree — no login required to
// scan a delivery receipt. There's no router wired up in this app (same
// precedent as the existing /supermarketera pathname check in index.html),
// so this is a plain pathname check.
const verifyMatch = window.location.pathname.match(/^\/verify\/([A-Za-z0-9]+)/);

createRoot(document.getElementById("root")!).render(
  verifyMatch ? (
    <VerifyReceiptPage code={verifyMatch[1]} />
  ) : (
    <ThemeProvider>
      <App />
      <PWAInstallPrompt />
    </ThemeProvider>
  )
);
