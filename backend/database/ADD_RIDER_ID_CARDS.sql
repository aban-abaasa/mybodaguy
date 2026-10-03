-- ============================================================================
-- RIDER ID CARDS — issued by the district chairperson, paid by the rider,
-- verified by QR
--
-- A QR ID card reaches a rider in one of two ways, and either way it is issued
-- instantly (no approval queue):
--
--   * the rider REQUESTS it from their own dashboard — mbg_request_rider_card —
--     and the card is auto-issued on the spot, or
--   * the district chairperson (the top of the hierarchy: district -> division
--     -> subcounty -> parish -> stage) ISSUES it to any ACTIVE rider in their
--     district — mbg_issue_rider_card.
--
-- Both create the card as 'pending_payment' and move no money, so nobody is
-- ever charged without agreeing to it. A card remembers whether the rider
-- asked for it (requested_by_rider / requested_at). Then:
--
--   PAY (the rider)  mbg_pay_rider_card(card_id)
--     the rider pays the card fee from their own ICAN wallet
--     (rider_card.fee_ican, default 2 ICAN) and the card turns 'active'.
--
-- The stage chairperson (and any chairperson above the stage) can open the
-- cards of the riders under them, read-only — including a card a rider has
-- just requested — through mbg_get_stage_rider_cards.
--
-- THE FEE IS SHARED THROUGH THE TREE. It is cut into 5 equal parts, one per
-- level of the rider's chain, and each part goes to the active chairperson(s)
-- of that level's region: the rider's stage, its parish, subcounty, division
-- and district. Several chairpersons on one level split that level's part
-- equally. A part with nobody to receive it (vacant seat, or a broken link in
-- the tree) is simply not credited to anyone, so it stays with ICANera — the
-- same convention ADD_CHAIN_COMMISSION_AND_COMMITTEE_SHARING.sql uses. Every
-- part is recorded in mbg_rider_card_shares (recipient NULL = kept by
-- ICANera), so the split is auditable.
--
-- EACH DIVISION AND EACH STAGE CAN CARRY ITS OWN INFORMATION on its riders'
-- cards: a short code, a contact (name + phone), one note line and an accent
-- colour (mbg_card_region_info, edited by the district chairperson through
-- mbg_set_card_region_info). A card shows the details of its rider's own
-- division and stage, read live, so a change reaches every card under it.
--
-- THE QR ALSO SHOWS WHERE THE RIDER STANDS: the status of their DRIVING PERMIT
-- (valid / expiring within 30 days / expired / not recorded — from the licence
-- expiry on their rider record, which the district chairperson can record with
-- mbg_set_rider_permit) and their FEES to the chairpersons, paid or pending:
-- the ID card fee, and any ride commission the rider still owes the hierarchy
-- (mbg_riders.cash_commission_debt_ugx). The permit number is masked.
--
-- The QR on the card opens /rider-card/<verify_code>. Scanning it calls
-- mbg_verify_rider_card, GRANT'd to anon, which answers LIVE: a suspended
-- rider stops verifying, an unpaid or cancelled card never verifies. Only
-- public-safe details come back — name, photo, vehicle, plate, the stage /
-- parish / subcounty / division / district chain, rating, and the division /
-- stage code, contact, note printed on the card, plus the permit and fee
-- status above. No rider phone, email, full licence number or wallet details.
--
-- The fee is developer-editable: mbg_platform_settings 'rider_card.fee_ican'.
--
-- A rider holds one live card per vehicle registration (a person can have
-- more than one mbg_riders row). An unpaid card can be cancelled by the
-- district chairperson; a paid card is final (its fee has been shared out).
--
-- Run after:
--   * ICAN/backend/CREATE_JOURNEY_ESCROW_FUNCTION.sql and
--     ICAN/backend/ADD_JOURNEY_FARE_EXPENSE_CLASSIFICATION.sql
--       (mbg_debit_journey_fare — the rider's wallet debit)
--   * ICAN/backend/ADD_RIDE_EARNING_CREDIT_FUNCTION.sql
--       (mbg_credit_ride_earning — the chairpersons' credits)
--   * ENFORCE_CHAIRPERSON_TREE_TRUTH.sql (mbg_region_parent)
-- Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Fee setting
-- ----------------------------------------------------------------------------
INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public)
VALUES (
  'rider_card.fee_ican', '2', 'number',
  'ICAN a rider pays for their QR ID card, shared equally across the 5 hierarchy levels of their chain (stage, parish, subcounty, division, district). Developer-editable.',
  'rider_card', true
)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.mbg_rider_card_seq START 1;

CREATE TABLE IF NOT EXISTS public.mbg_rider_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id        UUID NOT NULL REFERENCES public.mbg_riders(id) ON DELETE CASCADE,
  rider_user_id   UUID NOT NULL REFERENCES public.mbg_users(id)  ON DELETE CASCADE,
  issued_by       UUID REFERENCES public.mbg_users(id) ON DELETE SET NULL,
  district_id     UUID REFERENCES public.mbg_districts(id) ON DELETE SET NULL,
  card_number     TEXT NOT NULL UNIQUE,
  -- Unguessable; this is what the QR carries.
  verify_code     TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending_payment'
                    CHECK (status IN ('pending_payment', 'active', 'revoked')),
  fee_ican        NUMERIC(18, 8) NOT NULL CHECK (fee_ican > 0),
  paid_at         TIMESTAMPTZ,
  payment_tx_id   UUID,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live (unpaid or active) card per rider registration.
CREATE UNIQUE INDEX IF NOT EXISTS mbg_rider_cards_one_live_per_rider
  ON public.mbg_rider_cards (rider_id)
  WHERE status IN ('pending_payment', 'active');

-- Did the rider ask for this card themselves (auto-issued on request)?
-- NULL issued_by + requested_by_rider = issued by the system on the rider's request.
ALTER TABLE public.mbg_rider_cards
  ADD COLUMN IF NOT EXISTS requested_by_rider BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requested_at       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS mbg_rider_cards_rider_user_idx ON public.mbg_rider_cards (rider_user_id);
CREATE INDEX IF NOT EXISTS mbg_rider_cards_district_idx   ON public.mbg_rider_cards (district_id);

-- Where each part of a paid card fee went. recipient_user_id NULL = the level
-- had nobody to pay, so ICANera kept that part.
CREATE TABLE IF NOT EXISTS public.mbg_rider_card_shares (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id            UUID NOT NULL REFERENCES public.mbg_rider_cards(id) ON DELETE CASCADE,
  level              TEXT NOT NULL CHECK (level IN ('stage', 'parish', 'subcounty', 'division', 'district')),
  region_id          UUID,
  recipient_user_id  UUID REFERENCES public.mbg_users(id) ON DELETE SET NULL,
  amount_ican        NUMERIC(18, 8) NOT NULL CHECK (amount_ican >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mbg_rider_card_shares_card_idx      ON public.mbg_rider_card_shares (card_id);
CREATE INDEX IF NOT EXISTS mbg_rider_card_shares_recipient_idx ON public.mbg_rider_card_shares (recipient_user_id);

-- Card information that differs per DIVISION and per STAGE. Every rider card
-- shows the details of the division and the stage its rider belongs to, read
-- live, so editing a stage's contact or note updates every card under it.
-- The district chairperson maintains these (mbg_set_card_region_info).
CREATE TABLE IF NOT EXISTS public.mbg_card_region_info (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_type    TEXT NOT NULL CHECK (region_type IN ('division', 'stage')),
  region_id      UUID NOT NULL,
  -- Short code printed on the card, e.g. 'KWP' for a division or 'ST-04' for a stage.
  code           TEXT CHECK (code IS NULL OR char_length(code) <= 16),
  -- Who to call about this division / stage (office, stage chairperson, helpline).
  contact_name   TEXT CHECK (contact_name IS NULL OR char_length(contact_name) <= 60),
  contact_phone  TEXT CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 24),
  -- One extra line on the card, e.g. 'Report misconduct to the stage office'.
  notes          TEXT CHECK (notes IS NULL OR char_length(notes) <= 160),
  -- Card accent colour (#rrggbb); a stage's colour wins over its division's.
  accent_color   TEXT CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  updated_by     UUID REFERENCES public.mbg_users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (region_type, region_id)
);

-- ----------------------------------------------------------------------------
-- 3. RLS — all writes go through the SECURITY DEFINER functions below
-- ----------------------------------------------------------------------------
ALTER TABLE public.mbg_rider_cards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_rider_card_shares ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: this is read and written only through the functions below.
ALTER TABLE public.mbg_card_region_info  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_rider_cards_read_own    ON public.mbg_rider_cards;
DROP POLICY IF EXISTS mbg_rider_cards_read_issuer ON public.mbg_rider_cards;
CREATE POLICY mbg_rider_cards_read_own ON public.mbg_rider_cards
  FOR SELECT USING (rider_user_id = auth.uid());
CREATE POLICY mbg_rider_cards_read_issuer ON public.mbg_rider_cards
  FOR SELECT USING (issued_by = auth.uid());

DROP POLICY IF EXISTS mbg_rider_card_shares_read_own ON public.mbg_rider_card_shares;
CREATE POLICY mbg_rider_card_shares_read_own ON public.mbg_rider_card_shares
  FOR SELECT USING (recipient_user_id = auth.uid());

REVOKE ALL ON public.mbg_rider_cards       FROM anon;
REVOKE ALL ON public.mbg_rider_card_shares FROM anon;
-- Signed-in users may read their own rows (policies above) but never write directly.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.mbg_rider_cards       FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.mbg_rider_card_shares FROM authenticated;
REVOKE ALL ON public.mbg_card_region_info  FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Helpers (internal — not callable from the API)
-- ----------------------------------------------------------------------------

-- Districts where the caller is an active district chairperson.
CREATE OR REPLACE FUNCTION public.mbg_my_district_ids()
RETURNS UUID[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT cm.region_id), ARRAY[]::UUID[])
    FROM public.mbg_committee_members cm
   WHERE cm.user_id = auth.uid()
     AND cm.is_active = true
     AND cm.region_type::text = 'district';
$$;

-- The district a rider's stage sits in (NULL when the stage chain is broken).
CREATE OR REPLACE FUNCTION public.mbg_rider_district_id(p_rider_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dv.district_id
    FROM public.mbg_riders r
    JOIN public.mbg_stages     st ON st.id = r.stage_id
    JOIN public.mbg_parishes   pa ON pa.id = st.parish_id
    JOIN public.mbg_subcounties sc ON sc.id = pa.subcounty_id
    JOIN public.mbg_divisions  dv ON dv.id = sc.division_id
   WHERE r.id = p_rider_id;
$$;

-- Driving-permit status from its expiry date.
CREATE OR REPLACE FUNCTION public.mbg_permit_status(p_expiry DATE)
RETURNS TEXT
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_expiry IS NULL                    THEN 'not_recorded'
    WHEN p_expiry < current_date             THEN 'expired'
    WHEN p_expiry <= current_date + 30       THEN 'expiring_soon'
    ELSE 'valid'
  END;
$$;

-- Licence number with all but the last 3 characters hidden.
CREATE OR REPLACE FUNCTION public.mbg_mask_license(p_license TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN length(btrim(COALESCE(p_license, ''))) >= 5
      THEN repeat('•', length(btrim(p_license)) - 3) || right(btrim(p_license), 3)
    WHEN btrim(COALESCE(p_license, '')) <> '' THEN '•••'
  END;
$$;

-- Everything a card shows, for the issuer, the rider and the verifier.
CREATE OR REPLACE FUNCTION public.mbg_rider_card_payload(p_card_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'card_id',         c.id,
    'card_number',     c.card_number,
    'verify_code',     c.verify_code,
    'status',          c.status,
    'fee_ican',        c.fee_ican,
    'issued_at',       c.issued_at,
    'paid_at',         c.paid_at,
    'requested_by_rider', c.requested_by_rider,
    'requested_at',    c.requested_at,
    'rider_id',        r.id,
    'full_name',       COALESCE(NULLIF(btrim(up.full_name), ''), split_part(u.email, '@', 1)),
    'avatar_url',      up.avatar_url,
    'vehicle_type',    r.vehicle_type::text,
    'plate_number',    r.plate_number,
    'vehicle_model',   r.vehicle_model,
    'vehicle_color',   r.vehicle_color,
    'rider_status',    r.status::text,
    'rating',          r.rating,
    'completed_rides', r.completed_rides,
    'member_since',    r.created_at,
    'stage',           st.name,
    'parish',          pa.name,
    'subcounty',       sc.name,
    'division',        dv.name,
    'district',        di.name,
    -- Information that differs per division / stage (mbg_card_region_info)
    'division_code',          rd.code,
    'division_contact_name',  rd.contact_name,
    'division_contact_phone', rd.contact_phone,
    'division_notes',         rd.notes,
    'stage_code',             rs.code,
    'stage_contact_name',     rs.contact_name,
    'stage_contact_phone',    rs.contact_phone,
    'stage_notes',            rs.notes,
    'accent_color',           COALESCE(rs.accent_color, rd.accent_color),
    -- Driving permit (the number is masked; the full number never leaves here)
    'license_masked',     public.mbg_mask_license(r.license_number),
    'license_expiry',     r.license_expiry,
    'permit_status',      public.mbg_permit_status(r.license_expiry),
    'permit_days_left',   (r.license_expiry - current_date),
    -- Fees to the chairpersons: the card fee, and ride commission still owed
    -- (read through jsonb so this works before ADD_CASH_COMMISSION_DEBT_TRACKING.sql).
    'card_fee_status',    CASE c.status WHEN 'active' THEN 'paid'
                                        WHEN 'pending_payment' THEN 'pending'
                                        ELSE 'cancelled' END,
    'commission_owed_ugx', COALESCE((to_jsonb(r) ->> 'cash_commission_debt_ugx')::numeric, 0),
    'fees_status',        CASE WHEN c.status = 'pending_payment'
                                 OR COALESCE((to_jsonb(r) ->> 'cash_commission_debt_ugx')::numeric, 0) > 0
                               THEN 'pending' ELSE 'paid' END
  )
  FROM public.mbg_rider_cards c
  JOIN public.mbg_riders r  ON r.id = c.rider_id
  JOIN public.mbg_users  u  ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  LEFT JOIN public.mbg_stages      st ON st.id = r.stage_id
  LEFT JOIN public.mbg_parishes    pa ON pa.id = st.parish_id
  LEFT JOIN public.mbg_subcounties sc ON sc.id = pa.subcounty_id
  LEFT JOIN public.mbg_divisions   dv ON dv.id = sc.division_id
  LEFT JOIN public.mbg_districts   di ON di.id = dv.district_id
  LEFT JOIN public.mbg_card_region_info rs ON rs.region_type = 'stage'    AND rs.region_id = st.id
  LEFT JOIN public.mbg_card_region_info rd ON rd.region_type = 'division' AND rd.region_id = dv.id
  WHERE c.id = p_card_id;
$$;

REVOKE ALL ON FUNCTION public.mbg_my_district_ids()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_permit_status(DATE)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_mask_license(TEXT)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_rider_district_id(UUID)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mbg_rider_card_payload(UUID)   FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. The fee
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_get_rider_card_fee()
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.mbg_get_setting_numeric('rider_card.fee_ican', 2);
$$;

-- ----------------------------------------------------------------------------
-- 6. District chairperson: list every rider in my district(s) with card state
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_get_district_riders_for_cards()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_districts UUID[] := public.mbg_my_district_ids();
BEGIN
  IF cardinality(v_districts) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_json ORDER BY sort_district, sort_stage, sort_name)
    FROM (
      SELECT
        di.name AS sort_district,
        st.name AS sort_stage,
        COALESCE(NULLIF(btrim(up.full_name), ''), split_part(u.email, '@', 1)) AS sort_name,
        jsonb_build_object(
          'rider_id',     r.id,
          'full_name',    COALESCE(NULLIF(btrim(up.full_name), ''), split_part(u.email, '@', 1)),
          'avatar_url',   up.avatar_url,
          'vehicle_type', r.vehicle_type::text,
          'plate_number', r.plate_number,
          'rider_status', r.status::text,
          'stage',        st.name,
          'parish',       pa.name,
          'subcounty',    sc.name,
          'division',     dv.name,
          'district',     di.name,
          -- Chairperson-only: the full permit number, so it can be corrected.
          'license_number',  r.license_number,
          'license_expiry',  r.license_expiry,
          'permit_status',   public.mbg_permit_status(r.license_expiry),
          'permit_days_left', (r.license_expiry - current_date),
          'card',         CASE WHEN c.id IS NULL THEN NULL ELSE public.mbg_rider_card_payload(c.id) END
        ) AS row_json
      FROM public.mbg_riders r
      JOIN public.mbg_users      u  ON u.id  = r.user_id
      JOIN public.mbg_stages     st ON st.id = r.stage_id
      JOIN public.mbg_parishes   pa ON pa.id = st.parish_id
      JOIN public.mbg_subcounties sc ON sc.id = pa.subcounty_id
      JOIN public.mbg_divisions  dv ON dv.id = sc.division_id
      JOIN public.mbg_districts  di ON di.id = dv.district_id
      LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
      LEFT JOIN LATERAL (
        SELECT c1.id
          FROM public.mbg_rider_cards c1
         WHERE c1.rider_id = r.id AND c1.status IN ('pending_payment', 'active')
         ORDER BY c1.issued_at DESC
         LIMIT 1
      ) c ON true
      WHERE dv.district_id = ANY (v_districts)
    ) s
  ), '[]'::jsonb);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Issuing a card — shared by the district chairperson and by a rider's own
--    request, so both follow exactly the same rules. Internal (not callable
--    from the API): the callers below decide WHO may ask for it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_create_rider_card(
  p_rider_id  UUID,
  p_issued_by UUID,
  p_requested BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider       RECORD;
  v_district_id UUID;
  v_fee         NUMERIC;
  v_card_id     UUID;
BEGIN
  SELECT r.user_id, r.status::text AS status INTO v_rider
    FROM public.mbg_riders r WHERE r.id = p_rider_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rider not found');
  END IF;

  IF v_rider.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an active (approved) rider can get a card');
  END IF;

  v_district_id := public.mbg_rider_district_id(p_rider_id);
  IF v_district_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This rider''s stage is not linked to a district yet');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mbg_rider_cards c
     WHERE c.rider_id = p_rider_id AND c.status IN ('pending_payment', 'active')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This rider already has a card');
  END IF;

  v_fee := public.mbg_get_rider_card_fee();
  IF v_fee IS NULL OR v_fee <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The card fee is not configured');
  END IF;

  INSERT INTO public.mbg_rider_cards (
    rider_id, rider_user_id, issued_by, district_id, card_number, verify_code, fee_ican,
    requested_by_rider, requested_at
  ) VALUES (
    p_rider_id, v_rider.user_id, p_issued_by, v_district_id,
    'BGE-' || lpad(nextval('public.mbg_rider_card_seq')::text, 6, '0'),
    replace(gen_random_uuid()::text, '-', ''),
    v_fee,
    p_requested, CASE WHEN p_requested THEN now() END
  )
  RETURNING id INTO v_card_id;

  RETURN jsonb_build_object('success', true, 'card', public.mbg_rider_card_payload(v_card_id));
EXCEPTION
  -- Two requests at the same moment: the unique index lets one win.
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'This rider already has a card');
END;
$$;

REVOKE ALL ON FUNCTION public.mbg_create_rider_card(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- District chairperson: issue a card to a rider in their district.
CREATE OR REPLACE FUNCTION public.mbg_issue_rider_card(p_rider_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_districts   UUID[] := public.mbg_my_district_ids();
  v_district_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in');
  END IF;
  IF cardinality(v_districts) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a district chairperson can issue rider cards');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mbg_riders r WHERE r.id = p_rider_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rider not found');
  END IF;

  v_district_id := public.mbg_rider_district_id(p_rider_id);
  IF v_district_id IS NULL OR NOT (v_district_id = ANY (v_districts)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This rider is not in your district');
  END IF;

  RETURN public.mbg_create_rider_card(p_rider_id, auth.uid(), false);
END;
$$;

-- Rider: request my own card. It is auto-issued on the spot — no approval step —
-- as 'pending_payment'; the rider then pays to activate it.
CREATE OR REPLACE FUNCTION public.mbg_request_rider_card(p_rider_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in');
  END IF;
  -- Only ever for one of the caller's OWN rider registrations.
  IF NOT EXISTS (SELECT 1 FROM public.mbg_riders r WHERE r.id = p_rider_id AND r.user_id = auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rider not found');
  END IF;

  RETURN public.mbg_create_rider_card(p_rider_id, NULL, true);
END;
$$;

-- Rider: my registrations that could request a card right now (active, in a
-- district, no live card yet).
CREATE OR REPLACE FUNCTION public.mbg_get_my_card_requestable()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'rider_id',     r.id,
           'plate_number', r.plate_number,
           'vehicle_type', r.vehicle_type::text,
           'stage',        st.name
         ) ORDER BY r.created_at), '[]'::jsonb)
    FROM public.mbg_riders r
    LEFT JOIN public.mbg_stages st ON st.id = r.stage_id
   WHERE r.user_id = auth.uid()
     AND r.status::text = 'active'
     AND public.mbg_rider_district_id(r.id) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.mbg_rider_cards c
        WHERE c.rider_id = r.id AND c.status IN ('pending_payment', 'active')
     );
$$;

-- ----------------------------------------------------------------------------
-- 7b. Stage chairperson: open the cards of the riders under them (read-only)
-- ----------------------------------------------------------------------------

-- Is the caller an active chairperson of this stage, or of any region above it?
CREATE OR REPLACE FUNCTION public.mbg_chair_over_stage(p_stage_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_levels CONSTANT TEXT[] := ARRAY['stage', 'parish', 'subcounty', 'division', 'district'];
  v_rid    UUID := p_stage_id;
  i        INT;
BEGIN
  IF auth.uid() IS NULL OR p_stage_id IS NULL THEN
    RETURN false;
  END IF;
  FOR i IN 1 .. cardinality(v_levels) LOOP
    IF i > 1 THEN
      SELECT rp.parent_id INTO v_rid FROM public.mbg_region_parent(v_levels[i - 1], v_rid) rp;
    END IF;
    EXIT WHEN v_rid IS NULL;
    IF EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
       WHERE cm.user_id = auth.uid() AND cm.is_active = true
         AND cm.region_type::text = v_levels[i] AND cm.region_id = v_rid
    ) THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.mbg_chair_over_stage(UUID) FROM PUBLIC, anon, authenticated;

-- Every live card (unpaid or active) of the riders in a stage — including a card
-- a rider has just requested. Empty for anyone who is not a chairperson over it.
CREATE OR REPLACE FUNCTION public.mbg_get_stage_rider_cards(p_stage_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.mbg_chair_over_stage(p_stage_id) THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(public.mbg_rider_card_payload(c.id) ORDER BY c.issued_at DESC)
      FROM public.mbg_rider_cards c
      JOIN public.mbg_riders r ON r.id = c.rider_id
     WHERE r.stage_id = p_stage_id
       AND c.status IN ('pending_payment', 'active')
  ), '[]'::jsonb);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. District chairperson: cancel a card the rider has not paid for yet
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_cancel_rider_card(p_card_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_districts UUID[] := public.mbg_my_district_ids();
  v_card      public.mbg_rider_cards%ROWTYPE;
BEGIN
  IF cardinality(v_districts) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a district chairperson can cancel rider cards');
  END IF;

  SELECT * INTO v_card FROM public.mbg_rider_cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Card not found');
  END IF;
  IF v_card.district_id IS NULL OR NOT (v_card.district_id = ANY (v_districts)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This card is not from your district');
  END IF;
  IF v_card.status <> 'pending_payment' THEN
    RETURN jsonb_build_object('success', false, 'error',
      CASE v_card.status WHEN 'active' THEN 'A paid card cannot be cancelled' ELSE 'This card is already cancelled' END);
  END IF;

  UPDATE public.mbg_rider_cards SET status = 'revoked', updated_at = now() WHERE id = p_card_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8b. District chairperson: the information each division and stage puts on
--     its riders' cards
-- ----------------------------------------------------------------------------

-- Every division and stage in my district(s), each with its current card info.
CREATE OR REPLACE FUNCTION public.mbg_get_card_region_info()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_districts UUID[] := public.mbg_my_district_ids();
BEGIN
  IF cardinality(v_districts) = 0 THEN
    RETURN jsonb_build_object('divisions', '[]'::jsonb, 'stages', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'divisions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'region_id',     dv.id,
               'name',          dv.name,
               'code',          i.code,
               'contact_name',  i.contact_name,
               'contact_phone', i.contact_phone,
               'notes',         i.notes,
               'accent_color',  i.accent_color
             ) ORDER BY dv.name)
        FROM public.mbg_divisions dv
        LEFT JOIN public.mbg_card_region_info i ON i.region_type = 'division' AND i.region_id = dv.id
       WHERE dv.district_id = ANY (v_districts)
    ), '[]'::jsonb),
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'region_id',     st.id,
               'name',          st.name,
               'parish',        pa.name,
               'division',      dv.name,
               'code',          i.code,
               'contact_name',  i.contact_name,
               'contact_phone', i.contact_phone,
               'notes',         i.notes,
               'accent_color',  i.accent_color
             ) ORDER BY dv.name, st.name)
        FROM public.mbg_stages st
        JOIN public.mbg_parishes    pa ON pa.id = st.parish_id
        JOIN public.mbg_subcounties sc ON sc.id = pa.subcounty_id
        JOIN public.mbg_divisions   dv ON dv.id = sc.division_id
        LEFT JOIN public.mbg_card_region_info i ON i.region_type = 'stage' AND i.region_id = st.id
       WHERE dv.district_id = ANY (v_districts)
    ), '[]'::jsonb)
  );
