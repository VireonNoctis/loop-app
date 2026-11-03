-- Pending Collection invitations are valid for 30 days. Expired rows remain
-- as a durable state so stale invitations cannot be accepted or reappear.
ALTER TABLE public.collection_members
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE public.collection_members
SET expires_at = invited_at + INTERVAL '30 days'
WHERE status = 'pending' AND expires_at IS NULL;

ALTER TABLE public.collection_members
    DROP CONSTRAINT IF EXISTS collection_members_status_check;
ALTER TABLE public.collection_members
    ADD CONSTRAINT collection_members_status_check
    CHECK (status IN ('pending', 'active', 'declined', 'expired'));

ALTER TABLE public.collection_members
    DROP CONSTRAINT IF EXISTS collection_members_pending_expiry_check;
ALTER TABLE public.collection_members
    ADD CONSTRAINT collection_members_pending_expiry_check
    CHECK (
        status <> 'pending'
        OR (expires_at IS NOT NULL AND expires_at > invited_at)
    );

CREATE INDEX IF NOT EXISTS idx_collection_members_pending_expiry
    ON public.collection_members(expires_at)
    WHERE status = 'pending';
