-- ═══════════════════════════════════════════════════════════════════════════
-- BodaGoEra Loyalty Rewards — points system for customers AND riders
-- ═══════════════════════════════════════════════════════════════════════════
-- Separate from the ICAN coin wallet (ican_user_wallets). Reward Points are
-- a gamification layer earned from real ICAN movement on rides/journeys —
-- NOT the ride's nominal UGX fare, since a cash-paid ride never touches ICAN
-- at all. Customers earn on ICAN they actually spend on a fare; riders earn
-- on ICAN actually credited as their own ride earning. See
-- mbg_award_reward_points_from_ican_tx below for why this is a trigger on
-- ican_coin_transactions rather than on mbg_rides.
--   Customer: 5 points per 1 ICAN spent.
--   Rider:    10 points per 1 ICAN earned.
-- Points can be redeemed for:
--   1) ICAN Coins (via the existing shared credit_ican_earning() — same 10%
--      tithe every other ICAN earning pays, so this doesn't create a loophole)
--   2) Physical items from a shared catalog (helmet, jacket, reflectors, home
--      accessories) — fulfilled offline, tracked via mbg_reward_redemptions.
--
-- Conversion rate: 100 points = 1 ICAN coin (gross, before tithe).
-- Tiers (by lifetime points, cosmetic — no functional multiplier yet):
--   Bronze 0-999 · Silver 1,000-4,999 · Gold 5,000-14,999 · Platinum 15,000+
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Points ledger (one row per user; role = which side of the app they earn as) ──
CREATE TABLE IF NOT EXISTS mbg_reward_points (
  user_id         UUID PRIMARY KEY REFERENCES mbg_users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'rider')),
  points_balance  NUMERIC NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  lifetime_points NUMERIC NOT NULL DEFAULT 0,
  tier            TEXT NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Transaction history (earn + redeem) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS mbg_reward_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES mbg_users(id) ON DELETE CASCADE,
  points        NUMERIC NOT NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('earn', 'redeem')),
  source        TEXT NOT NULL,        -- 'ride' | 'delivery' | 'shop' | 'redeem_coins' | 'redeem_item' | 'bonus'
  reference_id  TEXT,                 -- ride id / order id / redemption id
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: the same ride/order can never award points twice.
CREATE UNIQUE INDEX IF NOT EXISTS mbg_reward_tx_earn_dedupe
  ON mbg_reward_transactions (user_id, source, reference_id)
  WHERE direction = 'earn' AND reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mbg_reward_tx_user_idx ON mbg_reward_transactions (user_id, created_at DESC);

-- ── 3. Redeemable catalog — shared by customers AND riders ──────────────────
CREATE TABLE IF NOT EXISTS mbg_reward_catalog (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category     TEXT NOT NULL CHECK (category IN ('safety_gear', 'home')),
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  emoji        TEXT NOT NULL DEFAULT '🎁',
  points_cost  NUMERIC NOT NULL CHECK (points_cost > 0),
  role_scope   TEXT NOT NULL DEFAULT 'both' CHECK (role_scope IN ('customer', 'rider', 'both')),
  stock_qty    INTEGER,              -- NULL = unlimited
  active       BOOLEAN NOT NULL DEFAULT true,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 4. Redemption requests (physical items — fulfilled offline by ops) ──────
CREATE TABLE IF NOT EXISTS mbg_reward_redemptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES mbg_users(id) ON DELETE CASCADE,
  catalog_item_id   UUID REFERENCES mbg_reward_catalog(id),
  item_name         TEXT NOT NULL,     -- snapshot, survives catalog edits
  points_spent      NUMERIC NOT NULL,
  delivery_address  TEXT,
  phone             TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'shipped', 'fulfilled', 'cancelled')),
  admin_notes       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mbg_reward_redemptions_user_idx ON mbg_reward_redemptions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mbg_reward_redemptions_status_idx ON mbg_reward_redemptions (status);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE mbg_reward_points        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mbg_reward_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mbg_reward_catalog       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mbg_reward_redemptions   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reward_points_owner_read ON mbg_reward_points;
CREATE POLICY reward_points_owner_read ON mbg_reward_points
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS reward_points_admin_read ON mbg_reward_points;
CREATE POLICY reward_points_admin_read ON mbg_reward_points
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.mbg_users mu WHERE mu.id = auth.uid() AND mu.role_type = 'developer' AND mu.is_active = TRUE)
  );

DROP POLICY IF EXISTS reward_tx_owner_read ON mbg_reward_transactions;
CREATE POLICY reward_tx_owner_read ON mbg_reward_transactions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS reward_catalog_public_read ON mbg_reward_catalog;
CREATE POLICY reward_catalog_public_read ON mbg_reward_catalog
  FOR SELECT TO authenticated USING (active = true);

