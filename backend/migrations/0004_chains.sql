-- Canonical collaborative Chains, distinct from Loop reply/Branch trees.
-- Additive migration: legacy loops and circles remain unchanged.

CREATE TABLE IF NOT EXISTS public.chains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    circle_id UUID REFERENCES public.circles(id) ON DELETE SET NULL,
    title VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL
        CHECK (kind IN ('story', 'worldbuilding', 'ranking', 'playlist', 'gallery', 'challenge', 'project', 'recommendations', 'open')),
    category TEXT NOT NULL DEFAULT 'general',
    visibility TEXT NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'unlisted', 'private', 'circle')),
    contribution_policy TEXT NOT NULL DEFAULT 'open'
        CHECK (contribution_policy IN ('open', 'members', 'circle_members')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'completed', 'archived')),
    cover_image_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    contribution_count BIGINT NOT NULL DEFAULT 0 CHECK (contribution_count >= 0),
    participant_count BIGINT NOT NULL DEFAULT 1 CHECK (participant_count >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chains_circle_visibility_consistent CHECK (
        (visibility = 'circle' AND circle_id IS NOT NULL)
        OR (visibility <> 'circle')
    )
);

CREATE TABLE IF NOT EXISTS public.chain_members (
    chain_id UUID NOT NULL REFERENCES public.chains(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'contributor'
        CHECK (role IN ('owner', 'collaborator', 'contributor', 'viewer')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chain_contributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id UUID NOT NULL REFERENCES public.chains(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    parent_contribution_id UUID REFERENCES public.chain_contributions(id) ON DELETE SET NULL,
    contribution_type TEXT NOT NULL
        CHECK (contribution_type IN ('text', 'image', 'video', 'audio', 'link', 'list', 'ranking', 'poll', 'document')),
    title VARCHAR(120),
    content TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    position BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published'
        CHECK (status IN ('published', 'pending', 'removed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chain_contribution_position_unique UNIQUE (chain_id, position)
);

CREATE INDEX IF NOT EXISTS idx_chains_public_discovery
    ON public.chains(status, visibility, updated_at DESC)
    WHERE visibility = 'public' AND status IN ('active', 'completed');
CREATE INDEX IF NOT EXISTS idx_chains_creator_updated
    ON public.chains(creator_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chains_circle_updated
    ON public.chains(circle_id, updated_at DESC)
    WHERE circle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chain_members_user
    ON public.chain_members(user_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_chain_contributions_chain_position
    ON public.chain_contributions(chain_id, position ASC)
    WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_chain_contributions_author
    ON public.chain_contributions(author_id, created_at DESC);
