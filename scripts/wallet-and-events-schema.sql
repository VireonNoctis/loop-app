-- Wallet & Events Schema Alignment Migration for Supabase

-- 1. Profiles (Ensure loop_coins exists)
-- NOTE: public.profiles is owned by scripts/complete-database-setup.sql, which
-- already runs before this file in scripts/run-production-setup.mjs and seeds
-- loop_coins via the app's economy defaults (see lib/economy.ts). This
-- CREATE TABLE is only a safety net for environments that run this file in
-- isolation, so its default must match the real signup bonus (not a fake
-- "everyone starts rich" balance).
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY,
    username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    loop_coins BIGINT DEFAULT 50,
    is_verified BOOLEAN DEFAULT FALSE,
    is_premium BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='loop_coins') THEN
        ALTER TABLE public.profiles ADD COLUMN loop_coins BIGINT DEFAULT 50;
    END IF;
END $$;

-- 2. Wallet Transactions Table
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount_usd NUMERIC(10, 2) DEFAULT 0,
    coins_amount INTEGER NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'completed',
    payment_method TEXT DEFAULT 'card',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_created ON public.wallet_transactions(created_at DESC);

-- 3. Coin Gifts Table
CREATE TABLE IF NOT EXISTS public.coin_gifts (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    sender_username TEXT,
    sender_name TEXT,
    sender_avatar TEXT,
    receiver_id TEXT NOT NULL,
    receiver_username TEXT,
    coins_amount INTEGER NOT NULL,
    gift_name TEXT,
    gift_icon TEXT,
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coin_gifts_sender ON public.coin_gifts(sender_id);
CREATE INDEX IF NOT EXISTS idx_coin_gifts_receiver ON public.coin_gifts(receiver_id);

-- 4. Events Table
CREATE TABLE IF NOT EXISTS public.events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    host_id TEXT NOT NULL,
    host_name TEXT,
    host_avatar TEXT,
    category TEXT DEFAULT 'General',
    status TEXT DEFAULT 'upcoming',
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    cover_image TEXT,
    participants_count INTEGER DEFAULT 1,
    is_live BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_status ON public.events(status);
CREATE INDEX IF NOT EXISTS idx_events_host ON public.events(host_id);

-- 5. Event Participants Table
CREATE TABLE IF NOT EXISTS public.event_participants (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    role TEXT DEFAULT 'attendee',
    status TEXT DEFAULT 'joined',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_event_user UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_part_event ON public.event_participants(event_id);
CREATE INDEX IF NOT EXISTS idx_event_part_user ON public.event_participants(user_id);

-- 6. User Inventory Table
CREATE TABLE IF NOT EXISTS public.user_inventory (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    item_type TEXT NOT NULL,
    acquired_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_user ON public.user_inventory(user_id);

-- 7. Withdrawal Requests Table (real, manually admin-reviewed payout requests)
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    username TEXT,
    coins_amount INTEGER NOT NULL,
    estimated_usd NUMERIC(10, 2) NOT NULL,
    payout_method TEXT DEFAULT 'bank',
    payout_details TEXT,
    status TEXT DEFAULT 'pending_review',
    admin_note TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='admin_note') THEN
        ALTER TABLE public.withdrawal_requests ADD COLUMN admin_note TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='reviewed_at') THEN
        ALTER TABLE public.withdrawal_requests ADD COLUMN reviewed_at TIMESTAMP WITH TIME ZONE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='withdrawal_requests' AND column_name='reviewed_by') THEN
        ALTER TABLE public.withdrawal_requests ADD COLUMN reviewed_by TEXT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wdr_user ON public.withdrawal_requests(user_id);

-- Private wallet/account records must never inherit the old public CRUD policies.
-- Service-role API routes own writes; authenticated clients may only read the
-- rows that belong to them (or gifts involving them). Event listings/rosters
-- remain public, but clients cannot mutate them directly.
DO $wallet_policies$
DECLARE
  policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN (
         'wallet_transactions',
         'coin_gifts',
         'events',
         'event_participants',
         'user_inventory',
         'withdrawal_requests'
       )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_row.policyname,
      policy_row.tablename
    );
  END LOOP;
END;
$wallet_policies$;

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallet_transactions_read_own
  ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (auth.uid()::TEXT = user_id);

CREATE POLICY coin_gifts_read_involved
  ON public.coin_gifts
  FOR SELECT TO authenticated
  USING (auth.uid()::TEXT = sender_id OR auth.uid()::TEXT = receiver_id);

