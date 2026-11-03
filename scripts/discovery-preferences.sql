-- Viewer-controlled Discover topics and personalization.
-- Preferences never grant access to otherwise restricted content.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discovery_preferences JSONB
  NOT NULL DEFAULT '{"personalization_enabled":true,"preferred_topics":[],"muted_topics":[]}'::jsonb;
UPDATE public.profiles
   SET discovery_preferences = '{"personalization_enabled":true,"preferred_topics":[],"muted_topics":[]}'::jsonb
 WHERE discovery_preferences IS NULL;
ALTER TABLE public.profiles
  ALTER COLUMN discovery_preferences
  SET DEFAULT '{"personalization_enabled":true,"preferred_topics":[],"muted_topics":[]}'::jsonb,
  ALTER COLUMN discovery_preferences SET NOT NULL;
