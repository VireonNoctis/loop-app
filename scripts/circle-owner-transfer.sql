-- Circle ownership is represented both by circles.owner_id and the owner
-- membership role. Keep the enum and both records in sync.
ALTER TYPE public.member_role ADD VALUE IF NOT EXISTS 'owner';

CREATE OR REPLACE FUNCTION public.transfer_circle_ownership(
    p_circle_id UUID,
    p_actor_id UUID,
    p_new_owner_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_current_owner_id UUID;
    v_new_owner_status TEXT;
    v_profile RECORD;
    v_member_count INTEGER;
BEGIN
    IF p_circle_id IS NULL OR p_actor_id IS NULL OR p_new_owner_id IS NULL THEN
        RAISE EXCEPTION 'Circle and account IDs are required'
            USING ERRCODE = '22023';
    END IF;

    IF p_actor_id = p_new_owner_id THEN
        RAISE EXCEPTION 'The current owner already owns this Circle'
            USING ERRCODE = '22023';
    END IF;

    -- The Circle row serializes ownership transfers with other lifecycle work.
    SELECT owner_id
    INTO v_current_owner_id
    FROM public.circles
    WHERE id = p_circle_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Circle not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_current_owner_id IS DISTINCT FROM p_actor_id THEN
        RAISE EXCEPTION 'Only the current Circle owner can transfer ownership'
            USING ERRCODE = '42501';
    END IF;

    SELECT is_banned, is_deleted
    INTO v_profile
    FROM public.profiles
    WHERE id = p_new_owner_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The new owner account was not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_profile.is_banned IS TRUE OR v_profile.is_deleted IS TRUE THEN
        RAISE EXCEPTION 'Suspended or deleted accounts cannot own a Circle'
            USING ERRCODE = '42501';
    END IF;

    SELECT status
    INTO v_new_owner_status
    FROM public.circle_members
    WHERE circle_id = p_circle_id
      AND user_id = p_new_owner_id
    FOR UPDATE;

    IF NOT FOUND OR v_new_owner_status NOT IN ('active', 'approved') THEN
        RAISE EXCEPTION 'The new owner must be an active Circle member'
            USING ERRCODE = '42501';
    END IF;

    -- Transfer the canonical owner pointer and normalize the membership roles
    -- within the same transaction. The former owner remains an admin member.
    UPDATE public.circles
    SET owner_id = p_new_owner_id,
        updated_at = NOW()
    WHERE id = p_circle_id;

    UPDATE public.circle_members
    SET role = 'owner'
    WHERE circle_id = p_circle_id
      AND user_id = p_new_owner_id
      AND status IN ('active', 'approved');

    INSERT INTO public.circle_members (
        circle_id, user_id, role, status, joined_at
    )
    VALUES (
        p_circle_id, p_actor_id, 'admin', 'active', NOW()
    )
    ON CONFLICT (circle_id, user_id)
    DO UPDATE SET role = 'admin'
    WHERE public.circle_members.status IN ('active', 'approved');

    SELECT COUNT(*)::INTEGER
    INTO v_member_count
    FROM public.circle_members
    WHERE circle_id = p_circle_id
      AND status IN ('active', 'approved');

    UPDATE public.circles
    SET member_count = v_member_count,
        updated_at = NOW()
    WHERE id = p_circle_id;

    INSERT INTO public.notifications (user_id, type, title, message, data, is_read)
    VALUES
    (
        p_new_owner_id,
        'system',
        'You now own this Circle',
        'Circle ownership has been transferred to your account.',
        jsonb_build_object('circle_id', p_circle_id::TEXT, 'route', '/circles/' || p_circle_id::TEXT),
        FALSE
    ),
    (
        p_actor_id,
        'system',
        'Circle ownership transferred',
        'You are now an admin of this Circle.',
        jsonb_build_object('circle_id', p_circle_id::TEXT, 'route', '/circles/' || p_circle_id::TEXT),
        FALSE
    );

    RETURN jsonb_build_object(
        'circle_id', p_circle_id,
        'previous_owner_id', p_actor_id,
        'owner_id', p_new_owner_id,
        'member_count', v_member_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_circle_ownership(UUID, UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON FUNCTION public.transfer_circle_ownership(UUID, UUID, UUID) FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON FUNCTION public.transfer_circle_ownership(UUID, UUID, UUID) FROM authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.transfer_circle_ownership(UUID, UUID, UUID) TO service_role;
    END IF;
END
$$;
