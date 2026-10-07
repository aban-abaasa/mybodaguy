import { useState } from 'react';
import { toast } from 'sonner';
import { riderCardService, type KinDetails } from '../services/riderCardService';

// Next of kin + home location of a rider. Printed on the back of their ID card and
// never shown on the public QR page. The rider fills it in for themselves; their
// district chairperson can fill it in for them.
export const kinFromRecord = (r: {
  next_of_kin_name?: string | null;
  next_of_kin_phone?: string | null;
  next_of_kin_relationship?: string | null;
  home_location?: string | null;
}): KinDetails => ({
  next_of_kin_name: r.next_of_kin_name ?? '',
  next_of_kin_phone: r.next_of_kin_phone ?? '',
  next_of_kin_relationship: r.next_of_kin_relationship ?? '',
  home_location: r.home_location ?? '',
});

const RELATIONSHIPS = ['Spouse', 'Parent', 'Child', 'Brother', 'Sister', 'Friend'];

export default function RiderKinForm({
  riderId,
  initial,
  idPrefix,
  onSaved,
  onCancel,
}: {
  riderId: string;
  initial: KinDetails;
  // Keeps element ids unique when several riders' forms are on one page.
  idPrefix: string;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<KinDetails>(initial);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof KinDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const nameOnly = !!form.next_of_kin_name.trim() !== !!form.next_of_kin_phone.trim();

  const save = async () => {
    if (nameOnly) {
      toast.error("Give both the next of kin's name and phone number, or leave both blank.");
      return;
    }
    setBusy(true);
    const result = await riderCardService.setKinDetails(riderId, form);
    setBusy(false);
    if (result.success) {
      toast.success('Saved. It is now on the back of the card.');
      onSaved();
    } else {
      toast.error(result.error || 'Could not save');
    }
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!busy) save(); }}
      className="space-y-3"
    >
      <div>
        <label htmlFor={`${idPrefix}-kin-name`} className="classic-label">Next of kin — full name</label>
        <input id={`${idPrefix}-kin-name`} className="classic-input" value={form.next_of_kin_name} maxLength={80} onChange={set('next_of_kin_name')} placeholder="Who should we call in an emergency?" autoComplete="off" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-kin-phone`} className="classic-label">Their phone</label>
          <input id={`${idPrefix}-kin-phone`} type="tel" inputMode="tel" className="classic-input" value={form.next_of_kin_phone} maxLength={24} onChange={set('next_of_kin_phone')} placeholder="+256 700 000000" autoComplete="off" />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-kin-rel`} className="classic-label">Relationship</label>
          <input id={`${idPrefix}-kin-rel`} className="classic-input" list={`${idPrefix}-kin-rel-list`} value={form.next_of_kin_relationship} maxLength={30} onChange={set('next_of_kin_relationship')} placeholder="e.g. Spouse" autoComplete="off" />
          <datalist id={`${idPrefix}-kin-rel-list`}>
            {RELATIONSHIPS.map((r) => <option key={r} value={r} />)}
          </datalist>
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-home`} className="classic-label">Home location</label>
        <input id={`${idPrefix}-home`} className="classic-input" value={form.home_location} maxLength={160} onChange={set('home_location')} placeholder="Village / zone, parish, landmark" autoComplete="off" />
        <p className="mt-1 text-[11px] text-slate-400">
          Printed on the back of the card. People who scan the QR code cannot see it.
        </p>
      </div>
      <div className="flex gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className="classic-btn classic-btn-outline !rounded-full">Cancel</button>
        )}
        <button type="submit" disabled={busy || nameOnly} className="classic-btn classic-btn-primary !rounded-full">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
