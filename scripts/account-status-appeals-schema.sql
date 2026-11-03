-- ============================================================================
-- LOOP account status and private suspension appeals.
-- Idempotent and safe to re-run. Applied after community-chat-schema.sql.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ban_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.ban_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

ALTER TABLE public.ban_appeals
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

UPDATE public.ban_appeals
SET status = 'pending'
WHERE status IS NULL OR status NOT IN ('pending', 'approved', 'denied');

ALTER TABLE public.ban_appeals
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.ban_appeals
  DROP CONSTRAINT IF EXISTS ban_appeals_status_check;
ALTER TABLE public.ban_appeals
  ADD CONSTRAINT ban_appeals_status_check
  CHECK (status IN ('pending', 'approved', 'denied'));

-- Remove the legacy lifetime-unique constraint so decisions remain auditable.
-- Only an open appeal is unique per user; a new appeal can follow a prior decision.
ALTER TABLE public.ban_appeals
  DROP CONSTRAINT IF EXISTS ban_appeals_user_id_key;

WITH ranked_pending AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC, id ASC) AS duplicate_rank
  FROM public.ban_appeals
  WHERE status = 'pending'
)
UPDATE public.ban_appeals AS appeal
SET status = 'denied',
    admin_notes = COALESCE(NULLIF(appeal.admin_notes, ''), 'Duplicate pending appeal reconciled during schema migration.'),
    reviewed_at = COALESCE(appeal.reviewed_at, NOW())
FROM ranked_pending AS ranked
WHERE ranked.id = appeal.id AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ban_appeals_one_pending_per_user
  ON public.ban_appeals(user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ban_appeals_status_created
  ON public.ban_appeals(status, created_at DESC);

-- Keep the existing Circle room bot/moderation metadata available on fresh
-- installations, but run only after the community chat schema creates it.
ALTER TABLE public.circle_room_messages
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bot_name TEXT,
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS moderation_reason TEXT;

-- Appeals may contain sensitive account and enforcement context. Use only the
-- authenticated server routes and service role, never direct browser access.
ALTER TABLE public.ban_appeals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own appeals" ON public.ban_appeals;
DROP POLICY IF EXISTS "Users create appeals" ON public.ban_appeals;
DROP POLICY IF EXISTS "Admins manage appeals" ON public.ban_appeals;
REVOKE ALL ON TABLE public.ban_appeals FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.ban_appeals FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.ban_appeals FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ban_appeals TO service_role;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.review_ban_appeal(
  p_appeal_id UUID,
  p_reviewer_id UUID,
  p_decision TEXT,
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_appeal public.ban_appeals%ROWTYPE;
  v_reviewer RECORD;
  v_note TEXT := NULLIF(BTRIM(p_admin_notes), '');
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'deny') THEN
    RAISE EXCEPTION 'Decision must be approve or deny' USING ERRCODE = '22023';
  END IF;
  IF p_admin_notes IS NOT NULL AND LENGTH(p_admin_notes) > 2000 THEN
    RAISE EXCEPTION 'Reviewer note must be 2000 characters or fewer' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'deny' AND v_note IS NULL THEN
    RAISE EXCEPTION 'A reason is required when denying an appeal' USING ERRCODE = '22023';
  END IF;

  SELECT is_admin, is_moderator
  INTO v_reviewer
  FROM public.profiles
  WHERE id = p_reviewer_id
  FOR UPDATE;

  IF NOT FOUND OR (v_reviewer.is_admin IS NOT TRUE AND v_reviewer.is_moderator IS NOT TRUE) THEN
    RAISE EXCEPTION 'Moderator access required' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_appeal
  FROM public.ban_appeals
  WHERE id = p_appeal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appeal not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_appeal.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Appeal has already been reviewed' USING ERRCODE = '55000';
  END IF;

  IF p_decision = 'approve' THEN
    UPDATE public.profiles
    SET is_banned = FALSE,
        ban_reason = NULL,
        suspension_reason = NULL,
        suspended_at = NULL,
        updated_at = NOW()
    WHERE id = v_appeal.user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Appealed profile not found' USING ERRCODE = '23503';
    END IF;
  END IF;

  UPDATE public.ban_appeals
  SET status = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'denied' END,
      admin_notes = v_note,
      reviewed_by = p_reviewer_id,
      reviewed_at = NOW()
  WHERE id = p_appeal_id
  RETURNING * INTO v_appeal;

  RETURN TO_JSONB(v_appeal);
END;
$$;

REVOKE ALL ON FUNCTION public.review_ban_appeal(UUID, UUID, TEXT, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.review_ban_appeal(UUID, UUID, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.review_ban_appeal(UUID, UUID, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.review_ban_appeal(UUID, UUID, TEXT, TEXT) TO service_role;
  END IF;
END
$$;
