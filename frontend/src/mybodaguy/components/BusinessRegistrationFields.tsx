import { useState } from 'react';
import { toast } from 'sonner';
import {
  LICENSE_LABEL,
  businessService,
  validateRegistration,
  type BusinessCategory,
  type BusinessRegistration,
  type RegistrationInput,
} from '../services/businessService';

export const emptyRegistration: RegistrationInput = {
  registrationNumber: '',
  licenseNumber: '',
  contactPhone: '',
  taxId: '',
  contactEmail: '',
  businessAddress: '',
  website: '',
  operatingHours: '',
};

export function registrationFrom(r: BusinessRegistration | undefined): RegistrationInput {
  if (!r) return emptyRegistration;
  return {
    registrationNumber: r.registration_number || '',
    licenseNumber: r.license_number || '',
    contactPhone: r.contact_phone || '',
    taxId: r.tax_id || '',
    contactEmail: r.contact_email || '',
    businessAddress: r.business_address || '',
    website: r.website || '',
    operatingHours: r.operating_hours || '',
  };
}

const inputCls = 'w-full border rounded-lg p-2.5 bg-white text-slate-900 placeholder-slate-400 text-sm';

function Field({ label, error, required, children }: { label: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
    </label>
  );
}

/** The legal + contact details a registered business gives. Used by the sign-up modal and the "complete registration" card. */
export function RegistrationFields({
  category,
  values,
  errors,
  onChange,
}: {
  category: BusinessCategory;
  values: RegistrationInput;
  errors: Record<string, string>;
  onChange: (next: RegistrationInput) => void;
}) {
  const set = (key: keyof RegistrationInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...values, [key]: e.target.value });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Business registration number" required error={errors.registrationNumber}>
          <input className={inputCls} placeholder="e.g. URSB certificate no." value={values.registrationNumber} onChange={set('registrationNumber')} autoComplete="off" />
        </Field>
        <Field label={LICENSE_LABEL[category]} required error={errors.licenseNumber}>
          <input className={inputCls} value={values.licenseNumber} onChange={set('licenseNumber')} autoComplete="off" />
        </Field>
        <Field label="Contact phone" required error={errors.contactPhone}>
          <input className={inputCls} type="tel" inputMode="tel" placeholder="+256 …" value={values.contactPhone} onChange={set('contactPhone')} />
        </Field>
        <Field label="Tax ID (TIN)" error={errors.taxId}>
          <input className={inputCls} value={values.taxId} onChange={set('taxId')} autoComplete="off" />
        </Field>
        <Field label="Business email" error={errors.contactEmail}>
          <input className={inputCls} type="email" value={values.contactEmail} onChange={set('contactEmail')} />
        </Field>
        <Field label="Website" error={errors.website}>
          <input className={inputCls} placeholder="https://" value={values.website} onChange={set('website')} />
        </Field>
      </div>
      <Field label="Office address" error={errors.businessAddress}>
        <input className={inputCls} value={values.businessAddress} onChange={set('businessAddress')} />
      </Field>
      <Field label="Operating hours" error={errors.operatingHours}>
        <input className={inputCls} placeholder="e.g. Mon–Sat 7am–8pm" value={values.operatingHours} onChange={set('operatingHours')} />
      </Field>
    </div>
  );
}

/**
 * Standalone submit card for an existing business: first submission for one that never gave details,
 * a re-submission after a rejection, or a grandfathered business filling its details in.
 */
export function RegistrationSubmitCard({
  businessProfileId,
  category,
  registration,
  onSubmitted,
  submitLabel = 'Submit for approval',
}: {
  businessProfileId: string;
  category: BusinessCategory;
  registration: BusinessRegistration | undefined;
  onSubmitted: () => void | Promise<void>;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<RegistrationInput>(() => registrationFrom(registration));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateRegistration(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    const err = await businessService.submitRegistration(businessProfileId, values);
    setSubmitting(false);
    if (err) {
      toast.error(err);
      return;
    }
    toast.success('Registration submitted');
    await onSubmitted();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <RegistrationFields category={category} values={values} errors={errors} onChange={setValues} />
      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-orange-500 disabled:bg-slate-300 text-white rounded-lg py-2.5 text-sm font-semibold"
      >
        {submitting ? 'Submitting…' : submitLabel}
      </button>
    </form>
  );
}
