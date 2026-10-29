import { useState } from 'react';
import { X, Truck, ShieldCheck } from 'lucide-react';
import { ClassicField } from './common/classicForm';
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

const CATEGORY_META: Record<BusinessCategory, { label: string; icon: typeof Truck }> = {
  transport_company: { label: 'Transport Company', icon: Truck },
  security_escort: { label: 'Security Escort Service', icon: ShieldCheck },
};

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
      setError('Complete the highlighted fields.');
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="classic-card !rounded-b-none sm:!rounded-b-[20px] flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-[#c4a052]/25 p-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#fbf3dc] text-[#a17c28]"><Icon size={18} /></span>
            <div>
              <p className="classic-eyebrow">Register</p>
              <h3 className="font-classic-display text-lg font-semibold leading-tight text-slate-800">{meta.label}</h3>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-5 overflow-y-auto p-5">
          {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          <section className="space-y-3">
            <ClassicField label="Business name" required>
              <input className="classic-input" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
            </ClassicField>
            <div className="grid grid-cols-2 gap-3">
              <ClassicField label="City">
                <input className="classic-input" value={homeCity} onChange={(e) => setHomeCity(e.target.value)} />
              </ClassicField>
              <ClassicField label="Country">
                <input className="classic-input" value={homeCountry} onChange={(e) => setHomeCountry(e.target.value)} />
              </ClassicField>
            </div>
            <ClassicField label="About">
              <textarea className="classic-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </ClassicField>
          </section>

          <section className="space-y-3">
            <p className="classic-eyebrow">Registration</p>
            <RegistrationFields category={category} values={registration} errors={fieldErrors} onChange={setRegistration} />
          </section>

          <button type="submit" disabled={submitting || !businessName.trim()} className="classic-btn classic-btn-primary">
            {submitting ? 'Submitting…' : 'Submit for approval'}
          </button>
        </form>
      </div>
    </div>
  );
}
