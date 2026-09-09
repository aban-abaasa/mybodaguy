import { useState } from 'react';
import { X, Truck, ShieldCheck } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';

export type BusinessCategory = 'transport_company' | 'security_escort';

interface BusinessRegistrationModalProps {
  category: BusinessCategory;
  onClose: () => void;
  onCreated: (businessProfileId: string) => void;
}

const CATEGORY_META: Record<BusinessCategory, { label: string; icon: typeof Truck; blurb: string }> = {
  transport_company: {
    label: 'Transport Company',
    icon: Truck,
    blurb: 'Run a fleet of drivers, take large/bulk ride & delivery orders, and set your own pricing.',
  },
  security_escort: {
    label: 'Security Escort Service',
    icon: ShieldCheck,
    blurb: 'Offer security escorts customers can add to a ride or delivery, with your own team and rates.',
  },
};

export default function BusinessRegistrationModal({ category, onClose, onCreated }: BusinessRegistrationModalProps) {
  const [businessName, setBusinessName] = useState('');
  const [description, setDescription] = useState('');
  const [homeCity, setHomeCity] = useState('');
  const [homeCountry, setHomeCountry] = useState('Uganda');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = CATEGORY_META[category];
  const Icon = meta.icon;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('mbg_register_business', {
        p_category_key: category,
        p_business_name: businessName.trim(),
        p_description: description.trim() || null,
        p_home_city: homeCity.trim() || null,
        p_home_country: homeCountry.trim() || 'Uganda',
      });
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.error || 'Could not register business');
      onCreated(data.business_profile_id);
    } catch (err: any) {
      setError(err.message || 'Could not register business');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Icon className="text-orange-500" size={20} />
            <h3 className="font-bold text-slate-800">Register a {meta.label}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <p className="text-sm text-slate-500">{meta.blurb}</p>
          {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3">{error}</div>}

          <input
            className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400"
            placeholder="Business name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            required
          />
          <textarea
            className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400"
            placeholder="Short description (optional)"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              className="border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400"
              placeholder="Home city (optional)"
              value={homeCity}
              onChange={(e) => setHomeCity(e.target.value)}
            />
            <input
              className="border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400"
              placeholder="Country"
              value={homeCountry}
              onChange={(e) => setHomeCountry(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !businessName.trim()}
            className="w-full bg-orange-500 disabled:bg-slate-300 text-white rounded-lg py-3 font-semibold"
          >
            {submitting ? 'Registering…' : `Register ${meta.label}`}
          </button>
        </form>
      </div>
    </div>
  );
}
