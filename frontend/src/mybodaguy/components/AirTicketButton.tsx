import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { getAirTicket } from '../services/journeyService';
import { downloadAirTicketPdf } from '../services/airTicketPdf';

/**
 * Downloads the customer's air ticket as a PDF. The ticket is read from the
 * saved booking (not from what's on screen), so it works any time — right after
 * booking, after a reload, or weeks later from the customer page.
 */
export default function AirTicketButton({ journeyId, className, label = 'Download air ticket' }: { journeyId: string; className?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadAirTicketPdf(await getAirTicket(journeyId));
    } catch (err: any) {
      setError(err?.message || 'Could not download your ticket — please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <button type="button" onClick={download} disabled={busy} className={className}>
        {busy ? <Loader2 className="animate-spin" size={15} /> : <Download size={15} />}
        {busy ? 'Preparing ticket…' : label}
      </button>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
