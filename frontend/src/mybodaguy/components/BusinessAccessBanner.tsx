import { Clock, XCircle, Ban, ClipboardList, BadgeCheck } from 'lucide-react';
import type { AccessState, BusinessRegistration } from '../services/businessService';

export const ACCESS_LABEL: Record<AccessState, string> = {
  unsupported: 'Active',
  incomplete: 'Registration needed',
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Not approved',
  suspended: 'Suspended',
};

export const ACCESS_CHIP: Record<AccessState, string> = {
  unsupported: 'bg-emerald-100 text-emerald-700',
  incomplete: 'bg-amber-100 text-amber-700',
  pending: 'bg-sky-100 text-sky-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  suspended: 'bg-red-100 text-red-700',
};

export function AccessChip({ state }: { state: AccessState }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${ACCESS_CHIP[state]}`}>
      {ACCESS_LABEL[state]}
    </span>
  );
}

/**
 * Says where the business stands with the BodaGoEra team and what to do next.
 * Renders nothing for a plainly approved business (the chip is enough).
 */
export default function BusinessAccessBanner({
  state,
  registration,
  onOpenRegistration,
}: {
  state: AccessState;
  registration: BusinessRegistration | undefined;
  onOpenRegistration: () => void;
}) {
  const action = (label: string) => (
    <button onClick={onOpenRegistration} className="mt-2 text-xs font-semibold underline underline-offset-2">
      {label}
    </button>
  );

  if (state === 'incomplete') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 p-4">
        <ClipboardList size={20} className="shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold">Add your registration details</p>
          <p className="text-xs mt-0.5">
            Only registered businesses can operate. Give your registration number and licence so the BodaGoEra team can approve you.
          </p>
          {action('Add registration details')}
        </div>
      </div>
    );
  }
  if (state === 'pending') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 text-sky-900 p-4">
        <Clock size={20} className="shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold">Waiting for approval</p>
          <p className="text-xs mt-0.5">
            The BodaGoEra team is reviewing your registration. You can finish your profile and pricing meanwhile — your team and
            insurance unlock the moment you are approved.
          </p>
        </div>
      </div>
    );
  }
  if (state === 'rejected') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 text-red-900 p-4">
        <XCircle size={20} className="shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold">Registration not approved</p>
          {registration?.rejection_reason && <p className="text-xs mt-0.5">Reason: {registration.rejection_reason}</p>}
          <p className="text-xs mt-0.5">Fix the details and submit again.</p>
          {action('Update and resubmit')}
        </div>
      </div>
    );
  }
  if (state === 'suspended') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 text-red-900 p-4">
        <Ban size={20} className="shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold">Business suspended</p>
          {registration?.rejection_reason && <p className="text-xs mt-0.5">Reason: {registration.rejection_reason}</p>}
          <p className="text-xs mt-0.5">Your team is offline. Contact the BodaGoEra team to be reinstated.</p>
        </div>
      </div>
    );
  }
  // Approved on trust before registration existed: nudge, never block.
  if (state === 'approved' && registration?.grandfathered && !registration.registration_number) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 p-4">
        <BadgeCheck size={20} className="shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold">Add your registration details</p>
          <p className="text-xs mt-0.5">
            Your business is active, but we have no registration number on file. Add it now to stay in good standing.
          </p>
          {action('Add registration details')}
        </div>
      </div>
    );
  }
  return null;
}
