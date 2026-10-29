import { useState } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { businessService, LICENSE_LABEL, type AccessState, type BusinessCategory, type BusinessRegistration } from '../services/businessService';
import { RegistrationSubmitCard } from './BusinessRegistrationFields';

interface EditableBusiness {
  id: string;
  business_name: string;
  category_key: BusinessCategory;
  description: string | null;
  home_city: string | null;
  home_country: string | null;
}

const inputCls = 'w-full border rounded-lg p-2.5 bg-white text-slate-900 placeholder-slate-400 text-sm';

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800 break-words">{value || '—'}</dd>
    </div>
  );
}

export default function BusinessProfileEditor({
  business,
  registration,
  state,
  onSaved,
}: {
  business: EditableBusiness;
  registration: BusinessRegistration | undefined;
  state: AccessState;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    businessName: business.business_name,
    description: business.description || '',
    homeCity: business.home_city || '',
    homeCountry: business.home_country || 'Uganda',
    contactPhone: registration?.contact_phone || '',
    contactEmail: registration?.contact_email || '',
    businessAddress: registration?.business_address || '',
    website: registration?.website || '',
    operatingHours: registration?.operating_hours || '',
  });
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.businessName.trim()) {
      toast.error('Business name is required');
      return;
    }
    setSaving(true);
    const err = await businessService.updateProfile(business.id, form);
    setSaving(false);
    if (err) {
      toast.error(err);
      return;
    }
    toast.success('Profile saved');
    await onSaved();
  };

  // Unsupported = the registration step does not exist yet, so there is nothing to submit.
  const showRegistrationForm =
    state === 'incomplete' ||
    state === 'rejected' ||
    (state === 'approved' && !!registration?.grandfathered) ||
    (state === 'pending' && !registration?.registration_number);
  const registrationLocked = !showRegistrationForm && state !== 'unsupported';

  return (
    <div className="space-y-6">
      {state !== 'unsupported' && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold text-slate-800">Registration</h4>
            {registrationLocked && (
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <Lock size={12} /> Locked while {state === 'pending' ? 'under review' : 'approved'}
              </span>
            )}
          </div>
          {showRegistrationForm ? (
            <>
              {state === 'rejected' && registration?.rejection_reason && (
                <p className="text-xs bg-red-50 text-red-700 rounded-lg p-3">Last review: {registration.rejection_reason}</p>
              )}
              <RegistrationSubmitCard
                businessProfileId={business.id}
                category={business.category_key}
                registration={registration}
                onSubmitted={onSaved}
                submitLabel={state === 'rejected' ? 'Resubmit for approval' : state === 'approved' ? 'Save registration details' : 'Submit for approval'}
              />
            </>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 rounded-xl p-4">
              <Row label="Registration number" value={registration?.registration_number ?? null} />
              <Row label={LICENSE_LABEL[business.category_key]} value={registration?.license_number ?? null} />
              <Row label="Tax ID (TIN)" value={registration?.tax_id ?? null} />
            </dl>
          )}
          {registrationLocked && (
            <p className="text-xs text-slate-400">To change these details, contact the BodaGoEra team.</p>
          )}
        </section>
      )}

      <form onSubmit={save} className="space-y-3">
        <h4 className="font-semibold text-slate-800">Public profile</h4>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Business name</label>
          <input className={inputCls} value={form.businessName} onChange={set('businessName')} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">About your business</label>
          <textarea className={inputCls} rows={3} placeholder="What you offer, areas you serve, what makes you reliable" value={form.description} onChange={set('description')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Home city</label>
            <input className={inputCls} value={form.homeCity} onChange={set('homeCity')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Country</label>
            <input className={inputCls} value={form.homeCountry} onChange={set('homeCountry')} />
          </div>
        </div>

        {registration && (
          <>
            <h4 className="font-semibold text-slate-800 pt-2">Contact &amp; hours</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Contact phone</label>
                <input className={inputCls} type="tel" value={form.contactPhone} onChange={set('contactPhone')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Business email</label>
                <input className={inputCls} type="email" value={form.contactEmail} onChange={set('contactEmail')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Website</label>
                <input className={inputCls} placeholder="https://" value={form.website} onChange={set('website')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Operating hours</label>
                <input className={inputCls} placeholder="e.g. Mon–Sat 7am–8pm" value={form.operatingHours} onChange={set('operatingHours')} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Office address</label>
              <input className={inputCls} value={form.businessAddress} onChange={set('businessAddress')} />
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-orange-500 disabled:bg-slate-300 text-white rounded-lg py-2.5 text-sm font-semibold"
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    </div>
  );
}
