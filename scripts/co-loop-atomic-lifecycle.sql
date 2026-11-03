-- Atomic Co-Loop version history writer.
-- This runs after the session, open-invite, and version tables exist.

-- Atomic version allocation and snapshot insert.
-- Locking the owning session row serializes concurrent saves for one room.
CREATE OR REPLACE FUNCTION public.create_co_loop_version(
    p_session_id TEXT,
    p_actor_id UUID,
    p_title TEXT,
    p_content TEXT,
    p_hashtags JSONB,
    p_media_url TEXT,
    p_media_urls JSONB,
    p_media_type TEXT,
    p_label TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $
DECLARE
    locked_session public.co_loop_sessions%ROWTYPE;
    actor_profile public.profiles%ROWTYPE;
    next_version INTEGER;
    saved_version public.co_loop_versions%ROWTYPE;
    allowed BOOLEAN := false;
BEGIN
    SELECT *
      INTO locked_session
      FROM public.co_loop_sessions
     WHERE session_id = p_session_id
     FOR UPDATE;

    IF NOT FOUND OR locked_session.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'co_loop_unavailable' USING ERRCODE = 'P0002';
    END IF;
    IF locked_session.status <> 'active' THEN
        RAISE EXCEPTION 'co_loop_inactive' USING ERRCODE = '55000';
    END IF;
    IF locked_session.locked AND locked_session.owner_id <> p_actor_id THEN
        RAISE EXCEPTION 'co_loop_locked' USING ERRCODE = '42501';
    END IF;

    allowed := locked_session.owner_id = p_actor_id
        OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements(
                    CASE
                      WHEN jsonb_typeof(locked_session.co_authors) = 'array'
                      THEN locked_session.co_authors
                      ELSE '[]'::jsonb
                    END
              ) AS author
             WHERE author->>'id' = p_actor_id::text
        )
        OR EXISTS (
            SELECT 1
              FROM public.open_co_loop_participants AS participant
             WHERE participant.session_id = p_session_id
               AND participant.user_id = p_actor_id
        );

    IF NOT allowed THEN
        RAISE EXCEPTION 'co_loop_participant_required' USING ERRCODE = '42501';
    END IF;

    IF p_media_type NOT IN ('text', 'image', 'video') THEN
        RAISE EXCEPTION 'invalid_media_type' USING ERRCODE = '22023';
    END IF;
    IF length(COALESCE(p_title, '')) > 300 OR length(COALESCE(p_content, '')) > 40000 THEN
        RAISE EXCEPTION 'version_content_too_large' USING ERRCODE = '22001';
    END IF;

    SELECT COALESCE(MAX(version_number), 0) + 1
      INTO next_version
      FROM public.co_loop_versions
     WHERE session_id = p_session_id;

    SELECT *
      INTO actor_profile
      FROM public.profiles
     WHERE id = p_actor_id;

    INSERT INTO public.co_loop_versions (
        session_id, version_number, title, content, hashtags, media_url,
        media_urls, media_type, co_authors, label, saved_by_id,
        saved_by_name, saved_by_avatar
    )
    VALUES (
        p_session_id,
        next_version,
        COALESCE(p_title, ''),
        COALESCE(p_content, ''),
        COALESCE(p_hashtags, '[]'::jsonb),
        p_media_url,
        COALESCE(p_media_urls, '[]'::jsonb),
        p_media_type,
        COALESCE(locked_session.co_authors, '[]'::jsonb),
        CASE
          WHEN NULLIF(BTRIM(p_label), '') IS NOT NULL THEN LEFT(BTRIM(p_label), 120)
          WHEN next_version = 1 THEN 'Initial Draft'
          ELSE 'Checkpoint #' || next_version::text
        END,
        p_actor_id,
        COALESCE(actor_profile.display_name, actor_profile.username, 'Collaborator'),
        actor_profile.avatar_url
    )
    RETURNING * INTO saved_version;

    UPDATE public.co_loop_sessions
       SET updated_at = NOW()
     WHERE session_id = p_session_id;

    RETURN TO_JSONB(saved_version);
