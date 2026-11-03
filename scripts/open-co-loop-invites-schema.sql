-- Open Co-Loop Invite: public join without direct invite
-- Adds open invite mode fields to co_loop_sessions and a participants tracking table.

-- 1. Add open invite columns to co_loop_sessions
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='co_loop_sessions' AND column_name='is_open_invite') THEN
        ALTER TABLE public.co_loop_sessions ADD COLUMN is_open_invite BOOLEAN NOT NULL DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='co_loop_sessions' AND column_name='max_collaborators') THEN
        ALTER TABLE public.co_loop_sessions ADD COLUMN max_collaborators INT NOT NULL DEFAULT 4;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='co_loop_sessions' AND column_name='open_invite_topic') THEN
        ALTER TABLE public.co_loop_sessions ADD COLUMN open_invite_topic TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='co_loop_sessions' AND column_name='feed_post_id') THEN
        ALTER TABLE public.co_loop_sessions ADD COLUMN feed_post_id TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'co_loop_sessions_session_id_unique') THEN
        ALTER TABLE public.co_loop_sessions ADD CONSTRAINT co_loop_sessions_session_id_unique UNIQUE (session_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_co_loop_sessions_open_invite ON public.co_loop_sessions(is_open_invite) WHERE is_open_invite = true;
CREATE INDEX IF NOT EXISTS idx_co_loop_sessions_feed_post ON public.co_loop_sessions(feed_post_id);

-- 2. Open invite participants tracking (who has joined)
CREATE TABLE IF NOT EXISTS public.open_co_loop_participants (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES public.co_loop_sessions(session_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_open_participants_session ON public.open_co_loop_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_open_participants_user ON public.open_co_loop_participants(user_id);

-- 3. RLS policies
ALTER TABLE public.open_co_loop_participants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- The participant roster is queried only by authenticated server routes.
    -- Do not expose member ids through the public Supabase REST surface.
    DROP POLICY IF EXISTS "Anyone can read open co-loop participants" ON public.open_co_loop_participants;
    DROP POLICY IF EXISTS "Service role manages open co-loop participants" ON public.open_co_loop_participants;
    CREATE POLICY "Service role manages open co-loop participants" ON public.open_co_loop_participants
        FOR ALL TO service_role USING (true) WITH CHECK (true);
END $$;

-- 4. Enable realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE open_co_loop_participants;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
