import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function getAppName() {
  return window.location.pathname.indexOf('/supermarketera') === 0 || new URLSearchParams(window.location.search).get('app') === 'supermarketera'
    ? 'SupermartKera'
    : 'BodaGoEra';
}

function getAppIcon() {
  return window.location.pathname.indexOf('/supermarketera') === 0 || new URLSearchParams(window.location.search).get('app') === 'supermarketera'
    ? '/images/supermarketera-apk.jpg'
    : '/images/bodagoera-apk.jpg';
}

export default function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('pwa-install-dismissed') === '1');
  const [showInstructions, setShowInstructions] = useState(false);
  const promptRef = useRef<InstallPromptEvent | null>(null);
  const appName = getAppName();
  const appIcon = getAppIcon();

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsInstalled(standalone);

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      const installPrompt = event as InstallPromptEvent;
      promptRef.current = installPrompt;
      setInstallEvent(installPrompt);
      console.log(`[${appName} PWA] Native install prompt ready`);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      promptRef.current = null;
      setInstallEvent(null);
    };
    const handleLandingInstallRequest = async () => {
      const prompt = promptRef.current;
      if (!prompt) {
        setShowInstructions(true);
        return;
      }
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') {
        promptRef.current = null;
        setInstallEvent(null);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('bodagoera-install-requested', handleLandingInstallRequest);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('bodagoera-install-requested', handleLandingInstallRequest);
    };
  }, []);

  if (isInstalled) return null;

  const install = async () => {
    if (!installEvent) {
      setShowInstructions(true);
      return;
    }
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === 'accepted') {
        promptRef.current = null;
        setInstallEvent(null);
      }
    } catch (error) {
      console.error(`[${appName} PWA] Install failed`, error);
    }
  };

  const dismiss = () => {
    sessionStorage.setItem('pwa-install-dismissed', '1');
    setDismissed(true);
  };

  if (dismissed && !showInstructions) {
    return (
      <button
        onClick={() => setShowInstructions(true)}
        className="fixed right-0 top-1/2 z-[100] -translate-y-1/2 rounded-l-xl bg-orange-500 px-2 py-4 text-xs font-bold text-white shadow-lg [writing-mode:vertical-rl] hover:bg-orange-600"
        aria-label={`Install ${appName}`}
      >
        <img src={appIcon} alt="" className="mb-2 h-5 w-5 rounded object-cover" />
        Install {appName}
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-orange-200 bg-white p-3 shadow-2xl">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
          <img src={appIcon} alt="" className="h-11 w-11 rounded-xl object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">Install {appName}</p>
          <p className="text-xs text-slate-500">Use it like an app from your home screen.</p>
        </div>
        <button onClick={install} className="rounded-xl bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600">
          Install
        </button>
        <button onClick={dismiss} aria-label="Dismiss install prompt" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={18} />
        </button>
      </div>
      {showInstructions && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/40 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Install {appName}</h2>
              <button onClick={() => setShowInstructions(false)} aria-label="Close install instructions" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X size={19} />
              </button>
            </div>
            <p className="text-sm leading-6 text-slate-600">
              In Chrome, open the <strong>⋮</strong> menu, choose <strong>Install app</strong> or <strong>Add to Home screen</strong>, then confirm.
            </p>
            <button onClick={() => setShowInstructions(false)} className="mt-4 w-full rounded-xl bg-orange-500 px-4 py-3 font-semibold text-white hover:bg-orange-600">
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