END;
$$;

-- Set (or clear) the card info of one division or stage in my district(s).
-- Blank fields are stored as NULL; a row with nothing left in it is removed.
CREATE OR REPLACE FUNCTION public.mbg_set_card_region_info(
  p_region_type   TEXT,
  p_region_id     UUID,
  p_code          TEXT DEFAULT NULL,
  p_contact_name  TEXT DEFAULT NULL,
  p_contact_phone TEXT DEFAULT NULL,
  p_notes         TEXT DEFAULT NULL,
  p_accent_color  TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_districts UUID[] := public.mbg_my_district_ids();
  v_in_district BOOLEAN;
  v_code    TEXT := NULLIF(btrim(p_code), '');
  v_name    TEXT := NULLIF(btrim(p_contact_name), '');
  v_phone   TEXT := NULLIF(btrim(p_contact_phone), '');
  v_notes   TEXT := NULLIF(btrim(p_notes), '');
  v_accent  TEXT := NULLIF(btrim(p_accent_color), '');
BEGIN
  IF cardinality(v_districts) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a district chairperson can edit card information');
  END IF;
  IF p_region_type NOT IN ('division', 'stage') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Card information is set per division or per stage');
  END IF;

  IF p_region_type = 'division' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.mbg_divisions dv
       WHERE dv.id = p_region_id AND dv.district_id = ANY (v_districts)
    ) INTO v_in_district;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.mbg_stages st
        JOIN public.mbg_parishes    pa ON pa.id = st.parish_id
        JOIN public.mbg_subcounties sc ON sc.id = pa.subcounty_id
        JOIN public.mbg_divisions   dv ON dv.id = sc.division_id
       WHERE st.id = p_region_id AND dv.district_id = ANY (v_districts)
    ) INTO v_in_district;
  END IF;
  IF NOT v_in_district THEN
    RETURN jsonb_build_object('success', false, 'error', 'That ' || p_region_type || ' is not in your district');
  END IF;

  IF v_code IS NOT NULL AND char_length(v_code) > 16 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The code can be at most 16 characters');
  END IF;
  IF v_name IS NOT NULL AND char_length(v_name) > 60 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The contact name can be at most 60 characters');
  END IF;
  IF v_phone IS NOT NULL AND (char_length(v_phone) > 24 OR v_phone !~ '^[0-9+()\s-]+$') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid contact phone number');
  END IF;
  IF v_notes IS NOT NULL AND char_length(v_notes) > 160 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The note can be at most 160 characters');
  END IF;
  IF v_accent IS NOT NULL AND v_accent !~ '^#[0-9a-fA-F]{6}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'The colour must look like #c4a052');
  END IF;

  IF v_code IS NULL AND v_name IS NULL AND v_phone IS NULL AND v_notes IS NULL AND v_accent IS NULL THEN
    DELETE FROM public.mbg_card_region_info WHERE region_type = p_region_type AND region_id = p_region_id;
    RETURN jsonb_build_object('success', true, 'cleared', true);
  END IF;

  INSERT INTO public.mbg_card_region_info
    (region_type, region_id, code, contact_name, contact_phone, notes, accent_color, updated_by, updated_at)
  VALUES
    (p_region_type, p_region_id, v_code, v_name, v_phone, v_notes, v_accent, auth.uid(), now())
  ON CONFLICT (region_type, region_id) DO UPDATE SET
    code = EXCLUDED.code,
    contact_name = EXCLUDED.contact_name,
    contact_phone = EXCLUDED.contact_phone,
    notes = EXCLUDED.notes,
    accent_color = EXCLUDED.accent_color,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8c. District chairperson: record a rider's driving permit
