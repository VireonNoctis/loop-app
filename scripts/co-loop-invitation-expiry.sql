-- Co-Loop direct invitations reserve capacity only while pending and unexpired.
-- Existing pending invitations receive a seven-day lifetime from creation.
ALTER TABLE public.co_loop_invitations
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE public.co_loop_invitations
SET expires_at = created_at + INTERVAL '7 days'
WHERE expires_at IS NULL;

UPDATE public.co_loop_invitations
SET status = 'expired',
    responded_at = COALESCE(responded_at, expires_at)
WHERE status = 'pending'
  AND expires_at <= NOW();

ALTER TABLE public.co_loop_invitations
    ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '7 days');

ALTER TABLE public.co_loop_invitations
    ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_co_loop_invitations_pending_expiry
    ON public.co_loop_invitations(expires_at)
    WHERE status = 'pending';