CREATE POLICY events_read_public
  ON public.events
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY event_participants_read_public
  ON public.event_participants
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY user_inventory_read_own
  ON public.user_inventory
  FOR SELECT TO authenticated
  USING (auth.uid()::TEXT = user_id);

CREATE POLICY withdrawal_requests_read_own
  ON public.withdrawal_requests
  FOR SELECT TO authenticated
  USING (auth.uid()::TEXT = user_id);

REVOKE ALL ON TABLE public.wallet_transactions FROM PUBLIC;
REVOKE ALL ON TABLE public.coin_gifts FROM PUBLIC;
REVOKE ALL ON TABLE public.user_inventory FROM PUBLIC;
REVOKE ALL ON TABLE public.withdrawal_requests FROM PUBLIC;

DO $wallet_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.wallet_transactions FROM anon;
    REVOKE ALL ON TABLE public.coin_gifts FROM anon;
    REVOKE ALL ON TABLE public.user_inventory FROM anon;
    REVOKE ALL ON TABLE public.withdrawal_requests FROM anon;
    GRANT SELECT ON TABLE public.events, public.event_participants TO anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.wallet_transactions FROM authenticated;
    REVOKE ALL ON TABLE public.coin_gifts FROM authenticated;
    REVOKE ALL ON TABLE public.user_inventory FROM authenticated;
    REVOKE ALL ON TABLE public.withdrawal_requests FROM authenticated;
    GRANT SELECT ON TABLE public.wallet_transactions, public.coin_gifts,
      public.events, public.event_participants, public.user_inventory,
      public.withdrawal_requests TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wallet_transactions,
      public.coin_gifts, public.events, public.event_participants,
      public.user_inventory, public.withdrawal_requests TO service_role;
  END IF;
END
$wallet_grants$;

-- Coin withdrawals reserve balance and create their payout request atomically.
CREATE OR REPLACE FUNCTION public.request_coin_withdrawal(
  p_user_id UUID,
  p_request_id TEXT,
  p_coins_amount INTEGER,
  p_payout_method TEXT,
  p_payout_details TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $coin_withdrawal$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_existing public.withdrawal_requests%ROWTYPE;
  v_request public.withdrawal_requests%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
     OR p_request_id IS NULL
     OR char_length(p_request_id) <> 40
     OR left(p_request_id, 4) <> 'wdr_'
     OR translate(substr(p_request_id, 5), '0123456789abcdefABCDEF-', '') <> ''
     OR substr(p_request_id, 13, 1) <> '-'
     OR substr(p_request_id, 18, 1) <> '-'
     OR substr(p_request_id, 23, 1) <> '-'
     OR substr(p_request_id, 28, 1) <> '-'
     OR p_coins_amount IS NULL OR p_coins_amount < 500
     OR p_payout_method IS NULL OR p_payout_method NOT IN ('bank', 'paypal', 'crypto')
     OR p_payout_details IS NULL OR char_length(btrim(p_payout_details)) = 0
     OR char_length(p_payout_details) > 1000 THEN
    RAISE EXCEPTION 'Invalid coin withdrawal request'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal profile not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_existing
    FROM public.withdrawal_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id::TEXT
       OR v_existing.coins_amount IS DISTINCT FROM p_coins_amount
       OR v_existing.payout_method IS DISTINCT FROM p_payout_method
       OR v_existing.payout_details IS DISTINCT FROM btrim(p_payout_details) THEN
      RAISE EXCEPTION 'Withdrawal idempotency key has already been used'
        USING ERRCODE = '23505';
    END IF;

    RETURN JSONB_BUILD_OBJECT(
      'request', to_jsonb(v_existing),
      'loop_coins', COALESCE(v_profile.loop_coins, 0),
      'already_processed', TRUE
    );
  END IF;

  IF v_profile.is_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'Verified creator status is required for coin withdrawals'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_profile.loop_coins, 0) < p_coins_amount THEN
    RAISE EXCEPTION 'Insufficient Loop Coin balance'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET loop_coins = COALESCE(loop_coins, 0) - p_coins_amount
   WHERE id = p_user_id
   RETURNING * INTO v_profile;

  INSERT INTO public.withdrawal_requests (
    id, user_id, username, coins_amount, estimated_usd,
    payout_method, payout_details, status, created_at
  )
  VALUES (
    p_request_id, p_user_id::TEXT, COALESCE(v_profile.username, 'user'),
    p_coins_amount, ROUND(p_coins_amount::NUMERIC / 100, 2),
    p_payout_method, btrim(p_payout_details), 'pending_review', NOW()
  )
  RETURNING * INTO v_request;

  RETURN JSONB_BUILD_OBJECT(
    'request', to_jsonb(v_request),
    'loop_coins', COALESCE(v_profile.loop_coins, 0),
    'already_processed', FALSE
  );
