import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { checkCirclePrivateAccess } from "@/lib/circle-access"
import { getUserFromRequest } from "@/lib/server-auth"

function getCircleMembersClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServerClient()
}

// Get circle members
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = getCircleMembersClient()
    if (!supabase) return NextResponse.json({ error: "Circle member service is unavailable" }, { status: 503 })

    const { searchParams } = new URL(request.url)
    const requestedLimit = Number.parseInt(searchParams.get("limit") || "50", 10)
    const requestedOffset = Number.parseInt(searchParams.get("offset") || "0", 10)
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 50
    const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.min(100_000, requestedOffset)) : 0
    const role = searchParams.get("role")
    const search = (searchParams.get("search") || "").trim().slice(0, 100)

    const { id: circleId } = await params

    // Private circles: member roster is only visible to approved members/owner.
    const access = await checkCirclePrivateAccess(circleId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ success: true, members: [], hasMore: false, locked: true })
    }

    let query = supabase
      .from("circle_members")
      .select(`
        id, circle_id, user_id, role, status, custom_title, permissions, joined_at,
        user:profiles(id, username, display_name, avatar_url, video_avatar_url, is_verified)
      `)
      .eq("circle_id", circleId)
      .in("status", ["active", "approved"])
      .order("joined_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (role) {
      query = query.eq("role", role)
    }

    if (search) {
      query = query.ilike("profiles.display_name", `%${search}%`)
    }

    const { data: members, error } = await query

    if (error) {
      console.error("Database error:", error)
      return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      members: members || [],
      hasMore: members?.length === limit,
    })
  } catch (error) {
    console.error("Error fetching circle members:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Update member role (admin/moderator actions)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: circleId } = await params
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidPattern.test(circleId)) {
      return NextResponse.json({ error: "Invalid Circle ID" }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { targetUserId, newRole, status, customTitle, permissions } = body as Record<string, unknown>
    if (typeof targetUserId !== "string" || !uuidPattern.test(targetUserId)) {
      return NextResponse.json({ error: "A valid target user ID is required" }, { status: 400 })
    }
    // Membership transitions have their own join/approval/leave/ban paths.
    if (status !== undefined) {
      return NextResponse.json({ error: "Use the Circle membership workflow to change member status" }, { status: 400 })
    }
    if (newRole !== undefined && (typeof newRole !== "string" || !["member", "moderator", "admin"].includes(newRole))) {
      return NextResponse.json({ error: "Choose a valid Circle role" }, { status: 400 })
    }
    if (customTitle !== undefined && customTitle !== null && typeof customTitle !== "string") {
      return NextResponse.json({ error: "Custom title must be text" }, { status: 400 })
    }
    if (typeof customTitle === "string" && customTitle.trim().length > 40) {
      return NextResponse.json({ error: "Custom titles cannot exceed 40 characters" }, { status: 400 })
    }
    if (permissions !== undefined && (!permissions || typeof permissions !== "object" || Array.isArray(permissions))) {
      return NextResponse.json({ error: "Permissions must be an object" }, { status: 400 })
    }

    const allowedPermissions = [
      "can_manage_events",
      "can_manage_rooms",
      "can_pin_posts",
      "can_moderate",
      "can_post_announcements",
    ] as const
    const sanitizedPermissions: Record<string, boolean> = {}
    if (permissions !== undefined) {
      const supplied = permissions as Record<string, unknown>
      for (const [key, value] of Object.entries(supplied)) {
        if (!allowedPermissions.includes(key as typeof allowedPermissions[number])) {
          return NextResponse.json({ error: `Unsupported permission: ${key}` }, { status: 400 })
        }
        if (typeof value !== "boolean") {
          return NextResponse.json({ error: "Permission values must be boolean" }, { status: 400 })
        }
        sanitizedPermissions[key] = value
      }
    }

    const supabase = getCircleMembersClient()
    if (!supabase) return NextResponse.json({ error: "Circle member service is unavailable" }, { status: 503 })

    const { data, error } = await supabase.rpc("update_circle_member", {
      p_circle_id: circleId,
      p_actor_id: user.id,
      p_target_user_id: targetUserId,
      p_new_role: typeof newRole === "string" ? newRole : null,
      p_update_custom_title: customTitle !== undefined,
      p_custom_title: typeof customTitle === "string" ? customTitle.trim() : null,
      p_update_permissions: permissions !== undefined,
      p_permissions: permissions === undefined ? null : sanitizedPermissions,
    })

    if (error) {
      console.error("Atomic Circle member update failed:", error)
      if (error.code === "42501") return NextResponse.json({ error: error.message || "Insufficient permissions" }, { status: 403 })
      if (error.code === "P0002") return NextResponse.json({ error: "Circle or member not found" }, { status: 404 })
      if (error.code === "55000") return NextResponse.json({ error: error.message || "Member state changed" }, { status: 409 })
      if (error.code === "22023") return NextResponse.json({ error: error.message || "Invalid member update" }, { status: 400 })
      if (["42883", "42P01", "42703"].includes(error.code || "")) {
        return NextResponse.json({ error: "Atomic Circle member updates are unavailable until the database migration is applied." }, { status: 503 })
      }
      return NextResponse.json({ error: "Could not update this member" }, { status: 500 })
    }

    const result = (Array.isArray(data) ? data[0] : data) as { member?: Record<string, unknown> } | null
    if (!result?.member || result.member.user_id !== targetUserId || result.member.circle_id !== circleId) {
      return NextResponse.json({ error: "Circle member update returned an invalid result" }, { status: 500 })
    }

    try {
      await supabase.channel(`circle-admin:${circleId}`).send({
        type: "broadcast",
        event: "admin_refresh",
        payload: { action: "member_updated", userId: targetUserId },
      })
    } catch {
      /* realtime refresh is best-effort */
    }

    return NextResponse.json({
      success: true,
      member: result.member,
      message: typeof newRole === "string" ? `Member role updated to ${newRole}` : "Member updated",
    })
  } catch (error) {
    console.error("Error updating Circle member:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Remove member (kick/ban)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: circleId } = await params
    const { searchParams } = new URL(request.url)
    const targetUserId = searchParams.get("userId")
    const action = searchParams.get("action") || "remove"
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

    if (!uuidPattern.test(circleId) || !targetUserId || !uuidPattern.test(targetUserId)) {
      return NextResponse.json({ error: "A valid Circle and target user ID are required" }, { status: 400 })
    }
    if (action !== "remove" && action !== "ban") {
      return NextResponse.json({ error: "Action must be remove or ban" }, { status: 400 })
    }
    if (targetUserId === user.id) {
      return NextResponse.json({ error: "Use the leave Circle action to remove yourself" }, { status: 409 })
    }

    const supabase = getCircleMembersClient()
    if (!supabase) return NextResponse.json({ error: "Circle member service is unavailable" }, { status: 503 })

    // The RPC locks the Circle row, rechecks current actor/target roles and
    // changes membership + member_count together with join/approval traffic.
    const { data, error } = await supabase.rpc("manage_circle_member", {
      p_circle_id: circleId,
      p_actor_id: user.id,
      p_target_user_id: targetUserId,
      p_action: action,
    })

    if (error) {
      console.error("Atomic Circle member moderation failed:", error)
      if (error.code === "42501") return NextResponse.json({ error: error.message || "Insufficient Circle permissions" }, { status: 403 })
      if (error.code === "P0002") return NextResponse.json({ error: "Circle or member not found" }, { status: 404 })
      if (error.code === "55000") return NextResponse.json({ error: error.message || "Membership has already changed" }, { status: 409 })
      if (error.code === "22023") return NextResponse.json({ error: error.message || "Invalid membership action" }, { status: 409 })
      if (["42883", "42P01", "42703"].includes(error.code || "")) {
        return NextResponse.json({ error: "Atomic Circle moderation is unavailable until the database migration is applied." }, { status: 503 })
      }
      return NextResponse.json({ error: "Could not update Circle membership" }, { status: 500 })
    }

    const result = (Array.isArray(data) ? data[0] : data) as {
      circle_id?: string
      user_id?: string
      status?: string
      member_count?: number
    } | null
    if (result?.circle_id !== circleId || result.user_id !== targetUserId || !["banned", "removed"].includes(result.status || "")) {
      return NextResponse.json({ error: "Circle moderation returned an invalid result" }, { status: 500 })
    }

    try {
      await supabase.channel(`circle-admin:${circleId}`).send({
        type: "broadcast",
        event: "admin_refresh",
        payload: { action, userId: targetUserId },
      })
    } catch {
      /* realtime refresh is best-effort; the database result is canonical */
    }

    return NextResponse.json({
      success: true,
      status: result.status,
      member_count: result.member_count,
      message: action === "ban" ? "Member banned successfully" : "Member removed successfully",
    })
  } catch (error) {
    console.error("Error removing Circle member:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
