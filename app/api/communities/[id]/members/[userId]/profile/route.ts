import { type NextRequest, NextResponse } from "next/server"
import { communityClient } from "@/lib/community-engine"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkBlockStatus } from "@/lib/user-blocks"
import { isRestrictedProfileVisibility, buildRestrictedProfileView } from "@/lib/profile-privacy"

export const dynamic = "force-dynamic"

/**
 * GET /api/communities/[id]/members/[userId]/profile
 *
 * Everything a mini profile shows, in one round trip: their base role and
 * Powers, the about text, how many threads they have started here, and the
 * badges/cosmetics the card decorates itself with. Private communities still
 * require membership, so the popover cannot be used to scout a closed world.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const { id, userId } = await params
    const viewer = await getUserFromRequest(request)
    const sb = communityClient()

    const { data: circle, error: circleError } = await sb
      .from("circles")
      .select("id, is_private, owner_id, creator_id")
      .eq("id", id)
      .maybeSingle()
    if (circleError) return NextResponse.json({ error: "Could not verify Circle access" }, { status: 503 })
    if (!circle) return NextResponse.json({ error: "Community not found" }, { status: 404 })

    let viewerMembership: any = null
    if (viewer) {
      const { data, error } = await sb
        .from("circle_members")
        .select("role, status")
        .eq("circle_id", id)
        .eq("user_id", viewer.id)
        .maybeSingle()
      if (error) return NextResponse.json({ error: "Could not verify Circle membership" }, { status: 503 })
      viewerMembership = data
    }

    const viewerIsActiveMember = Boolean(
      viewerMembership && ["active", "approved"].includes(String(viewerMembership.status || "")),
    )
    const viewerIsOwner = Boolean(
      viewer && (circle.owner_id === viewer.id || circle.creator_id === viewer.id),
    )
    if (circle.is_private && !viewerIsOwner && !viewerIsActiveMember) {
      return NextResponse.json({ error: "This community is private" }, { status: 403 })
    }

    const [{ data: member, error: memberError }, { data: profile, error: profileError }] = await Promise.all([
      sb
        .from("circle_members")
        .select("role, status, contribution_score, joined_at")
        .eq("circle_id", id)
        .eq("user_id", userId)
        .maybeSingle(),
      sb
        .from("profiles")
        .select(
          "id, username, display_name, avatar_url, banner_url, bio, is_verified, is_premium, equipped_frame_id, privacy_settings",
        )
        .eq("id", userId)
        .maybeSingle(),
    ])

    if (memberError || profileError) {
      return NextResponse.json({ error: "Could not load member profile" }, { status: 503 })
    }
    if (!profile) return NextResponse.json({ error: "That member no longer exists" }, { status: 404 })
    if (!member || !["active", "approved"].includes(String(member.status || ""))) {
      return NextResponse.json({ error: "Active Circle member not found" }, { status: 404 })
    }

    const isSelf = Boolean(viewer && viewer.id === userId)
    let isBlocked = false
    if (viewer && !isSelf) {
      try {
        const block = await checkBlockStatus(sb, viewer.id, userId)
        isBlocked = block.blocked
      } catch {
        return NextResponse.json({ error: "Could not verify profile access" }, { status: 503 })
      }
    }
    if (isBlocked) return NextResponse.json({ error: "Member profile not found" }, { status: 404 })

    const isPrivateProfile = isRestrictedProfileVisibility(profile.privacy_settings)
    let isFollower = false
    if (viewer && !isSelf && isPrivateProfile) {
      const { data: follow, error: followError } = await sb
        .from("follows")
        .select("id")
        .eq("follower_id", viewer.id)
        .eq("following_id", userId)
        .maybeSingle()
      if (followError) return NextResponse.json({ error: "Could not verify profile access" }, { status: 503 })
      isFollower = Boolean(follow)
    }

    const canViewFullProfile = !isPrivateProfile || isSelf || isFollower
    const publicIdentity = {
      id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url ?? null,
      banner_url: profile.banner_url ?? null,
      bio: profile.bio ?? null,
      is_verified: Boolean(profile.is_verified),
      is_premium: Boolean(profile.is_premium),
      equipped_frame_id: profile.equipped_frame_id ?? null,
    }

    if (!canViewFullProfile) {
      const restricted = buildRestrictedProfileView(publicIdentity, {
        isPrivate: true,
        hasPendingRequest: false,
        isBlocked: false,
        blockDirection: null,
      })
      return NextResponse.json({
        profile: restricted,
        membership: null,
        powers: [],
        post_count: 0,
        message_count: 0,
        can_moderate: false,
        viewer_role: viewerMembership?.role || null,
      })
    }

    // Powers are only disclosed for active members and readable profiles.
    const { data: roleRows, error: roleError } = await sb
      .from("community_member_roles")
      .select("role_id, community_roles:community_roles(id, name, color, icon)")
      .eq("circle_id", id)
      .eq("user_id", userId)
      .limit(8)
    if (roleError) return NextResponse.json({ error: "Could not load member roles" }, { status: 503 })

    const powers = (roleRows || []).flatMap((row: any) => {
      const role = Array.isArray(row.community_roles) ? row.community_roles[0] : row.community_roles
      return role ? [{ id: String(role.id), name: role.name, color: role.color || null, icon: role.icon || null }] : []
    })

    const [{ count: postCount, error: postCountError }, { count: messageCount, error: messageCountError }] = await Promise.all([
      sb
        .from("circle_posts")
        .select("id", { count: "exact", head: true })
        .eq("circle_id", id)
        .eq("author_id", userId)
        .or("status.is.null,status.eq.published"),
      sb
        .from("circle_post_comments")
        .select("id", { count: "exact", head: true })
        .eq("circle_id", id)
        .eq("author_id", userId)
        .is("hidden_at", null),
    ])
    if (postCountError || messageCountError) {
      return NextResponse.json({ error: "Could not load member activity" }, { status: 503 })
    }

    const viewerRole = viewerMembership && ["active", "approved"].includes(String(viewerMembership.status || ""))
      ? String(viewerMembership.role || "")
      : ""
    const canModerate = ["owner", "admin", "moderator"].includes(viewerRole) && !isSelf
    const profileIdentity = publicIdentity

    return NextResponse.json({
      profile: profileIdentity,
      membership: {
        role: member.role || null,
        status: member.status || null,
        contribution_score: Number(member.contribution_score || 0),
        joined_at: member.joined_at || null,
      },
      powers,
      post_count: postCount || 0,
      message_count: messageCount || 0,
      can_moderate: canModerate,
      viewer_role: viewerRole || null,
    })
  } catch (e: any) {
    console.error("[mini-profile] GET error:", e)
    return NextResponse.json({ error: e.message || "Could not load profile" }, { status: 500 })
  }
}
