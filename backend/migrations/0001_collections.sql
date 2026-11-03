-- Core compatibility schema for the local Rust API stack.
-- Production databases already have these tables; CREATE IF NOT EXISTS keeps
-- this additive while allowing a brand-new Docker volume to migrate cleanly.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    avatar_url TEXT,
    video_avatar_url TEXT,
    banner_url TEXT,
    bio TEXT,
    location TEXT,
    website TEXT,
    loop_coins BIGINT NOT NULL DEFAULT 0,
    total_earnings NUMERIC(14, 2) NOT NULL DEFAULT 0,
    available_earnings NUMERIC(14, 2) NOT NULL DEFAULT 0,
    is_premium BOOLEAN NOT NULL DEFAULT false,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    is_team_member BOOLEAN NOT NULL DEFAULT false,
    is_sponsor BOOLEAN NOT NULL DEFAULT false,
    is_organization BOOLEAN NOT NULL DEFAULT false,
    organization_name TEXT,
    is_admin BOOLEAN NOT NULL DEFAULT false,
    onboarding_completed BOOLEAN NOT NULL DEFAULT false,
    active_theme TEXT,
    xp_points INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    premium_expires_at TIMESTAMPTZ,
    verification_level TEXT,
    can_stream BOOLEAN NOT NULL DEFAULT false,
    stream_key TEXT,
    theme_data JSONB,
    privacy_settings JSONB NOT NULL DEFAULT '{"profile_visibility":"public","message_privacy":"everyone"}'::jsonb,
    notification_settings JSONB NOT NULL DEFAULT '{"email":true,"push":true,"in_app":true}'::jsonb,
    followers_count INTEGER NOT NULL DEFAULT 0,
    following_count INTEGER NOT NULL DEFAULT 0,
    loops_count INTEGER NOT NULL DEFAULT 0,
    invited_via_coloop BOOLEAN NOT NULL DEFAULT false,
    invited_by_username TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Better Auth owns these identity/session records. Profile IDs remain UUIDs;
-- no Snowflake cutover is attempted by this migration.
CREATE TABLE IF NOT EXISTS public."user" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "stripeCustomerId" TEXT
);

CREATE TABLE IF NOT EXISTS public."session" (
    "id" TEXT PRIMARY KEY,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES public."user"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_better_auth_session_user
    ON public."session"("userId");

CREATE TABLE IF NOT EXISTS public."account" (
    "id" TEXT PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES public."user"("id") ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_better_auth_account_user
    ON public."account"("userId");

CREATE TABLE IF NOT EXISTS public."verification" (
    "id" TEXT PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public."subscription" (
    "id" TEXT PRIMARY KEY,
    "plan" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "status" TEXT,
    "periodStart" TIMESTAMPTZ,
    "periodEnd" TIMESTAMPTZ,
    "trialStart" TIMESTAMPTZ,
    "trialEnd" TIMESTAMPTZ,
    "cancelAtPeriodEnd" BOOLEAN DEFAULT false,
    "cancelAt" TIMESTAMPTZ,
    "canceledAt" TIMESTAMPTZ,
    "endedAt" TIMESTAMPTZ,
    "seats" INTEGER,
    "billingInterval" TEXT,
    "stripeScheduleId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.circles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    avatar_url TEXT,
    banner_url TEXT,
    is_private BOOLEAN NOT NULL DEFAULT false,
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    member_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.circle_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id UUID NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('member', 'moderator', 'admin')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (circle_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_circle_members_user
    ON public.circle_members(user_id);

CREATE TABLE IF NOT EXISTS public.loops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    parent_loop_id UUID REFERENCES public.loops(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL DEFAULT 'text',
    content_text TEXT,
    content_media_url TEXT,
    content_metadata JSONB,
    content_title TEXT,
    content JSONB,
    visibility TEXT NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'private', 'circle')),
    circle_id UUID REFERENCES public.circles(id) ON DELETE SET NULL,
    tree_depth INTEGER NOT NULL DEFAULT 0,
    hashtags TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loops_author_created
    ON public.loops(author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loops_circle
    ON public.loops(circle_id)
    WHERE circle_id IS NOT NULL;

-- LOOP collections: reusable, shareable sets of existing platform objects.
-- This migration is additive and does not rewrite legacy bookmarks or content.

CREATE TABLE IF NOT EXISTS collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title VARCHAR(80) NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
    description VARCHAR(500) NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'private'
        CHECK (visibility IN ('private', 'unlisted', 'public')),
    is_collaborative BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collections_owner_created
    ON collections(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_collections_public_created
    ON collections(created_at DESC)
    WHERE visibility = 'public';

CREATE TABLE IF NOT EXISTS collection_members (
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer'
        CHECK (role IN ('editor', 'viewer')),
    invited_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending', 'active', 'declined')),
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (collection_id, user_id)
);

ALTER TABLE collection_members
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

UPDATE collection_members
SET status = 'active',
    accepted_at = COALESCE(accepted_at, joined_at)
WHERE status IS NULL OR status NOT IN ('pending', 'active', 'declined');

ALTER TABLE collection_members
    DROP CONSTRAINT IF EXISTS collection_members_status_check;
ALTER TABLE collection_members
    ADD CONSTRAINT collection_members_status_check
    CHECK (status IN ('pending', 'active', 'declined'));

CREATE INDEX IF NOT EXISTS idx_collection_members_pending_user
    ON collection_members(user_id, invited_at DESC)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_collection_members_user
    ON collection_members(user_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS collection_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    added_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('loop', 'circle', 'external')),
    loop_id UUID REFERENCES loops(id) ON DELETE CASCADE,
    circle_id UUID REFERENCES circles(id) ON DELETE CASCADE,
    external_url TEXT,
    title_override VARCHAR(160),
    note VARCHAR(500),
    position BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT collection_item_target_matches_type CHECK (
        (item_type = 'loop' AND loop_id IS NOT NULL AND circle_id IS NULL AND external_url IS NULL)
        OR
        (item_type = 'circle' AND loop_id IS NULL AND circle_id IS NOT NULL AND external_url IS NULL)
        OR
        (item_type = 'external' AND loop_id IS NULL AND circle_id IS NULL AND external_url IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_collection_items_order
    ON collection_items(collection_id, position, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_items_unique_loop
    ON collection_items(collection_id, loop_id)
    WHERE loop_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_items_unique_circle
    ON collection_items(collection_id, circle_id)
    WHERE circle_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_items_unique_external
    ON collection_items(collection_id, external_url)
    WHERE external_url IS NOT NULL;
