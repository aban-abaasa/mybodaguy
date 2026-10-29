import { useState } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { businessService, LICENSE_LABEL, type AccessState, type BusinessCategory, type BusinessRegistration } from '../services/businessService';
import { RegistrationSubmitCard } from './BusinessRegistrationFields';
import ClassicSection from './common/ClassicSection';
import { ClassicField } from './common/classicForm';

interface EditableBusiness {
  id: string;
  business_name: string;
  category_key: BusinessCategory;
  description: string | null;
  home_city: string | null;
  home_country: string | null;
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="classic-label !mb-0">{label}</dt>
      <dd className="break-words text-sm text-slate-800">{value || '—'}</dd>
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
    toast.success('Saved');
    await onSaved();
  };

  // Unsupported = the registration step does not exist yet, so there is nothing to submit.
  const needsRegistration =
    state === 'incomplete' ||
    state === 'rejected' ||
    (state === 'approved' && !!registration?.grandfathered) ||
    (state === 'pending' && !registration?.registration_number);
  const registrationLocked = !needsRegistration && state !== 'unsupported';

  return (
    <div className="space-y-3">
      {state !== 'unsupported' && (
        <ClassicSection
          title="Registration"
          defaultOpen={needsRegistration}
          summary={registration?.registration_number ? `No. ${registration.registration_number}` : 'Not submitted'}
          right={registrationLocked ? <Lock size={14} className="text-slate-400" aria-label="Locked" /> : undefined}
        >
          {needsRegistration ? (
            <>
              {state === 'rejected' && registration?.rejection_reason && (
                <p className="mb-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">Last review: {registration.rejection_reason}</p>
              )}
              <RegistrationSubmitCard
                businessProfileId={business.id}
                category={business.category_key}
                registration={registration}
                onSubmitted={onSaved}
                submitLabel={state === 'rejected' ? 'Resubmit' : state === 'approved' ? 'Save details' : 'Submit for approval'}
              />
            </>
          ) : (
            <>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Row label="Registration no." value={registration?.registration_number ?? null} />
                <Row label={LICENSE_LABEL[business.category_key]} value={registration?.license_number ?? null} />
                <Row label="TIN" value={registration?.tax_id ?? null} />
              </dl>
              <p className="mt-3 text-xs text-slate-400">Locked. Contact BodaGoEra to change these.</p>
            </>
          )}
        </ClassicSection>
      )}

      <form onSubmit={save} className="space-y-3">
        <ClassicSection title="Public profile" defaultOpen={!needsRegistration} summary={business.business_name}>
          <div className="space-y-3">
            <ClassicField label="Business name">
              <input className="classic-input" value={form.businessName} onChange={set('businessName')} required />
            </ClassicField>
            <ClassicField label="About">
              <textarea className="classic-input" rows={3} value={form.description} onChange={set('description')} />
            </ClassicField>
            <div className="grid grid-cols-2 gap-3">
              <ClassicField label="City">
                <input className="classic-input" value={form.homeCity} onChange={set('homeCity')} />
              </ClassicField>
              <ClassicField label="Country">
                <input className="classic-input" value={form.homeCountry} onChange={set('homeCountry')} />
              </ClassicField>
            </div>
          </div>
        </ClassicSection>

        {registration && (
          <ClassicSection title="Contact & hours" summary={registration.contact_phone || undefined}>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ClassicField label="Phone">
                  <input className="classic-input" type="tel" value={form.contactPhone} onChange={set('contactPhone')} />
                </ClassicField>
                <ClassicField label="Email">
                  <input className="classic-input" type="email" value={form.contactEmail} onChange={set('contactEmail')} />
                </ClassicField>
                <ClassicField label="Website">
                  <input className="classic-input" placeholder="https://" value={form.website} onChange={set('website')} />
                </ClassicField>
                <ClassicField label="Hours">
                  <input className="classic-input" placeholder="Mon–Sat 7am–8pm" value={form.operatingHours} onChange={set('operatingHours')} />
                </ClassicField>
              </div>
              <ClassicField label="Address">
                <input className="classic-input" value={form.businessAddress} onChange={set('businessAddress')} />
              </ClassicField>
            </div>
          </ClassicSection>
        )}

        <button type="submit" disabled={saving} className="classic-btn classic-btn-primary">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  );
}
