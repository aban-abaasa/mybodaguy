import { useState } from 'react';
import { X, Truck, ShieldCheck, ClipboardCheck } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { businessService, validateRegistration, type BusinessCategory, type RegistrationInput } from '../services/businessService';
import { RegistrationFields, emptyRegistration } from './BusinessRegistrationFields';

export type { BusinessCategory };

interface BusinessRegistrationModalProps {
  category: BusinessCategory;
  onClose: () => void;
  /** registrationError is set when the business was created but its details could not be filed — the panel then asks for them again. */
  onCreated: (businessProfileId: string, registrationError?: string) => void;
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

const inputCls = 'w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400';

export default function BusinessRegistrationModal({ category, onClose, onCreated }: BusinessRegistrationModalProps) {
  const [businessName, setBusinessName] = useState('');
  const [description, setDescription] = useState('');
  const [homeCity, setHomeCity] = useState('');
  const [homeCountry, setHomeCountry] = useState('Uganda');
  const [registration, setRegistration] = useState<RegistrationInput>(emptyRegistration);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = CATEGORY_META[category];
  const Icon = meta.icon;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Validate the legal details first so a bad form never leaves a half-registered business behind.
    const found = validateRegistration(registration);
    setFieldErrors(found);
    if (Object.keys(found).length) {
      setError('Please complete the highlighted registration details.');
      return;
    }
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
      const registrationError = await businessService.submitRegistration(data.business_profile_id, registration);
      onCreated(data.business_profile_id, registrationError || undefined);
    } catch (err: any) {
      setError(err.message || 'Could not register business');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <Icon className="text-orange-500" size={20} />
            <h3 className="font-bold text-slate-800">Register a {meta.label}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-5 overflow-y-auto">
          <p className="text-sm text-slate-500">{meta.blurb}</p>
          {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3">{error}</div>}

          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your business</h4>
            <input
              className={inputCls}
              placeholder="Business name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
            />
            <textarea
              className={inputCls}
              placeholder="Short description (optional)"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <input className={inputCls} placeholder="Home city (optional)" value={homeCity} onChange={(e) => setHomeCity(e.target.value)} />
              <input className={inputCls} placeholder="Country" value={homeCountry} onChange={(e) => setHomeCountry(e.target.value)} />
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Registration details</h4>
            <RegistrationFields category={category} values={registration} errors={fieldErrors} onChange={setRegistration} />
          </section>

          <div className="flex items-start gap-2 bg-orange-50 text-orange-800 text-xs rounded-lg p-3">
            <ClipboardCheck size={16} className="shrink-0 mt-0.5" />
            <p>
              Only registered businesses can operate. The BodaGoEra team reviews these details in the developer panel.
              While you wait you can finish your profile and pricing; adding {category === 'security_escort' ? 'escorts' : 'drivers'} and
              insurance unlock once you are approved.
            </p>
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
