-- Pro-only profile CSS is stored as source text and sanitized on every write/render.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_custom_css TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.profiles.profile_custom_css IS
  'LOOP Pro custom profile CSS source; validated and scoped by the application before rendering.';
