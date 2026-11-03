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
