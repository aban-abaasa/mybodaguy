-- ===========================================================================
-- BODAGOERA (MYBODAGUY) SECURITY CANWE SHIELD
--
-- Durable, cross-request storage for the deception-based bot/attacker
-- detection layer (see frontend/api/_lib/canweShield.js and
-- frontend/src/mybodaguy/components/security/CanweFields.tsx). Deliberately
-- named something generic rather than a recognizable security term, so a
-- reader of the client bundle or this schema can't identify the mechanism
-- by keyword search.
--
-- This matters more here than in a long-running server: mybodaguy's api/**
-- functions are Vercel serverless -- there is no persistent process to hold
-- an in-memory IP blocklist between requests, let alone between cold
-- starts. Postgres is the only thing both the request that raises a flag
-- and the very next, possibly brand-new, function instance can agree on.
--
--   security_threat_events  — append-only audit log, one row per trigger.
--   security_flagged_ips    — current reputation state per IP.
--
-- Both are written ONLY through the SECURITY DEFINER functions below,
-- callable only by service_role (frontend/api/_lib/supabaseAdmin.js holds
-- that key; it is never bundled into the browser).
--
-- Safe to run multiple times.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS security_threat_events (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address    TEXT NOT NULL,
  user_agent    TEXT,
  trigger_type  TEXT NOT NULL CHECK (trigger_type IN ('honeytoken_field', 'decoy_route', 'decoy_link')),
  route         TEXT,
  http_method   TEXT,
  payload       JSONB,
  app_name      TEXT NOT NULL DEFAULT 'mybodaguy'
);

CREATE INDEX IF NOT EXISTS idx_sec_threat_ip       ON security_threat_events(ip_address);
CREATE INDEX IF NOT EXISTS idx_sec_threat_occurred  ON security_threat_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sec_threat_app       ON security_threat_events(app_name);

CREATE TABLE IF NOT EXISTS security_flagged_ips (
  ip_address    TEXT NOT NULL,
  app_name      TEXT NOT NULL DEFAULT 'mybodaguy',
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count     INT NOT NULL DEFAULT 1,
  severity      TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  last_trigger  TEXT,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  PRIMARY KEY (ip_address, app_name)
);

CREATE INDEX IF NOT EXISTS idx_sec_flagged_expires ON security_flagged_ips(expires_at);

ALTER TABLE security_threat_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_flagged_ips   ENABLE ROW LEVEL SECURITY;
-- No policies: service_role (used only by the functions below and the
-- Supabase dashboard) bypasses RLS entirely; add a developer/admin-read
-- policy here yourself once you've settled on this project's staff table.

CREATE OR REPLACE FUNCTION log_security_threat(
  p_ip           TEXT,
  p_user_agent   TEXT,
  p_trigger_type TEXT,
  p_route        TEXT DEFAULT NULL,
  p_http_method  TEXT DEFAULT NULL,
  p_payload      JSONB DEFAULT NULL,
  p_app_name     TEXT DEFAULT 'mybodaguy',
  p_severity     TEXT DEFAULT 'medium'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_hit_count INT;
  v_severity  TEXT;
BEGIN
  IF p_ip IS NULL OR length(trim(p_ip)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'ip_address is required');
  END IF;

  INSERT INTO security_threat_events (ip_address, user_agent, trigger_type, route, http_method, payload, app_name)
  VALUES (trim(p_ip), p_user_agent, p_trigger_type, p_route, p_http_method, p_payload, p_app_name);

  INSERT INTO security_flagged_ips (ip_address, app_name, hit_count, severity, last_trigger, expires_at)
  VALUES (trim(p_ip), p_app_name, 1, p_severity, p_trigger_type, now() + interval '7 days')
  ON CONFLICT (ip_address, app_name) DO UPDATE SET
    hit_count    = security_flagged_ips.hit_count + 1,
    last_seen    = now(),
    last_trigger = EXCLUDED.last_trigger,
    severity     = CASE
                     WHEN security_flagged_ips.hit_count + 1 >= 5 THEN 'critical'
                     WHEN security_flagged_ips.hit_count + 1 >= 2 THEN 'high'
                     ELSE EXCLUDED.severity
                   END,
    expires_at   = now() + interval '7 days'
  RETURNING hit_count, severity INTO v_hit_count, v_severity;

  RETURN jsonb_build_object('success', true, 'hit_count', v_hit_count, 'severity', v_severity);
END;
$$;

REVOKE ALL ON FUNCTION log_security_threat FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_security_threat TO service_role;

CREATE OR REPLACE FUNCTION check_ip_flagged(
  p_ip       TEXT,
  p_app_name TEXT DEFAULT 'mybodaguy'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row security_flagged_ips;
BEGIN
  SELECT * INTO v_row
  FROM security_flagged_ips
  WHERE ip_address = trim(p_ip) AND app_name = p_app_name AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('flagged', false);
  END IF;

  RETURN jsonb_build_object('flagged', true, 'hit_count', v_row.hit_count, 'severity', v_row.severity);
END;
$$;

REVOKE ALL ON FUNCTION check_ip_flagged FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_ip_flagged TO service_role;

SELECT 'BodaGoEra Security Canwe Shield — complete' AS status, now() AS run_at;
