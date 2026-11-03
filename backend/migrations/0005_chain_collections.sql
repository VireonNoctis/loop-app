-- Add collaborative Chains as a first-class Collection item.
-- This migration runs after 0004_chains.sql creates public.chains.

ALTER TABLE public.collection_items
    ADD COLUMN IF NOT EXISTS chain_id UUID
    REFERENCES public.chains(id) ON DELETE CASCADE;

ALTER TABLE public.collection_items
    DROP CONSTRAINT IF EXISTS collection_items_item_type_check;

ALTER TABLE public.collection_items
    ADD CONSTRAINT collection_items_item_type_check
    CHECK (item_type IN ('loop', 'circle', 'chain', 'external'));

ALTER TABLE public.collection_items
    DROP CONSTRAINT IF EXISTS collection_item_target_matches_type;

ALTER TABLE public.collection_items
    ADD CONSTRAINT collection_item_target_matches_type CHECK (
        (item_type = 'loop' AND loop_id IS NOT NULL AND circle_id IS NULL AND chain_id IS NULL AND external_url IS NULL)
        OR
        (item_type = 'circle' AND loop_id IS NULL AND circle_id IS NOT NULL AND chain_id IS NULL AND external_url IS NULL)
        OR
        (item_type = 'chain' AND loop_id IS NULL AND circle_id IS NULL AND chain_id IS NOT NULL AND external_url IS NULL)
        OR
        (item_type = 'external' AND loop_id IS NULL AND circle_id IS NULL AND chain_id IS NULL AND external_url IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_items_unique_chain
    ON public.collection_items(collection_id, chain_id)
    WHERE chain_id IS NOT NULL;
