import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';

/**
 * API tab of the BodaGoEra developer panel: approve outside developers, watch usage, switch endpoints off.
 *
 * The console is one framework-free module shared by all four developer panels
 * (public/developers/admin.js, loaded at runtime so it is not part of this bundle). It renders in a Shadow DOM,
 * so this app's styles cannot touch it, and it asks for a REAL signed-in admin account. The database side lives
 * in the ICAN repo (supabase/migrations/20261005100000_era_api.sql); all four apps share one Supabase project.
 */
type AdminModule = {
  mountEraApiAdmin: (
    host: HTMLElement,
    opts: {
      rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
      signIn: (email: string, password: string) => PromiseLike<{ error: { message?: string } | null }>;
      theme?: 'light' | 'dark';
    },
  ) => { destroy: () => void; refresh: () => void; setTheme: (t: string | null) => void };
};

export default function EraApiDevTab() {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let ui: { destroy: () => void } | null = null;
    let off = false;
    (async () => {
      try {
        const url = '/developers/admin.js';
        const mod = (await import(/* @vite-ignore */ url)) as AdminModule;
        if (off || !ref.current) return;
        ui = mod.mountEraApiAdmin(ref.current, {
          rpc: (fn, args) => supabase.rpc(fn, args),
          signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
        });
      } catch {
        if (!off) setFailed(true);
      }
    })();
    return () => { off = true; if (ui) ui.destroy(); };
  }, []);

  if (failed) {
    return <p className="text-sm text-slate-500 text-center py-8">The API console could not load. Check your connection and refresh.</p>;
  }
  return <div ref={ref} />;
}
