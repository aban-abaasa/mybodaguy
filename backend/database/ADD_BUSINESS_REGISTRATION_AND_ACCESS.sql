-- ============================================================================
-- Registered-business requirement + developer-panel approval for
-- Transport Company / Security Escort businesses, plus the RPCs behind the
-- upgraded "Manage Your Business" pages (overview, profile, contact details).
-- ============================================================================
-- Run ONCE in the shared Supabase SQL Editor, after
-- CREATE_BODAGOERA_BUSINESS_CATEGORIES_AND_REGISTRATION.sql,
-- CREATE_BODAGOERA_BUSINESS_DRIVER_ROSTER.sql and
-- CREATE_BODAGOERA_BUSINESS_PRICING.sql. Safe to run twice.
--
-- Until this is applied the app behaves exactly as before: the frontend
-- detects the missing RPCs and switches the gate off ("not switched on yet").
--
-- What it does
--  1. mbg_business_registrations: the legal details a business must give
--     (registration number, operating/security licence, phone ...) and its
--     access status — pending / approved / rejected / suspended.
--  2. A business is "live" only when a platform developer has approved it in
--     the Developer Panel (Businesses tab). Until then it can set up its
--     profile and pricing, but it cannot add drivers/escorts or put anyone
--     online. That is enforced here, in the database, not just in the UI.
--  3. Every business that already existed when this runs is grandfathered in
--     as approved, so nothing live is switched off. They are asked to add
--     their registration details from the Profile tab.
--
-- This deliberately does NOT touch business_profiles.verification_status: that
-- column belongs to the shared ICAN system (the Era API uses it to decide who
-- may mint live payment keys). BodaGoEra approval is its own decision.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Registration + access status
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mbg_business_registrations (
  business_profile_id UUID PRIMARY KEY REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  registration_number TEXT,
  tax_id TEXT,
  license_number TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  business_address TEXT,
  website TEXT,
  operating_hours TEXT,
  access_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (access_status IN ('pending', 'approved', 'rejected', 'suspended')),
  grandfathered BOOLEAN NOT NULL DEFAULT false,
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One registration number, one business (a rejected one frees it up again).
CREATE UNIQUE INDEX IF NOT EXISTS mbg_business_registrations_regno_uniq
  ON public.mbg_business_registrations (lower(btrim(registration_number)))
  WHERE registration_number IS NOT NULL AND access_status <> 'rejected';

CREATE INDEX IF NOT EXISTS mbg_business_registrations_status_idx
  ON public.mbg_business_registrations (access_status, submitted_at DESC);

ALTER TABLE public.mbg_business_registrations ENABLE ROW LEVEL SECURITY;

-- Members can read their own business's row. Nobody writes directly: every
-- change goes through the SECURITY DEFINER functions below.
DROP POLICY IF EXISTS mbg_business_registrations_member_read ON public.mbg_business_registrations;
CREATE POLICY mbg_business_registrations_member_read ON public.mbg_business_registrations
  FOR SELECT TO authenticated
  USING (public.ican_business_member(business_profile_id));

-- Existing BodaGoEra businesses keep working: grandfather them in as approved.
INSERT INTO public.mbg_business_registrations (business_profile_id, access_status, grandfathered, reviewed_at, submitted_at)
SELECT bp.id, 'approved', true, now(), bp.created_at
FROM public.business_profiles bp
WHERE bp.metadata->>'source' = 'bodagoera'
  AND bp.metadata->>'category_key' IN ('transport_company', 'security_escort')
ON CONFLICT (business_profile_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_business_is_developer()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true
  );
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_is_developer() TO authenticated;

-- Only BodaGoEra transport/escort businesses are subject to the gate; other
-- business types that may have drivers (e.g. supermarkets) are untouched.
CREATE OR REPLACE FUNCTION public.mbg_business_requires_approval(p_business_profile_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_profiles bp
    WHERE bp.id = p_business_profile_id
      AND bp.metadata->>'source' = 'bodagoera'
      AND bp.metadata->>'category_key' IN ('transport_company', 'security_escort')
  );
$$;

CREATE OR REPLACE FUNCTION public.mbg_business_is_live(p_business_profile_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mbg_business_registrations
    WHERE business_profile_id = p_business_profile_id AND access_status = 'approved'
  );
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_is_live(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Server-side gate: no roster and nobody online until approved.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_guard_business_roster()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.business_profile_id IS NULL THEN RETURN NEW; END IF;
  IF NOT public.mbg_business_requires_approval(NEW.business_profile_id) THEN RETURN NEW; END IF;
  IF public.mbg_business_is_live(NEW.business_profile_id) THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Your business registration must be approved by the BodaGoEra team before you can add drivers or escorts';
  END IF;
  IF NEW.is_available IS TRUE THEN NEW.is_available := false; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mbg_guard_business_roster_trg ON public.mbg_riders;
CREATE TRIGGER mbg_guard_business_roster_trg
  BEFORE INSERT OR UPDATE OF is_available, business_profile_id ON public.mbg_riders
  FOR EACH ROW EXECUTE FUNCTION public.mbg_guard_business_roster();

-- ----------------------------------------------------------------------------
-- 4. Owner: submit / re-submit registration details
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_submit_business_registration(
  p_business_profile_id UUID,
  p_registration_number TEXT,
  p_license_number TEXT,
  p_contact_phone TEXT,
  p_tax_id TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_business_address TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_operating_hours TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_reg TEXT := NULLIF(btrim(COALESCE(p_registration_number, '')), '');
  v_lic TEXT := NULLIF(btrim(COALESCE(p_license_number, '')), '');
  v_phone TEXT := NULLIF(btrim(COALESCE(p_contact_phone, '')), '');
  v_existing public.mbg_business_registrations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF NOT public.ican_business_admin(p_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a business admin can submit registration details');
  END IF;
  IF NOT public.mbg_business_requires_approval(p_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a transport company or security escort business');
  END IF;
  IF v_reg IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Business registration number is required');
  END IF;
  IF v_lic IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Operating / security licence number is required');
  END IF;
  IF v_phone IS NULL OR length(regexp_replace(v_phone, '\D', '', 'g')) < 7 THEN
    RETURN jsonb_build_object('success', false, 'error', 'A valid contact phone number is required');
  END IF;

  SELECT * INTO v_existing FROM public.mbg_business_registrations WHERE business_profile_id = p_business_profile_id;

  IF FOUND AND v_existing.access_status = 'suspended' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This business is suspended — contact the BodaGoEra team');
  END IF;
  -- Once approved after review, the legal identifiers are locked (changing them
  -- is a re-review). Grandfathered businesses were never reviewed, so they may
  -- fill the details in without losing access.
  IF FOUND AND v_existing.access_status = 'approved' AND NOT v_existing.grandfathered THEN
    RETURN jsonb_build_object('success', false, 'error', 'This business is already approved — contact the BodaGoEra team to change registration details');
  END IF;

  INSERT INTO public.mbg_business_registrations (
    business_profile_id, submitted_by, registration_number, tax_id, license_number,
    contact_phone, contact_email, business_address, website, operating_hours,
    access_status, submitted_at, updated_at
  ) VALUES (
    p_business_profile_id, auth.uid(), v_reg, NULLIF(btrim(COALESCE(p_tax_id, '')), ''), v_lic,
    v_phone, NULLIF(btrim(COALESCE(p_contact_email, '')), ''),
    NULLIF(btrim(COALESCE(p_business_address, '')), ''),
    NULLIF(btrim(COALESCE(p_website, '')), ''),
    NULLIF(btrim(COALESCE(p_operating_hours, '')), ''),
    'pending', now(), now()
  )
  ON CONFLICT (business_profile_id) DO UPDATE SET
    submitted_by = auth.uid(),
    registration_number = EXCLUDED.registration_number,
    tax_id = EXCLUDED.tax_id,
    license_number = EXCLUDED.license_number,
    contact_phone = EXCLUDED.contact_phone,
    contact_email = EXCLUDED.contact_email,
    business_address = EXCLUDED.business_address,
    website = EXCLUDED.website,
    operating_hours = EXCLUDED.operating_hours,
    -- grandfathered + approved stays approved; pending/rejected go (back) to pending
    access_status = CASE WHEN mbg_business_registrations.access_status = 'approved'
                         THEN 'approved' ELSE 'pending' END,
    rejection_reason = NULL,
    submitted_at = now(),
    updated_at = now();

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'That registration number is already used by another business');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_submit_business_registration(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Owner: the registration rows of every business I belong to.
CREATE OR REPLACE FUNCTION public.mbg_my_business_registrations()
RETURNS TABLE (
  business_profile_id UUID,
  registration_number TEXT,
  tax_id TEXT,
  license_number TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  business_address TEXT,
  website TEXT,
  operating_hours TEXT,
  access_status TEXT,
  grandfathered BOOLEAN,
  rejection_reason TEXT,
  reviewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rg.business_profile_id, rg.registration_number, rg.tax_id, rg.license_number,
         rg.contact_phone, rg.contact_email, rg.business_address, rg.website, rg.operating_hours,
         rg.access_status, rg.grandfathered, rg.rejection_reason, rg.reviewed_at, rg.submitted_at
  FROM public.mbg_business_registrations rg
  WHERE public.ican_business_member(rg.business_profile_id);
$$;
GRANT EXECUTE ON FUNCTION public.mbg_my_business_registrations() TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Owner: edit the public profile and contact details (works while pending)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_update_business_profile(
  p_business_profile_id UUID,
  p_business_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_home_city TEXT DEFAULT NULL,
  p_home_country TEXT DEFAULT NULL,
  p_contact_phone TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_business_address TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_operating_hours TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name TEXT := NULLIF(btrim(COALESCE(p_business_name, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.ican_business_admin(p_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a business admin can edit the profile');
  END IF;
  IF NOT public.mbg_business_requires_approval(p_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a transport company or security escort business');
  END IF;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Business name is required');
  END IF;
  IF p_contact_phone IS NOT NULL AND btrim(p_contact_phone) <> ''
     AND length(regexp_replace(p_contact_phone, '\D', '', 'g')) < 7 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid contact phone number');
  END IF;

  UPDATE public.business_profiles SET
    business_name = v_name,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'description', NULLIF(btrim(COALESCE(p_description, '')), ''),
      'home_city', NULLIF(btrim(COALESCE(p_home_city, '')), ''),
      'home_country', COALESCE(NULLIF(btrim(COALESCE(p_home_country, '')), ''), 'Uganda')
    ),
    updated_at = now()
  WHERE id = p_business_profile_id;

  -- Contact fields live on the registration row. A business with no row has not
  -- submitted its registration yet, so those fields wait for that step.
  UPDATE public.mbg_business_registrations SET
    contact_phone = COALESCE(NULLIF(btrim(COALESCE(p_contact_phone, '')), ''), contact_phone),
    contact_email = NULLIF(btrim(COALESCE(p_contact_email, '')), ''),
    business_address = NULLIF(btrim(COALESCE(p_business_address, '')), ''),
    website = NULLIF(btrim(COALESCE(p_website, '')), ''),
    operating_hours = NULLIF(btrim(COALESCE(p_operating_hours, '')), ''),
    updated_at = now()
  WHERE business_profile_id = p_business_profile_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_update_business_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Owner: overview numbers (team, last 30 days, 14-day trend, top people)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_business_overview(p_business_profile_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.ican_business_member(p_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this business');
  END IF;

  WITH team AS (
    SELECT r.id, r.status, r.is_available, r.rating,
           (to_jsonb(r)->>'admin_verified_at') IS NOT NULL AS platform_verified
    FROM public.mbg_riders r
    WHERE r.business_profile_id = p_business_profile_id
  ),
  rides AS (
    SELECT ride.id, ride.rider_id, ride.status::text AS status, ride.fare,
           ride.created_at, ride.completed_at
    FROM public.mbg_rides ride
    JOIN public.mbg_riders r ON r.id = ride.rider_id
    WHERE r.business_profile_id = p_business_profile_id
  ),
  days AS (
    SELECT d::date AS day FROM generate_series(current_date - 13, current_date, interval '1 day') d
  ),
  trend AS (
    SELECT days.day,
           count(rides.id) FILTER (WHERE rides.status = 'completed') AS completed,
           COALESCE(sum(rides.fare) FILTER (WHERE rides.status = 'completed'), 0) AS revenue
    FROM days
    LEFT JOIN rides ON rides.completed_at::date = days.day
    GROUP BY days.day
    ORDER BY days.day
  ),
  top AS (
    SELECT r.id AS rider_id,
           COALESCE(up.full_name, u.email) AS name,
           count(*) AS ride_count,
           COALESCE(sum(x.fare), 0) AS revenue
    FROM rides x
    JOIN public.mbg_riders r ON r.id = x.rider_id
    JOIN public.mbg_users u ON u.id = r.user_id
    LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
    WHERE x.status = 'completed' AND x.completed_at >= now() - interval '30 days'
    GROUP BY r.id, up.full_name, u.email
    ORDER BY count(*) DESC, COALESCE(sum(x.fare), 0) DESC
    LIMIT 3
  )
  SELECT jsonb_build_object(
    'success', true,
    'team_total',    (SELECT count(*) FROM team),
    'team_active',   (SELECT count(*) FROM team WHERE status = 'active'),
    'team_online',   (SELECT count(*) FROM team WHERE is_available),
    'team_verified', (SELECT count(*) FROM team WHERE platform_verified),
    'avg_rating',    (SELECT round(avg(rating)::numeric, 2) FROM team WHERE rating IS NOT NULL AND rating > 0),
    'rides_30d',     (SELECT count(*) FROM rides WHERE created_at >= now() - interval '30 days'),
    'completed_30d', (SELECT count(*) FROM rides WHERE status = 'completed' AND completed_at >= now() - interval '30 days'),
    'cancelled_30d', (SELECT count(*) FROM rides WHERE status = 'cancelled' AND created_at >= now() - interval '30 days'),
    'active_now',    (SELECT count(*) FROM rides WHERE status IN ('requested', 'accepted', 'picked_up', 'in_transit')),
    'revenue_30d',   (SELECT COALESCE(sum(fare), 0) FROM rides WHERE status = 'completed' AND completed_at >= now() - interval '30 days'),
    'revenue_all',   (SELECT COALESCE(sum(fare), 0) FROM rides WHERE status = 'completed'),
    'trend',         (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', day, 'completed', completed, 'revenue', revenue) ORDER BY day), '[]'::jsonb) FROM trend),
    'top',           (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'rides', ride_count, 'revenue', revenue)), '[]'::jsonb) FROM top)
  ) INTO v_result;

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_overview(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Developer Panel: review queue + decisions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_admin_list_business_registrations()
RETURNS TABLE (
  business_profile_id UUID,
  business_name TEXT,
  category_key TEXT,
  description TEXT,
  home_city TEXT,
  home_country TEXT,
  avatar_url TEXT,
  owner_name TEXT,
  owner_email TEXT,
  registration_number TEXT,
  tax_id TEXT,
  license_number TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  business_address TEXT,
  website TEXT,
  access_status TEXT,
  grandfathered BOOLEAN,
  rejection_reason TEXT,
  team_size INTEGER,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    bp.id, bp.business_name,
    bp.metadata->>'category_key',
    COALESCE(bp.metadata->>'description', bp.description),
    bp.metadata->>'home_city', bp.metadata->>'home_country',
    bp.avatar_url,
    up.full_name, u.email,
    rg.registration_number, rg.tax_id, rg.license_number,
    rg.contact_phone, rg.contact_email, rg.business_address, rg.website,
    rg.access_status, rg.grandfathered, rg.rejection_reason,
    (SELECT count(*)::INTEGER FROM public.mbg_riders r WHERE r.business_profile_id = bp.id),
    rg.submitted_at, rg.reviewed_at
  FROM public.mbg_business_registrations rg
  JOIN public.business_profiles bp ON bp.id = rg.business_profile_id
  LEFT JOIN public.mbg_users u
    ON u.id = COALESCE(rg.submitted_by, NULLIF(to_jsonb(bp)->>'user_id', '')::uuid)
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = u.id
  WHERE public.mbg_business_is_developer()
  ORDER BY (rg.access_status = 'pending') DESC, rg.submitted_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_admin_list_business_registrations() TO authenticated;

-- p_decision: 'approve' | 'reject' | 'suspend' | 'reinstate'
CREATE OR REPLACE FUNCTION public.mbg_admin_review_business(
  p_business_profile_id UUID,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.mbg_business_registrations%ROWTYPE;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF NOT public.mbg_business_is_developer() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a developer can review businesses');
  END IF;

  SELECT * INTO v_row FROM public.mbg_business_registrations WHERE business_profile_id = p_business_profile_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'This business has not submitted its registration yet');
  END IF;

  IF p_decision = 'approve' THEN
    IF v_row.access_status NOT IN ('pending', 'rejected') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only a pending or rejected business can be approved');
    END IF;
    IF v_row.registration_number IS NULL OR v_row.license_number IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Registration number and licence are missing');
    END IF;
    UPDATE public.mbg_business_registrations SET access_status = 'approved', grandfathered = false,
      rejection_reason = NULL, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    WHERE business_profile_id = p_business_profile_id;

  ELSIF p_decision = 'reject' THEN
    IF v_row.access_status <> 'pending' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only a pending business can be rejected');
    END IF;
    IF v_reason IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Give the owner a reason so they can fix it and re-apply');
    END IF;
    UPDATE public.mbg_business_registrations SET access_status = 'rejected',
      rejection_reason = v_reason, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    WHERE business_profile_id = p_business_profile_id;

  ELSIF p_decision = 'suspend' THEN
    IF v_row.access_status <> 'approved' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only an approved business can be suspended');
    END IF;
    IF v_reason IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'A reason is required to suspend a business');
    END IF;
    UPDATE public.mbg_business_registrations SET access_status = 'suspended',
      rejection_reason = v_reason, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    WHERE business_profile_id = p_business_profile_id;
    -- Take the whole team offline immediately.
    UPDATE public.mbg_riders SET is_available = false, updated_at = now()
    WHERE business_profile_id = p_business_profile_id AND is_available = true;

  ELSIF p_decision = 'reinstate' THEN
    IF v_row.access_status <> 'suspended' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only a suspended business can be reinstated');
    END IF;
    UPDATE public.mbg_business_registrations SET access_status = 'approved',
      rejection_reason = NULL, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    WHERE business_profile_id = p_business_profile_id;

  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Unknown decision');
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_admin_review_business(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Business registration + developer approval ready. Existing businesses were grandfathered as approved.';
END $$;
