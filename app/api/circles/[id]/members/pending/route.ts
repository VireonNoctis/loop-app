import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { notifyUser } from "@/lib/notifications";
import { getUserFromRequest } from "@/lib/server-auth"
import { normalizeRole } from "@/lib/circle-permissions"

const supabase = createServerClient()

async function getCircleStaffRole(circleId: string, userId: string): Promise<"owner" | "admin" | "moderator" | null> {
  const { data: circle, error: circleError } = await supabase
    .from("circles")
    .select("owner_id, creator_id")
    .eq("id", circleId)
    .maybeSingle()
  if (circleError || !circle) return null
  if (circle.owner_id === userId) return "owner"

  const { data: member, error } = await supabase
    .from("circle_members")
    .select("role, status")
    .eq("circle_id", circleId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error || !member || !["active", "approved"].includes(String(member.status))) return null
  const role = normalizeRole(member.role)
  return role === "owner" || role === "admin" || role === "moderator" ? role : null
}

// Get pending join requests
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Circle membership service is unavailable" }, { status: 503 })
    }
    const user = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }

    const { id: circleId } = await params

    if (!(await getCircleStaffRole(circleId, user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Get pending members
    const { data: pendingMembers, error } = await supabase
      .from("circle_members")
      .select(`
        *,
        profile:profiles(id, username, display_name, avatar_url, video_avatar_url)
      `)
      .eq("circle_id", circleId)
      .eq("status", "pending")

    if (error) {
      console.error("Database error:", error)
      return NextResponse.json({ error: "Failed to fetch pending members" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      pending_members: pendingMembers || [],
    })
  } catch (error) {
    console.error("Error fetching pending members:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Approve or reject a join request
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Circle membership service is unavailable" }, { status: 503 })
    }
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: circleId } = await params
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const input = body as Record<string, unknown>
    if (typeof input.memberId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.memberId)) {
      return NextResponse.json({ error: "A valid member ID is required" }, { status: 400 })
    }
    if (input.action !== "approve" && input.action !== "reject") {
      return NextResponse.json({ error: "Action must be approve or reject" }, { status: 400 })
    }
    const requestedRole = input.role === undefined ? "member" : input.role
    if (input.action === "approve" && (typeof requestedRole !== "string" || !["member", "moderator", "admin"].includes(requestedRole))) {
      return NextResponse.json({ error: "Choose a valid Circle role" }, { status: 400 })
    }

    // The RPC independently rechecks staff authority, target profile status,
    // request state and max_members under the same Circle row lock as joins.
    const { data, error } = await supabase.rpc("review_circle_join_request", {
      p_circle_id: circleId,
      p_member_id: input.memberId,
      p_actor_id: user.id,
      p_action: input.action,
      p_role: typeof requestedRole === "string" ? requestedRole : "member",
    })

    if (error) {
      console.error("Atomic Circle join review failed:", error)
      if (error.code === "42501") return NextResponse.json({ error: error.message || "Insufficient Circle permissions" }, { status: 403 })
      if (error.code === "P0002") return NextResponse.json({ error: "Circle or join request not found" }, { status: 404 })
      if (error.code === "55000") return NextResponse.json({ error: "This join request has already been handled" }, { status: 409 })
      if (error.code === "22023") return NextResponse.json({ error: error.message || "The Circle cannot accept this member" }, { status: 409 })
      if (["42883", "42P01", "42703"].includes(error.code || "")) {
        return NextResponse.json({ error: "Circle membership review is unavailable until the database migration is applied." }, { status: 503 })
      }
      return NextResponse.json({ error: "Could not update Circle membership" }, { status: 500 })
    }

    const reviewed = (Array.isArray(data) ? data[0] : data) as {
      status?: string
      user_id?: string
      role?: string
    } | null
    if (!reviewed?.user_id || !["active", "rejected"].includes(reviewed.status || "")) {
      return NextResponse.json({ error: "Circle membership review returned an invalid result" }, { status: 500 })
    }

    const { data: circle, error: circleError } = await supabase
      .from("circles")
      .select("name")
      .eq("id", circleId)
      .maybeSingle()
    if (circleError) console.error("Could not load Circle name for notification:", circleError)

    if (reviewed.status === "active") {
      await notifyUser(supabase, {
        userId: reviewed.user_id,
        type: "circle_join_approved",
        title: "Join request approved",
        message: `You're in! Your request to join ${circle?.name || "the Circle"} was approved.`,
        actionUrl: `/circles/${circleId}`,
        pushCategory: "circleInvites",
        data: { circleId },
      })
      return NextResponse.json({ success: true, message: "Member approved successfully", role: reviewed.role })
    }

    await notifyUser(supabase, {
      userId: reviewed.user_id,
      type: "circle_join_rejected",
      title: "Join request declined",
      message: `Your request to join ${circle?.name || "the Circle"} was declined.`,
      pushCategory: "circleInvites",
      inAppOnly: true,
      data: { circleId },
    })
    return NextResponse.json({ success: true, message: "Member rejected successfully" })
  } catch (error) {
    console.error("Error processing Circle join request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
