import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import PWAInstallPrompt from "./components/PWAInstallPrompt";

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('[BodaGoEra PWA] Service worker ready'))
      .catch((error) => console.error('[BodaGoEra PWA] Service worker registration failed', error));
  });
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <App />
    <PWAInstallPrompt />
  </ThemeProvider>
);
