-- LOOP Circle membership lifecycle.
-- Requires circles-schema-alignment.sql and account-status-appeals-schema.sql
-- to have been applied by the canonical production setup runner.

CREATE OR REPLACE FUNCTION public.join_circle(
  p_circle_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_circle public.circles%ROWTYPE;
  v_profile RECORD;
  v_member public.circle_members%ROWTYPE;
  v_status TEXT;
  v_role TEXT := 'member';
  v_active_count INTEGER;
BEGIN
  -- Serialize joins against the capacity of this Circle.
  SELECT * INTO v_circle
  FROM public.circles
  WHERE id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Circle not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT is_banned, is_deleted
  INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_profile.is_banned IS TRUE OR v_profile.is_deleted IS TRUE THEN
    RAISE EXCEPTION 'Suspended or deleted accounts cannot join Circles'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_member
  FROM public.circle_members
  WHERE circle_id = p_circle_id AND user_id = p_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_member.status IN ('active', 'approved') THEN
      RETURN jsonb_build_object(
        'status', 'active',
        'already_member', TRUE,
        'is_private', COALESCE(v_circle.is_private, FALSE),
        'member_id', v_member.id
      );
    END IF;
    IF v_member.status = 'pending' THEN
      RETURN jsonb_build_object(
        'status', 'pending',
        'already_member', TRUE,
        'is_private', COALESCE(v_circle.is_private, FALSE),
        'member_id', v_member.id
      );
    END IF;
    IF v_member.status = 'banned' THEN
      RAISE EXCEPTION 'You cannot rejoin this Circle' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_status := CASE WHEN COALESCE(v_circle.is_private, FALSE) THEN 'pending' ELSE 'active' END;

  -- A Circle owner is always restored with the owner role; other joiners can
  -- never choose an elevated role from this public endpoint.
  IF p_user_id = v_circle.owner_id THEN
    v_status := 'active';
    v_role := 'owner';
  END IF;

  IF v_status = 'active' AND v_role <> 'owner' AND v_circle.max_members IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER INTO v_active_count
    FROM public.circle_members
    WHERE circle_id = p_circle_id
      AND status IN ('active', 'approved');

    IF v_active_count >= v_circle.max_members THEN
      RAISE EXCEPTION 'This Circle has reached its member limit' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.circle_members(circle_id, user_id, role, status, joined_at)
  VALUES (p_circle_id, p_user_id, v_role, v_status, NOW())
  ON CONFLICT (circle_id, user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    joined_at = EXCLUDED.joined_at
  RETURNING * INTO v_member;

  SELECT COUNT(*)::INTEGER INTO v_active_count
  FROM public.circle_members
  WHERE circle_id = p_circle_id
    AND status IN ('active', 'approved');

  UPDATE public.circles
  SET member_count = v_active_count,
      updated_at = NOW()
  WHERE id = p_circle_id;

  RETURN jsonb_build_object(
    'status', v_status,
    'already_member', FALSE,
    'is_private', COALESCE(v_circle.is_private, FALSE),
    'member_id', v_member.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_circle(UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.join_circle(UUID, UUID) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.join_circle(UUID, UUID) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.join_circle(UUID, UUID) TO service_role;
  END IF;
END
$$;


-- Review a private Circle membership request in the same transaction as its
-- capacity check. The Circle row is the mutex shared with join_circle().
CREATE OR REPLACE FUNCTION public.review_circle_join_request(
  p_circle_id UUID,
  p_member_id UUID,
  p_actor_id UUID,
  p_action TEXT,
  p_role TEXT DEFAULT 'member'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_circle public.circles%ROWTYPE;
  v_actor RECORD;
  v_target_profile RECORD;
  v_member public.circle_members%ROWTYPE;
  v_actor_role TEXT;
  v_member_count INTEGER;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Action must be approve or reject' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_circle
  FROM public.circles
  WHERE id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Circle not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT is_banned, is_deleted
  INTO v_actor
  FROM public.profiles
  WHERE id = p_actor_id
  FOR UPDATE;

  IF NOT FOUND OR v_actor.is_banned IS TRUE OR v_actor.is_deleted IS TRUE THEN
    RAISE EXCEPTION 'Active Circle staff account required' USING ERRCODE = '42501';
  END IF;

  IF p_actor_id = v_circle.owner_id THEN
    v_actor_role := 'owner';
  ELSE
    SELECT role, status
    INTO v_actor
    FROM public.circle_members
    WHERE circle_id = p_circle_id AND user_id = p_actor_id
    FOR UPDATE;

    IF NOT FOUND OR v_actor.status NOT IN ('active', 'approved')
       OR v_actor.role NOT IN ('admin', 'moderator') THEN
      RAISE EXCEPTION 'Circle staff access required' USING ERRCODE = '42501';
    END IF;
    v_actor_role := v_actor.role;
  END IF;

  SELECT * INTO v_member
  FROM public.circle_members
  WHERE id = p_member_id AND circle_id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Circle join request not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_member.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Circle join request is no longer pending' USING ERRCODE = '55000';
  END IF;

  IF p_action = 'reject' THEN
    UPDATE public.circle_members
    SET status = 'rejected'
    WHERE id = p_member_id
    RETURNING * INTO v_member;

    RETURN jsonb_build_object(
      'status', 'rejected',
      'user_id', v_member.user_id,
      'role', v_member.role
    );
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('member', 'moderator', 'admin') THEN
    RAISE EXCEPTION 'Unsupported Circle role' USING ERRCODE = '22023';
  END IF;
  IF p_role = 'admin' AND v_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the Circle owner can approve an admin' USING ERRCODE = '42501';
  END IF;
  IF p_role = 'moderator' AND v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only Circle owners or admins can approve a moderator' USING ERRCODE = '42501';
  END IF;

  SELECT is_banned, is_deleted
  INTO v_target_profile
  FROM public.profiles
  WHERE id = v_member.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Applicant profile not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_profile.is_banned IS TRUE OR v_target_profile.is_deleted IS TRUE THEN
    RAISE EXCEPTION 'Suspended or deleted accounts cannot be approved' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_member_count
  FROM public.circle_members
  WHERE circle_id = p_circle_id AND status IN ('active', 'approved');

  IF v_circle.max_members IS NOT NULL AND v_member_count >= v_circle.max_members THEN
    RAISE EXCEPTION 'This Circle has reached its member limit' USING ERRCODE = '22023';
  END IF;

  UPDATE public.circle_members
  SET status = 'active',
      role = p_role,
      joined_at = NOW()
  WHERE id = p_member_id
  RETURNING * INTO v_member;

  SELECT COUNT(*)::INTEGER INTO v_member_count
  FROM public.circle_members
  WHERE circle_id = p_circle_id AND status IN ('active', 'approved');

  UPDATE public.circles
  SET member_count = v_member_count,
      updated_at = NOW()
  WHERE id = p_circle_id;

  RETURN jsonb_build_object(
    'status', 'active',
    'user_id', v_member.user_id,
    'role', v_member.role,
    'member_count', v_member_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_circle_join_request(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.review_circle_join_request(UUID, UUID, UUID, TEXT, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.review_circle_join_request(UUID, UUID, UUID, TEXT, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.review_circle_join_request(UUID, UUID, UUID, TEXT, TEXT) TO service_role;
  END IF;
END
$$;

-- All membership removals, bans and voluntary leaves share the same Circle-row
-- lock as joins and approvals. This keeps member_count canonical under load and
-- rechecks the actor's live role inside the database transaction.
CREATE OR REPLACE FUNCTION public.manage_circle_member(
  p_circle_id UUID,
  p_actor_id UUID,
  p_target_user_id UUID,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_circle public.circles%ROWTYPE;
  v_actor_profile RECORD;
  v_actor_membership RECORD;
  v_target_membership RECORD;
  v_actor_role TEXT;
  v_member_count INTEGER;
  v_result_status TEXT;
BEGIN
  IF p_circle_id IS NULL OR p_actor_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Circle and account IDs are required' USING ERRCODE = '22023';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('leave', 'remove', 'ban') THEN
    RAISE EXCEPTION 'Action must be leave, remove or ban' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_circle
  FROM public.circles
  WHERE id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Circle not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT is_banned, is_deleted
  INTO v_actor_profile
  FROM public.profiles
  WHERE id = p_actor_id
  FOR UPDATE;

  IF NOT FOUND OR v_actor_profile.is_banned IS TRUE OR v_actor_profile.is_deleted IS TRUE THEN
    RAISE EXCEPTION 'An active account is required' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'leave' THEN
    IF p_actor_id IS DISTINCT FROM p_target_user_id THEN
      RAISE EXCEPTION 'You can only leave a Circle as yourself' USING ERRCODE = '42501';
    END IF;
    IF p_actor_id = v_circle.owner_id THEN
      RAISE EXCEPTION 'Transfer Circle ownership before leaving' USING ERRCODE = '22023';
    END IF;

    SELECT role::TEXT AS role, status::TEXT AS status
    INTO v_target_membership
    FROM public.circle_members
    WHERE circle_id = p_circle_id AND user_id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Circle membership not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_target_membership.role = 'owner' THEN
      RAISE EXCEPTION 'Transfer Circle ownership before leaving' USING ERRCODE = '22023';
    END IF;
    IF v_target_membership.status = 'banned' THEN
      RAISE EXCEPTION 'A banned member cannot leave to clear the ban' USING ERRCODE = '42501';
    END IF;
    IF v_target_membership.status NOT IN ('active', 'approved', 'pending') THEN
      RAISE EXCEPTION 'This membership can no longer be withdrawn' USING ERRCODE = '55000';
    END IF;

    v_result_status := CASE
      WHEN v_target_membership.status = 'pending' THEN 'cancelled'
      ELSE 'left'
    END;

    DELETE FROM public.circle_members
    WHERE circle_id = p_circle_id AND user_id = p_target_user_id;
  ELSE
    IF p_actor_id = p_target_user_id THEN
      RAISE EXCEPTION 'Use the leave action for your own membership' USING ERRCODE = '22023';
    END IF;

    IF p_actor_id = v_circle.owner_id THEN
      v_actor_role := 'owner';
    ELSE
      SELECT role::TEXT AS role, status::TEXT AS status
      INTO v_actor_membership
      FROM public.circle_members
      WHERE circle_id = p_circle_id AND user_id = p_actor_id
      FOR UPDATE;

      IF NOT FOUND
         OR v_actor_membership.status NOT IN ('active', 'approved')
         OR v_actor_membership.role NOT IN ('admin', 'moderator') THEN
        RAISE EXCEPTION 'Current Circle staff access is required' USING ERRCODE = '42501';
      END IF;
      v_actor_role := v_actor_membership.role;
    END IF;

    SELECT role::TEXT AS role, status::TEXT AS status
    INTO v_target_membership
    FROM public.circle_members
    WHERE circle_id = p_circle_id AND user_id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Circle member not found' USING ERRCODE = 'P0002';
    END IF;
    IF p_target_user_id = v_circle.owner_id OR v_target_membership.role = 'owner' THEN
      RAISE EXCEPTION 'Circle ownership cannot be removed or banned' USING ERRCODE = '42501';
    END IF;
    IF v_target_membership.status = 'banned' THEN
      RAISE EXCEPTION 'This member is already banned' USING ERRCODE = '55000';
    END IF;
    IF v_target_membership.status NOT IN ('active', 'approved', 'pending') THEN
      RAISE EXCEPTION 'This membership cannot be moderated in its current state' USING ERRCODE = '55000';
    END IF;

    IF NOT (
      (v_actor_role = 'owner' AND v_target_membership.role <> 'guest')
      OR (v_actor_role = 'admin' AND v_target_membership.role IN ('member', 'moderator'))
      OR (v_actor_role = 'moderator' AND v_target_membership.role = 'member')
    ) THEN
      RAISE EXCEPTION 'Cannot remove a member with an equal or higher role' USING ERRCODE = '42501';
    END IF;

    IF p_action = 'ban' THEN
      UPDATE public.circle_members
      SET status = 'banned'
      WHERE circle_id = p_circle_id AND user_id = p_target_user_id;
      v_result_status := 'banned';
    ELSE
      DELETE FROM public.circle_members
      WHERE circle_id = p_circle_id AND user_id = p_target_user_id;
      v_result_status := 'removed';
    END IF;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_member_count
  FROM public.circle_members
  WHERE circle_id = p_circle_id
    AND status IN ('active', 'approved');

  UPDATE public.circles
  SET member_count = v_member_count,
      updated_at = NOW()
  WHERE id = p_circle_id;

  RETURN jsonb_build_object(
    'circle_id', p_circle_id,
    'user_id', p_target_user_id,
    'status', v_result_status,
    'member_count', v_member_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manage_circle_member(UUID, UUID, UUID, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.manage_circle_member(UUID, UUID, UUID, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.manage_circle_member(UUID, UUID, UUID, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.manage_circle_member(UUID, UUID, UUID, TEXT) TO service_role;
  END IF;
END
$$;

-- Role changes and per-member overrides use the same Circle-row lock as
-- join/approval/removal, so concurrent role changes cannot use stale authority.
CREATE OR REPLACE FUNCTION public.update_circle_member(
  p_circle_id UUID,
  p_actor_id UUID,
  p_target_user_id UUID,
  p_new_role TEXT DEFAULT NULL,
  p_update_custom_title BOOLEAN DEFAULT FALSE,
  p_custom_title TEXT DEFAULT NULL,
  p_update_permissions BOOLEAN DEFAULT FALSE,
  p_permissions JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_circle public.circles%ROWTYPE;
  v_actor_profile RECORD;
  v_actor_membership RECORD;
  v_target_membership RECORD;
  v_target_profile RECORD;
  v_actor_role TEXT;
  v_permission_key TEXT;
  v_permission_value JSONB;
  v_member JSONB;
BEGIN
  IF p_circle_id IS NULL OR p_actor_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Circle and account IDs are required' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id = p_target_user_id THEN
    RAISE EXCEPTION 'You cannot manage your own Circle membership' USING ERRCODE = '42501';
  END IF;
  IF p_new_role IS NULL AND NOT p_update_custom_title AND NOT p_update_permissions THEN
    RAISE EXCEPTION 'No member changes were supplied' USING ERRCODE = '22023';
  END IF;
  IF p_new_role IS NOT NULL AND p_new_role NOT IN ('member', 'moderator', 'admin') THEN
    RAISE EXCEPTION 'Unsupported Circle role' USING ERRCODE = '22023';
  END IF;
  IF p_update_custom_title AND p_custom_title IS NOT NULL AND char_length(btrim(p_custom_title)) > 40 THEN
    RAISE EXCEPTION 'Custom titles cannot exceed 40 characters' USING ERRCODE = '22023';
  END IF;
  IF p_update_permissions THEN
    IF p_permissions IS NULL OR jsonb_typeof(p_permissions) <> 'object' THEN
      RAISE EXCEPTION 'Permissions must be a JSON object' USING ERRCODE = '22023';
    END IF;
    FOR v_permission_key, v_permission_value IN
      SELECT key, value FROM jsonb_each(p_permissions)
    LOOP
      IF v_permission_key NOT IN (
        'can_manage_events',
        'can_manage_rooms',
        'can_pin_posts',
        'can_moderate',
        'can_post_announcements'
      ) OR jsonb_typeof(v_permission_value) <> 'boolean' THEN
        RAISE EXCEPTION 'Permission overrides contain an unsupported key or non-boolean value'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  SELECT * INTO v_circle
  FROM public.circles
  WHERE id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Circle not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT is_banned, is_deleted
  INTO v_actor_profile
  FROM public.profiles
  WHERE id = p_actor_id
  FOR UPDATE;

  IF NOT FOUND OR v_actor_profile.is_banned IS TRUE OR v_actor_profile.is_deleted IS TRUE THEN
    RAISE EXCEPTION 'An active account is required' USING ERRCODE = '42501';
  END IF;

  IF p_actor_id = v_circle.owner_id THEN
    v_actor_role := 'owner';
  ELSE
    SELECT role::TEXT AS role, status::TEXT AS status
    INTO v_actor_membership
    FROM public.circle_members
    WHERE circle_id = p_circle_id AND user_id = p_actor_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_actor_membership.status NOT IN ('active', 'approved')
       OR v_actor_membership.role NOT IN ('admin') THEN
      RAISE EXCEPTION 'Current Circle owner or admin access is required' USING ERRCODE = '42501';
    END IF;
    v_actor_role := v_actor_membership.role;
  END IF;

  SELECT role::TEXT AS role, status::TEXT AS status
  INTO v_target_membership
  FROM public.circle_members
  WHERE circle_id = p_circle_id AND user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Circle member not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_target_user_id = v_circle.owner_id OR v_target_membership.role = 'owner' THEN
    RAISE EXCEPTION 'Circle ownership cannot be changed through member settings' USING ERRCODE = '42501';
  END IF;
  IF v_target_membership.status NOT IN ('active', 'approved') THEN
    RAISE EXCEPTION 'Only active Circle members can be managed' USING ERRCODE = '55000';
  END IF;

  SELECT is_banned, is_deleted
  INTO v_target_profile
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_target_profile.is_banned IS TRUE OR v_target_profile.is_deleted IS TRUE THEN
    RAISE EXCEPTION 'This account is not eligible for Circle role changes' USING ERRCODE = '42501';
  END IF;

  IF p_new_role IS NOT NULL THEN
    IF v_actor_role = 'admin'
       AND (
         v_target_membership.role NOT IN ('member', 'moderator')
         OR p_new_role NOT IN ('member', 'moderator')
       ) THEN
      RAISE EXCEPTION 'Admins can only manage member and moderator roles' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_update_custom_title OR p_update_permissions THEN
    IF v_target_membership.role NOT IN ('member', 'moderator') THEN
      RAISE EXCEPTION 'Only member or moderator settings can be changed' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_update_permissions
     AND p_permissions ? 'can_moderate'
     AND v_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the Circle owner can grant moderation permission overrides'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.circle_members
  SET role = COALESCE(p_new_role, role),
      custom_title = CASE
        WHEN p_update_custom_title THEN NULLIF(btrim(p_custom_title), '')
        ELSE custom_title
      END,
      permissions = CASE
        WHEN p_update_permissions THEN p_permissions
        ELSE permissions
      END
  WHERE circle_id = p_circle_id
    AND user_id = p_target_user_id
    AND status IN ('active', 'approved');

  SELECT jsonb_build_object(
    'id', member.id,
    'circle_id', member.circle_id,
    'user_id', member.user_id,
    'role', member.role,
    'status', member.status,
    'custom_title', member.custom_title,
    'permissions', member.permissions,
    'joined_at', member.joined_at,
    'user', jsonb_build_object(
      'id', profile.id,
      'username', profile.username,
      'display_name', profile.display_name,
      'avatar_url', profile.avatar_url,
      'video_avatar_url', profile.video_avatar_url
    )
  )
  INTO v_member
  FROM public.circle_members AS member
  JOIN public.profiles AS profile ON profile.id = member.user_id
  WHERE member.circle_id = p_circle_id AND member.user_id = p_target_user_id;

  RETURN jsonb_build_object('member', v_member);
END;
$$;

REVOKE ALL ON FUNCTION public.update_circle_member(UUID, UUID, UUID, TEXT, BOOLEAN, TEXT, BOOLEAN, JSONB) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.update_circle_member(UUID, UUID, UUID, TEXT, BOOLEAN, TEXT, BOOLEAN, JSONB) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.update_circle_member(UUID, UUID, UUID, TEXT, BOOLEAN, TEXT, BOOLEAN, JSONB) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.update_circle_member(UUID, UUID, UUID, TEXT, BOOLEAN, TEXT, BOOLEAN, JSONB) TO service_role;
  END IF;
END
$$;
