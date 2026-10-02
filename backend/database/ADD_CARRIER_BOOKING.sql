-- ============================================================================
-- CARRIER BOOKINGS FOR SHIP CARGO
-- Run after ADD_SHIP_CARGO_JOURNEY.sql (safe to re-run). Then re-run
-- ADD_SHIP_TICKET_VERIFICATION.sql so the QR check reports these fields.
--
-- The sea leg of a paid cargo journey can be booked with a shipping line (see
-- frontend/api/_lib/carriers and POST /api/journeys/carrier-booking). The carrier's
-- reference is stored on the leg and shown on the waybill and its QR page.
-- ============================================================================

-- Shipping lines identify ports by UN/LOCODE, not by name.
ALTER TABLE public.mbg_ports ADD COLUMN IF NOT EXISTS un_locode TEXT;

UPDATE public.mbg_ports SET un_locode = v.code
FROM (VALUES
  ('Canada', 'Halifax', 'CAHAL'),
  ('Ghana', 'Tema', 'GHTEM'),
  ('Kenya', 'Mombasa', 'KEMBA'),
  ('Nigeria', 'Lagos', 'NGLOS'),
  ('South Africa', 'Durban', 'ZADUR'),
  ('Tanzania', 'Dar es Salaam', 'TZDAR'),
  ('United Arab Emirates', 'Dubai', 'AEJEA'),
  ('United Kingdom', 'Felixstowe', 'GBFXT'),
  ('United States', 'New York', 'USNYC')
) AS v(country, city, code)
WHERE public.mbg_ports.country = v.country AND public.mbg_ports.city = v.city AND public.mbg_ports.un_locode IS NULL;

ALTER TABLE public.mbg_journey_legs
  ADD COLUMN IF NOT EXISTS carrier_provider       TEXT,         -- 'maersk' | 'mock'
  ADD COLUMN IF NOT EXISTS carrier_booking_ref    TEXT,         -- the carrier's booking reference
  ADD COLUMN IF NOT EXISTS carrier_booking_status TEXT,         -- requesting | unconfirmed | failed | the carrier's own status (RECEIVED, CONFIRMED…)
  ADD COLUMN IF NOT EXISTS carrier_booked_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS carrier_booking_error  TEXT;

-- One booking reference per carrier, so a reference cannot be attached to two legs.
CREATE UNIQUE INDEX IF NOT EXISTS mbg_journey_legs_carrier_ref_idx
  ON public.mbg_journey_legs (carrier_provider, carrier_booking_ref) WHERE carrier_booking_ref IS NOT NULL;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Ports have UN/LOCODEs and ship legs can hold a carrier booking (provider, reference, status).';
END $$;