END;
$$;

REVOKE ALL ON FUNCTION public.create_co_loop_version(
    TEXT, UUID, TEXT, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_co_loop_version(
    TEXT, UUID, TEXT, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT
) TO service_role;


-- Atomically reserve a collaborator slot and update the durable room roster.
-- The session row lock serializes simultaneous joins for the same Co-Loop.
CREATE OR REPLACE FUNCTION public.join_open_co_loop_session(
    p_session_id TEXT,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    room public.co_loop_sessions%ROWTYPE;
    profile public.profiles%ROWTYPE;
    existing_participant BOOLEAN;
    seat_already_reserved BOOLEAN;
    invitation_status TEXT;
    invitation_expires_at TIMESTAMPTZ;
    reserved_count INTEGER;
    current_count INTEGER;
    capacity INTEGER;
    co_author JSONB;
    final_roster JSONB;
BEGIN
    SELECT *
      INTO room
      FROM public.co_loop_sessions
     WHERE session_id = p_session_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF room.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'session_deleted' USING ERRCODE = '55000';
    END IF;
    IF room.status <> 'active' THEN
        RAISE EXCEPTION 'session_inactive' USING ERRCODE = '55000';
    END IF;
    IF NOT COALESCE(room.is_open_invite, false) THEN
        RAISE EXCEPTION 'session_not_open' USING ERRCODE = '42501';
    END IF;

    capacity := LEAST(4, GREATEST(2, COALESCE(room.max_collaborators, 4)));

    SELECT *
      INTO profile
      FROM public.profiles
     WHERE id = p_user_id
       AND is_banned IS NOT TRUE
       AND is_deleted IS NOT TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'profile_unavailable' USING ERRCODE = '42501';
    END IF;

    SELECT invitation.status, invitation.expires_at
      INTO invitation_status, invitation_expires_at
      FROM public.co_loop_invitations AS invitation
     WHERE invitation.session_id = p_session_id
       AND invitation.invitee_id = p_user_id;

    IF invitation_status = 'pending' AND invitation_expires_at <= NOW() THEN
        UPDATE public.co_loop_invitations
           SET status = 'expired',
               responded_at = NOW()
         WHERE session_id = p_session_id
           AND invitee_id = p_user_id
           AND status = 'pending';
        invitation_status := 'expired';
    END IF;

    existing_participant := room.owner_id = p_user_id
        OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(room.co_authors) = 'array'
                         THEN room.co_authors ELSE '[]'::jsonb END
              ) AS author
             WHERE author->>'id' = p_user_id::text
        )
        OR EXISTS (
            SELECT 1
              FROM public.open_co_loop_participants AS participant
             WHERE participant.session_id = p_session_id
               AND participant.user_id = p_user_id
        )
        OR invitation_status = 'accepted';

    seat_already_reserved := existing_participant OR invitation_status = 'pending';

    -- A host lock blocks new collaborators, but an existing participant may
    -- still reconnect to the room. A pending invitation does not bypass lock.
    IF room.locked IS TRUE
       AND room.owner_id IS DISTINCT FROM p_user_id
       AND NOT existing_participant THEN
        RAISE EXCEPTION 'session_locked' USING ERRCODE = '42501';
    END IF;

    -- One canonical set of occupied seats. Pending direct invitations reserve
    -- a seat; accepted invitations are retained as participants even if an
    -- older route has not yet repaired the JSON roster.
    SELECT COUNT(*)::INTEGER
      INTO reserved_count
      FROM (
        SELECT room.owner_id::text AS user_id
         WHERE room.owner_id IS NOT NULL
        UNION
        SELECT author->>'id'
          FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(room.co_authors) = 'array'
                     THEN room.co_authors ELSE '[]'::jsonb END
          ) AS author
         WHERE NULLIF(author->>'id', '') IS NOT NULL
        UNION
        SELECT participant.user_id::text
          FROM public.open_co_loop_participants AS participant
         WHERE participant.session_id = p_session_id
        UNION
        SELECT invitation.invitee_id::text
          FROM public.co_loop_invitations AS invitation
         WHERE invitation.session_id = p_session_id
           AND invitation.status IN ('pending', 'accepted')
           AND (invitation.status <> 'pending' OR invitation.expires_at > NOW())
      ) AS roster;

    IF room.owner_id = p_user_id THEN
        RETURN JSONB_BUILD_OBJECT(
            'owner_id', room.owner_id,
            'owner_username', room.owner_username,
            'topic', COALESCE(room.open_invite_topic, ''),
            'current_count', reserved_count,
            'max', capacity,
            'is_full', reserved_count >= capacity,
            'already_joined', true,
            'is_owner', true,
            'co_author_entry', NULL
        );
    END IF;

    IF NOT seat_already_reserved AND reserved_count >= capacity THEN
        RAISE EXCEPTION 'session_full' USING ERRCODE = '23514';
    END IF;

    -- Convert an invitation's reserved seat to an active participant. The
    -- total remains unchanged, while a new public join consumes one new seat.
    IF invitation_status = 'pending' THEN
        UPDATE public.co_loop_invitations
           SET status = 'accepted',
               responded_at = NOW()
         WHERE session_id = p_session_id
           AND invitee_id = p_user_id
           AND status = 'pending';
    END IF;

    co_author := jsonb_build_object(
        'id', p_user_id::text,
        'username', COALESCE(profile.username, 'collaborator'),
        'display_name', COALESCE(profile.display_name, profile.username, 'Co-Author'),
        'avatar_url', profile.avatar_url,
        'role', 'Co-Author'
    );

    INSERT INTO public.open_co_loop_participants(session_id, user_id)
    VALUES (p_session_id, p_user_id)
    ON CONFLICT (session_id, user_id) DO NOTHING;

    final_roster := CASE
        WHEN EXISTS (
            SELECT 1
              FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(room.co_authors) = 'array'
                         THEN room.co_authors ELSE '[]'::jsonb END
              ) AS entry
             WHERE entry->>'id' = p_user_id::text
        )
        THEN COALESCE(room.co_authors, '[]'::jsonb)
        ELSE COALESCE(room.co_authors, '[]'::jsonb) || jsonb_build_array(co_author)
    END;

    UPDATE public.co_loop_sessions
       SET co_authors = final_roster,
           updated_at = NOW()
     WHERE session_id = p_session_id;

    current_count := CASE
        WHEN seat_already_reserved THEN reserved_count
        ELSE reserved_count + 1
    END;

    IF room.feed_post_id IS NOT NULL THEN
        UPDATE public.loops
           SET content_metadata =
               COALESCE(content_metadata, '{}'::jsonb) ||
               jsonb_build_object(
                   'is_open_coloop_invite', true,
                   'session_id', p_session_id,
                   'max_collaborators', capacity,
                   'topic', COALESCE(room.open_invite_topic, ''),
                   'current_participants', current_count,
                   'status', CASE WHEN current_count >= capacity THEN 'full' ELSE 'open' END
               )
         WHERE id::text = room.feed_post_id;
    END IF;

    RETURN JSONB_BUILD_OBJECT(
        'owner_id', room.owner_id,
        'owner_username', room.owner_username,
        'topic', COALESCE(room.open_invite_topic, ''),
        'current_count', current_count,
        'max', capacity,
        'is_full', current_count >= capacity,
        'already_joined', existing_participant,
        'is_owner', false,
        'co_author_entry', co_author
    );