--     (the number and expiry the QR's permit status is worked out from)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_set_rider_permit(
  p_rider_id       UUID,
  p_license_number TEXT DEFAULT NULL,
  p_license_expiry DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_districts   UUID[] := public.mbg_my_district_ids();
  v_district_id UUID;
  v_number      TEXT := NULLIF(btrim(p_license_number), '');
BEGIN
  IF cardinality(v_districts) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a district chairperson can record a driving permit');
  END IF;

  v_district_id := public.mbg_rider_district_id(p_rider_id);
  IF v_district_id IS NULL OR NOT (v_district_id = ANY (v_districts)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This rider is not in your district');
  END IF;

  IF v_number IS NOT NULL AND char_length(v_number) > 40 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The permit number can be at most 40 characters');
  END IF;
  -- Expired permits are real data, so the past is fine; only absurd dates are refused.
  IF p_license_expiry IS NOT NULL
     AND (p_license_expiry < DATE '2000-01-01' OR p_license_expiry > current_date + 3660) THEN
    RETURN jsonb_build_object('success', false, 'error', 'That expiry date does not look right');
  END IF;

  -- A blank number keeps the one on file (it is required on every rider record);
  -- a blank expiry clears the expiry, which makes the permit "not recorded".
  UPDATE public.mbg_riders
     SET license_number = COALESCE(v_number, license_number),
         license_expiry = p_license_expiry,
         updated_at = now()
   WHERE id = p_rider_id;

  RETURN jsonb_build_object(
    'success', true,
    'permit_status', public.mbg_permit_status(p_license_expiry)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. Rider: my live cards
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_get_my_rider_cards()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    jsonb_agg(public.mbg_rider_card_payload(c.id) ORDER BY c.issued_at DESC),
    '[]'::jsonb
  )
  FROM public.mbg_rider_cards c
  WHERE c.rider_user_id = auth.uid()
    AND c.status IN ('pending_payment', 'active');
$$;

-- ----------------------------------------------------------------------------
-- 10. Rider: pay the fee — debit the rider, share it up the tree, activate
--
-- One transaction: if anything after the debit raises, the debit rolls back
-- with it. A declined debit (insufficient ICAN, no wallet) is returned as an
-- error with nothing changed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_pay_rider_card(p_card_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_levels  CONSTANT TEXT[] := ARRAY['stage', 'parish', 'subcounty', 'division', 'district'];
  v_card    public.mbg_rider_cards%ROWTYPE;
  v_status  TEXT;
  v_debit   JSONB;
  v_part    NUMERIC;
  v_rid     UUID;
  v_users   UUID[];
  v_user    UUID;
  v_each    NUMERIC;
  v_ref     TEXT;
  i         INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in');
  END IF;

  SELECT * INTO v_card FROM public.mbg_rider_cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND OR v_card.rider_user_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Card not found');
  END IF;
  IF v_card.status = 'active' THEN
    RETURN jsonb_build_object('success', true, 'already_paid', true,
                              'card', public.mbg_rider_card_payload(v_card.id));
  END IF;
  IF v_card.status <> 'pending_payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This card was cancelled');
  END IF;

  SELECT r.status::text INTO v_status FROM public.mbg_riders r WHERE r.id = v_card.rider_id;
  IF v_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your rider account is not active, so this card cannot be paid for');
  END IF;

  v_ref := 'rider_card:' || v_card.id::text;
  v_debit := public.mbg_debit_journey_fare(auth.uid(), v_card.fee_ican, 'mybodaguy', v_ref);
  IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
    RETURN jsonb_build_object('success', false,
                              'error', COALESCE(v_debit ->> 'error', 'Wallet payment failed'));
  END IF;

  -- Share the fee: one equal part per level of the rider's chain.
  v_part := v_card.fee_ican / cardinality(v_levels);

  FOR i IN 1 .. cardinality(v_levels) LOOP
    IF i = 1 THEN
      SELECT r.stage_id INTO v_rid FROM public.mbg_riders r WHERE r.id = v_card.rider_id;
    ELSE
      SELECT rp.parent_id INTO v_rid FROM public.mbg_region_parent(v_levels[i - 1], v_rid) rp;
    END IF;

    v_users := NULL;
    IF v_rid IS NOT NULL THEN
      SELECT array_agg(DISTINCT cm.user_id) INTO v_users
        FROM public.mbg_committee_members cm
       WHERE cm.region_type::text = v_levels[i]
         AND cm.region_id = v_rid
         AND cm.is_active = true;
    END IF;

    IF v_users IS NULL THEN
      -- Nobody holds this level: ICANera keeps its part (recorded, not credited).
      INSERT INTO public.mbg_rider_card_shares (card_id, level, region_id, recipient_user_id, amount_ican)
      VALUES (v_card.id, v_levels[i], v_rid, NULL, v_part);
      CONTINUE;
    END IF;

    v_each := ROUND(v_part / cardinality(v_users), 8);
    FOREACH v_user IN ARRAY v_users LOOP
      IF v_each > 0 THEN
        PERFORM public.mbg_credit_ride_earning(
          v_user, v_each, 'mybodaguy', v_ref,
          v_levels[i] || ' chairperson share of a rider ID card fee'
        );
      END IF;
      INSERT INTO public.mbg_rider_card_shares (card_id, level, region_id, recipient_user_id, amount_ican)
      VALUES (v_card.id, v_levels[i], v_rid, v_user, v_each);
    END LOOP;
  END LOOP;

  UPDATE public.mbg_rider_cards
     SET status = 'active',
         paid_at = now(),
         payment_tx_id = NULLIF(v_debit ->> 'tx_id', '')::UUID,
         updated_at = now()
   WHERE id = v_card.id;

  RETURN jsonb_build_object('success', true, 'card', public.mbg_rider_card_payload(v_card.id));
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. Public QR check — answered live, public-safe details only
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_verify_rider_card(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id      UUID;
  v_card    JSONB;
  v_state   TEXT;
BEGIN
  IF p_code IS NULL OR length(p_code) < 16 OR length(p_code) > 64 OR p_code !~ '^[A-Za-z0-9]+$' THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  SELECT c.id INTO v_id FROM public.mbg_rider_cards c WHERE c.verify_code = p_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  v_card := public.mbg_rider_card_payload(v_id);

  v_state := CASE
    WHEN v_card ->> 'status' = 'revoked'         THEN 'cancelled'
    WHEN v_card ->> 'status' = 'pending_payment' THEN 'unpaid'
    WHEN v_card ->> 'rider_status' <> 'active'   THEN 'suspended'
    ELSE 'valid'
  END;

  -- An unpaid or cancelled card is not a card: say so, and nothing about the rider.
  IF v_state IN ('unpaid', 'cancelled') THEN
    RETURN jsonb_build_object('is_valid', false, 'state', v_state, 'card_number', v_card ->> 'card_number');
  END IF;

  RETURN jsonb_build_object(
    'is_valid',        v_state = 'valid',
    'state',           v_state,
    'card_number',     v_card ->> 'card_number',
    'full_name',       v_card ->> 'full_name',
    'avatar_url',      v_card ->> 'avatar_url',
    'vehicle_type',    v_card ->> 'vehicle_type',
    'vehicle_model',   v_card ->> 'vehicle_model',
    'vehicle_color',   v_card ->> 'vehicle_color',
    'plate_number',    v_card ->> 'plate_number',
    'rating',          v_card -> 'rating',
    'completed_rides', v_card -> 'completed_rides',
    'member_since',    v_card ->> 'member_since',
    'issued_at',       v_card ->> 'issued_at',
    'stage',           v_card ->> 'stage',
    'parish',          v_card ->> 'parish',
    'subcounty',       v_card ->> 'subcounty',
    'division',        v_card ->> 'division',
    'district',        v_card ->> 'district',
    'division_code',          v_card ->> 'division_code',
    'division_contact_name',  v_card ->> 'division_contact_name',
    'division_contact_phone', v_card ->> 'division_contact_phone',
    'division_notes',         v_card ->> 'division_notes',
    'stage_code',             v_card ->> 'stage_code',
    'stage_contact_name',     v_card ->> 'stage_contact_name',
    'stage_contact_phone',    v_card ->> 'stage_contact_phone',
    'stage_notes',            v_card ->> 'stage_notes',
    'accent_color',           v_card ->> 'accent_color',
    'license_masked',         v_card ->> 'license_masked',
    'license_expiry',         v_card ->> 'license_expiry',
    'permit_status',          v_card ->> 'permit_status',
    'permit_days_left',       v_card -> 'permit_days_left',
    'fees', jsonb_build_object(
      'status',              v_card ->> 'fees_status',
      'card_fee_ican',       v_card -> 'fee_ican',
      'card_fee_status',     v_card ->> 'card_fee_status',
      'card_fee_paid_at',    v_card ->> 'paid_at',
      'commission_owed_ugx', v_card -> 'commission_owed_ugx'
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.mbg_get_rider_card_fee()              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_get_district_riders_for_cards()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_issue_rider_card(UUID)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_request_rider_card(UUID)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_get_my_card_requestable()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_get_stage_rider_cards(UUID)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_cancel_rider_card(UUID)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_get_card_region_info()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_set_rider_permit(UUID, TEXT, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_set_card_region_info(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_get_my_rider_cards()              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_pay_rider_card(UUID)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mbg_verify_rider_card(TEXT)           FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mbg_get_rider_card_fee()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_get_district_riders_for_cards()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_issue_rider_card(UUID)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_request_rider_card(UUID)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_get_my_card_requestable()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_get_stage_rider_cards(UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_cancel_rider_card(UUID)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_get_card_region_info()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_set_rider_permit(UUID, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_set_card_region_info(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_get_my_rider_cards()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_pay_rider_card(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_verify_rider_card(TEXT)           TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Rider ID cards ready: a rider requests one (auto-issued) or the district chairperson issues it; the rider pays rider_card.fee_ican (default 2 ICAN), shared equally across the stage / parish / subcounty / division / district chairpersons, who can open the cards read-only. QR opens /rider-card/<code>.';
END $$;
