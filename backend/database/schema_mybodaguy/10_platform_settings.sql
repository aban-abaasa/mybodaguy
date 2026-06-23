-- My Boda Guy - Platform Settings
-- Configurable platform settings (commission percentages, etc.)

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
  description TEXT,
  category TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read public settings
DROP POLICY IF EXISTS platform_settings_read_public ON public.platform_settings;
CREATE POLICY platform_settings_read_public ON public.platform_settings
  FOR SELECT
  USING (is_public = true);

-- Developers can read all settings
DROP POLICY IF EXISTS platform_settings_read_developer ON public.platform_settings;
CREATE POLICY platform_settings_read_developer ON public.platform_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Only developers can modify settings
DROP POLICY IF EXISTS platform_settings_manage_developer ON public.platform_settings;
CREATE POLICY platform_settings_manage_developer ON public.platform_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Service role has full access
DROP POLICY IF EXISTS platform_settings_service_role ON public.platform_settings;
CREATE POLICY platform_settings_service_role ON public.platform_settings
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS platform_settings_key_idx ON public.platform_settings(key);
CREATE INDEX IF NOT EXISTS platform_settings_category_idx ON public.platform_settings(category);

-- Insert default commission percentages
INSERT INTO public.platform_settings (key, value, value_type, description, category, is_public) VALUES
  ('commission.platform_fee_percentage', '5.00', 'number', 'Platform fee percentage', 'commission', true),
  ('commission.rider_percentage', '70.00', 'number', 'Rider earnings percentage', 'commission', true),
  ('commission.stage_chair_percentage', '10.00', 'number', 'Stage chairperson commission percentage', 'commission', true),
  ('commission.parish_chair_percentage', '6.00', 'number', 'Parish chairperson commission percentage', 'commission', true),
  ('commission.subcounty_chair_percentage', '4.00', 'number', 'Subcounty chairperson commission percentage', 'commission', true),
  ('commission.division_chair_percentage', '3.00', 'number', 'Division chairperson commission percentage', 'commission', true),
  ('commission.district_chair_percentage', '2.00', 'number', 'District chairperson commission percentage', 'commission', true),
  ('ride.minimum_fare', '2000', 'number', 'Minimum ride fare in UGX', 'ride', true),
  ('ride.per_km_rate', '1500', 'number', 'Rate per kilometer in UGX', 'ride', true),
  ('ride.base_fare', '1000', 'number', 'Base fare for all rides in UGX', 'ride', true),
  ('withdrawal.minimum_amount', '10000', 'number', 'Minimum withdrawal amount in UGX', 'withdrawal', true),
  ('app.name', 'My Boda Guy', 'string', 'Application name', 'app', true),
  ('app.tagline', 'Your Trusted Ride Partner', 'string', 'Application tagline', 'app', true),
  ('app.support_phone', '+256-XXX-XXXXXX', 'string', 'Support phone number', 'app', true),
  ('app.support_email', 'support@mybodaguy.com', 'string', 'Support email', 'app', true)
ON CONFLICT (key) DO NOTHING;

COMMIT;
