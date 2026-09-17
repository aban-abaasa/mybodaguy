import { useEffect, useState } from 'react';
import { getAvailableSlots } from '../../services/bookingService';

const toISODate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
};

export interface RoomSelection {
  checkin: string;
  checkout: string;
  quantity: number;
}

interface RoomPickerProps {
  productId: string;
  refreshKey: number;
  onSelect: (sel: RoomSelection | null) => void;
  selected: RoomSelection | null;
}

// Check-in / check-out date range + "how many rooms" stepper for a 'room'
// product. Availability across the whole stay is the MINIMUM of every
// night's spots_left (a stay is only bookable if every night it spans has
// enough rooms free) — fn_create_service_booking re-checks this
// server-side under a lock, this is just a live preview for the customer.
// Ported from digital-city-era's RoomPicker.jsx against the same shared RPCs.
export default function RoomPicker({ productId, refreshKey, onSelect, selected }: RoomPickerProps) {
  const today = toISODate(new Date());
  const [checkin, setCheckin] = useState(selected?.checkin || today);
  const [checkout, setCheckout] = useState(selected?.checkout || addDays(today, 1));
  const [minAvailable, setMinAvailable] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(selected?.quantity || 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const nights = Math.round((new Date(`${checkout}T00:00:00`).getTime() - new Date(`${checkin}T00:00:00`).getTime()) / 86400000);

  useEffect(() => {
    if (!productId || !checkin || !checkout || nights < 1) {
      setMinAvailable(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    Promise.all(
      Array.from({ length: nights }, (_, i) => getAvailableSlots(productId, addDays(checkin, i)))
    )
      .then((nightsData) => {
        if (!active) return;
        const min = Math.min(...nightsData.map((d) => d?.[0]?.spots_left ?? 0));
        setMinAvailable(min);
        setQuantity((q) => Math.max(1, Math.min(q, min || 1)));
      })
      .catch((err) => { if (active) setError(err.message || 'Could not load availability'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId, checkin, checkout, nights, refreshKey]);

  useEffect(() => {
    if (nights >= 1 && (minAvailable || 0) > 0) onSelect({ checkin, checkout, quantity });
    else onSelect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkin, checkout, quantity, minAvailable, nights]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Check-in</label>
          <input
            type="date"
            value={checkin}
            min={today}
            onChange={(e) => {
              const v = e.target.value;
              setCheckin(v);
              if (checkout <= v) setCheckout(addDays(v, 1));
            }}
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Check-out</label>
          <input
            type="date"
            value={checkout}
            min={addDays(checkin, 1)}
            onChange={(e) => setCheckout(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5"
          />
        </div>
      </div>

      {loading && <p className="text-sm text-gray-400">Checking availability…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!loading && !error && nights >= 1 && (
        (minAvailable || 0) > 0 ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {minAvailable} room{minAvailable === 1 ? '' : 's'} available for {nights} night{nights === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="h-7 w-7 rounded-lg border border-gray-300 text-gray-600">−</button>
              <span className="w-6 text-center text-sm font-medium">{quantity}</span>
              <button type="button" onClick={() => setQuantity((q) => Math.min(minAvailable || 1, q + 1))} className="h-7 w-7 rounded-lg border border-gray-300 text-gray-600">+</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No rooms free for that whole stay — try different dates.</p>
        )
      )}
    </div>
  );
}
