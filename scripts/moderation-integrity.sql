-- LOOP moderation integrity: report idempotency and atomic review actions.
-- Applied after scripts/moderation-schema.sql by the production setup runner.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_moderator BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ban_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

ALTER TABLE public.content_flags
  ADD COLUMN IF NOT EXISTS moderator_notes TEXT,
  ADD COLUMN IF NOT EXISTS moderator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Preserve the audit trail while reconciling any historical duplicate pending
-- reports before enforcing one open report per reporter/content pair.
WITH ranked_pending AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY reporter_id, content_type, content_id
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_rank
  FROM public.content_flags
  WHERE status = 'pending' AND reporter_id IS NOT NULL
)
UPDATE public.content_flags AS flag
SET status = 'dismissed',
    action_taken = 'duplicate_merged',
    moderator_notes = COALESCE(
      NULLIF(flag.moderator_notes, ''),
      'Duplicate pending report reconciled during moderation integrity migration.'
    ),
    updated_at = NOW()
FROM ranked_pending AS ranked
WHERE ranked.id = flag.id AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_flags_one_pending_per_reporter
  ON public.content_flags(reporter_id, content_type, content_id)
  WHERE status = 'pending' AND reporter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_content_flags_reporter_created
  ON public.content_flags(reporter_id, created_at DESC);

-- Reports contain potentially private allegations and evidence. All reads are
-- server-mediated, except for moderator-only authenticated realtime SELECT.
ALTER TABLE public.content_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_flags_moderator_select ON public.content_flags;
CREATE POLICY content_flags_moderator_select
  ON public.content_flags
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS reviewer
      WHERE reviewer.id = auth.uid()
        AND (reviewer.is_admin IS TRUE OR reviewer.is_moderator IS TRUE)
    )
  );

REVOKE ALL ON TABLE public.content_flags FROM PUBLIC;

DO $
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.content_flags FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.content_flags FROM authenticated;
    GRANT SELECT ON TABLE public.content_flags TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.content_flags TO service_role;
  END IF;
END
$;

CREATE OR REPLACE FUNCTION public.review_content_flag(
  p_flag_id UUID,
  p_moderator_id UUID,
  p_status TEXT,
  p_action_taken TEXT DEFAULT 'none',
  p_moderator_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_flag public.content_flags%ROWTYPE;
  v_reviewer RECORD;
  v_target RECORD;
  v_note TEXT := NULLIF(BTRIM(p_moderator_notes), '');
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('reviewed', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Unsupported moderation status' USING ERRCODE = '22023';
  END IF;
  IF p_action_taken IS NULL OR p_action_taken NOT IN ('none', 'user_suspended') THEN
    RAISE EXCEPTION 'Unsupported moderation action' USING ERRCODE = '22023';
  END IF;
  IF p_moderator_notes IS NOT NULL AND LENGTH(p_moderator_notes) > 1000 THEN
    RAISE EXCEPTION 'Moderator notes must be 1000 characters or fewer' USING ERRCODE = '22023';
  END IF;
  IF p_action_taken = 'user_suspended' AND (p_status <> 'resolved' OR v_note IS NULL) THEN
    RAISE EXCEPTION 'A resolved suspension requires a reason' USING ERRCODE = '22023';
  END IF;
  IF p_action_taken = 'none' AND p_status = 'resolved' THEN
    RAISE EXCEPTION 'Resolved reports must record the moderation action taken' USING ERRCODE = '22023';
  END IF;

  SELECT is_admin, is_moderator
  INTO v_reviewer
  FROM public.profiles
  WHERE id = p_moderator_id
  FOR UPDATE;

  IF NOT FOUND OR (v_reviewer.is_admin IS NOT TRUE AND v_reviewer.is_moderator IS NOT TRUE) THEN
    RAISE EXCEPTION 'Moderator access required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_flag
  FROM public.content_flags
  WHERE id = p_flag_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Moderation report not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_flag.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Moderation report is no longer pending' USING ERRCODE = '55000';
  END IF;

  IF p_action_taken = 'user_suspended' THEN
    IF v_flag.content_type <> 'profile' THEN
      RAISE EXCEPTION 'Account suspension requires a profile report' USING ERRCODE = '22023';
    END IF;
    IF v_flag.content_id = p_moderator_id THEN
      RAISE EXCEPTION 'A moderator cannot suspend their own account from a report' USING ERRCODE = '22023';
    END IF;

    SELECT is_admin, is_moderator
    INTO v_target
    FROM public.profiles
    WHERE id = v_flag.content_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reported profile not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_reviewer.is_admin IS NOT TRUE
       AND (v_target.is_admin IS TRUE OR v_target.is_moderator IS TRUE) THEN
      RAISE EXCEPTION 'A moderator cannot suspend another moderator or administrator' USING ERRCODE = '42501';
    END IF;

    UPDATE public.profiles
    SET is_banned = TRUE,
        ban_reason = v_note,
        suspension_reason = v_note,
        suspended_at = NOW(),
        updated_at = NOW()
    WHERE id = v_flag.content_id;
  END IF;

  UPDATE public.content_flags
  SET status = p_status,
      action_taken = p_action_taken,
      moderator_id = p_moderator_id,
      moderator_notes = v_note,
      reviewed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_flag_id
  RETURNING * INTO v_flag;

  RETURN TO_JSONB(v_flag);
END;
$$;

REVOKE ALL ON FUNCTION public.review_content_flag(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.review_content_flag(UUID, UUID, TEXT, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.review_content_flag(UUID, UUID, TEXT, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.review_content_flag(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
  END IF;
END
$$;
