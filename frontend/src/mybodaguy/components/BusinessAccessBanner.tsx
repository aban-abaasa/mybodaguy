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
  const box = (tone: 'amber' | 'sky' | 'red', icon: React.ReactNode, title: string, body?: string, action?: string) => {
    const tones = {
      amber: 'border-amber-200 bg-amber-50 text-amber-900',
      sky: 'border-sky-200 bg-sky-50 text-sky-900',
      red: 'border-red-200 bg-red-50 text-red-900',
    };
    return (
      <div className={`flex items-start gap-3 rounded-2xl border p-3.5 ${tones[tone]}`}>
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 text-sm">
          <p className="font-classic-display font-semibold">{title}</p>
          {body && <p className="mt-0.5 text-xs">{body}</p>}
          {action && (
            <button onClick={onOpenRegistration} className="mt-1.5 text-xs font-semibold underline underline-offset-2">
              {action}
            </button>
          )}
        </div>
      </div>
    );
  };

  if (state === 'incomplete') return box('amber', <ClipboardList size={18} />, 'Registration details needed', undefined, 'Add details');
  if (state === 'pending') return box('sky', <Clock size={18} />, 'Waiting for approval', 'Profile and pricing are open. Your team unlocks once approved.');
  if (state === 'rejected') {
    return box('red', <XCircle size={18} />, 'Not approved', registration?.rejection_reason ? `Reason: ${registration.rejection_reason}` : undefined, 'Update and resubmit');
  }
  if (state === 'suspended') {
    return box('red', <Ban size={18} />, 'Suspended', registration?.rejection_reason ? `Reason: ${registration.rejection_reason}` : 'Your team is offline.');
  }
  // Approved on trust before registration existed: nudge, never block.
  if (state === 'approved' && registration?.grandfathered && !registration.registration_number) {
    return box('amber', <BadgeCheck size={18} />, 'Add your registration details', 'No registration number on file yet.', 'Add details');
  }
  return null;
}
