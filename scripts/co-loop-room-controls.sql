-- Co-Loop Studio: per-session activity feed + host room controls.
--
-- The studio previously recorded nothing about what happened in a session: you
-- could not answer "who wrote what, and when?", the host could not pause a room
-- while they stepped away, and once a Co-Loop was published the session row was
-- kept forever with no way to retire it.

CREATE TABLE IF NOT EXISTS public.co_loop_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    actor_name TEXT,
    action TEXT NOT NULL CHECK (action IN (
        'edited',
        'version_saved',
        'version_restored',
        'published',
        'locked',
        'unlocked',
        'gifted',
        'invite_sent'
    )),
    summary TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_co_loop_activity_session
    ON public.co_loop_activity(session_id, created_at DESC);

ALTER TABLE public.co_loop_activity ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Anyone can read co_loop_activity" ON public.co_loop_activity;

    -- All direct table access is restricted to service_role. User-facing
    -- reads and writes must pass through /api/co-loop/activity, which verifies
    -- the caller's current room membership before returning or mutating rows.
    DROP POLICY IF EXISTS "Service role manages co_loop_activity" ON public.co_loop_activity;
    CREATE POLICY "Service role manages co_loop_activity" ON public.co_loop_activity
        FOR ALL TO service_role USING (true) WITH CHECK (true);
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE co_loop_activity;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Host controls on the session itself.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'co_loop_sessions' AND column_name = 'locked'
    ) THEN
        ALTER TABLE public.co_loop_sessions ADD COLUMN locked BOOLEAN NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'co_loop_sessions' AND column_name = 'locked_at'
    ) THEN
        ALTER TABLE public.co_loop_sessions ADD COLUMN locked_at TIMESTAMP WITH TIME ZONE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'co_loop_sessions' AND column_name = 'locked_by'
    ) THEN
        ALTER TABLE public.co_loop_sessions ADD COLUMN locked_by UUID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'co_loop_sessions' AND column_name = 'deleted_at'
    ) THEN
        ALTER TABLE public.co_loop_sessions ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Deleted rooms drop out of the "all sessions" listing without destroying the
-- published Loop they produced.
CREATE INDEX IF NOT EXISTS idx_co_loop_sessions_live
    ON public.co_loop_sessions(session_id) WHERE deleted_at IS NULL;
