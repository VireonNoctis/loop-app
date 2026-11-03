-- Creator earnings must be durable in the canonical production schema.
-- Values are USD-equivalent amounts, stored with two decimal places.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS total_earnings NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_earnings NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id UUID,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'available',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE public.earnings
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT;

ALTER TABLE public.earnings
  ALTER COLUMN amount TYPE NUMERIC(12, 2) USING amount::NUMERIC(12, 2),
  ALTER COLUMN status SET DEFAULT 'available',
  ALTER COLUMN currency SET DEFAULT 'usd';

UPDATE public.earnings
   SET status = 'available'
 WHERE status IS NULL;

UPDATE public.earnings
   SET currency = 'usd'
 WHERE currency IS NULL;

ALTER TABLE public.earnings
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN currency SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_earnings_source_reference
  ON public.earnings(source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_earnings_user_created
  ON public.earnings(user_id, created_at DESC);

-- The ledger is private account-financial data. Clients can read only their
-- own rows; every write is performed by a privileged server transaction.
ALTER TABLE public.earnings ENABLE ROW LEVEL SECURITY;
DO $earnings_policies$
DECLARE
  policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'earnings'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.earnings', policy_row.policyname);
  END LOOP;
END;
$earnings_policies$;

CREATE POLICY earnings_read_own
  ON public.earnings
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.earnings FROM PUBLIC;

DO $earnings_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.earnings FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.earnings FROM authenticated;
    GRANT SELECT ON TABLE public.earnings TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.earnings TO service_role;
  END IF;
END;
$earnings_grants$;

-- Each gift reference can award earnings once. The source advisory lock also
-- serializes duplicate deliveries while the profile row protects the balance.
CREATE OR REPLACE FUNCTION public.award_creator_earnings(
  p_user_id UUID,
  p_amount NUMERIC,
  p_source_type TEXT,
  p_source_id UUID,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $award_creator_earnings$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_existing public.earnings%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
     OR p_amount IS NULL
     OR p_amount <= 0
     OR p_amount > 1000000
     OR p_source_type IS NULL
     OR p_source_type NOT IN ('gift', 'premium', 'tip', 'ad_revenue')
     OR p_source_id IS NULL
     OR (p_description IS NOT NULL AND char_length(p_description) > 500) THEN
    RAISE EXCEPTION 'Invalid creator earnings award'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Creator profile not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_source_type || ':' || p_source_id::TEXT, 0)
  );

  SELECT * INTO v_existing
    FROM public.earnings
   WHERE source_type = p_source_type
     AND source_id = p_source_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.currency IS DISTINCT FROM 'usd' THEN
      RAISE EXCEPTION 'Earnings source reference has already been used'
        USING ERRCODE = '23505';
    END IF;

    RETURN JSONB_BUILD_OBJECT(
      'available_earnings', COALESCE(v_profile.available_earnings, 0),
      'total_earnings', COALESCE(v_profile.total_earnings, 0),
      'already_processed', TRUE
    );
  END IF;

  UPDATE public.profiles
     SET available_earnings = COALESCE(available_earnings, 0) + p_amount,
         total_earnings = COALESCE(total_earnings, 0) + p_amount,
         updated_at = NOW()
   WHERE id = p_user_id
   RETURNING * INTO v_profile;

  INSERT INTO public.earnings (
    user_id, source_type, source_id, amount, currency, status,
    description, created_at, processed_at
  )
  VALUES (
    p_user_id, p_source_type, p_source_id, p_amount, 'usd', 'available',
    p_description, NOW(), NOW()
  );

  RETURN JSONB_BUILD_OBJECT(
    'available_earnings', COALESCE(v_profile.available_earnings, 0),
    'total_earnings', COALESCE(v_profile.total_earnings, 0),
    'already_processed', FALSE
  );
END;
$award_creator_earnings$;

REVOKE ALL ON FUNCTION public.award_creator_earnings(UUID, NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC;

DO $award_creator_earnings_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.award_creator_earnings(UUID, NUMERIC, TEXT, UUID, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.award_creator_earnings(UUID, NUMERIC, TEXT, UUID, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.award_creator_earnings(UUID, NUMERIC, TEXT, UUID, TEXT) TO service_role;
  END IF;
END;
$award_creator_earnings_acl$;
