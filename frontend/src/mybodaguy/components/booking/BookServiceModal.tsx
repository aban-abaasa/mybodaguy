import { useState } from 'react';
import { X } from 'lucide-react';
import SlotPicker, { SlotSelection } from './SlotPicker';
import TicketPicker, { TicketSelection } from './TicketPicker';
import RoomPicker, { RoomSelection } from './RoomPicker';
import BookingChatCallPanel from './BookingChatCallPanel';
import { createBooking, BookableService } from '../../services/bookingService';

interface Identity {
  userId?: string | null;
  name?: string;
  email?: string;
  phone?: string;
}

interface BookServiceModalProps {
  service: BookableService;
  businessName?: string | null;
  identity: Identity;
  onClose: () => void;
}

type Selection = SlotSelection | TicketSelection | RoomSelection | null;

const confirmLabel = (bookingType: string, selected: Selection) => {
  if (!selected) return bookingType === 'room' ? 'Pick your dates' : bookingType === 'ticket' ? 'Pick a date' : 'Pick a time';
  if (bookingType === 'room') {
    const s = selected as RoomSelection;
    return `Book ${s.quantity} room${s.quantity > 1 ? 's' : ''}`;
  }
  if (bookingType === 'ticket') {
    const s = selected as TicketSelection;
    return `Book ${s.quantity} ticket${s.quantity > 1 ? 's' : ''}`;
  }
  return `Book ${(selected as SlotSelection).slotStart}`;
};

// Customer flow: pick a slot/date/date-range -> confirm contact details ->
// book -> land in a real chat thread (+ call buttons) with the store.
// `service.booking_type` ('slot' | 'ticket' | 'room') decides which picker
// is shown. Ported from digital-city-era's BookServiceModal.jsx against the
// same shared RPCs.
export default function BookServiceModal({ service, businessName, identity, onClose }: BookServiceModalProps) {
  const bookingType = service.booking_type || 'slot';
  const [selected, setSelected] = useState<Selection>(null);
  const [name, setName] = useState(identity?.name || '');
  const [phone, setPhone] = useState(identity?.phone || '');
  const [notes, setNotes] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  const handleConfirm = async () => {
    if (!selected || !name.trim()) {
      setError(`Pick ${bookingType === 'room' ? 'your dates' : 'a date'} and enter your name.`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const data = await createBooking({
        productId: service.id,
        bookingDate: bookingType === 'room' ? (selected as RoomSelection).checkin : (selected as SlotSelection | TicketSelection).date,
        slotStart: bookingType === 'slot' ? (selected as SlotSelection).slotStart : undefined,
        checkoutDate: bookingType === 'room' ? (selected as RoomSelection).checkout : undefined,
        quantity: bookingType === 'slot' ? 1 : (selected as TicketSelection | RoomSelection).quantity,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        customerEmail: identity?.email,
        notes: notes.trim(),
      });
      setResult(data);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setError(err.message || 'Could not complete that booking — availability may have just changed.');
      setRefreshKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div>
            <h3 className="font-semibold text-gray-800">{service.name}</h3>
            {businessName && <p className="text-xs text-gray-400">{businessName}</p>}
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {result?.success ? (
            <>
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
                {bookingType === 'room' ? (
                  <>Booked {result.booking.quantity} room{result.booking.quantity > 1 ? 's' : ''} from {result.booking.booking_date} to {result.booking.checkout_date}.</>
                ) : bookingType === 'ticket' ? (
                  <>Booked {result.booking.quantity} ticket{result.booking.quantity > 1 ? 's' : ''} for {result.booking.booking_date}.</>
                ) : (
                  <>Booked for {result.booking.booking_date} at {result.booking.slot_start}.</>
                )}{' '}
                The store has been notified — message or call them below if you need to.
              </div>
              <BookingChatCallPanel
                bookingId={result.booking.id}
                conversationId={result.conversationId}
                selfId={identity?.userId || null}
                selfName={name}
              />
            </>
          ) : (
            <>
              {bookingType === 'room' ? (
                <RoomPicker productId={service.id} refreshKey={refreshKey} onSelect={setSelected as (s: RoomSelection | null) => void} selected={selected as RoomSelection | null} />
              ) : bookingType === 'ticket' ? (
                <TicketPicker productId={service.id} refreshKey={refreshKey} onSelect={setSelected as (s: TicketSelection | null) => void} selected={selected as TicketSelection | null} />
              ) : (
                <SlotPicker productId={service.id} refreshKey={refreshKey} onSelect={setSelected as (s: SlotSelection) => void} selected={selected as SlotSelection | null} />
              )}

              <div className="space-y-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the store should know? (optional)" rows={2} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                type="button"
                onClick={handleConfirm}
                disabled={!selected || submitting}
                className="w-full rounded-lg bg-blue-600 text-white py-2.5 font-medium disabled:opacity-50"
              >
                {submitting ? 'Booking…' : confirmLabel(bookingType, selected)}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
