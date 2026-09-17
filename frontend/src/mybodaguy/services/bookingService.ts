import { supabase } from './supabaseClient';

// Reads/writes the SHARED service-booking tables that digital-city-era
// ("Supermartkera") runs on this same Supabase project: public.supermarkets
// (offers_services), public.products (is_bookable), public.service_bookings,
// public.service_availability_rules, plus the fn_get_available_slots /
// fn_create_service_booking / fn_update_booking_status RPCs — see
// digital-city-era/backend/database/migrations/ADD_SERVICE_BOOKINGS.sql.
// These are plain Postgres functions in the shared project, so this is just
// a TypeScript port of digital-city-era's bookingService.js calling the
// same RPCs, tagged with origin_app: 'mybodaguy' where relevant.

export interface BookableBusiness {
  id: string;
  name: string;
  business_type: string;
  logo_url: string | null;
  city: string | null;
  address: string | null;
}

export type BookingType = 'slot' | 'ticket' | 'room';

export interface BookableService {
  id: string;
  name: string;
  description: string | null;
  selling_price: number | null;
  price: number | null;
  image_url: string | null;
  booking_type: BookingType;
}

export interface AvailableSlot {
  slot_start: string;
  slot_end: string;
  spots_left: number;
}

export const getBusinessesOfferingServices = async (): Promise<BookableBusiness[]> => {
  const { data, error } = await supabase
    .from('supermarkets')
    .select('id, name, business_type, logo_url, city, address')
    .eq('offers_services', true)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data || [];
};

export const getBookableServices = async (supermarketId: string): Promise<BookableService[]> => {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, description, selling_price, price, image_url, booking_type')
    .eq('supermarket_id', supermarketId)
    .eq('inventory_mode', 'service_item')
    .eq('is_bookable', true)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data || [];
};

export interface BookableServiceWithBusiness extends BookableService {
  supermarket_id: string;
  business: BookableBusiness;
}

// Every bookable service across every business that has opted in
// (offers_services=true), each carrying its own business's info — powers
// the cross-business search/marketplace "Book" screen, as opposed to
// getBookableServices() above which is scoped to one store. `!inner` forces
// the join so the supermarkets.* filters below actually apply server-side.
// Ported from digital-city-era's bookingService.js against the same shared
// tables so mybodaguy customers get the same search experience.
export const searchBookableServices = async (): Promise<BookableServiceWithBusiness[]> => {
  const { data, error } = await supabase
    .from('products')
    .select(
      'id, name, description, selling_price, price, image_url, supermarket_id, booking_type,' +
        ' supermarkets!inner(id, name, business_type, logo_url, city, address, offers_services, is_active)'
    )
    .eq('inventory_mode', 'service_item')
    .eq('is_bookable', true)
    .eq('is_active', true)
    .eq('supermarkets.offers_services', true)
    .eq('supermarkets.is_active', true)
    .order('name');
  if (error) throw error;
  return (data || []).map(({ supermarkets, ...svc }: any) => ({ ...svc, business: supermarkets }));
};

export const getAvailableSlots = async (productId: string, date: string): Promise<AvailableSlot[]> => {
  const { data, error } = await supabase.rpc('fn_get_available_slots', {
    p_product_id: productId,
    p_date: date,
  });
  if (error) throw error;
  return data || [];
};

// slotStart is only meaningful for a 'slot' product; quantity is the ticket
// count or room count for 'ticket'/'room' products (ignored — forced to 1 —
// server-side for 'slot'); checkoutDate is only meaningful for a 'room'
// product (a multi-night stay).
export const createBooking = async ({
  productId,
  bookingDate,
  slotStart,
  customerName,
  customerPhone,
  customerEmail,
  notes,
  quantity,
  checkoutDate,
}: {
  productId: string;
  bookingDate: string;
  slotStart?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
  quantity?: number;
  checkoutDate?: string;
}) => {
  const { data, error } = await supabase.rpc('fn_create_service_booking', {
    p_product_id: productId,
    p_booking_date: bookingDate,
    p_slot_start: slotStart || null,
    p_customer_name: customerName,
    p_customer_phone: customerPhone || null,
    p_customer_email: customerEmail || null,
    p_notes: notes || null,
    p_origin_app: 'mybodaguy',
    p_quantity: quantity || 1,
    p_checkout_date: checkoutDate || null,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Could not create booking');
  return data;
};

export const updateBookingStatus = async (bookingId: string, status: string) => {
  const { data, error } = await supabase.rpc('fn_update_booking_status', {
    p_booking_id: bookingId,
    p_new_status: status,
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Could not update booking');
  return data;
};

export const getMyBookings = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('service_bookings')
    .select('*, products(name, image_url, booking_type), supermarkets(name, logo_url, phone)')
    .eq('user_id', user.id)
    .order('booking_date', { ascending: false })
    .order('slot_start', { ascending: false });
  if (error) throw error;
  return data || [];
};
