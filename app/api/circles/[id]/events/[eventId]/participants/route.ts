import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"

export const dynamic = "force-dynamic"

function getSupabase() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Circle event access")
  }
  return createServerClient()
}

function canManageEvents(
  role: string | null | undefined,
  permissions: Record<string, unknown> | null | undefined,
  organizerId: string,
  userId: string,
) {
  return organizerId === userId
    || ["owner", "admin", "moderator"].includes(String(role))
    || permissions?.can_manage_events === true
}

function rpcFailure(error: { code?: string; message?: string } | null, fallback: string) {
  const message = error?.message || fallback
  if (message.includes("circle_event_full")) {
    return NextResponse.json({ error: "This event is full" }, { status: 409 })
  }
  if (message.includes("circle_event_ended")) {
    return NextResponse.json({ error: "This event has already ended" }, { status: 400 })
  }
  if (message.includes("circle_event_member_required")) {
    return NextResponse.json({ error: "An active Circle membership is required" }, { status: 403 })
  }
  if (message.includes("circle_event_manager_action_required")) {
    return NextResponse.json({ error: "You cannot manage this RSVP" }, { status: 403 })
  }
  if (message.includes("circle_event_not_found") || error?.code === "P0002") {
    return NextResponse.json({ error: "Event not found" }, { status: 404 })
  }
  if (message.includes("circle_event_invalid_rsvp") || message.includes("circle_event_approval")) {
    return NextResponse.json({ error: "This RSVP action is not valid for the event" }, { status: 400 })
  }
  console.error("Circle event RSVP operation failed:", message)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

// List attendees, the viewer's RSVP state and (for event managers) pending
// approval requests. Pending names are never disclosed to ordinary members.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  try {
    const { id: circleId, eventId } = await params
    const access = await checkCirclePrivateAccess(circleId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

    const { data: event, error: eventError } = await getSupabase()
      .from("circle_events")
      .select("id, organizer_id, requires_approval")
      .eq("id", eventId)
      .eq("circle_id", circleId)
      .maybeSingle()

    if (eventError) return NextResponse.json({ error: "Could not load event" }, { status: 500 })
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

    const user = await getUserFromRequest(request)
    const [{ data: membership, error: membershipError }, { data: rows, error }] = await Promise.all([
      user
        ? getSupabase()
            .from("circle_members")
            .select("role, permissions, status")
            .eq("circle_id", circleId)
            .eq("user_id", user.id)
            .in("status", ["active", "approved"])
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      getSupabase()
        .from("circle_event_participants")
        .select("user_id, status, created_at, profile:profiles!user_id(id, username, display_name, avatar_url, video_avatar_url)")
        .eq("event_id", eventId),
    ])

    if (membershipError || error) {
      console.error("Circle event participants query failed:", membershipError || error)
      return NextResponse.json({ error: "Could not load event participants" }, { status: 500 })
    }

    const participants = (rows || []).map((participant: any) => ({
      ...participant,
      profile: Array.isArray(participant.profile) ? participant.profile[0] || null : participant.profile,
    }))
    const attendees = participants.filter((participant: any) => participant.status === "attending")
    const pending = participants.filter((participant: any) => participant.status === "pending")
    const viewerRsvp = user
      ? participants.find((participant: any) => participant.user_id === user.id)?.status || null
      : null
    const canManage = Boolean(
      user && membership && canManageEvents(
        membership.role,
        membership.permissions,
        event.organizer_id,
        user.id,
      ),
    )

    return NextResponse.json({
      success: true,
      attendee_count: attendees.length,
      participants: attendees,
      is_attending: viewerRsvp === "attending",
      rsvp_status: viewerRsvp,
      pending_count: canManage ? pending.length : 0,
      pending_participants: canManage ? pending : [],
      can_manage: canManage,
    })
  } catch (error) {
    console.error("Event participants GET error:", error)
    return NextResponse.json({ error: "Could not load event participants" }, { status: 500 })
  }
}

