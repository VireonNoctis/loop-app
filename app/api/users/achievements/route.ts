import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { profileStatus } from "@/lib/user-status"
import { isRestrictedProfileVisibility } from "@/lib/profile-privacy"
import { checkBlockStatus } from "@/lib/user-blocks"
import { canViewAchievementStats } from "@/lib/achievement-visibility"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase configuration")
  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(request: NextRequest) {
  try {
    const viewer = await getUserFromRequest(request)
    const requestedUserId = request.nextUrl.searchParams.get("userId")
    if (!viewer && !requestedUserId) return NextResponse.json({ error: "Invalid token" }, { status: 401 })

    const targetId = requestedUserId || viewer?.id || ""
    if (!UUID_PATTERN.test(targetId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 })

    const supabase = createServerClient()
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, privacy_settings, is_banned, is_deleted, deletion_executed_at")
      .eq("id", targetId)
      .maybeSingle()

    if (profileError) {
      console.error("Could not load achievement profile:", profileError)
      return NextResponse.json({ error: "Could not load achievements" }, { status: 500 })
    }
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    const isSelf = Boolean(viewer && viewer.id === targetId)
    const active = profileStatus(profile as any) === "active"
    let blocked = false
    if (viewer && !isSelf) blocked = (await checkBlockStatus(supabase, viewer.id, targetId)).blocked

    const restricted = isRestrictedProfileVisibility(profile.privacy_settings)
    let isApprovedFollower = false
    if (viewer && !isSelf && restricted && !blocked) {
      const { data: follow, error: followError } = await supabase
        .from("follows")
        .select("id")
        .eq("follower_id", viewer.id)
        .eq("following_id", targetId)
        .maybeSingle()
      if (followError) {
        console.error("Could not verify achievement visibility:", followError)
        return NextResponse.json({ error: "Could not verify profile access" }, { status: 500 })
      }
      isApprovedFollower = Boolean(follow)
    }

    if (!canViewAchievementStats({
      viewerId: viewer?.id || null,
      targetId,
      profileActive: active,
      blocked,
      restricted,
      isApprovedFollower,
    })) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    const { data: earnedAchievements, error: achievementsError } = await supabase
      .from("user_achievements")
      .select(`
        id,
        earned_at,
        achievement:achievements(
          id, name, description, category, level, xp_reward, coins_reward, icon
        )
      `)
      .eq("user_id", targetId)
      .order("earned_at", { ascending: false })

    if (achievementsError) {
      console.error("Error fetching achievements:", achievementsError)
      return NextResponse.json({ error: "Failed to fetch achievements" }, { status: 500 })
    }

    const { data: userStats, error: statsError } = await supabase
      .from("user_stats")
      .select("loops_created, total_likes_received, total_comments_received, total_shares_received, followers_count, following_count, loops_liked, comments_made, total_xp, level")
      .eq("user_id", targetId)
      .maybeSingle()

    if (statsError) {
      console.error("Error fetching user stats:", statsError)
      return NextResponse.json({ error: "Failed to fetch achievement progress" }, { status: 500 })
    }

    const { data: availableAchievements, error: catalogueError } = await supabase
      .from("achievements")
      .select("id, category, level")
      .eq("is_active", true)

    if (catalogueError) {
      console.error("Error fetching achievement catalogue:", catalogueError)
      return NextResponse.json({ error: "Failed to fetch achievement catalogue" }, { status: 500 })
    }

    const earnedIds = (earnedAchievements || []).map((item: any) => {
      const achievement = Array.isArray(item.achievement) ? item.achievement[0] : item.achievement
      return achievement?.id
    }).filter(Boolean)

    const achievementStats = {
      total_earned: earnedAchievements?.length || 0,
      total_available: availableAchievements?.length || 0,
      by_category: {} as Record<string, { earned: number; total: number }>,
      by_level: {} as Record<string, { earned: number; total: number }>,
    }

    for (const category of ["social", "content", "engagement", "special", "milestone"]) {
      const rows = (availableAchievements || []).filter((item: any) => item.category === category)
      achievementStats.by_category[category] = {
        earned: rows.filter((item: any) => earnedIds.includes(item.id)).length,
        total: rows.length,
      }
    }
    for (const level of ["bronze", "silver", "gold", "platinum", "diamond"]) {
      const rows = (availableAchievements || []).filter((item: any) => item.level === level)
      achievementStats.by_level[level] = {
        earned: rows.filter((item: any) => earnedIds.includes(item.id)).length,
        total: rows.length,
      }
    }

    return NextResponse.json({
      success: true,
      achievements: earnedAchievements || [],
      stats: userStats || {
        loops_created: 0,
        total_likes_received: 0,
        total_comments_received: 0,
        total_shares_received: 0,
        followers_count: 0,
        following_count: 0,
        loops_liked: 0,
        comments_made: 0,
        total_xp: 0,
        level: 1,
      },
      achievement_stats: achievementStats,
    })
  } catch (error) {
    console.error("Error fetching user achievements:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
