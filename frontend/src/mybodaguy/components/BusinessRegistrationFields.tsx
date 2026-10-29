import { useState } from 'react';
import { toast } from 'sonner';
import ClassicSection from './common/ClassicSection';
import { ClassicField } from './common/classicForm';
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
  const [more, setMore] = useState(false);
  const set = (key: keyof RegistrationInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...values, [key]: e.target.value });
  const optionalFilled = [values.taxId, values.contactEmail, values.website, values.businessAddress, values.operatingHours].filter((v) => v?.trim()).length;

  return (
    <div className="space-y-3">
      <ClassicField label="Registration number" required error={errors.registrationNumber}>
        <input className="classic-input" value={values.registrationNumber} onChange={set('registrationNumber')} autoComplete="off" />
      </ClassicField>
      <ClassicField label={LICENSE_LABEL[category]} required error={errors.licenseNumber}>
        <input className="classic-input" value={values.licenseNumber} onChange={set('licenseNumber')} autoComplete="off" />
      </ClassicField>
      <ClassicField label="Contact phone" required error={errors.contactPhone}>
        <input className="classic-input" type="tel" inputMode="tel" placeholder="+256" value={values.contactPhone} onChange={set('contactPhone')} />
      </ClassicField>

      <ClassicSection
        title="More details"
        summary={optionalFilled ? `${optionalFilled} added` : 'Optional'}
        open={more || !!errors.contactEmail || !!errors.website}
        onToggle={setMore}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ClassicField label="Tax ID (TIN)">
              <input className="classic-input" value={values.taxId} onChange={set('taxId')} autoComplete="off" />
            </ClassicField>
            <ClassicField label="Email" error={errors.contactEmail}>
              <input className="classic-input" type="email" value={values.contactEmail} onChange={set('contactEmail')} />
            </ClassicField>
            <ClassicField label="Website" error={errors.website}>
              <input className="classic-input" placeholder="https://" value={values.website} onChange={set('website')} />
            </ClassicField>
            <ClassicField label="Hours">
              <input className="classic-input" placeholder="Mon–Sat 7am–8pm" value={values.operatingHours} onChange={set('operatingHours')} />
            </ClassicField>
          </div>
          <ClassicField label="Address">
            <input className="classic-input" value={values.businessAddress} onChange={set('businessAddress')} />
          </ClassicField>
        </div>
      </ClassicSection>
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
    toast.success('Submitted');
    await onSubmitted();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <RegistrationFields category={category} values={values} errors={errors} onChange={setValues} />
      <button type="submit" disabled={submitting} className="classic-btn classic-btn-primary">
        {submitting ? 'Submitting…' : submitLabel}
      </button>
    </form>
  );
}
