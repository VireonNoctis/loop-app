-- Achievement integrity, stat reconciliation and idempotent reward ledger.
-- Run after wallet-and-events-schema.sql and achievements-system.sql.

ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS total_shares_received INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loops_liked INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments_made INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_days_active INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_xp INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- The beta and consecutive-day criteria do not yet have trusted, privacy-aware
-- eligibility sources. Keep these two rewards disabled rather than guessing.
UPDATE public.achievements
SET is_active = FALSE
WHERE name IN ('Beta Tester', 'Daily Streaker');

-- Rebuild derived lifetime counters from source-of-truth rows while preserving
-- existing XP, level and earned achievement history.
WITH loop_counts AS (
  SELECT author_id AS user_id, COUNT(*)::INTEGER AS count
  FROM public.loops
  WHERE parent_loop_id IS NULL
  GROUP BY author_id
),
likes_received AS (
  SELECT loop.author_id AS user_id, COUNT(*)::INTEGER AS count
  FROM public.loop_interactions AS interaction
  JOIN public.loops AS loop ON loop.id = interaction.loop_id
  WHERE interaction.interaction_type::TEXT = 'like'
  GROUP BY loop.author_id
),
comments_received AS (
  SELECT loop.author_id AS user_id, COUNT(*)::INTEGER AS count
  FROM public.comments AS comment
  JOIN public.loops AS loop ON loop.id = comment.loop_id
  GROUP BY loop.author_id
),
shares_received AS (
  SELECT loop.author_id AS user_id, SUM(GREATEST(COALESCE(stats.shares_count, 0), 0))::INTEGER AS count
  FROM public.loop_stats AS stats
  JOIN public.loops AS loop ON loop.id = stats.loop_id
  GROUP BY loop.author_id
),
followers AS (
  SELECT following_id AS user_id, COUNT(*)::INTEGER AS count
  FROM public.follows GROUP BY following_id
),
following AS (
  SELECT follower_id AS user_id, COUNT(*)::INTEGER AS count
  FROM public.follows GROUP BY follower_id
),
likes_made AS (
  SELECT user_id, COUNT(*)::INTEGER AS count
  FROM public.loop_interactions
  WHERE interaction_type::TEXT = 'like'
  GROUP BY user_id
),
comments_made AS (
  SELECT author_id AS user_id, COUNT(*)::INTEGER AS count
  FROM public.comments
  GROUP BY author_id
)
INSERT INTO public.user_stats (
  user_id, loops_created, total_likes_received, total_comments_received,
  total_shares_received, followers_count, following_count, loops_liked,
  comments_made
)
SELECT
  profile.id,
  COALESCE(loop_counts.count, 0),
  COALESCE(likes_received.count, 0),
  COALESCE(comments_received.count, 0),
  COALESCE(shares_received.count, 0),
  COALESCE(followers.count, 0),
  COALESCE(following.count, 0),
  COALESCE(likes_made.count, 0),
  COALESCE(comments_made.count, 0)
