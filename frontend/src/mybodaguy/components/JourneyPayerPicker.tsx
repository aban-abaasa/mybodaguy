import type { ReactNode } from 'react';
import { Building2, User } from 'lucide-react';
import { formatIcan } from '../services/flightOffers';
import type { CompanyJourneyBenefit } from '../services/journeyService';

export type JourneyPayer = 'personal' | 'company';

interface JourneyPayerPickerProps {
  benefit: CompanyJourneyBenefit;
  value: JourneyPayer;
  onChange: (payer: JourneyPayer) => void;
  disabled?: boolean;
}

/**
 * "Who pays for this journey": the customer's own wallet, or the company that has
 * allowed them to pay for journeys. Shown only to people who have that permission
 * (ADD_JOURNEY_COMPANY_PAYMENT.sql), the same way a normal ride only offers the
 * Company payment tile to an employee with a company transport allocation.
 */
export default function JourneyPayerPicker({ benefit, value, onChange, disabled }: JourneyPayerPickerProps) {
  if (!benefit.eligible) return null;
  const company = benefit.businessName || 'Your company';
  const tile = (payer: JourneyPayer, label: string, icon: ReactNode) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={value === payer}
      onClick={() => onChange(payer)}
      className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border-2 px-2 py-2 text-sm font-semibold transition-all disabled:opacity-60 ${
        value === payer ? 'border-[#c4a052] bg-[#fbf3dc] text-[#7a5c18]' : 'border-slate-200 text-slate-500'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <div className="space-y-2">
      <span className="classic-label">Who pays for this journey</span>
      <div className="grid grid-cols-2 gap-2">
        {tile('personal', 'Personal', <User size={16} />)}
        {tile('company', company, <Building2 size={16} />)}
      </div>
      {value === 'company' ? (
        <p className="text-xs leading-relaxed text-slate-500">
          Paid by {company} from its business wallet, in full when you confirm. Nothing comes out of your own wallet.
          {benefit.limitIcan ? ` Your company allows up to ${formatIcan(benefit.limitIcan)} ICAN for one journey.` : ''}
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-slate-500">Paid from your own ICAN wallet.</p>
      )}
    </div>
  );
}
