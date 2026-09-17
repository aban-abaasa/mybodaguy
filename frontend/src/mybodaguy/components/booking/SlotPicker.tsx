import { useEffect, useMemo, useState } from 'react';
import { getAvailableSlots, AvailableSlot } from '../../services/bookingService';

const formatTime = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = ((hour + 11) % 12) + 1;
  return `${displayHour}:${m} ${suffix}`;
};

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

export interface SlotSelection {
  date: string;
  slotStart: string;
  slotEnd: string;
}

interface SlotPickerProps {
  productId: string;
  refreshKey: number;
  onSelect: (sel: SlotSelection) => void;
  selected: SlotSelection | null;
}

// Date strip + slot grid for one bookable product — computed live server-side
// via fn_get_available_slots, so bump refreshKey after a booking to refresh.
export default function SlotPicker({ productId, refreshKey, onSelect, selected }: SlotPickerProps) {
  const days = useMemo(() => nextNDays(14), []);
  const [selectedDate, setSelectedDate] = useState(toISODate(days[0]));
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId || !selectedDate) return;
    let active = true;
    setLoading(true);
    setError('');
    getAvailableSlots(productId, selectedDate)
      .then((data) => { if (active) setSlots(data); })
      .catch((err) => { if (active) setError(err.message || 'Could not load availability'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId, selectedDate, refreshKey]);

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

      {loading && <p className="text-sm text-gray-400 py-3">Loading available times…</p>}
      {error && <p className="text-sm text-red-500 py-3">{error}</p>}
      {!loading && !error && slots.length === 0 && <p className="text-sm text-gray-400 py-3">No open slots this day — try another date.</p>}

      {!loading && slots.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-2">
          {slots.map((s) => {
            const isSelected = selected?.date === selectedDate && selected?.slotStart === s.slot_start;
            return (
              <button
                key={s.slot_start}
                type="button"
                onClick={() => onSelect({ date: selectedDate, slotStart: s.slot_start, slotEnd: s.slot_end })}
                className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
                  isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-700 hover:border-blue-300'
                }`}
              >
                {formatTime(s.slot_start)}
                {s.spots_left > 1 && <span className="block text-[10px] opacity-75">{s.spots_left} left</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