FROM public.profiles AS profile
LEFT JOIN loop_counts ON loop_counts.user_id = profile.id
LEFT JOIN likes_received ON likes_received.user_id = profile.id
LEFT JOIN comments_received ON comments_received.user_id = profile.id
LEFT JOIN shares_received ON shares_received.user_id = profile.id
LEFT JOIN followers ON followers.user_id = profile.id
LEFT JOIN following ON following.user_id = profile.id
LEFT JOIN likes_made ON likes_made.user_id = profile.id
LEFT JOIN comments_made ON comments_made.user_id = profile.id
ON CONFLICT (user_id) DO UPDATE SET
  loops_created = EXCLUDED.loops_created,
  total_likes_received = EXCLUDED.total_likes_received,
  total_comments_received = EXCLUDED.total_comments_received,
  total_shares_received = EXCLUDED.total_shares_received,
  followers_count = EXCLUDED.followers_count,
  following_count = EXCLUDED.following_count,
  loops_liked = EXCLUDED.loops_liked,
  comments_made = EXCLUDED.comments_made,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.check_user_achievements(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_stats public.user_stats%ROWTYPE;
  v_achievement RECORD;
  v_requirement RECORD;
  v_meets_requirement BOOLEAN;
  v_special_met BOOLEAN;
  v_awarded_id UUID;
  v_new_level INTEGER;
  v_reward_coins INTEGER;
BEGIN
  INSERT INTO public.user_stats(user_id)
  VALUES (target_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Serialize all checks for one account. The earned-row unique constraint is
  -- the second idempotency barrier and the only path to granting any reward.
  SELECT * INTO v_stats
  FROM public.user_stats
  WHERE user_id = target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  FOR v_achievement IN
    SELECT achievement.*
    FROM public.achievements AS achievement
    WHERE achievement.is_active IS TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.user_achievements AS earned
        WHERE earned.user_id = target_user_id
          AND earned.achievement_id = achievement.id
      )
    ORDER BY achievement.created_at ASC, achievement.id ASC
  LOOP
    v_meets_requirement := TRUE;

    FOR v_requirement IN
      SELECT key, value
      FROM jsonb_each_text(COALESCE(v_achievement.requirements, '{}'::JSONB))
    LOOP
      CASE v_requirement.key
        WHEN 'loops_created' THEN
          v_meets_requirement := COALESCE(v_stats.loops_created, 0) >= v_requirement.value::INTEGER;
        WHEN 'total_likes_received' THEN
          v_meets_requirement := COALESCE(v_stats.total_likes_received, 0) >= v_requirement.value::INTEGER;
        WHEN 'total_comments_received' THEN
          v_meets_requirement := COALESCE(v_stats.total_comments_received, 0) >= v_requirement.value::INTEGER;
        WHEN 'total_shares_received' THEN
          v_meets_requirement := COALESCE(v_stats.total_shares_received, 0) >= v_requirement.value::INTEGER;
        WHEN 'followers_count' THEN
          v_meets_requirement := COALESCE(v_stats.followers_count, 0) >= v_requirement.value::INTEGER;
        WHEN 'following_count' THEN
          v_meets_requirement := COALESCE(v_stats.following_count, 0) >= v_requirement.value::INTEGER;
        WHEN 'loops_liked' THEN
          v_meets_requirement := COALESCE(v_stats.loops_liked, 0) >= v_requirement.value::INTEGER;
        WHEN 'comments_made' THEN
          v_meets_requirement := COALESCE(v_stats.comments_made, 0) >= v_requirement.value::INTEGER;
        WHEN 'consecutive_days_active' THEN
          v_meets_requirement := COALESCE(v_stats.consecutive_days_active, 0) >= v_requirement.value::INTEGER;
        WHEN 'level' THEN
          v_meets_requirement := COALESCE(v_stats.level, 1) >= v_requirement.value::INTEGER;
        WHEN 'special' THEN
          v_special_met := FALSE;
          IF v_requirement.value = 'premium_user' THEN
            SELECT COALESCE(profile.is_premium, FALSE)
            INTO v_special_met
            FROM public.profiles AS profile
            WHERE profile.id = target_user_id;
          END IF;
          v_meets_requirement := COALESCE(v_special_met, FALSE);
        ELSE
          -- Unknown requirement keys fail closed and can never auto-award.
          v_meets_requirement := FALSE;
      END CASE;

      IF NOT v_meets_requirement THEN EXIT; END IF;
    END LOOP;

    IF v_meets_requirement THEN
      v_awarded_id := NULL;
      INSERT INTO public.user_achievements(user_id, achievement_id)
      VALUES (target_user_id, v_achievement.id)
      ON CONFLICT (user_id, achievement_id) DO NOTHING
      RETURNING id INTO v_awarded_id;

      IF v_awarded_id IS NOT NULL THEN
        v_reward_coins := GREATEST(COALESCE(v_achievement.coins_reward, 0), 0);

        UPDATE public.user_stats
        SET total_xp = COALESCE(total_xp, 0) + GREATEST(COALESCE(v_achievement.xp_reward, 0), 0),
            level = GREATEST(
              COALESCE(level, 1),
              ((COALESCE(total_xp, 0) + GREATEST(COALESCE(v_achievement.xp_reward, 0), 0)) / 1000) + 1
            ),
            updated_at = NOW()
        WHERE user_id = target_user_id
        RETURNING level INTO v_new_level;

        UPDATE public.profiles
        SET xp_points = COALESCE(xp_points, 0) + GREATEST(COALESCE(v_achievement.xp_reward, 0), 0),
            level = GREATEST(COALESCE(level, 1), v_new_level),
            loop_coins = COALESCE(loop_coins, 0) + v_reward_coins,
            updated_at = NOW()
        WHERE id = target_user_id;

        IF v_reward_coins > 0 THEN
          INSERT INTO public.wallet_transactions (
            id, user_id, amount_usd, coins_amount, type, description, status, payment_method, created_at
          )
          VALUES (
            format('achievement_%s_%s', target_user_id, v_achievement.id),
            target_user_id::TEXT,
            0,
            v_reward_coins,
            'achievement_reward',
            format('Achievement reward: %s', v_achievement.name),
            'completed',
            'system',
            NOW()
          )
          ON CONFLICT (id) DO NOTHING;
        END IF;

        INSERT INTO public.notifications (
          user_id, type, title, message, data, is_read
        )
        VALUES (
          target_user_id,
          'achievement',
          'Achievement unlocked',
          format('You earned “%s”.', v_achievement.name),
          jsonb_build_object(
            'achievement_id', v_achievement.id,
            'achievement_name', v_achievement.name,
            'category', v_achievement.category,
            'level', v_achievement.level
          ),
          FALSE
        );

        SELECT * INTO v_stats
        FROM public.user_stats
        WHERE user_id = target_user_id;
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_user_stats_and_check_achievements(
  target_user_id UUID,
  stat_type TEXT,
  increment_value INTEGER DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF increment_value = 0 OR increment_value < -100000 OR increment_value > 100000 THEN
    RAISE EXCEPTION 'Achievement stat increment must be between -100000 and 100000 and cannot be zero'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_stats(user_id)
  VALUES (target_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  CASE stat_type
    WHEN 'loops_created' THEN
      UPDATE public.user_stats SET loops_created = GREATEST(0, COALESCE(loops_created, 0) + increment_value) WHERE user_id = target_user_id;
    WHEN 'likes_received' THEN
      UPDATE public.user_stats SET total_likes_received = GREATEST(0, COALESCE(total_likes_received, 0) + increment_value) WHERE user_id = target_user_id;
    WHEN 'comments_received' THEN
      UPDATE public.user_stats SET total_comments_received = GREATEST(0, COALESCE(total_comments_received, 0) + increment_value) WHERE user_id = target_user_id;
    WHEN 'shares_received' THEN
      UPDATE public.user_stats SET total_shares_received = GREATEST(0, COALESCE(total_shares_received, 0) + increment_value) WHERE user_id = target_user_id;
    WHEN 'follower_gained' THEN
      UPDATE public.user_stats SET followers_count = GREATEST(0, COALESCE(followers_count, 0) + increment_value) WHERE user_id = target_user_id;
    WHEN 'following_added' THEN
      UPDATE public.user_stats SET following_count = GREATEST(0, COALESCE(following_count, 0) + increment_value) WHERE user_id = target_user_id;
    WHEN 'loops_liked' THEN
      UPDATE public.user_stats SET loops_liked = GREATEST(0, COALESCE(loops_liked, 0) + increment_value) WHERE user_id = target_user_id;
    WHEN 'comments_made' THEN
      UPDATE public.user_stats SET comments_made = GREATEST(0, COALESCE(comments_made, 0) + increment_value) WHERE user_id = target_user_id;
    ELSE
      RAISE EXCEPTION 'Unsupported achievement stat type: %', stat_type USING ERRCODE = '22023';
  END CASE;

  UPDATE public.user_stats SET updated_at = NOW() WHERE user_id = target_user_id;
  PERFORM public.check_user_achievements(target_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.achievement_loop_created_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.parent_loop_id IS NULL THEN
    PERFORM public.update_user_stats_and_check_achievements(NEW.author_id, 'loops_created', 1);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS achievement_loop_created ON public.loops;
CREATE TRIGGER achievement_loop_created
AFTER INSERT ON public.loops
FOR EACH ROW EXECUTE FUNCTION public.achievement_loop_created_trigger();

CREATE OR REPLACE FUNCTION public.achievement_interaction_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor_id UUID;
  v_loop_id UUID;
  v_author_id UUID;
  v_delta INTEGER;
  v_interaction_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_actor_id := NEW.user_id;
    v_loop_id := NEW.loop_id;
    v_interaction_type := NEW.interaction_type::TEXT;
    v_delta := 1;
  ELSE
    v_actor_id := OLD.user_id;
    v_loop_id := OLD.loop_id;
    v_interaction_type := OLD.interaction_type::TEXT;
    v_delta := -1;
  END IF;

  IF v_interaction_type = 'like' THEN
    PERFORM public.update_user_stats_and_check_achievements(v_actor_id, 'loops_liked', v_delta);
    SELECT loop.author_id INTO v_author_id
    FROM public.loops AS loop
    WHERE loop.id = v_loop_id;
    IF v_author_id IS NOT NULL AND v_author_id <> v_actor_id THEN
      PERFORM public.update_user_stats_and_check_achievements(v_author_id, 'likes_received', v_delta);
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS achievement_interaction_insert ON public.loop_interactions;
CREATE TRIGGER achievement_interaction_insert
AFTER INSERT ON public.loop_interactions
FOR EACH ROW EXECUTE FUNCTION public.achievement_interaction_trigger();

DROP TRIGGER IF EXISTS achievement_interaction_delete ON public.loop_interactions;
CREATE TRIGGER achievement_interaction_delete
AFTER DELETE ON public.loop_interactions
FOR EACH ROW EXECUTE FUNCTION public.achievement_interaction_trigger();

CREATE OR REPLACE FUNCTION public.achievement_comment_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_loop_id UUID;
  v_comment_author_id UUID;
  v_delta INTEGER;
  v_loop_author_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_loop_id := NEW.loop_id;
    v_comment_author_id := NEW.author_id;
    v_delta := 1;
  ELSE
    v_loop_id := OLD.loop_id;
    v_comment_author_id := OLD.author_id;
    v_delta := -1;
  END IF;

  PERFORM public.update_user_stats_and_check_achievements(v_comment_author_id, 'comments_made', v_delta);
  SELECT loop.author_id INTO v_loop_author_id
  FROM public.loops AS loop
  WHERE loop.id = v_loop_id;
  IF v_loop_author_id IS NOT NULL THEN
    PERFORM public.update_user_stats_and_check_achievements(v_loop_author_id, 'comments_received', v_delta);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS achievement_comment_insert ON public.comments;
CREATE TRIGGER achievement_comment_insert
AFTER INSERT ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.achievement_comment_trigger();

DROP TRIGGER IF EXISTS achievement_comment_delete ON public.comments;
CREATE TRIGGER achievement_comment_delete
AFTER DELETE ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.achievement_comment_trigger();

CREATE OR REPLACE FUNCTION public.achievement_follow_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_delta INTEGER;
  v_follower_id UUID;
  v_following_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_follower_id := NEW.follower_id;
    v_following_id := NEW.following_id;
    v_delta := 1;
  ELSE
    v_follower_id := OLD.follower_id;
    v_following_id := OLD.following_id;
    v_delta := -1;
  END IF;

  PERFORM public.update_user_stats_and_check_achievements(v_follower_id, 'following_added', v_delta);
  PERFORM public.update_user_stats_and_check_achievements(v_following_id, 'follower_gained', v_delta);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS achievement_follow_insert ON public.follows;
CREATE TRIGGER achievement_follow_insert
AFTER INSERT ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.achievement_follow_trigger();

DROP TRIGGER IF EXISTS achievement_follow_delete ON public.follows;
CREATE TRIGGER achievement_follow_delete
AFTER DELETE ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.achievement_follow_trigger();

CREATE OR REPLACE FUNCTION public.achievement_share_count_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_delta INTEGER;
  v_author_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_delta := GREATEST(COALESCE(NEW.shares_count, 0), 0);
  ELSE
    v_delta := COALESCE(NEW.shares_count, 0) - COALESCE(OLD.shares_count, 0);
  END IF;

  IF v_delta <> 0 THEN
    SELECT loop.author_id INTO v_author_id
    FROM public.loops AS loop
    WHERE loop.id = NEW.loop_id;
    IF v_author_id IS NOT NULL THEN
      PERFORM public.update_user_stats_and_check_achievements(v_author_id, 'shares_received', v_delta);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS achievement_share_count_changed ON public.loop_stats;
CREATE TRIGGER achievement_share_count_changed
AFTER INSERT OR UPDATE ON public.loop_stats
FOR EACH ROW EXECUTE FUNCTION public.achievement_share_count_trigger();


-- Re-check existing users after source counters are reconciled. Earned rows
-- make this safe to re-run and prevent any duplicate reward.
DO $
DECLARE
  v_user RECORD;
BEGIN
  FOR v_user IN SELECT user_id FROM public.user_stats ORDER BY user_id LOOP
    PERFORM public.check_user_achievements(v_user.user_id);
  END LOOP;
END;
$;

REVOKE ALL ON FUNCTION public.check_user_achievements(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_user_stats_and_check_achievements(UUID, TEXT, INTEGER) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.achievements FROM anon;
    REVOKE ALL ON TABLE public.user_achievements FROM anon;
    REVOKE ALL ON TABLE public.user_stats FROM anon;
    REVOKE ALL ON FUNCTION public.check_user_achievements(UUID) FROM anon;
    REVOKE ALL ON FUNCTION public.update_user_stats_and_check_achievements(UUID, TEXT, INTEGER) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.achievements FROM authenticated;
    REVOKE ALL ON TABLE public.user_achievements FROM authenticated;
    REVOKE ALL ON TABLE public.user_stats FROM authenticated;
    REVOKE ALL ON FUNCTION public.check_user_achievements(UUID) FROM authenticated;
    REVOKE ALL ON FUNCTION public.update_user_stats_and_check_achievements(UUID, TEXT, INTEGER) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.achievements TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_achievements TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_stats TO service_role;
    GRANT EXECUTE ON FUNCTION public.check_user_achievements(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION public.update_user_stats_and_check_achievements(UUID, TEXT, INTEGER) TO service_role;
  END IF;
END
$$;

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;
