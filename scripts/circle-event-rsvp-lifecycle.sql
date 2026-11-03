-- Circle event RSVP lifecycle.
-- Run after scripts/circles-enhancements-schema.sql and
-- scripts/fix-circle-event-participants.sql.
--
-- This function serializes capacity changes by locking the event row. It keeps
-- participant_count in sync with the actual attending rows and supports
-- pending/declined RSVP states without reserving a seat before approval.

CREATE UNIQUE INDEX IF NOT EXISTS circle_event_participants_event_user_key
  ON public.circle_event_participants (event_id, user_id);


CREATE OR REPLACE FUNCTION public.set_circle_event_rsvp(
  p_event_id UUID,
  p_user_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $
DECLARE
  event_row public.circle_events%ROWTYPE;
  previous_status TEXT;
  attendee_total INTEGER;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'attending', 'declined') THEN
    RAISE EXCEPTION 'invalid_rsvp_status' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO event_row
  FROM public.circle_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'circle_event_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF event_row.ends_at IS NOT NULL AND event_row.ends_at < NOW() THEN
    RAISE EXCEPTION 'circle_event_ended' USING ERRCODE = '22023';
  END IF;

  SELECT status
  INTO previous_status
  FROM public.circle_event_participants
  WHERE event_id = p_event_id AND user_id = p_user_id;

  IF p_status = 'attending'
     AND COALESCE(previous_status, '') <> 'attending'
     AND event_row.max_participants IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER
    INTO attendee_total
    FROM public.circle_event_participants
    WHERE event_id = p_event_id AND status = 'attending';

    IF attendee_total >= event_row.max_participants THEN
      RAISE EXCEPTION 'circle_event_full' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.circle_event_participants (event_id, user_id, status)
  VALUES (p_event_id, p_user_id, p_status)
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET status = EXCLUDED.status;

  SELECT COUNT(*)::INTEGER
  INTO attendee_total
  FROM public.circle_event_participants
  WHERE event_id = p_event_id AND status = 'attending';

  UPDATE public.circle_events
  SET participant_count = attendee_total
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'status', p_status,
    'participant_count', attendee_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_circle_event_rsvp(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_circle_event_rsvp(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.set_circle_event_rsvp(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_circle_event_rsvp(UUID, UUID, TEXT) TO service_role;


-- Authoritative RSVP transaction. Rechecks target membership, actor event
-- permissions, approval policy and capacity while holding the event row lock.
CREATE OR REPLACE FUNCTION public.set_circle_event_rsvp_authorized(
  p_event_id UUID,
  p_user_id UUID,
  p_actor_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  event_row public.circle_events%ROWTYPE;
  previous_status TEXT;
  attendee_total INTEGER;
  target_is_member BOOLEAN;
  actor_is_manager BOOLEAN;
BEGIN
  IF p_event_id IS NULL OR p_user_id IS NULL OR p_actor_id IS NULL
     OR p_status IS NULL OR p_status NOT IN ('pending', 'attending', 'declined') THEN
    RAISE EXCEPTION 'circle_event_invalid_rsvp' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO event_row
    FROM public.circle_events
   WHERE id = p_event_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'circle_event_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF event_row.ends_at IS NOT NULL AND event_row.ends_at < NOW() THEN
    RAISE EXCEPTION 'circle_event_ended' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = p_actor_id
       AND is_banned IS NOT TRUE
       AND is_deleted IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'circle_event_actor_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.circle_members AS member
      JOIN public.profiles AS profile ON profile.id = member.user_id
     WHERE member.circle_id = event_row.circle_id
       AND member.user_id = p_user_id
       AND member.status IN ('active', 'approved')
       AND profile.is_banned IS NOT TRUE
       AND profile.is_deleted IS NOT TRUE
  ) INTO target_is_member;

  IF p_status IN ('pending', 'attending') AND NOT target_is_member THEN
    RAISE EXCEPTION 'circle_event_member_required' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.circle_members AS member
     WHERE member.circle_id = event_row.circle_id
       AND member.user_id = p_actor_id
       AND member.status IN ('active', 'approved')
       AND (
         member.role IN ('owner', 'admin', 'moderator')
         OR member.permissions->>'can_manage_events' = 'true'
       )
  ) OR (
    p_actor_id = event_row.organizer_id
    AND EXISTS (
      SELECT 1 FROM public.circle_members AS member
       WHERE member.circle_id = event_row.circle_id
         AND member.user_id = p_actor_id
         AND member.status IN ('active', 'approved')
    )
  ) INTO actor_is_manager;

  SELECT status
    INTO previous_status
    FROM public.circle_event_participants
   WHERE event_id = p_event_id
     AND user_id = p_user_id;

  -- Submitting an approval-required RSVP is always a self-action.
  IF p_status = 'pending' THEN
    IF p_actor_id <> p_user_id THEN
      RAISE EXCEPTION 'circle_event_manager_action_required' USING ERRCODE = '42501';
    END IF;
    IF NOT event_row.requires_approval THEN
      RAISE EXCEPTION 'circle_event_approval_not_required' USING ERRCODE = '22023';
    END IF;
    IF previous_status IN ('pending', 'attending') THEN
      SELECT COUNT(*)::INTEGER
        INTO attendee_total
        FROM public.circle_event_participants
       WHERE event_id = p_event_id AND status = 'attending';
      RETURN JSONB_BUILD_OBJECT(
        'event_id', p_event_id,
        'status', previous_status,
        'participant_count', attendee_total,
        'already_set', true
      );
    END IF;
  ELSIF p_status = 'attending' THEN
    IF previous_status = 'attending' THEN
      SELECT COUNT(*)::INTEGER
        INTO attendee_total
        FROM public.circle_event_participants
       WHERE event_id = p_event_id AND status = 'attending';
      RETURN JSONB_BUILD_OBJECT(
        'event_id', p_event_id,
        'status', 'attending',
        'participant_count', attendee_total,
        'already_set', true
      );
    END IF;

    IF event_row.requires_approval THEN
      IF previous_status <> 'pending' OR NOT actor_is_manager THEN
        RAISE EXCEPTION 'circle_event_approval_required' USING ERRCODE = '42501';
      END IF;
    ELSIF p_actor_id <> p_user_id AND NOT actor_is_manager THEN
      RAISE EXCEPTION 'circle_event_manager_action_required' USING ERRCODE = '42501';
    END IF;
  ELSIF p_status = 'declined' THEN
    IF p_actor_id <> p_user_id AND NOT actor_is_manager THEN
      RAISE EXCEPTION 'circle_event_manager_action_required' USING ERRCODE = '42501';
    END IF;
    IF previous_status IS NULL THEN
      SELECT COUNT(*)::INTEGER
        INTO attendee_total
        FROM public.circle_event_participants
       WHERE event_id = p_event_id AND status = 'attending';
      RETURN JSONB_BUILD_OBJECT(
        'event_id', p_event_id,
        'status', NULL,
        'participant_count', attendee_total,
        'already_set', true
      );
    END IF;
  END IF;

  IF p_status = 'attending'
     AND COALESCE(previous_status, '') <> 'attending'
     AND event_row.max_participants IS NOT NULL THEN
    SELECT COUNT(*)::INTEGER
      INTO attendee_total
      FROM public.circle_event_participants
     WHERE event_id = p_event_id AND status = 'attending';

    IF attendee_total >= event_row.max_participants THEN
      RAISE EXCEPTION 'circle_event_full' USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.circle_event_participants (event_id, user_id, status)
  VALUES (p_event_id, p_user_id, p_status)
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET status = EXCLUDED.status;

  SELECT COUNT(*)::INTEGER
    INTO attendee_total
    FROM public.circle_event_participants
   WHERE event_id = p_event_id AND status = 'attending';

  UPDATE public.circle_events
     SET participant_count = attendee_total
   WHERE id = p_event_id;

  RETURN JSONB_BUILD_OBJECT(
    'event_id', p_event_id,
    'status', p_status,
    'participant_count', attendee_total,
    'already_set', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_circle_event_rsvp_authorized(UUID, UUID, UUID, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.set_circle_event_rsvp_authorized(UUID, UUID, UUID, TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.set_circle_event_rsvp_authorized(UUID, UUID, UUID, TEXT) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.set_circle_event_rsvp_authorized(UUID, UUID, UUID, TEXT) TO service_role;
  END IF;
END
$$;
