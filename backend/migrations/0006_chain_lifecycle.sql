-- Preserve contribution history and record the source of a remixed Chain.
ALTER TABLE public.chains
    ADD COLUMN IF NOT EXISTS source_chain_id UUID
    REFERENCES public.chains(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chains_source_chain
    ON public.chains(source_chain_id)
    WHERE source_chain_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.chain_contribution_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contribution_id UUID NOT NULL
        REFERENCES public.chain_contributions(id) ON DELETE CASCADE,
    editor_id UUID NOT NULL
        REFERENCES public.profiles(id) ON DELETE RESTRICT,
    revision_number BIGINT NOT NULL CHECK (revision_number > 0),
    contribution_type TEXT NOT NULL
        CHECK (contribution_type IN ('text', 'image', 'video', 'audio', 'link', 'list', 'ranking', 'poll', 'document')),
    title VARCHAR(120),
    content TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chain_contribution_revision_number_unique
        UNIQUE (contribution_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_chain_contribution_revisions_history
    ON public.chain_contribution_revisions(contribution_id, revision_number DESC);

COMMENT ON TABLE public.chain_contribution_revisions IS
    'Immutable snapshots of published Chain contributions before an author edit.';


-- Browser clients receive no direct access to the revision ledger. The Rust
-- API applies the same Chain visibility checks before returning revision data.
ALTER TABLE public.chain_contribution_revisions ENABLE ROW LEVEL SECURITY;
