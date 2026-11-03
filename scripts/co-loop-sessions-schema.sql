-- Co-Loop Studio session tracking: durable ownership + co-author roster.
--
-- Previously /api/co-loop/session-info queried a `co_loop_sessions` table
-- that never existed in any deployed database — every query failed
-- silently (destructured without checking `error`), so session ownership
-- and co-author membership were resolved purely from ephemeral realtime
-- presence and fragile heuristics (invitedBy query param, notifications,
-- messages). That's why the Primary Creator's studio view could miss an
-- invited co-author that the co-author's own view showed correctly, and
-- why some published Co-Loops ended up with an empty co_authors list.

CREATE TABLE IF NOT EXISTS public.co_loop_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT UNIQUE NOT NULL,
    owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    owner_username TEXT,
    co_authors JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'published', 'ended')),
    published_loop_id UUID REFERENCES public.loops(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='co_loop_sessions' AND column_name='co_authors') THEN
        ALTER TABLE public.co_loop_sessions ADD COLUMN co_authors JSONB NOT NULL DEFAULT '[]'::jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='co_loop_sessions' AND column_name='status') THEN
        ALTER TABLE public.co_loop_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='co_loop_sessions' AND column_name='published_loop_id') THEN
        ALTER TABLE public.co_loop_sessions ADD COLUMN published_loop_id UUID REFERENCES public.loops(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_co_loop_sessions_session_id ON public.co_loop_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_co_loop_sessions_owner_id ON public.co_loop_sessions(owner_id);

ALTER TABLE public.co_loop_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- Session drafts, roster metadata and lock state are private. Server routes
    -- authenticate room participants; no public or authenticated-user policy
    -- should expose this table through the Supabase REST endpoint.
    DROP POLICY IF EXISTS "Anyone can read co_loop_sessions" ON public.co_loop_sessions;
    DROP POLICY IF EXISTS "Service role manages co_loop_sessions" ON public.co_loop_sessions;
    CREATE POLICY "Service role manages co_loop_sessions" ON public.co_loop_sessions
        FOR ALL TO service_role USING (true) WITH CHECK (true);
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE co_loop_sessions;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Canonical Co-Loop direct-invitation lifecycle. Notifications and DMs are
-- delivery surfaces, never the authorization source.
CREATE TABLE IF NOT EXISTS public.co_loop_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    inviter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    invitee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    responded_at TIMESTAMPTZ,
    UNIQUE (session_id, invitee_id)
);

CREATE INDEX IF NOT EXISTS idx_co_loop_invitations_invitee_status
    ON public.co_loop_invitations(invitee_id, status);

ALTER TABLE public.co_loop_invitations ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    DROP POLICY IF EXISTS "Service role manages co_loop_invitations" ON public.co_loop_invitations;
    CREATE POLICY "Service role manages co_loop_invitations"
        ON public.co_loop_invitations
        FOR ALL TO service_role USING (true) WITH CHECK (true);
END $$;

-- Canonical Co-Loop direct-invitation lifecycle. Notifications and DMs are
-- delivery surfaces, never the authorization source.
CREATE TABLE IF NOT EXISTS public.co_loop_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    inviter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    invitee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    responded_at TIMESTAMPTZ,
    UNIQUE (session_id, invitee_id)
);

CREATE INDEX IF NOT EXISTS idx_co_loop_invitations_invitee_status
    ON public.co_loop_invitations(invitee_id, status);

ALTER TABLE public.co_loop_invitations ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    DROP POLICY IF EXISTS "Service role manages co_loop_invitations" ON public.co_loop_invitations;
    CREATE POLICY "Service role manages co_loop_invitations"
        ON public.co_loop_invitations
        FOR ALL TO service_role USING (true) WITH CHECK (true);
END $$;