END;
$$;

REVOKE ALL ON FUNCTION public.join_open_co_loop_session(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_open_co_loop_session(TEXT, UUID) TO service_role;


-- Atomic direct invitation reservation. A single room-row lock serializes
-- invitations, accepted direct invites and open-room joins against capacity.
CREATE OR REPLACE FUNCTION public.create_co_loop_invitation(
    p_session_id TEXT,
    p_inviter_id UUID,
    p_invitee_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    room public.co_loop_sessions%ROWTYPE;
    inviter_profile public.profiles%ROWTYPE;
    invitee_profile public.profiles%ROWTYPE;
    capacity INTEGER;
    reserved_count INTEGER;
    invitation_id UUID;
BEGIN
    IF p_session_id IS NULL OR BTRIM(p_session_id) = '' OR LENGTH(p_session_id) > 160
       OR p_inviter_id IS NULL OR p_invitee_id IS NULL THEN
        RAISE EXCEPTION 'invalid_invitation_input' USING ERRCODE = '22023';
    END IF;

    IF p_inviter_id = p_invitee_id THEN
        RAISE EXCEPTION 'cannot_invite_self' USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO room
      FROM public.co_loop_sessions
     WHERE session_id = p_session_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'co_loop_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF room.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'co_loop_deleted' USING ERRCODE = '55000';
    END IF;
    IF room.status <> 'active' THEN
        RAISE EXCEPTION 'co_loop_inactive' USING ERRCODE = '55000';
    END IF;

    SELECT *
      INTO inviter_profile
      FROM public.profiles
     WHERE id = p_inviter_id
       AND is_banned IS NOT TRUE
       AND is_deleted IS NOT TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'co_loop_inviter_unavailable' USING ERRCODE = '42501';
    END IF;

    SELECT *
      INTO invitee_profile
      FROM public.profiles
     WHERE id = p_invitee_id
       AND is_banned IS NOT TRUE
       AND is_deleted IS NOT TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'co_loop_invitee_unavailable' USING ERRCODE = 'P0002';
    END IF;

    IF room.locked IS TRUE AND room.owner_id IS DISTINCT FROM p_inviter_id THEN
        RAISE EXCEPTION 'co_loop_locked' USING ERRCODE = '42501';
    END IF;

    IF room.owner_id IS DISTINCT FROM p_inviter_id
       AND NOT EXISTS (
            SELECT 1
              FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(room.co_authors) = 'array'
                         THEN room.co_authors ELSE '[]'::jsonb END
              ) AS author
             WHERE author->>'id' = p_inviter_id::text
       )
       AND NOT EXISTS (
            SELECT 1
              FROM public.open_co_loop_participants AS participant
             WHERE participant.session_id = p_session_id
               AND participant.user_id = p_inviter_id
       ) THEN
        RAISE EXCEPTION 'co_loop_participant_required' USING ERRCODE = '42501';
    END IF;

    IF room.owner_id = p_invitee_id
       OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(room.co_authors) = 'array'
                         THEN room.co_authors ELSE '[]'::jsonb END
              ) AS author
             WHERE author->>'id' = p_invitee_id::text
       )
       OR EXISTS (
            SELECT 1
              FROM public.open_co_loop_participants AS participant
             WHERE participant.session_id = p_session_id
               AND participant.user_id = p_invitee_id
       ) THEN
        RAISE EXCEPTION 'co_loop_invitee_already_participating' USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.co_loop_invitations AS invitation
         WHERE invitation.session_id = p_session_id
           AND invitation.invitee_id = p_invitee_id
           AND invitation.status IN ('pending', 'accepted')
           AND (invitation.status <> 'pending' OR invitation.expires_at > NOW())
    ) THEN
        RAISE EXCEPTION 'co_loop_invitation_already_active' USING ERRCODE = '55000';
    END IF;

    capacity := LEAST(4, GREATEST(2, COALESCE(room.max_collaborators, 4)));

    -- Count the host, current co-authors, open-invite participants and every
    -- pending/accepted direct invitation as one reserved seat each.
    SELECT COUNT(*)::INTEGER
      INTO reserved_count
      FROM (
        SELECT room.owner_id::text AS user_id
         WHERE room.owner_id IS NOT NULL
        UNION
        SELECT author->>'id'
          FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(room.co_authors) = 'array'
                     THEN room.co_authors ELSE '[]'::jsonb END
          ) AS author
         WHERE NULLIF(author->>'id', '') IS NOT NULL
        UNION
        SELECT participant.user_id::text
          FROM public.open_co_loop_participants AS participant
         WHERE participant.session_id = p_session_id
        UNION
        SELECT invitation.invitee_id::text
          FROM public.co_loop_invitations AS invitation
         WHERE invitation.session_id = p_session_id
           AND invitation.status IN ('pending', 'accepted')
           AND (invitation.status <> 'pending' OR invitation.expires_at > NOW())
      ) AS roster;

    IF reserved_count >= capacity THEN
        RAISE EXCEPTION 'co_loop_full' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.co_loop_invitations (
        session_id, inviter_id, invitee_id, status, created_at, expires_at, responded_at
    )
    VALUES (p_session_id, p_inviter_id, p_invitee_id, 'pending', NOW(), NOW() + INTERVAL '7 days', NULL)
    ON CONFLICT (session_id, invitee_id)
    DO UPDATE SET
        inviter_id = EXCLUDED.inviter_id,
        status = 'pending',
        created_at = NOW(),
        expires_at = NOW() + INTERVAL '7 days',
        responded_at = NULL
    RETURNING id INTO invitation_id;

    UPDATE public.co_loop_sessions
       SET updated_at = NOW()
     WHERE session_id = p_session_id;

    RETURN JSONB_BUILD_OBJECT(
        'id', invitation_id,
        'session_id', p_session_id,
        'status', 'pending',
        'expires_at', NOW() + INTERVAL '7 days',
        'capacity', capacity,
        'reserved_count', reserved_count + 1
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_co_loop_invitation(TEXT, UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON FUNCTION public.create_co_loop_invitation(TEXT, UUID, UUID) FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON FUNCTION public.create_co_loop_invitation(TEXT, UUID, UUID) FROM authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.create_co_loop_invitation(TEXT, UUID, UUID) TO service_role;
    END IF;
END
$$;


-- Serialize acceptance/decline with room locking, deletion and new
-- reservations. The API validates delivery identity; this function owns state.
CREATE OR REPLACE FUNCTION public.respond_co_loop_invitation(
    p_session_id TEXT,
    p_invitee_id UUID,
    p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    room public.co_loop_sessions%ROWTYPE;
    invitation public.co_loop_invitations%ROWTYPE;
BEGIN
    IF p_session_id IS NULL OR BTRIM(p_session_id) = '' OR LENGTH(p_session_id) > 160
       OR p_invitee_id IS NULL
       OR p_action NOT IN ('accepted', 'declined') THEN
        RAISE EXCEPTION 'invalid_invitation_response' USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO room
      FROM public.co_loop_sessions
     WHERE session_id = p_session_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'co_loop_not_found' USING ERRCODE = 'P0002';
    END IF;

    SELECT *
      INTO invitation
      FROM public.co_loop_invitations
     WHERE session_id = p_session_id
       AND invitee_id = p_invitee_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'co_loop_invitation_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF invitation.status = 'accepted' THEN
        IF p_action = 'accepted' THEN
            RETURN JSONB_BUILD_OBJECT(
                'id', invitation.id,
                'session_id', p_session_id,
                'status', 'accepted',
                'already_responded', true
            );
        END IF;
        RAISE EXCEPTION 'accepted_invitation_cannot_be_declined' USING ERRCODE = '55000';
    END IF;

    IF invitation.status = 'pending' AND invitation.expires_at <= NOW() THEN
        UPDATE public.co_loop_invitations
           SET status = 'expired',
               responded_at = NOW()
         WHERE id = invitation.id
         RETURNING * INTO invitation;

        RETURN JSONB_BUILD_OBJECT(
            'id', invitation.id,
            'session_id', p_session_id,
            'status', 'expired',
            'already_responded', false
        );
    END IF;

    IF invitation.status <> 'pending' THEN
        RAISE EXCEPTION 'co_loop_invitation_no_longer_pending' USING ERRCODE = '55000';
    END IF;

    IF p_action = 'accepted' THEN
        IF room.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'co_loop_deleted' USING ERRCODE = '55000';
        END IF;
        IF room.status <> 'active' THEN
            RAISE EXCEPTION 'co_loop_inactive' USING ERRCODE = '55000';
        END IF;
        IF room.locked IS TRUE THEN
            RAISE EXCEPTION 'co_loop_locked' USING ERRCODE = '42501';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = p_invitee_id
              AND is_banned IS NOT TRUE
              AND is_deleted IS NOT TRUE
        ) THEN
            RAISE EXCEPTION 'co_loop_invitee_unavailable' USING ERRCODE = '42501';
        END IF;
    END IF;

    UPDATE public.co_loop_invitations
       SET status = p_action,
           responded_at = NOW()
     WHERE id = invitation.id
     RETURNING * INTO invitation;

    RETURN JSONB_BUILD_OBJECT(
        'id', invitation.id,
        'session_id', p_session_id,
        'status', invitation.status,
        'already_responded', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.respond_co_loop_invitation(TEXT, UUID, TEXT) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON FUNCTION public.respond_co_loop_invitation(TEXT, UUID, TEXT) FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON FUNCTION public.respond_co_loop_invitation(TEXT, UUID, TEXT) FROM authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.respond_co_loop_invitation(TEXT, UUID, TEXT) TO service_role;
    END IF;
END
$$;


-- Atomic host removal. It serializes with invite reservation, invite response
-- and open joins by taking the same session-row lock before changing the
-- invitation ledger, open-participant set and co-author roster.
CREATE OR REPLACE FUNCTION public.kick_co_loop_participant(
    p_session_id TEXT,
    p_owner_id UUID,
    p_target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    room public.co_loop_sessions%ROWTYPE;
    removed_entry JSONB;
    next_roster JSONB;
    current_count INTEGER;
    capacity INTEGER;
    found_member BOOLEAN;
BEGIN
    IF p_session_id IS NULL OR BTRIM(p_session_id) = '' OR LENGTH(p_session_id) > 160
       OR p_owner_id IS NULL OR p_target_user_id IS NULL THEN
        RAISE EXCEPTION 'invalid_kick_input' USING ERRCODE = '22023';
    END IF;
    IF p_owner_id = p_target_user_id THEN
        RAISE EXCEPTION 'host_cannot_kick_self' USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO room
      FROM public.co_loop_sessions
     WHERE session_id = p_session_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'co_loop_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF room.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'co_loop_deleted' USING ERRCODE = '55000';
    END IF;
    IF room.owner_id IS DISTINCT FROM p_owner_id THEN
        RAISE EXCEPTION 'co_loop_host_required' USING ERRCODE = '42501';
    END IF;

    SELECT author
      INTO removed_entry
      FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(room.co_authors) = 'array'
                 THEN room.co_authors ELSE '[]'::jsonb END
      ) AS author
     WHERE author->>'id' = p_target_user_id::text
     LIMIT 1;

    SELECT (
        removed_entry IS NOT NULL
        OR EXISTS (
            SELECT 1
              FROM public.open_co_loop_participants AS participant
             WHERE participant.session_id = p_session_id
               AND participant.user_id = p_target_user_id
        )
        OR EXISTS (
            SELECT 1
              FROM public.co_loop_invitations AS invitation
             WHERE invitation.session_id = p_session_id
               AND invitation.invitee_id = p_target_user_id
               AND invitation.status IN ('pending', 'accepted')
           AND (invitation.status <> 'pending' OR invitation.expires_at > NOW())
        )
    ) INTO found_member;

    IF NOT found_member THEN
        RAISE EXCEPTION 'co_loop_participant_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- A revoked ledger row overrides any stale legacy roster or delivery.
    IF EXISTS (
        SELECT 1
          FROM public.profiles
         WHERE id = p_target_user_id
    ) THEN
        INSERT INTO public.co_loop_invitations (
            session_id, inviter_id, invitee_id, status, created_at, responded_at
        )
        VALUES (
            p_session_id, p_owner_id, p_target_user_id, 'revoked', NOW(), NOW()
        )
        ON CONFLICT (session_id, invitee_id)
        DO UPDATE SET
            inviter_id = EXCLUDED.inviter_id,
            status = 'revoked',
            responded_at = NOW();
    ELSE
        UPDATE public.co_loop_invitations
           SET status = 'revoked',
               responded_at = NOW()
         WHERE session_id = p_session_id
           AND invitee_id = p_target_user_id;
    END IF;

    DELETE FROM public.open_co_loop_participants
     WHERE session_id = p_session_id
       AND user_id = p_target_user_id;

    SELECT COALESCE(
        JSONB_AGG(author ORDER BY ordinal_position),
        '[]'::jsonb
    )
      INTO next_roster
      FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(room.co_authors) = 'array'
                 THEN room.co_authors ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS roster(author, ordinal_position)
     WHERE author->>'id' IS DISTINCT FROM p_target_user_id::text;

    UPDATE public.co_loop_sessions
       SET co_authors = next_roster,
           updated_at = NOW()
     WHERE session_id = p_session_id;

    capacity := LEAST(4, GREATEST(2, COALESCE(room.max_collaborators, 4)));

    SELECT COUNT(*)::INTEGER
      INTO current_count
      FROM (
        SELECT room.owner_id::text AS user_id
         WHERE room.owner_id IS NOT NULL
        UNION
        SELECT author->>'id'
          FROM jsonb_array_elements(next_roster) AS author
         WHERE NULLIF(author->>'id', '') IS NOT NULL
        UNION
        SELECT participant.user_id::text
          FROM public.open_co_loop_participants AS participant
         WHERE participant.session_id = p_session_id
        UNION
        SELECT invitation.invitee_id::text
          FROM public.co_loop_invitations AS invitation
         WHERE invitation.session_id = p_session_id
           AND invitation.status IN ('pending', 'accepted')
           AND (invitation.status <> 'pending' OR invitation.expires_at > NOW())
      ) AS roster;

    IF room.feed_post_id IS NOT NULL THEN
        UPDATE public.loops
           SET content_metadata =
               COALESCE(content_metadata, '{}'::jsonb) ||
               JSONB_BUILD_OBJECT(
                   'is_open_coloop_invite', true,
                   'session_id', p_session_id,
                   'max_collaborators', capacity,
                   'topic', COALESCE(room.open_invite_topic, ''),
                   'current_participants', current_count,
                   'status', CASE
                       WHEN room.status = 'published' THEN 'published'
                       WHEN current_count >= capacity THEN 'full'
                       ELSE 'open'
                   END
               )
         WHERE id::text = room.feed_post_id;
    END IF;

    RETURN JSONB_BUILD_OBJECT(
        'session_id', p_session_id,
        'target_user_id', p_target_user_id,
        'removed_entry', removed_entry,
        'current_count', current_count,
        'max', capacity
    );
END;
$$;

REVOKE ALL ON FUNCTION public.kick_co_loop_participant(TEXT, UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON FUNCTION public.kick_co_loop_participant(TEXT, UUID, UUID) FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON FUNCTION public.kick_co_loop_participant(TEXT, UUID, UUID) FROM authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.kick_co_loop_participant(TEXT, UUID, UUID) TO service_role;
    END IF;
END
$$;
