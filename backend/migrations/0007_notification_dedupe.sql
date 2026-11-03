-- Idempotency key for transactional domain-event notifications.
-- Existing notifications remain readable and are not rewritten.
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_key
    ON public.notifications(dedupe_key)
    WHERE dedupe_key IS NOT NULL;
