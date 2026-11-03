import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { checkCirclePrivateAccess } from "@/lib/circle-access"
import { getUserFromRequest } from "@/lib/server-auth"
import { CIRCLE_EVENT_TYPES, normalizeCircleEventInput } from "@/lib/circle-events"

export const dynamic = "force-dynamic"

function getSupabase() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Circle event access")
  }
  return createServerClient()
}

type CircleMember = {
  role: string | null
  permissions: Record<string, unknown> | null
}

function canManageEvents(member: CircleMember | null | undefined) {
  return Boolean(
    member && (
      ["owner", "admin", "moderator"].includes(String(member.role))
      || member.permissions?.can_manage_events === true
    ),
  )
}

async function getActiveMember(circleId: string, userId: string) {
  return getSupabase()
    .from("circle_members")
    .select("role, permissions, status")
    .eq("circle_id", circleId)
    .eq("user_id", userId)
    .in("status", ["active", "approved"])
    .maybeSingle()
}

function parsePagination(searchParams: URLSearchParams) {
  const rawLimit = Number(searchParams.get("limit") ?? 50)
  const rawOffset = Number(searchParams.get("offset") ?? 0)
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 50
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0
  return { limit, offset }
}

// List Circle events. Private Circle events are never disclosed to outsiders.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: circleId } = await params
    const { searchParams } = new URL(request.url)
    const { limit, offset } = parsePagination(searchParams)
    const status = searchParams.get("status")
    const type = searchParams.get("type")

    if (status && !["upcoming", "past", "ongoing"].includes(status)) {
      return NextResponse.json({ error: "Unsupported event status filter" }, { status: 400 })
    }
    if (type && !CIRCLE_EVENT_TYPES.includes(type as (typeof CIRCLE_EVENT_TYPES)[number])) {
      return NextResponse.json({ error: "Unsupported event type filter" }, { status: 400 })
    }

    const access = await checkCirclePrivateAccess(circleId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ success: true, events: [], can_manage_events: false, hasMore: false, locked: true })
    }

    const now = new Date().toISOString()
    let query = getSupabase()
      .from("circle_events")
      .select(`
        *,
        organizer:profiles!organizer_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_premium)
      `)
      .eq("circle_id", circleId)
      .order("starts_at", { ascending: true })
      .range(offset, offset + limit - 1)

    if (status === "upcoming") query = query.gte("starts_at", now)
    if (status === "past") query = query.not("ends_at", "is", null).lt("ends_at", now)
    if (status === "ongoing") {
      query = query.lte("starts_at", now).or(`ends_at.is.null,ends_at.gte.${now}`)
    }
    if (type) query = query.eq("event_type", type)

    const { data: events, error } = await query
    if (error) {
      console.error("Circle event list query failed:", error)
      return NextResponse.json({ error: "Could not load Circle events" }, { status: 500 })
    }

    const viewer = await getUserFromRequest(request)
    const rsvpStatuses = new Map<string, string>()
    let canManage = false

    if (viewer) {
      if (events?.length) {
        const { data: rows, error: rsvpError } = await getSupabase()
          .from("circle_event_participants")
          .select("event_id, status")
          .eq("user_id", viewer.id)
          .in("event_id", events.map((event: { id: string }) => event.id))

        if (rsvpError) {
          console.error("Circle event RSVP lookup failed:", rsvpError)
          return NextResponse.json({ error: "Could not load your event RSVPs" }, { status: 500 })
        }
        for (const row of rows || []) rsvpStatuses.set(String(row.event_id), String(row.status))
      }

      const { data: member, error: memberError } = await getActiveMember(circleId, viewer.id)
      if (memberError) {
        console.error("Circle event permission lookup failed:", memberError)
        return NextResponse.json({ error: "Could not verify Circle permissions" }, { status: 500 })
      }
      canManage = canManageEvents(member)
    }

    return NextResponse.json({
      success: true,
      events: (events || []).map((event: { id: string }) => {
        const rsvpStatus = rsvpStatuses.get(String(event.id)) || null
        return {
          ...event,
          rsvp_status: rsvpStatus,
          is_attending: rsvpStatus === "attending",
          is_pending: rsvpStatus === "pending",
        }
      }),
      can_manage_events: canManage,
      hasMore: (events?.length || 0) === limit,
    })
  } catch (error) {
    console.error("Circle events GET error:", error)
    return NextResponse.json({ error: "Could not load Circle events" }, { status: 500 })
  }
}

