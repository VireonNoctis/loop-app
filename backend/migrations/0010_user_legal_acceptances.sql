-- Record explicit, versioned agreement to LOOP's current legal documents.
-- Versions are assigned by the application; users cannot choose or backdate them.
CREATE TABLE IF NOT EXISTS public.user_legal_acceptances (
    auth_user_id TEXT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    document_key TEXT NOT NULL CHECK (document_key IN ('terms', 'privacy')),
    document_version TEXT NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acceptance_source TEXT NOT NULL DEFAULT 'web'
        CHECK (acceptance_source IN ('web', 'ios', 'android')),
    PRIMARY KEY (auth_user_id, document_key, document_version)
);

CREATE INDEX IF NOT EXISTS idx_user_legal_acceptances_latest
    ON public.user_legal_acceptances (auth_user_id, accepted_at DESC);

-- This ledger is accessed only by the authenticated Rust API; do not expose it to browser roles.
REVOKE ALL ON TABLE public.user_legal_acceptances FROM PUBLIC;
