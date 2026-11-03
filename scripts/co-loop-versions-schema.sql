-- Co-Loop Studio version history.
--
-- Snapshots used to be written to `localStorage` only, which meant a refresh
-- wiped the whole timeline, invited co-authors never saw each other's
-- checkpoints, and restoring a version could not be repeated on another device.
-- This table makes the timeline a property of the session: shared by every
-- participant and durable across reloads.

CREATE TABLE IF NOT EXISTS public.co_loop_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
    media_url TEXT,
    media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    media_type TEXT NOT NULL DEFAULT 'text' CHECK (media_type IN ('text', 'image', 'video')),
    co_authors JSONB NOT NULL DEFAULT '[]'::jsonb,
    label TEXT,
    saved_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    saved_by_name TEXT,
    saved_by_avatar TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'co_loop_versions_session_version_key'
    ) THEN
        ALTER TABLE public.co_loop_versions
            ADD CONSTRAINT co_loop_versions_session_version_key UNIQUE (session_id, version_number);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_co_loop_versions_session
    ON public.co_loop_versions(session_id, version_number DESC);

ALTER TABLE public.co_loop_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- Version history can contain unpublished creative work. Keep it private
    -- behind the authenticated Co-Loop version API.
    DROP POLICY IF EXISTS "Anyone can read co_loop_versions" ON public.co_loop_versions;
    DROP POLICY IF EXISTS "Service role manages co_loop_versions" ON public.co_loop_versions;
    CREATE POLICY "Service role manages co_loop_versions" ON public.co_loop_versions
        FOR ALL TO service_role USING (true) WITH CHECK (true);
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE co_loop_versions;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

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
SET search_path = public
AS $$
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