// Create events only for approved, active Circle members who hold the
// event-management capability. Input is normalized before it reaches SQL.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: circleId } = await params
    const body = await request.json().catch(() => null)
    const normalized = normalizeCircleEventInput(body)
    if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 })

    const { data: member, error: memberError } = await getActiveMember(circleId, user.id)
    if (memberError) return NextResponse.json({ error: "Could not verify Circle membership" }, { status: 500 })
    if (!member) return NextResponse.json({ error: "Join this Circle before creating events" }, { status: 403 })
    if (!canManageEvents(member)) {
      return NextResponse.json({ error: "You cannot create events in this Circle" }, { status: 403 })
    }

    const { value } = normalized
    const { data: event, error } = await getSupabase()
      .from("circle_events")
      .insert({
        circle_id: circleId,
        organizer_id: user.id,
        ...value,
        is_recurring: false,
        recurrence_pattern: null,
        participant_count: 0,
        created_at: new Date().toISOString(),
      })
      .select(`
        *,
        organizer:profiles!organizer_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_premium)
      `)
      .single()

    if (error) {
      console.error("Circle event create failed:", error)
      return NextResponse.json({ error: "Could not create this event" }, { status: 500 })
    }

    try {
      await getSupabase().channel(`circle-admin:${circleId}`).send({
        type: "broadcast",
        event: "admin_refresh",
        payload: { action: "create_event", eventId: event.id },
      })
    } catch {
      // Realtime is an enhancement; a successful database write is authoritative.
    }

    return NextResponse.json({ success: true, event, message: "Event created successfully" }, { status: 201 })
  } catch (error) {
    console.error("Circle events POST error:", error)
    return NextResponse.json({ error: "Could not create this event" }, { status: 500 })
  }
}

// Update an event. The route accepts partial payloads but validates the
// resulting complete event record, including date order and HTTPS links.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: circleId } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object" || typeof body.eventId !== "string" || !body.eventId) {
      return NextResponse.json({ error: "An eventId is required" }, { status: 400 })
    }

    const [{ data: event, error: eventError }, { data: member, error: memberError }] = await Promise.all([
      getSupabase()
        .from("circle_events")
        .select("*")
        .eq("id", body.eventId)
        .eq("circle_id", circleId)
        .maybeSingle(),
      getActiveMember(circleId, user.id),
    ])

    if (eventError || memberError) {
      return NextResponse.json({ error: "Could not verify event permissions" }, { status: 500 })
    }
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })
    if (!member) return NextResponse.json({ error: "Join this Circle before managing events" }, { status: 403 })
    if (event.organizer_id !== user.id && !canManageEvents(member)) {
      return NextResponse.json({ error: "You cannot edit this event" }, { status: 403 })
    }

    const normalized = normalizeCircleEventInput({ ...event, ...body })
    if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 })

    const { count, error: countError } = await getSupabase()
      .from("circle_event_participants")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .eq("status", "attending")

    if (countError) return NextResponse.json({ error: "Could not verify attendee capacity" }, { status: 500 })
    if (normalized.value.max_participants !== null && (count || 0) > normalized.value.max_participants) {
      return NextResponse.json({ error: "The attendee limit is lower than the number already attending" }, { status: 409 })
    }

    const { data: updatedEvent, error: updateError } = await getSupabase()
      .from("circle_events")
      .update(normalized.value)
      .eq("id", event.id)
      .eq("circle_id", circleId)
      .select(`
        *,
        organizer:profiles!organizer_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_premium)
      `)
      .single()

    if (updateError) {
      console.error("Circle event update failed:", updateError)
      return NextResponse.json({ error: "Could not update this event" }, { status: 500 })
    }

    return NextResponse.json({ success: true, event: updatedEvent, message: "Event updated successfully" })
  } catch (error) {
    console.error("Circle events PUT error:", error)
    return NextResponse.json({ error: "Could not update this event" }, { status: 500 })
  }
}

// Delete only the selected event in this Circle, and only by its organizer or
// an active member with the event-management capability.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: circleId } = await params
    const eventId = new URL(request.url).searchParams.get("eventId")
    if (!eventId) return NextResponse.json({ error: "An eventId is required" }, { status: 400 })

    const [{ data: event, error: eventError }, { data: member, error: memberError }] = await Promise.all([
      getSupabase()
        .from("circle_events")
        .select("id, organizer_id")
        .eq("id", eventId)
        .eq("circle_id", circleId)
        .maybeSingle(),
      getActiveMember(circleId, user.id),
    ])

    if (eventError || memberError) {
      return NextResponse.json({ error: "Could not verify event permissions" }, { status: 500 })
    }
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 })
    if (!member) return NextResponse.json({ error: "Join this Circle before managing events" }, { status: 403 })
    if (event.organizer_id !== user.id && !canManageEvents(member)) {
      return NextResponse.json({ error: "You cannot delete this event" }, { status: 403 })
    }

    const { error: deleteError } = await getSupabase()
      .from("circle_events")
      .delete()
      .eq("id", eventId)
      .eq("circle_id", circleId)

    if (deleteError) {
      console.error("Circle event delete failed:", deleteError)
      return NextResponse.json({ error: "Could not delete this event" }, { status: 500 })
    }

    try {
      await getSupabase().channel(`circle-admin:${circleId}`).send({
        type: "broadcast",
        event: "admin_refresh",
        payload: { action: "delete_event", eventId },
      })
    } catch {
      // Realtime is an enhancement; the database delete is authoritative.
    }

    return NextResponse.json({ success: true, message: "Event deleted successfully" })
  } catch (error) {
    console.error("Circle events DELETE error:", error)
    return NextResponse.json({ error: "Could not delete this event" }, { status: 500 })
  }
}
