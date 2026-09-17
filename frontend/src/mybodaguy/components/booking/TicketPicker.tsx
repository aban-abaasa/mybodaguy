import { useEffect, useMemo, useState } from 'react';
import { getAvailableSlots } from '../../services/bookingService';

const nextNDays = (n: number) => {
  const days: Date[] = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
};

const toISODate = (d: Date) => d.toISOString().slice(0, 10);

export interface TicketSelection {
  date: string;
  quantity: number;
}

interface TicketPickerProps {
  productId: string;
  refreshKey: number;
  onSelect: (sel: TicketSelection | null) => void;
  selected: TicketSelection | null;
}

// Date strip + "how many" stepper for a 'ticket' product — no time-of-day,
// just a date and a quantity, bounded by that date's remaining pool
// (fn_get_available_slots returns exactly one whole-day pseudo-slot for
// ticket products, so spots_left there IS "tickets left today"). Ported
// from digital-city-era's TicketPicker.jsx against the same shared RPCs.
export default function TicketPicker({ productId, refreshKey, onSelect, selected }: TicketPickerProps) {
  const days = useMemo(() => nextNDays(14), []);
  const [selectedDate, setSelectedDate] = useState(selected?.date || toISODate(days[0]));
  const [spotsLeft, setSpotsLeft] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(selected?.quantity || 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId || !selectedDate) return;
    let active = true;
    setLoading(true);
    setError('');
    getAvailableSlots(productId, selectedDate)
      .then((data) => {
        if (!active) return;
        const left = data?.[0]?.spots_left ?? 0;
        setSpotsLeft(left);
        setQuantity((q) => Math.max(1, Math.min(q, left || 1)));
      })
      .catch((err) => { if (active) setError(err.message || 'Could not load availability'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId, selectedDate, refreshKey]);

  useEffect(() => {
    if ((spotsLeft || 0) > 0) onSelect({ date: selectedDate, quantity });
    else onSelect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, quantity, spotsLeft]);

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {days.map((d) => {
          const iso = toISODate(d);
          const isSelected = iso === selectedDate;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => setSelectedDate(iso)}
              className={`flex-shrink-0 flex flex-col items-center rounded-lg border px-3 py-2 text-xs transition ${
                isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:border-blue-300'
              }`}
            >
              <span>{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="font-semibold">{d.getDate()}</span>
            </button>
          );
        })}
      </div>

      {loading && <p className="text-sm text-gray-400 py-3">Checking availability…</p>}
      {error && <p className="text-sm text-red-500 py-3">{error}</p>}
      {!loading && !error && (
        (spotsLeft || 0) > 0 ? (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-gray-500">{spotsLeft} ticket{spotsLeft === 1 ? '' : 's'} left for this date</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="h-7 w-7 rounded-lg border border-gray-300 text-gray-600">−</button>
              <span className="w-6 text-center text-sm font-medium">{quantity}</span>
              <button type="button" onClick={() => setQuantity((q) => Math.min(spotsLeft || 1, q + 1))} className="h-7 w-7 rounded-lg border border-gray-300 text-gray-600">+</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400 py-3">Sold out this day — try another date.</p>
        )
      )}
    </div>
  );
}
