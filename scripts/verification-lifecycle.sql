-- LOOP identity verification lifecycle
-- Idempotent schema migration. Run through scripts/run-production-setup.mjs.
-- Verification is an authenticity review, not a Premium entitlement.

CREATE TABLE IF NOT EXISTS public.verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  real_name VARCHAR(255),
  username VARCHAR(100),
  social_links TEXT,
  reason TEXT,
  verification_type VARCHAR(50),
  documents_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  display_name TEXT,
  category TEXT,
  website_url TEXT,
  additional_info TEXT,
  CONSTRAINT verification_requests_verification_type_check
    CHECK (verification_type IS NULL OR verification_type IN ('creator', 'business', 'public_figure', 'nonprofit', 'influencer', 'root')),
  CONSTRAINT verification_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

ALTER TABLE public.verification_requests
  ADD COLUMN IF NOT EXISTS real_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS username VARCHAR(100),
  ADD COLUMN IF NOT EXISTS social_links TEXT,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS verification_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS documents_url TEXT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS additional_info TEXT;

UPDATE public.verification_requests
SET status = 'pending'
WHERE status IS NULL;

ALTER TABLE public.verification_requests
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.verification_requests
  DROP CONSTRAINT IF EXISTS verification_requests_verification_type_check,
  DROP CONSTRAINT IF EXISTS verification_requests_status_check;

ALTER TABLE public.verification_requests
  ADD CONSTRAINT verification_requests_verification_type_check
    CHECK (verification_type IS NULL OR verification_type IN ('creator', 'business', 'public_figure', 'nonprofit', 'influencer', 'root')),
  ADD CONSTRAINT verification_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.verification_requests
    WHERE status = 'pending' AND user_id IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Multiple pending verification requests exist for one or more users; reconcile them before applying the one-pending-request index'
      USING ERRCODE = '23505';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_requests_one_pending
  ON public.verification_requests(user_id)
  WHERE status = 'pending' AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verification_requests_status_created
  ON public.verification_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_verification_requests_user_created
  ON public.verification_requests(user_id, created_at DESC);

-- Applications are accessed through authenticated server routes using the
-- server-only Supabase service role. Remove the old broad applicant policies
-- so clients cannot read legal names or evidence URLs directly.
ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS verification_requests_select_policy ON public.verification_requests;
DROP POLICY IF EXISTS verification_requests_insert_policy ON public.verification_requests;
DROP POLICY IF EXISTS verification_requests_update_policy ON public.verification_requests;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.verification_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.verification_requests FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_requests TO service_role;
  END IF;
END
$$;