DROP POLICY IF EXISTS reward_catalog_admin_all ON mbg_reward_catalog;
CREATE POLICY reward_catalog_admin_all ON mbg_reward_catalog
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.mbg_users mu WHERE mu.id = auth.uid() AND mu.role_type = 'developer' AND mu.is_active = TRUE)
  );

DROP POLICY IF EXISTS reward_redemptions_owner_rw ON mbg_reward_redemptions;
CREATE POLICY reward_redemptions_owner_rw ON mbg_reward_redemptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS reward_redemptions_admin_all ON mbg_reward_redemptions;
CREATE POLICY reward_redemptions_admin_all ON mbg_reward_redemptions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.mbg_users mu WHERE mu.id = auth.uid() AND mu.role_type = 'developer' AND mu.is_active = TRUE)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Functions
-- ═══════════════════════════════════════════════════════════════════════════

-- Recomputes tier from lifetime_points. Cosmetic status band only.
CREATE OR REPLACE FUNCTION mbg_reward_tier_for(p_lifetime NUMERIC) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_lifetime >= 15000 THEN 'platinum'
    WHEN p_lifetime >= 5000  THEN 'gold'
    WHEN p_lifetime >= 1000  THEN 'silver'
    ELSE 'bronze'
  END;
$$;

-- ── Earn points ───────────────────────────────────────────────────────────
-- Idempotent per (user_id, source, reference_id) via the unique index above —
-- safe to call more than once for the same ride/order.
CREATE OR REPLACE FUNCTION mbg_earn_reward_points(
  p_user_id      UUID,
  p_points       NUMERIC,
  p_role         TEXT DEFAULT 'customer',
  p_source       TEXT DEFAULT 'ride',
  p_reference_id TEXT DEFAULT NULL,
  p_note         TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_lifetime NUMERIC;
  v_new_balance  NUMERIC;
  v_new_tier     TEXT;
BEGIN
  IF p_points <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Points must be positive');
  END IF;

  INSERT INTO mbg_reward_points (user_id, role, points_balance, lifetime_points, tier)
  VALUES (p_user_id, p_role, p_points, p_points, mbg_reward_tier_for(p_points))
  ON CONFLICT (user_id) DO UPDATE
    SET points_balance  = mbg_reward_points.points_balance + EXCLUDED.points_balance,
        lifetime_points = mbg_reward_points.lifetime_points + EXCLUDED.lifetime_points,
        tier            = mbg_reward_tier_for(mbg_reward_points.lifetime_points + EXCLUDED.lifetime_points),
        role            = EXCLUDED.role,
        updated_at      = now()
  RETURNING points_balance, lifetime_points, tier INTO v_new_balance, v_new_lifetime, v_new_tier;

  BEGIN
    INSERT INTO mbg_reward_transactions (user_id, points, direction, source, reference_id, note)
    VALUES (p_user_id, p_points, 'earn', p_source, p_reference_id, p_note);
  EXCEPTION WHEN unique_violation THEN
    -- Already awarded for this reference — roll the balance bump back.
    UPDATE mbg_reward_points
      SET points_balance  = points_balance - p_points,
          lifetime_points = lifetime_points - p_points,
          tier            = mbg_reward_tier_for(lifetime_points - p_points)
      WHERE user_id = p_user_id;
    RETURN jsonb_build_object('success', false, 'error', 'Points already awarded for this reference');
  END;

  RETURN jsonb_build_object(
    'success', true,
    'points_awarded', p_points,
    'points_balance', v_new_balance,
    'lifetime_points', v_new_lifetime,
    'tier', v_new_tier
  );
END;
$$;

-- ── Summary (single round trip for the UI: balance + tier + progress) ──────
CREATE OR REPLACE FUNCTION mbg_get_reward_summary(p_user_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row mbg_reward_points%ROWTYPE;
  v_next_threshold NUMERIC;
  v_next_tier TEXT;
BEGIN
  SELECT * INTO v_row FROM mbg_reward_points WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'points_balance', 0, 'lifetime_points', 0, 'tier', 'bronze',
      'next_tier', 'silver', 'next_threshold', 1000, 'progress_pct', 0
    );
  END IF;

  v_next_threshold := CASE v_row.tier
    WHEN 'bronze' THEN 1000 WHEN 'silver' THEN 5000 WHEN 'gold' THEN 15000 ELSE NULL END;
  v_next_tier := CASE v_row.tier
    WHEN 'bronze' THEN 'silver' WHEN 'silver' THEN 'gold' WHEN 'gold' THEN 'platinum' ELSE NULL END;

  RETURN jsonb_build_object(
    'points_balance', v_row.points_balance,
    'lifetime_points', v_row.lifetime_points,
    'tier', v_row.tier,
    'next_tier', v_next_tier,
    'next_threshold', v_next_threshold,
    'progress_pct', CASE WHEN v_next_threshold IS NULL THEN 100
      ELSE LEAST(100, ROUND(v_row.lifetime_points / v_next_threshold * 100)) END
  );
END;
$$;

-- ── Redeem points → ICAN coins ───────────────────────────────────────────────
-- 100 points = 1 ICAN (gross). Routed through the shared credit_ican_earning()
-- so it pays the same 10% tithe as every other ICAN earning in the system.
CREATE OR REPLACE FUNCTION mbg_redeem_points_for_coins(
  p_user_id UUID,
  p_points  NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance    NUMERIC;
  v_ican_gross NUMERIC;
  v_redemption_id UUID;
  v_credit_result JSONB;
BEGIN
  IF p_points <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Points must be positive');
  END IF;

  SELECT points_balance INTO v_balance FROM mbg_reward_points WHERE user_id = p_user_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < p_points THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not enough points');
  END IF;

  v_ican_gross := ROUND(p_points / 100.0, 8);

  UPDATE mbg_reward_points SET points_balance = points_balance - p_points, updated_at = now()
    WHERE user_id = p_user_id;

  INSERT INTO mbg_reward_redemptions (user_id, item_name, points_spent, status)
  VALUES (p_user_id, format('%s ICAN Coins', v_ican_gross::TEXT), p_points, 'fulfilled')
  RETURNING id INTO v_redemption_id;

  INSERT INTO mbg_reward_transactions (user_id, points, direction, source, reference_id, note)
  VALUES (p_user_id, p_points, 'redeem', 'redeem_coins', v_redemption_id::TEXT,
          format('Converted %s points to %s ICAN', p_points::TEXT, v_ican_gross::TEXT));

  v_credit_result := credit_ican_earning(
    p_user_id, v_ican_gross, 'mybodaguy',
    format('Reward points redeemed: %s points -> ICAN', p_points::TEXT),
    v_redemption_id::TEXT
  );

  IF NOT (v_credit_result->>'success')::BOOLEAN THEN
    RAISE EXCEPTION 'ICAN credit failed: %', v_credit_result->>'error';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'points_spent', p_points,
    'ican_credited', v_credit_result->>'net_credited',
    'redemption_id', v_redemption_id
  );
END;
$$;

-- ── Redeem points → physical item (helmet, jacket, reflectors, home goods) ──
-- Debits points immediately and files a 'pending' redemption for offline
-- fulfilment (same pattern as mbg_operator_applications review queue).
CREATE OR REPLACE FUNCTION mbg_redeem_points_for_item(
  p_user_id          UUID,
  p_catalog_item_id  UUID,
  p_delivery_address TEXT DEFAULT NULL,
  p_phone            TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item       mbg_reward_catalog%ROWTYPE;
  v_balance    NUMERIC;
  v_redemption_id UUID;
BEGIN
  SELECT * INTO v_item FROM mbg_reward_catalog WHERE id = p_catalog_item_id AND active = true FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item not available');
  END IF;

  IF v_item.stock_qty IS NOT NULL AND v_item.stock_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item out of stock');
  END IF;

  SELECT points_balance INTO v_balance FROM mbg_reward_points WHERE user_id = p_user_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < v_item.points_cost THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not enough points');
  END IF;

  UPDATE mbg_reward_points SET points_balance = points_balance - v_item.points_cost, updated_at = now()
    WHERE user_id = p_user_id;

  IF v_item.stock_qty IS NOT NULL THEN
    UPDATE mbg_reward_catalog SET stock_qty = stock_qty - 1 WHERE id = v_item.id;
  END IF;

  INSERT INTO mbg_reward_redemptions (user_id, catalog_item_id, item_name, points_spent, delivery_address, phone, status)
  VALUES (p_user_id, v_item.id, v_item.name, v_item.points_cost, p_delivery_address, p_phone, 'pending')
  RETURNING id INTO v_redemption_id;

  INSERT INTO mbg_reward_transactions (user_id, points, direction, source, reference_id, note)
  VALUES (p_user_id, v_item.points_cost, 'redeem', 'redeem_item', v_redemption_id::TEXT,
          format('Redeemed: %s', v_item.name));

  RETURN jsonb_build_object('success', true, 'redemption_id', v_redemption_id, 'item_name', v_item.name, 'points_spent', v_item.points_cost);
END;
$$;

-- ── Admin: update a redemption's fulfilment status ───────────────────────────
CREATE OR REPLACE FUNCTION mbg_update_redemption_status(
  p_redemption_id UUID,
  p_status        TEXT,
  p_admin_notes   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mbg_users mu WHERE mu.id = auth.uid() AND mu.role_type = 'developer' AND mu.is_active = TRUE) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Requires developer role');
  END IF;

  IF p_status NOT IN ('pending', 'processing', 'shipped', 'fulfilled', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid status');
  END IF;

  UPDATE mbg_reward_redemptions
    SET status = p_status, admin_notes = COALESCE(p_admin_notes, admin_notes), updated_at = now()
    WHERE id = p_redemption_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Redemption not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── Auto-award points from real ICAN movement (not the ride's UGX fields) ───
-- mbg_complete_ride marks a ride 'completed' *before* it does the ICAN
-- debit/credit for a wallet-paid ride (mbg_debit_journey_fare /
-- mbg_credit_ride_earning both run afterwards, in the same transaction) — so
-- a trigger on mbg_rides itself would always fire too early to see the ICAN
-- amounts. Hooking ican_coin_transactions instead means points are earned
-- from ICAN actually spent/earned, and a cash-paid ride (which never touches
-- ICAN) correctly earns nobody any points.
--   Customer: 5 pts per 1 ICAN spent on a ride/journey fare (transaction_type
--             'journey_payment' is only ever written by mbg_debit_journey_fare).
--   Rider:    10 pts per 1 ICAN credited as their OWN ride earning — 'earn'
--             rows are reused for lots of things (chairperson commissions,
--             delivery payouts, even this file's own points→ICAN redemption),
--             so this is scoped to rows whose reference_id is a ride whose
--             assigned rider is exactly this row's recipient.
CREATE OR REPLACE FUNCTION mbg_award_reward_points_from_ican_tx() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_points             NUMERIC;
  v_ride_rider_user_id UUID;
BEGIN
  IF NEW.transaction_type = 'journey_payment' AND NEW.sender_user_id IS NOT NULL THEN
    v_points := FLOOR(NEW.ican_amount * 5);
    IF v_points > 0 THEN
      PERFORM mbg_earn_reward_points(
        NEW.sender_user_id, v_points, 'customer', 'ride', NEW.id::TEXT,
        format('%s pts for %s ICAN spent on a ride/journey', v_points::TEXT, NEW.ican_amount::TEXT)
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.transaction_type = 'earn' AND NEW.recipient_user_id IS NOT NULL AND NEW.reference_id IS NOT NULL THEN
    SELECT ri.user_id INTO v_ride_rider_user_id
    FROM mbg_rides r
    JOIN mbg_riders ri ON ri.id = r.rider_id
    WHERE r.id::TEXT = NEW.reference_id;

    IF v_ride_rider_user_id IS NOT NULL AND v_ride_rider_user_id = NEW.recipient_user_id THEN
      v_points := FLOOR(NEW.ican_amount * 10);
      IF v_points > 0 THEN
        PERFORM mbg_earn_reward_points(
          NEW.recipient_user_id, v_points, 'rider', 'ride', NEW.id::TEXT,
          format('%s pts for %s ICAN earned on a ride', v_points::TEXT, NEW.ican_amount::TEXT)
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Superseded by mbg_award_reward_points_from_ican_tx above (kept as an
-- explicit drop in case an earlier version of this file already ran).
DROP TRIGGER IF EXISTS mbg_reward_points_on_ride_complete ON mbg_rides;
DROP FUNCTION IF EXISTS mbg_award_ride_reward_points() CASCADE;

DROP TRIGGER IF EXISTS mbg_reward_points_on_ican_tx ON ican_coin_transactions;
CREATE TRIGGER mbg_reward_points_on_ican_tx
  AFTER INSERT ON ican_coin_transactions
  FOR EACH ROW
  WHEN (NEW.source_app = 'mybodaguy')
  EXECUTE FUNCTION mbg_award_reward_points_from_ican_tx();

-- ═══════════════════════════════════════════════════════════════════════════
-- Seed catalog — shared by customers and riders
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO mbg_reward_catalog (category, name, description, emoji, points_cost, role_scope, sort_order) VALUES
  ('safety_gear', 'Reflector Set (4-pack)',        'Stick-on reflectors for helmet, jacket and bike frame — be seen at night.', '🔶', 500,  'both', 1),
  ('safety_gear', 'Reflective Safety Jacket',      'Hi-vis reflective vest, adjustable, all-weather.',                        '🦺', 1200, 'both', 2),
  ('safety_gear', 'DOT-Standard Boda Helmet',      'Certified full-face safety helmet.',                                     '⛑️', 3500, 'both', 3),
  ('home',        'Home Essentials — Kitchen Set', 'Non-stick pot set + serving plates.',                                    '🍲', 5000, 'both', 4),
  ('home',        'Home Essentials — Bedding Set', 'Bedsheet set with pillowcases, queen size.',                             '🛏️', 6000, 'both', 5)
ON CONFLICT (name) DO NOTHING;
