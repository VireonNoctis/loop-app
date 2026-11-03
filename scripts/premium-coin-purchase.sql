-- Atomic and idempotent Premium Coin-pass purchases.
-- Requires premium-subscriptions-migration.sql and wallet-and-events-schema.sql.

CREATE OR REPLACE FUNCTION public.purchase_premium_with_coins(
  p_user_id UUID,
  p_plan_type TEXT,
  p_transaction_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_existing public.wallet_transactions%ROWTYPE;
  v_cost INTEGER;
  v_days INTEGER;
  v_expiry TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_plan_type = 'monthly' THEN
    v_cost := 5000;
    v_days := 30;
  ELSIF p_plan_type = 'annual' THEN
    v_cost := 60000;
    v_days := 365;
  ELSE
    RAISE EXCEPTION 'Unsupported Pro plan' USING ERRCODE = '22023';
  END IF;

  IF p_transaction_id IS NULL
     OR p_transaction_id !~ '^premium_coins_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid Premium purchase reference' USING ERRCODE = '22023';
  END IF;

  -- Serialize all purchases for one profile, including duplicate retries.
  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
  END IF;

  -- Recheck idempotency after obtaining the profile lock. A concurrent
  -- retry may have committed while this request waited for the row lock.
  SELECT *
  INTO v_existing
  FROM public.wallet_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id::TEXT
       OR v_existing.type IS DISTINCT FROM 'premium_purchase'
       OR v_existing.coins_amount IS DISTINCT FROM -v_cost
       OR v_existing.payment_method IS DISTINCT FROM 'coins' THEN
      RAISE EXCEPTION 'Purchase reference has already been used' USING ERRCODE = '23505';
    END IF;

    RETURN JSONB_BUILD_OBJECT(
      'loop_coins', COALESCE(v_profile.loop_coins, 0),
      'premium_expires_at', v_profile.premium_expires_at,
      'already_processed', TRUE
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE user_id = p_user_id
      AND source = 'stripe'
      AND status IN ('active', 'trialing')
      AND current_period_end > v_now
  ) THEN
    RAISE EXCEPTION 'An active card subscription already provides Pro. Manage that subscription instead.'
      USING ERRCODE = '55000';
  END IF;

  IF v_profile.is_premium IS TRUE
     AND v_profile.premium_expires_at IS NULL
     AND COALESCE(v_profile.premium_source, 'legacy') <> 'stripe' THEN
    RAISE EXCEPTION 'This account already has a non-expiring Pro grant.'
      USING ERRCODE = '55000';
  END IF;

  IF COALESCE(v_profile.loop_coins, 0) < v_cost THEN
    RAISE EXCEPTION 'Not enough Loop Coins. This plan requires % coins.', v_cost
      USING ERRCODE = '22023';
  END IF;

  v_expiry := GREATEST(COALESCE(v_profile.premium_expires_at, v_now), v_now)
    + make_interval(days => v_days);

  UPDATE public.profiles
  SET loop_coins = COALESCE(loop_coins, 0) - v_cost,
      is_premium = TRUE,
      premium_source = 'coins',
      premium_expires_at = v_expiry,
      updated_at = v_now
  WHERE id = p_user_id
  RETURNING * INTO v_profile;

  INSERT INTO public.wallet_transactions (
    id, user_id, amount_usd, coins_amount, type, description, status, payment_method, created_at
  )
  VALUES (
    p_transaction_id,
    p_user_id::TEXT,
    0,
    -v_cost,
    'premium_purchase',
    format('Loop Pro %s (%s days)', p_plan_type, v_days),
    'completed',
    'coins',
    v_now
  );

  RETURN JSONB_BUILD_OBJECT(
    'loop_coins', COALESCE(v_profile.loop_coins, 0),
    'premium_expires_at', v_profile.premium_expires_at,
    'already_processed', FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_premium_with_coins(UUID, TEXT, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.purchase_premium_with_coins(UUID, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.purchase_premium_with_coins(UUID, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.purchase_premium_with_coins(UUID, TEXT, TEXT) TO service_role;
  END IF;
END
$$;

-- Stripe checkout grants are committed atomically with their unique receipt row.
-- Stripe may deliver the same event more than once or concurrently; locking the
-- profile serializes retries before the idempotency lookup and expiry update.
CREATE OR REPLACE FUNCTION public.grant_stripe_premium_checkout(
  p_user_id UUID,
  p_transaction_id TEXT,
  p_days INTEGER,
  p_amount_usd NUMERIC,
  p_payment_intent_id TEXT DEFAULT NULL,
  p_plan TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $grant_fn$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_existing public.wallet_transactions%ROWTYPE;
  v_expiry TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_user_id IS NULL
     OR p_transaction_id IS NULL
     OR char_length(p_transaction_id) <= 15
     OR NOT (
       left(p_transaction_id, 15) IN ('stripe_cs_test_', 'stripe_cs_live_')
       OR left(p_transaction_id, 10) = 'stripe_pi_'
     )
     OR translate(p_transaction_id, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_', '') <> ''
     OR p_days IS NULL OR p_days < 1 OR p_days > 3660
     OR p_amount_usd IS NULL OR p_amount_usd < 0
     OR (p_payment_intent_id IS NOT NULL AND char_length(p_payment_intent_id) > 255)
     OR (p_plan IS NOT NULL AND char_length(p_plan) > 80) THEN
    RAISE EXCEPTION 'Invalid Stripe Premium checkout grant'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Premium account profile not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Serialize duplicate webhook deliveries before checking the receipt ledger.
  SELECT * INTO v_existing
    FROM public.wallet_transactions
   WHERE id = p_transaction_id
      OR (
        p_payment_intent_id IS NOT NULL
        AND payment_intent_id = p_payment_intent_id
        AND payment_method = 'stripe'
      )
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id::TEXT
       OR v_existing.type IS DISTINCT FROM 'premium_purchase'
       OR v_existing.payment_method IS DISTINCT FROM 'stripe' THEN
      RAISE EXCEPTION 'Stripe checkout reference has already been used'
        USING ERRCODE = '23505';
    END IF;

    RETURN JSONB_BUILD_OBJECT(
      'premium_expires_at', v_profile.premium_expires_at,
      'already_processed', TRUE
    );
  END IF;

  IF v_profile.is_premium IS TRUE
     AND v_profile.premium_expires_at IS NULL
     AND COALESCE(v_profile.premium_source, 'legacy') <> 'stripe' THEN
    RAISE EXCEPTION 'This account already has a non-expiring Pro grant'
      USING ERRCODE = '55000';
  END IF;

  v_expiry := GREATEST(COALESCE(v_profile.premium_expires_at, v_now), v_now)
    + make_interval(days => p_days);

  UPDATE public.profiles
     SET is_premium = TRUE,
         premium_source = 'stripe_one_time',
         premium_expires_at = v_expiry,
         updated_at = v_now
   WHERE id = p_user_id;

  INSERT INTO public.wallet_transactions (
    id, user_id, amount_usd, coins_amount, type, description, status,
    payment_method, payment_intent_id, created_at
  )
  VALUES (
    p_transaction_id, p_user_id::TEXT, p_amount_usd, 0,
    'premium_purchase',
    format('Loop Pro %s (%s days)', COALESCE(NULLIF(p_plan, ''), 'Pro'), p_days),
    'completed', 'stripe', p_payment_intent_id, v_now
  );

  RETURN JSONB_BUILD_OBJECT(
    'premium_expires_at', v_expiry,
    'already_processed', FALSE
  );
END;
$grant_fn$;

REVOKE ALL ON FUNCTION public.grant_stripe_premium_checkout(UUID, TEXT, INTEGER, NUMERIC, TEXT, TEXT) FROM PUBLIC;

DO $grant_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.grant_stripe_premium_checkout(UUID, TEXT, INTEGER, NUMERIC, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.grant_stripe_premium_checkout(UUID, TEXT, INTEGER, NUMERIC, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.grant_stripe_premium_checkout(UUID, TEXT, INTEGER, NUMERIC, TEXT, TEXT) TO service_role;
  END IF;
END
$grant_acl$;
-- Wallet transactions are account financial records, not public social data.
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read wallet_transactions" ON public.wallet_transactions;
DROP POLICY IF EXISTS wallet_transactions_read_own ON public.wallet_transactions;
CREATE POLICY wallet_transactions_read_own
  ON public.wallet_transactions
  FOR SELECT
  TO authenticated
  USING (auth.uid()::TEXT = user_id);

REVOKE ALL ON TABLE public.wallet_transactions FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.wallet_transactions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.wallet_transactions FROM authenticated;
    GRANT SELECT ON TABLE public.wallet_transactions TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wallet_transactions TO service_role;
  END IF;
END
$$;
