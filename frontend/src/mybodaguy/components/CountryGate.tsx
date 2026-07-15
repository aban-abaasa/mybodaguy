import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import { COUNTRY_NAMES } from '../data/countries';

interface CountryGateProps {
  user: any;
  children: React.ReactNode;
}

// Google sign-in never collects a country (unlike the email/password signup
// form), so this re-checks on every authenticated session — not just at
// signup — and blocks with a mandatory picker until mbg_user_profiles.country
// is set. Also catches pre-existing accounts created before country became
// required.
export default function CountryGate({ user, children }: CountryGateProps) {
  const [checking, setChecking] = useState(true);
  const [needsCountry, setNeedsCountry] = useState(false);
  const [country, setCountry] = useState('Uganda');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    const checkCountry = async () => {
      if (!user?.id) {
        if (active) setChecking(false);
        return;
      }

      // Don't trap offline users behind a picker they can't submit anyway.
      if (!navigator.onLine) {
        if (active) {
          setNeedsCountry(false);
          setChecking(false);
        }
        return;
      }

      try {
        const { data, error } = await supabase
          .from('mbg_user_profiles')
          .select('country')
          .eq('user_id', user.id)
          .maybeSingle();

        if (!active) return;

        if (error) {
          console.error('[CountryGate] Failed to check country:', error);
          setNeedsCountry(false);
        } else {
          setNeedsCountry(!data?.country || !data.country.trim());
        }
      } finally {
        if (active) setChecking(false);
      }
    };

    checkCountry();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const handleSave = async () => {
    if (!country || !user?.id) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('mbg_user_profiles')
        .update({ country })
        .eq('user_id', user.id);

      if (error) throw error;

      toast.success('Country saved!');
      setNeedsCountry(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save country');
    } finally {
      setSaving(false);
    }
  };

  if (checking) return null;
  if (!needsCountry) return <>{children}</>;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-yellow-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl">
            <Globe size={32} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Select Your Country</h2>
          <p className="text-slate-600 text-sm">
            We need your country to match you with drivers and destination pickups in the right place.
          </p>
        </div>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all appearance-none bg-white mb-4"
        >
          {COUNTRY_NAMES.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
