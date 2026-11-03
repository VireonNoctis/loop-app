-- Hashtag usage is only discoverable when it belongs to public, top-level
-- Loops authored by profiles whose content is publicly visible.
CREATE TABLE IF NOT EXISTS public.hashtag_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hashtag TEXT NOT NULL,
  loop_id UUID REFERENCES public.loops(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hashtag_usage_hashtag ON public.hashtag_usage(hashtag);
CREATE INDEX IF NOT EXISTS idx_hashtag_usage_created_at ON public.hashtag_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_hashtag_usage_loop_id ON public.hashtag_usage(loop_id);
CREATE INDEX IF NOT EXISTS idx_hashtag_usage_user_id ON public.hashtag_usage(user_id);

ALTER TABLE public.hashtag_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view all hashtag usage" ON public.hashtag_usage;
DROP POLICY IF EXISTS "Users can view hashtag usage for public Loops" ON public.hashtag_usage;
CREATE POLICY "Users can view hashtag usage for public Loops"
  ON public.hashtag_usage
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.loops AS loop
      JOIN public.profiles AS author ON author.id = loop.author_id
      WHERE loop.id = hashtag_usage.loop_id
        AND loop.visibility = 'public'
        AND loop.parent_loop_id IS NULL
        AND COALESCE(
          to_jsonb(author)->'privacy_settings'->>'profile_visibility',
          'public'
        ) NOT IN ('private', 'followers')
    )
  );

DROP POLICY IF EXISTS "Users can insert their own hashtag usage" ON public.hashtag_usage;
CREATE POLICY "Users can insert their own hashtag usage" ON public.hashtag_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own hashtag usage" ON public.hashtag_usage;
CREATE POLICY "Users can update their own hashtag usage" ON public.hashtag_usage
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own hashtag usage" ON public.hashtag_usage;
CREATE POLICY "Users can delete their own hashtag usage" ON public.hashtag_usage
  FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.get_trending_hashtags(
  days_back INTEGER DEFAULT 7,
  result_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  hashtag TEXT,
  usage_count BIGINT,
  recent_usage_count BIGINT,
  trending_score NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    usage.hashtag,
    COUNT(*) AS usage_count,
    COUNT(*) FILTER (
      WHERE usage.created_at >= NOW() - INTERVAL '1 day' * GREATEST(1, LEAST(days_back, 30))
    ) AS recent_usage_count,
    (
      COUNT(*) FILTER (
        WHERE usage.created_at >= NOW() - INTERVAL '1 day' * GREATEST(1, LEAST(days_back, 30))
      )::NUMERIC * 2
      + COUNT(*)::NUMERIC * 0.5
    ) AS trending_score
  FROM public.hashtag_usage AS usage
  JOIN public.loops AS loop ON loop.id = usage.loop_id
  JOIN public.profiles AS author ON author.id = loop.author_id
  WHERE loop.visibility = 'public'
    AND loop.parent_loop_id IS NULL
    AND COALESCE(
      to_jsonb(author)->'privacy_settings'->>'profile_visibility',
      'public'
    ) NOT IN ('private', 'followers')
    AND (
      loop.circle_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circles AS circle
        WHERE circle.id = loop.circle_id
          AND COALESCE(circle.is_private, FALSE) = FALSE
          AND COALESCE(circle.is_premium_only, FALSE) = FALSE
      )
    )
    AND usage.created_at >= NOW() - INTERVAL '1 day' * GREATEST(1, LEAST(days_back, 30)) * 2
  GROUP BY usage.hashtag
  HAVING COUNT(*) FILTER (
    WHERE usage.created_at >= NOW() - INTERVAL '1 day' * GREATEST(1, LEAST(days_back, 30))
  ) > 0
  ORDER BY trending_score DESC, recent_usage_count DESC
  LIMIT GREATEST(1, LEAST(result_limit, 100));
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER;

CREATE OR REPLACE VIEW public.trending_hashtags AS
SELECT
  usage.hashtag,
  COUNT(*) AS total_usage,
  COUNT(*) FILTER (WHERE usage.created_at >= NOW() - INTERVAL '7 days') AS recent_usage,
  COUNT(*) FILTER (WHERE usage.created_at >= NOW() - INTERVAL '1 day') AS daily_usage,
  (
    COUNT(*) FILTER (WHERE usage.created_at >= NOW() - INTERVAL '7 days')::NUMERIC * 2
    + COUNT(*)::NUMERIC * 0.5
  ) AS trending_score
FROM public.hashtag_usage AS usage
JOIN public.loops AS loop ON loop.id = usage.loop_id
JOIN public.profiles AS author ON author.id = loop.author_id
WHERE loop.visibility = 'public'
  AND loop.parent_loop_id IS NULL
  AND COALESCE(
    to_jsonb(author)->'privacy_settings'->>'profile_visibility',
    'public'
  ) NOT IN ('private', 'followers')
  AND (
    loop.circle_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.circles AS circle
      WHERE circle.id = loop.circle_id
        AND COALESCE(circle.is_private, FALSE) = FALSE
        AND COALESCE(circle.is_premium_only, FALSE) = FALSE
    )
  )
  AND usage.created_at >= NOW() - INTERVAL '30 days'
GROUP BY usage.hashtag
HAVING COUNT(*) FILTER (WHERE usage.created_at >= NOW() - INTERVAL '7 days') > 0;

GRANT SELECT ON public.trending_hashtags TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trending_hashtags(INTEGER, INTEGER) TO authenticated;