-- Review status and profile verification are committed together. If either
-- update fails, PostgreSQL rolls both changes back.
CREATE OR REPLACE FUNCTION public.review_verification_request(
  p_request_id UUID,
  p_reviewer_id UUID,
  p_action TEXT,
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_request public.verification_requests%ROWTYPE;
  v_updated_profiles INTEGER;
  v_note TEXT := NULLIF(BTRIM(p_admin_notes), '');
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Action must be approved or rejected'
      USING ERRCODE = '22023';
  END IF;

  IF p_admin_notes IS NOT NULL AND LENGTH(p_admin_notes) > 2000 THEN
    RAISE EXCEPTION 'Reviewer note must be 2000 characters or fewer'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'rejected' AND v_note IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_reviewer_id AND is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_request
  FROM public.verification_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification request not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Verification request is no longer pending'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.verification_requests
  SET status = p_action,
      admin_id = p_reviewer_id,
      reviewed_by = p_reviewer_id,
      admin_notes = v_note,
      rejection_reason = CASE WHEN p_action = 'rejected' THEN v_note ELSE NULL END,
      reviewed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  IF p_action = 'approved' THEN
    UPDATE public.profiles
    SET is_verified = TRUE
    WHERE id = v_request.user_id;

    GET DIAGNOSTICS v_updated_profiles = ROW_COUNT;
    IF v_updated_profiles <> 1 THEN
      RAISE EXCEPTION 'Applicant profile could not be verified'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  RETURN TO_JSONB(v_request);
END;
$$;

REVOKE ALL ON FUNCTION public.review_verification_request(UUID, UUID, TEXT, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.review_verification_request(UUID, UUID, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.review_verification_request(UUID, UUID, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.review_verification_request(UUID, UUID, TEXT, TEXT) TO service_role;
  END IF;
END
$$;


-- One-time applicant appeals and append-only verification decision history.
CREATE TABLE IF NOT EXISTS public.verification_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE
    REFERENCES public.verification_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 20 AND 2000),
  evidence_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewer_notes TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_appeals_status_created
  ON public.verification_appeals(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_verification_appeals_user_created
  ON public.verification_appeals(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.verification_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL,
  user_id UUID NOT NULL,
  actor_id UUID,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_review_events_request_created
  ON public.verification_review_events(request_id, created_at ASC);

ALTER TABLE public.verification_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_review_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.verification_appeals FROM anon;
    REVOKE ALL ON TABLE public.verification_review_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.verification_appeals FROM authenticated;
    REVOKE ALL ON TABLE public.verification_review_events FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON TABLE public.verification_appeals TO service_role;
    GRANT SELECT ON TABLE public.verification_review_events TO service_role;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.audit_verification_request_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_event_type TEXT;
  v_from_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'application_submitted';
    v_from_status := NULL;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_from_status := OLD.status;
    v_event_type := CASE
      WHEN OLD.status = 'pending' AND NEW.status = 'approved' THEN 'application_approved'
      WHEN OLD.status = 'pending' AND NEW.status = 'rejected' THEN 'application_rejected'
      WHEN OLD.status = 'rejected' AND NEW.status = 'pending' THEN 'application_reopened_after_appeal'
      ELSE 'application_status_changed'
    END;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.verification_review_events (
    request_id, user_id, actor_id, event_type, from_status, to_status
  )
  VALUES (
    NEW.id,
    NEW.user_id,
    CASE
      WHEN TG_OP = 'INSERT' THEN NEW.user_id
      ELSE COALESCE(NEW.reviewed_by, NEW.admin_id, OLD.reviewed_by, OLD.admin_id, NEW.user_id)
    END,
    v_event_type,
    v_from_status,
    NEW.status
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_verification_request_transition
  ON public.verification_requests;

CREATE TRIGGER audit_verification_request_transition
AFTER INSERT OR UPDATE OF status ON public.verification_requests
FOR EACH ROW
EXECUTE FUNCTION public.audit_verification_request_transition();

CREATE OR REPLACE FUNCTION public.submit_verification_appeal(
  p_request_id UUID,
  p_user_id UUID,
  p_reason TEXT,
  p_evidence_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_request public.verification_requests%ROWTYPE;
  v_appeal public.verification_appeals%ROWTYPE;
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_evidence_url TEXT := NULLIF(BTRIM(p_evidence_url), '');
BEGIN
  IF v_reason IS NULL OR char_length(v_reason) < 20 OR char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Appeal reason must be between 20 and 2000 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_evidence_url IS NOT NULL AND (
    char_length(v_evidence_url) > 2048
    OR v_evidence_url !~ '^https://[^[:space:]]+$'
  ) THEN
    RAISE EXCEPTION 'Appeal evidence must be a valid HTTPS URL'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_request
  FROM public.verification_requests
  WHERE id = p_request_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification request not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION 'Only rejected verification requests can be appealed'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.verification_appeals
    WHERE request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'This verification request already has an appeal'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.verification_appeals (
    request_id, user_id, reason, evidence_url
  )
  VALUES (
    p_request_id, p_user_id, v_reason, v_evidence_url
  )
  RETURNING * INTO v_appeal;

  INSERT INTO public.verification_review_events (
    request_id, user_id, actor_id, event_type, from_status, to_status
  )
  VALUES (
    p_request_id, p_user_id, p_user_id, 'appeal_submitted', 'rejected', 'rejected'
  );

  RETURN TO_JSONB(v_appeal);
END;
$$;

CREATE OR REPLACE FUNCTION public.review_verification_appeal(
  p_appeal_id UUID,
  p_reviewer_id UUID,
  p_action TEXT,
  p_rejection_reason TEXT DEFAULT NULL,
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_appeal public.verification_appeals%ROWTYPE;
  v_request public.verification_requests%ROWTYPE;
  v_rejection_reason TEXT := NULLIF(BTRIM(p_rejection_reason), '');
  v_admin_notes TEXT := NULLIF(BTRIM(p_admin_notes), '');
  v_request_status TEXT;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'Action must be accepted or rejected'
      USING ERRCODE = '22023';
  END IF;

  IF v_admin_notes IS NOT NULL AND char_length(v_admin_notes) > 2000 THEN
    RAISE EXCEPTION 'Reviewer note must be 2000 characters or fewer'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'rejected' AND (
    v_rejection_reason IS NULL OR char_length(v_rejection_reason) < 10
    OR char_length(v_rejection_reason) > 2000
  ) THEN
    RAISE EXCEPTION 'A rejection reason between 10 and 2000 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_reviewer_id AND is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_appeal
  FROM public.verification_appeals
  WHERE id = p_appeal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification appeal not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_appeal.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Verification appeal is no longer pending'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_request
  FROM public.verification_requests
  WHERE id = v_appeal.request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION 'The original verification request is no longer appealable'
      USING ERRCODE = '55000';
  END IF;

  IF p_action = 'accepted' THEN
    IF EXISTS (
      SELECT 1 FROM public.verification_requests
      WHERE user_id = v_request.user_id
        AND status = 'pending'
        AND id <> v_request.id
    ) THEN
      RAISE EXCEPTION 'A newer verification request is already pending'
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.verification_appeals
    SET status = 'accepted',
        reviewer_id = p_reviewer_id,
        reviewer_notes = v_admin_notes,
        rejection_reason = NULL,
        reviewed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_appeal_id
    RETURNING * INTO v_appeal;

    -- Reopen the same application. This does not grant verification; a
    -- separate reviewer decision must still approve it.
    UPDATE public.verification_requests
    SET status = 'pending',
        admin_id = NULL,
        reviewed_by = NULL,
        admin_notes = NULL,
        rejection_reason = NULL,
        reviewed_at = NULL,
        updated_at = NOW()
    WHERE id = v_request.id;

    v_request_status := 'pending';
  ELSE
    UPDATE public.verification_appeals
    SET status = 'rejected',
        reviewer_id = p_reviewer_id,
        reviewer_notes = v_admin_notes,
        rejection_reason = v_rejection_reason,
        reviewed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_appeal_id
    RETURNING * INTO v_appeal;

    v_request_status := v_request.status;
  END IF;

  INSERT INTO public.verification_review_events (
    request_id, user_id, actor_id, event_type, from_status, to_status
  )
  VALUES (
    v_appeal.request_id,
    v_appeal.user_id,
    p_reviewer_id,
    CASE WHEN p_action = 'accepted' THEN 'appeal_accepted' ELSE 'appeal_rejected' END,
    'rejected',
    v_request_status
  );

  RETURN JSONB_BUILD_OBJECT(
    'appeal', TO_JSONB(v_appeal),
    'request_status', v_request_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_verification_appeal(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_verification_appeal(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.submit_verification_appeal(UUID, UUID, TEXT, TEXT) FROM anon;
    REVOKE ALL ON FUNCTION public.review_verification_appeal(UUID, UUID, TEXT, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.submit_verification_appeal(UUID, UUID, TEXT, TEXT) FROM authenticated;
    REVOKE ALL ON FUNCTION public.review_verification_appeal(UUID, UUID, TEXT, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.submit_verification_appeal(UUID, UUID, TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.review_verification_appeal(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
  END IF;
END
$$;