END;
$coin_withdrawal$;

REVOKE ALL ON FUNCTION public.request_coin_withdrawal(UUID, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC;

DO $coin_withdrawal_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.request_coin_withdrawal(UUID, TEXT, INTEGER, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.request_coin_withdrawal(UUID, TEXT, INTEGER, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.request_coin_withdrawal(UUID, TEXT, INTEGER, TEXT, TEXT) TO service_role;
  END IF;
END
$coin_withdrawal_acl$;
-- Admin payout review and coin refunds are serialized with the request row.
CREATE OR REPLACE FUNCTION public.review_coin_withdrawal(
  p_admin_id UUID,
  p_withdrawal_id TEXT,
  p_status TEXT,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $review_coin_withdrawal$
DECLARE
  v_admin public.profiles%ROWTYPE;
  v_owner public.profiles%ROWTYPE;
  v_owner_id TEXT;
  v_request public.withdrawal_requests%ROWTYPE;
  v_already_processed BOOLEAN := FALSE;
BEGIN
  IF p_admin_id IS NULL
     OR p_withdrawal_id IS NULL
     OR p_status IS NULL
     OR p_status NOT IN ('approved', 'paid', 'rejected')
     OR (p_admin_note IS NOT NULL AND char_length(p_admin_note) > 1000) THEN
    RAISE EXCEPTION 'Invalid withdrawal review request'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_admin
    FROM public.profiles
   WHERE id = p_admin_id
   FOR SHARE;

  IF NOT FOUND OR v_admin.is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'Administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  -- Keep the same lock order as request_coin_withdrawal: profile first,
  -- then the withdrawal row. This prevents retry/rejection deadlocks.
  SELECT user_id INTO v_owner_id
    FROM public.withdrawal_requests
   WHERE id = p_withdrawal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal request not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_owner
    FROM public.profiles
   WHERE id = v_owner_id::UUID
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal owner profile not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_request
    FROM public.withdrawal_requests
   WHERE id = p_withdrawal_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal request not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status = p_status THEN
    v_already_processed := TRUE;
    RETURN JSONB_BUILD_OBJECT(
      'request', to_jsonb(v_request),
      'already_processed', v_already_processed
    );
  END IF;

  IF NOT (
    (v_request.status = 'pending_review' AND p_status IN ('approved', 'rejected'))
    OR (v_request.status = 'approved' AND p_status IN ('paid', 'rejected'))
  ) THEN
    RAISE EXCEPTION 'Invalid withdrawal status transition'
      USING ERRCODE = '55000';
  END IF;

  IF p_status = 'rejected' THEN
    UPDATE public.profiles
       SET loop_coins = COALESCE(loop_coins, 0) + GREATEST(v_request.coins_amount, 0),
           updated_at = NOW()
     WHERE id = v_owner_id::UUID;
  END IF;

  UPDATE public.withdrawal_requests
     SET status = p_status,
         admin_note = NULLIF(btrim(p_admin_note), ''),
         reviewed_at = NOW(),
         reviewed_by = p_admin_id::TEXT
   WHERE id = p_withdrawal_id
   RETURNING * INTO v_request;

  RETURN JSONB_BUILD_OBJECT(
    'request', to_jsonb(v_request),
    'already_processed', v_already_processed
  );
END;
$review_coin_withdrawal$;

REVOKE ALL ON FUNCTION public.review_coin_withdrawal(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;

DO $review_coin_withdrawal_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.review_coin_withdrawal(UUID, TEXT, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.review_coin_withdrawal(UUID, TEXT, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.review_coin_withdrawal(UUID, TEXT, TEXT, TEXT) TO service_role;
  END IF;
END;
$review_coin_withdrawal_acl$;

-- Enable Supabase Realtime for Tables
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE wallet_transactions;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE coin_gifts;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE events;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE event_participants;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE withdrawal_requests;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