// RSVP to an event. Approval-required events create a pending request and do
// not reserve a seat until an organizer approves it.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  try {
    const { id: circleId, eventId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: membership, error: membershipError } = await getSupabase()
      .from("circle_members")
      .select("id")
      .eq("circle_id", circleId)
      .eq("user_id", user.id)
      .in("status", ["active", "approved"])
      .maybeSingle()

    if (membershipError) return NextResponse.json({ error: "Could not verify Circle membership" }, { status: 500 })
    if (!membership) return NextResponse.json({ error: "Join this Circle before RSVPing" }, { status: 403 })

    const { data: event, error: eventError } = await getSupabase()
      .from("circle_events")
      .select("id, ends_at, requires_approval")
      .eq("id", eventId)
      .eq("circle_id", circleId)
      .maybeSingle()

    if (eventError) return NextResponse.json({ error: "Could not load event" }, { status: 500 })
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })
    if (event.ends_at && new Date(event.ends_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "This event has already ended" }, { status: 400 })
    }

    const status = event.requires_approval ? "pending" : "attending"
    const { data: result, error } = await getSupabase().rpc("set_circle_event_rsvp_authorized", {
      p_event_id: eventId,
      p_user_id: user.id,
      p_actor_id: user.id,
      p_status: status,
    })
    if (error) return rpcFailure(error, "Could not save your RSVP")

    return NextResponse.json({
      success: true,
      status,
      participant_count: Number(result?.participant_count) || 0,
      message: status === "pending" ? "Your request was sent to the event organizer" : "Your RSVP is confirmed",
    })
  } catch (error) {
    console.error("Event RSVP POST error:", error)
    return NextResponse.json({ error: "Could not save your RSVP" }, { status: 500 })
  }
}

// Approve or decline a pending request. Only the event organizer or Circle
// event managers can make this decision.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  try {
    const { id: circleId, eventId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const targetUserId = typeof body.user_id === "string" ? body.user_id : ""
    const action = body.action
    if (!targetUserId || !["approve", "decline"].includes(action)) {
      return NextResponse.json({ error: "A user_id and approve/decline action are required" }, { status: 400 })
    }

    const [{ data: event, error: eventError }, { data: membership, error: membershipError }] = await Promise.all([
      getSupabase()
        .from("circle_events")
        .select("id, organizer_id")
        .eq("id", eventId)
        .eq("circle_id", circleId)
        .maybeSingle(),
      getSupabase()
        .from("circle_members")
        .select("role, permissions")
        .eq("circle_id", circleId)
        .eq("user_id", user.id)
        .in("status", ["active", "approved"])
        .maybeSingle(),
    ])

    if (eventError || membershipError) {
      return NextResponse.json({ error: "Could not verify event permissions" }, { status: 500 })
    }
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })
    if (!membership || !canManageEvents(membership.role, membership.permissions, event.organizer_id, user.id)) {
      return NextResponse.json({ error: "You cannot manage RSVPs for this event" }, { status: 403 })
    }

    const { data: pending, error: pendingError } = await getSupabase()
      .from("circle_event_participants")
      .select("id")
      .eq("event_id", eventId)
      .eq("user_id", targetUserId)
      .eq("status", "pending")
      .maybeSingle()

    if (pendingError) return NextResponse.json({ error: "Could not load the pending request" }, { status: 500 })
    if (!pending) return NextResponse.json({ error: "Pending RSVP not found" }, { status: 404 })

    const status = action === "approve" ? "attending" : "declined"
    const { data: result, error } = await getSupabase().rpc("set_circle_event_rsvp_authorized", {
      p_event_id: eventId,
      p_user_id: targetUserId,
      p_actor_id: user.id,
      p_status: status,
    })
    if (error) return rpcFailure(error, "Could not update the RSVP request")

    return NextResponse.json({
      success: true,
      status,
      participant_count: Number(result?.participant_count) || 0,
    })
  } catch (error) {
    console.error("Event RSVP approval error:", error)
    return NextResponse.json({ error: "Could not update the RSVP request" }, { status: 500 })
  }
}

// A member can cancel their own attending or pending RSVP. The event/circle
// pair is checked before touching the participant row.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  try {
    const { id: circleId, eventId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: event, error: eventError } = await getSupabase()
      .from("circle_events")
      .select("id")
      .eq("id", eventId)
      .eq("circle_id", circleId)
      .maybeSingle()

    if (eventError) return NextResponse.json({ error: "Could not load event" }, { status: 500 })
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

    const { data: existing, error: existingError } = await getSupabase()
      .from("circle_event_participants")
      .select("id")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .in("status", ["attending", "pending"])
      .maybeSingle()

    if (existingError) return NextResponse.json({ error: "Could not load your RSVP" }, { status: 500 })
    if (!existing) return NextResponse.json({ success: true, status: null, message: "No RSVP to cancel" })

    const { data: result, error } = await getSupabase().rpc("set_circle_event_rsvp_authorized", {
      p_event_id: eventId,
      p_user_id: user.id,
      p_actor_id: user.id,
      p_status: "declined",
    })
    if (error) return rpcFailure(error, "Could not cancel your RSVP")

    return NextResponse.json({
      success: true,
      status: "declined",
      participant_count: Number(result?.participant_count) || 0,
      message: "Your RSVP was cancelled",
    })
  } catch (error) {
    console.error("Event RSVP DELETE error:", error)
    return NextResponse.json({ error: "Could not cancel your RSVP" }, { status: 500 })
  }
}
