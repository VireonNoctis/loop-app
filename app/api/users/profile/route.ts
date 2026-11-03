import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { normalizeLoops } from "@/lib/normalize-loop"
import { enrichLoopsWithPollsAndDuels } from "@/lib/enrich-loops"
import { getUserFromRequest } from "@/lib/server-auth"
import { isProUser } from "@/lib/pro-features"
import { maskProfile, profileStatus } from "@/lib/user-status"
import { applyRealCommentCounts, attachParentAuthors } from "@/lib/loop-stats"
import { checkBlockStatus } from "@/lib/user-blocks"
import { buildPublicProfileIdentity, buildRestrictedProfileView, isRestrictedProfileVisibility } from "@/lib/profile-privacy"
import { filterPrivateContent, getFollowingIds } from "@/lib/privacy"
import { filterCircleScopedContent } from "@/lib/circle-content-privacy"

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const username = request.nextUrl.searchParams.get("username")
    const authedUser = await getUserFromRequest(request)

    // Public profile lookup by username (used by /profile/[username]).
    // If username is omitted, require auth and return the current user's profile.
    let profileQuery = supabase.from("profiles").select("*")
    if (username) {
      profileQuery = profileQuery.eq("username", username)
    } else {
      if (!authedUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
      profileQuery = profileQuery.eq("id", authedUser.id)
    }

    const { data: profile, error: profileError } = await profileQuery.single()

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    // Auto-assign animated character avatar to users who don't have one yet
    if (!profile.avatar_url) {
      try {
        const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, "")
        const name = profile.display_name || profile.username || "U"
        const defaultAvatar = `${baseUrl}/api/default-avatar?id=${encodeURIComponent(profile.id)}&name=${encodeURIComponent(name)}`
        const defaultBanner = `${baseUrl}/api/default-avatar?id=${encodeURIComponent(profile.id)}&name=${encodeURIComponent(name)}&type=banner`
        // Mutate the in-memory profile so this response uses the new avatar immediately
        ;(profile as any).avatar_url = defaultAvatar
        if (!(profile as any).banner_url) {
          ;(profile as any).banner_url = defaultBanner
        }
        // Fire-and-forget: persist to DB so this only happens once.
        // Wrapped in try/catch to prevent unhandled rejection from crashing the response.
        supabase
          .from("profiles")
          .update({ avatar_url: defaultAvatar, banner_url: profile.banner_url || defaultBanner, updated_at: new Date().toISOString() })
          .eq("id", profile.id)
          .then(() => {}, () => {}) // swallow errors
      } catch {
        // If anything goes wrong generating the URL, just continue with null avatar
      }
    }

    // Deleted / suspended accounts render as placeholders — no real profile
    // data, no content, no follow actions. Suspended users keep an appeal path.
    const accountStatus = profileStatus(profile as any)
    if (accountStatus !== "active") {
      const masked = maskProfile(profile as any)
      return NextResponse.json({
        success: true,
        profile: {
          ...masked,
          is_private: false,
          can_view_full: false,
          status: accountStatus,
          is_suspended: accountStatus === "suspended",
          is_deleted: accountStatus === "deleted",
          ban_reason: (profile as any)?.ban_reason || "Violated community guidelines",
          followers_count: 0,
          following_count: 0,
          loops_count: 0,
          branches_count: 0,
          comments_count: 0,
          likes_received: 0,
          recent_loops: [],
          recent_branches: [],
          media_loops: [],
          active_cosmetics: null,
          active_effects: [],
        },
        [accountStatus]: true,
      })
    }

    const privacySettings = (profile as any)?.privacy_settings || {}
    // "followers" visibility is gated exactly like "private": only approved
    // followers (and the owner) can see the full profile.
    const isPrivate = isRestrictedProfileVisibility(privacySettings)

    const [{ count: followersCount }, { count: followingCount }, { count: loopsCount }, { count: branchesCount }, { count: commentsCount }, { data: rawRecentLoops }, { data: rawCoLoops }, { data: rawRecentBranches }, { data: rawMediaLoops }, { data: followRecord }, { data: pendingFollowRequest }, { data: activeItems }] = await Promise.all([
      supabase.from("follows").select("id", { count: "exact", head: true }).eq("following_id", profile.id),
      supabase.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", profile.id),
      supabase.from("loops").select("id", { count: "exact", head: true }).eq("author_id", profile.id).is("parent_loop_id", null),
      supabase.from("loops").select("id", { count: "exact", head: true }).eq("author_id", profile.id).not("parent_loop_id", "is", null),
      supabase.from("comments").select("id", { count: "exact", head: true }).eq("author_id", profile.id),
      supabase
        .from("loops")
        .select(`
          *,
          author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, badge_id, equipped_frame_id, active_cosmetics, cosmetics),
          loop_stats(likes_count, comments_count, branches_count, shares_count, views_count)
        `)
        .eq("author_id", profile.id)
        .is("parent_loop_id", null)
        .order("created_at", { ascending: false })
        .limit(100),
      // Loops where this profile is listed as a co-author (JSONB containment —
      // scoped directly to this profile, not just "the 30 most recent
      // co-loops platform-wide", which could miss older ones entirely once
      // co-loops are common).
      supabase
        .from("loops")
        .select(`
          *,
          author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, badge_id, equipped_frame_id, active_cosmetics, cosmetics),
          loop_stats(likes_count, comments_count, branches_count, shares_count, views_count)
        `)
        .is("parent_loop_id", null)
        .filter("content_metadata->co_authors", "cs", JSON.stringify([{ id: profile.id }]))
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("loops")
        .select(`
          *,
          author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, badge_id, equipped_frame_id, active_cosmetics, cosmetics),
          loop_stats(likes_count, comments_count, branches_count, shares_count, views_count)
        `)
        .eq("author_id", profile.id)
        .not("parent_loop_id", "is", null)
        .order("created_at", { ascending: false })        .limit(100),
      supabase
        .from("loops")
        .select(
          `id, content, content_text, content_media_url, content_type, media_url, media_urls, media_type, hashtags, created_at,
          author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, badge_id, equipped_frame_id, active_cosmetics, cosmetics),
          loop_stats(likes_count, comments_count, branches_count, shares_count, views_count)
        `)
        .eq("author_id", profile.id)
        .or("media_url.not.is.null,content_media_url.not.is.null")
        .order("created_at", { ascending: false })
        .limit(36),
      authedUser
        ? supabase
            .from("follows")
            .select("id")
            .eq("follower_id", authedUser.id)
            .eq("following_id", profile.id)
            .maybeSingle()
        : Promise.resolve({ data: null } as any),
      authedUser
        ? supabase
            .from("follow_requests")
            .select("id, status")
            .eq("requester_id", authedUser.id)
            .eq("target_id", profile.id)
            .eq("status", "pending")
            .maybeSingle()
        : Promise.resolve({ data: null } as any),
      supabase
        .from("user_inventory")
        .select("id, item_id, item_type, is_active, shop_item:shop_items(id, name, category, item_type, item_data, preview_data)")
        .eq("user_id", profile.id)
        .eq("is_active", true)
        .limit(12),
    ])

    const isSelf = Boolean(authedUser && authedUser.id === profile.id)
    const isFollower = Boolean(followRecord)
    const hasPendingRequest = Boolean(pendingFollowRequest)

    // Blocks short-circuit the profile: the target blocked the viewer, or the
    // viewer blocked the target — either way the full profile stays hidden.
    // (Blocking is meant to be one-sided and invisible-ish; both directions
    // hide so a blocked user can't probe via a second account.)
    let isBlockedView = false
    let blockDirection: "by_me" | "by_them" | null = null
    if (authedUser && !isSelf) {
      const blockStatus = await checkBlockStatus(supabase, authedUser.id, profile.id)
      isBlockedView = blockStatus.blocked
      blockDirection = blockStatus.direction
    }

    const canViewFull = !isBlockedView && (!isPrivate || isSelf || isFollower)

    // Private profile, or a block in either direction — only expose pfp,
    // cover, name and bio (plus block status so the UI can explain why).
    if (!canViewFull) {
      const limited = buildRestrictedProfileView(profile as any, {
        isPrivate,
        hasPendingRequest,
        isBlocked: isBlockedView,
        blockDirection,
      })
      return NextResponse.json({ success: true, profile: limited, private: isPrivate, blocked: isBlockedView })
    }

    // Filter co-authored loops where profile is listed in co_authors or author
    const matchedCoLoops = (rawCoLoops || []).filter((l: any) => {
      if (l.author_id === profile.id) return true
      const coAuthorsList = l.co_authors || l.content_metadata?.co_authors || []
      return Array.isArray(coAuthorsList) && coAuthorsList.some((ca: any) => ca.id === profile.id || ca.username === profile.username)
    })

    // Merge recent loops + co-authored loops, deduplicate by ID, sort by created_at desc
    const loopMap = new Map<string, any>()
    ;(rawRecentLoops || []).forEach((l: any) => loopMap.set(l.id, l))
    matchedCoLoops.forEach((l: any) => loopMap.set(l.id, l))
    const combinedRecentLoops = Array.from(loopMap.values()).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ).slice(0, 30)

    // Profile surfaces follow the same creator/block and Circle access rules
    // as Discover and Search. A public profile does not make a private Circle's
    // posts or another blocked co-author's work public.
    const followingIds = await getFollowingIds(supabase, authedUser?.id || null)
    const filterProfileSurface = async (rows: any[]) => {
      const visibleAuthors = await filterPrivateContent(
        supabase,
        rows,
        authedUser?.id || null,
        followingIds,
      )
      return filterCircleScopedContent(supabase, visibleAuthors, authedUser?.id || null)
    }

    const [visibleRecentLoops, visibleRecentBranches, visibleMediaLoops] = await Promise.all([
      filterProfileSurface(combinedRecentLoops),
      filterProfileSurface(rawRecentBranches || []),
      filterProfileSurface(rawMediaLoops || []),
    ])

    const recentLoops = await enrichLoopsWithPollsAndDuels(supabase, visibleRecentLoops)
    const recentBranches = await enrichLoopsWithPollsAndDuels(supabase, visibleRecentBranches)
    const mediaLoops = await enrichLoopsWithPollsAndDuels(supabase, visibleMediaLoops)
    // Branched posts also carry a parent — fetch the real parent author so
    // branch banners can say "Branch from @username" here too.
    await Promise.all([
      attachParentAuthors(supabase, recentLoops),
      attachParentAuthors(supabase, recentBranches),
      attachParentAuthors(supabase, mediaLoops),
    ])

    // True comment counts from the comments table for every loop surface.
    await Promise.all([
      applyRealCommentCounts(supabase, recentLoops),
      applyRealCommentCounts(supabase, recentBranches),
      applyRealCommentCounts(supabase, mediaLoops),
    ])

    const likesReceived = (recentLoops || []).reduce((sum, loop: any) => {
      const stats = Array.isArray(loop.loop_stats) ? loop.loop_stats[0] : loop.loop_stats
      return sum + Number(stats?.likes_count || 0)
    }, 0)

    const viewsReceived = (recentLoops || []).reduce((sum, loop: any) => {
      const stats = Array.isArray(loop.loop_stats) ? loop.loop_stats[0] : loop.loop_stats
      return sum + Number(stats?.views_count || 0)
    }, 0)

    const { cosmeticsFromInventory } = await import("@/lib/cosmetics")
    const derivedCosmetics = cosmeticsFromInventory(activeItems || [])

    const profileWithSocial = {
      ...buildPublicProfileIdentity(profile as Record<string, any>, isSelf),
      followers_count: followersCount ?? profile.followers_count ?? 0,
      following_count: followingCount ?? profile.following_count ?? 0,
      loops_count: loopsCount ?? profile.loops_count ?? 0,
      branches_count: branchesCount ?? profile.branches_count ?? 0,
      comments_count: commentsCount ?? profile.comments_count ?? 0,
      likes_received: likesReceived,
      views_received: viewsReceived,
      level: profile.level ?? 1,
      xp_points: profile.xp_points ?? 0,
      achievements: profile.achievements ?? [],
      active_theme: profile.active_theme ?? null,
      theme_preferences: profile.theme_preferences ?? null,
      active_effects: activeItems || [],
      active_cosmetics:
        profile.active_cosmetics && Object.keys(profile.active_cosmetics || {}).length
          ? profile.active_cosmetics
          : derivedCosmetics,
      recent_loops: normalizeLoops(recentLoops || []),
      recent_branches: normalizeLoops(recentBranches || []),
      media_loops: normalizeLoops(mediaLoops || []),
      is_following: isFollower,
      is_follower: isFollower,
      is_self: isSelf,
      is_private: isPrivate,
      is_blocked: false,
      block_direction: null,
      has_pending_follow_request: hasPendingRequest,
      can_view_full: true,
      privacy: {
        profile_visibility: privacySettings.profile_visibility || "public",
        message_privacy: privacySettings.message_privacy || "everyone",
      },
    }

    return NextResponse.json({
      success: true,
      profile: profileWithSocial,
    })
  } catch (error) {
    console.error("Error fetching profile:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const updates = await request.json()
    const supabase = createServerClient()

    // Animated GIF avatars/covers are Pro-only — enforced server-side.
    const looksLikeGif = (url?: unknown) =>
      typeof url === "string" && /\.gif(\?|#|$)/i.test(url.trim())
    if (looksLikeGif(updates.avatar_url) || looksLikeGif(updates.banner_url)) {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("is_premium, premium_expires_at")
        .eq("id", user.id)
        .maybeSingle()
      if (!isProUser(profileRow as any)) {
        return NextResponse.json(
          {
            error: "Animated GIF profile pictures and covers are a Pro perk — upgrade to Pro to use them.",
            pro_required: true,
          },
          { status: 403 },
        )
      }
    }

    // Validate allowed fields
    const allowedFields = [
      'display_name',
      'bio',
      'location',
      'website',
      'avatar_url',
      'video_avatar_url',
      'banner_url',
      'theme_data',
      'privacy_settings',
      'notification_settings',
      'tagged_circles',
    ]

    const filteredUpdates = Object.keys(updates)
      .filter(key => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updates[key]
        return obj
      }, {} as any)

    if (Object.keys(filteredUpdates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    // Add updated_at timestamp
    filteredUpdates.updated_at = new Date().toISOString()

    // Update profile
    const { data: profile, error: updateError } = await supabase
      .from("profiles")
      .update(filteredUpdates)
      .eq("id", user.id)
      .select("*")
      .single()

    if (updateError) {
      console.error("Profile update error:", updateError)
      return NextResponse.json({ error: "Failed to update profile" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      profile,
    })
  } catch (error) {
    console.error("Error updating profile:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
