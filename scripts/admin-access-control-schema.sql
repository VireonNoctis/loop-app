-- LOOP staff-role hierarchy and user-scoped permission control.
-- Explicit staff_role takes precedence over legacy flags. Existing is_admin
-- accounts are intentionally resolved as Developers until reassigned.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS staff_role TEXT;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_moderator BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_team_member BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.profiles
SET staff_role = 'moderator'
WHERE staff_role IS NULL
  AND COALESCE(is_moderator, FALSE) = TRUE
  AND COALESCE(is_admin, FALSE) = FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_staff_role_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_staff_role_check
      CHECK (staff_role IS NULL OR staff_role IN ('developer', 'admin', 'moderator'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.team_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission_key)
);
ALTER TABLE public.team_permissions
  ADD COLUMN IF NOT EXISTS granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.team_permissions
  ADD COLUMN IF NOT EXISTS granted_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_team_permissions_user_id
  ON public.team_permissions(user_id);
ALTER TABLE public.team_permissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admin_access_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  previous_role TEXT NOT NULL,
  next_role TEXT NOT NULL,
  previous_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_access_audit_target_created
  ON public.admin_access_audit(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_access_audit_actor_created
  ON public.admin_access_audit(actor_id, created_at DESC);
ALTER TABLE public.admin_access_audit ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_update_access(
  p_actor_id UUID,
  p_target_id UUID,
  p_new_role TEXT,
  p_permissions TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_record RECORD;
  target_record RECORD;
  actor_role TEXT;
  target_role TEXT;
  next_role TEXT;
  next_permissions TEXT[] := COALESCE(p_permissions, ARRAY[]::TEXT[]);
  previous_permissions JSONB := '[]'::jsonb;
  valid_permissions CONSTANT TEXT[] := ARRAY[
    'moderation', 'gifs_emojis', 'ads', 'events', 'support', 'analytics',
    'economy', 'pro_lounge', 'organizations', 'featured', 'broadcast',
    'verification', 'awards', 'coloop_sessions', 'account_management',
    'health', 'cache', 'settings'
  ];
  moderator_permissions CONSTANT TEXT[] := ARRAY['moderation', 'support'];
  developer_count INTEGER;
BEGIN
  IF p_actor_id IS NULL OR p_target_id IS NULL OR p_actor_id = p_target_id THEN
    RAISE EXCEPTION 'You cannot change your own access settings';
  END IF;

  SELECT id, staff_role, is_admin, is_moderator
    INTO actor_record
    FROM profiles
    WHERE id = p_actor_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actor profile not found';
  END IF;

  actor_role := COALESCE(
    actor_record.staff_role,
    CASE
      WHEN COALESCE(actor_record.is_admin, FALSE) THEN 'developer'
      WHEN COALESCE(actor_record.is_moderator, FALSE) THEN 'moderator'
      ELSE NULL
    END
  );
  IF actor_role IS NULL OR actor_role NOT IN ('developer', 'admin', 'moderator') THEN
    RAISE EXCEPTION 'Admin dashboard access required';
  END IF;

  SELECT id, staff_role, is_admin, is_moderator, username
    INTO target_record
    FROM profiles
    WHERE id = p_target_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target account not found';
  END IF;

  target_role := COALESCE(
    target_record.staff_role,
    CASE
      WHEN COALESCE(target_record.is_admin, FALSE) THEN 'developer'
      WHEN COALESCE(target_record.is_moderator, FALSE) THEN 'moderator'
      ELSE NULL
    END
  );

  IF p_new_role IS NULL OR p_new_role NOT IN ('user', 'developer', 'admin', 'moderator') THEN
    RAISE EXCEPTION 'Invalid staff role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(next_permissions) AS selected(permission_key)
    WHERE selected.permission_key <> ALL(valid_permissions)
  ) THEN
    RAISE EXCEPTION 'One or more permissions are not recognised';
  END IF;
  IF cardinality(next_permissions) <> (
    SELECT COUNT(DISTINCT selected.permission_key)
    FROM unnest(next_permissions) AS selected(permission_key)
  ) THEN
    RAISE EXCEPTION 'Duplicate permissions are not allowed';
  END IF;

  IF actor_role = 'moderator' THEN
    IF target_role IS NOT NULL THEN
      RAISE EXCEPTION 'Moderators can only edit permissions for regular users';
    END IF;
    IF p_new_role <> 'user' THEN
      RAISE EXCEPTION 'Moderators cannot assign staff roles';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(next_permissions) AS selected(permission_key)
      WHERE selected.permission_key <> ALL(moderator_permissions)
    ) THEN
      RAISE EXCEPTION 'Moderators may only grant Moderation and Support permissions';
    END IF;
  ELSIF actor_role = 'admin' THEN
    IF target_role IN ('developer', 'admin') THEN
      RAISE EXCEPTION 'Admins cannot edit Developer or Admin accounts';
    END IF;
    IF p_new_role NOT IN ('user', 'moderator') THEN
      RAISE EXCEPTION 'Admins may only assign or remove the Moderator role';
    END IF;
  END IF;

  next_role := CASE WHEN p_new_role = 'user' THEN NULL ELSE p_new_role END;

  IF target_role = 'developer' AND next_role IS DISTINCT FROM 'developer' THEN
    SELECT COUNT(*) INTO developer_count
    FROM profiles
    WHERE staff_role = 'developer'
       OR (staff_role IS NULL AND COALESCE(is_admin, FALSE) = TRUE);
    IF developer_count <= 1 THEN
      RAISE EXCEPTION 'The last Developer account cannot be demoted';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(permission_key ORDER BY permission_key), '[]'::jsonb)
    INTO previous_permissions
    FROM team_permissions
    WHERE user_id = p_target_id;

  DELETE FROM team_permissions WHERE user_id = p_target_id;
  INSERT INTO team_permissions (user_id, permission_key, granted_by, granted_at)
  SELECT p_target_id, selected.permission_key, p_actor_id, now()
  FROM unnest(next_permissions) AS selected(permission_key);

  UPDATE profiles
  SET
    staff_role = next_role,
    is_admin = COALESCE(next_role IN ('developer', 'admin'), FALSE),
    is_moderator = COALESCE(next_role = 'moderator', FALSE),
    is_team_member = (next_role IS NOT NULL OR cardinality(next_permissions) > 0),
    updated_at = now()
  WHERE id = p_target_id;

  INSERT INTO admin_access_audit (
    actor_id, target_user_id, previous_role, next_role,
    previous_permissions, next_permissions
  )
  VALUES (
    p_actor_id, p_target_id, COALESCE(target_role, 'user'), COALESCE(next_role, 'user'),
    previous_permissions, to_jsonb(next_permissions)
  );

  RETURN jsonb_build_object(
    'user_id', p_target_id,
    'staff_role', COALESCE(next_role, 'user'),
    'permissions', to_jsonb(next_permissions)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_access(UUID, UUID, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_access(UUID, UUID, TEXT, TEXT[]) TO service_role;
