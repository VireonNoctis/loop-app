import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"
import { canCreateCircleActivity, normalizeCircleActivityInput } from "@/lib/circle-activity"

/** GET /api/circles/[id]/activity — fetch circle activity feed */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: circleId } = await params
    const access = await checkCirclePrivateAccess(circleId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") || "20")))
    const offset = Math.max(0, Number(searchParams.get("offset") || "0"))

    const supabase = createServerClient()
    const { data: activities, error } = await supabase
      .from("circle_activity")
      .select(`
        *,
        actor:profiles!actor_id(id, username, display_name, avatar_url, video_avatar_url, is_premium, is_verified, level)
      `)
      .eq("circle_id", circleId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, activities: activities || [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

/** POST /api/circles/[id]/activity — log a circle activity event */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: circleId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => null)
    const normalized = normalizeCircleActivityInput(body)
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: normalized.status })
    }

    const supabase = createServerClient()
    const { data: circle, error: circleError } = await supabase
      .from("circles")
      .select("id, owner_id, creator_id, is_active")
      .eq("id", circleId)
      .maybeSingle()
    if (circleError) return NextResponse.json({ error: "Could not verify Circle" }, { status: 500 })
    if (!circle) return NextResponse.json({ error: "Circle not found" }, { status: 404 })
    if (circle.is_active === false) {
      return NextResponse.json({ error: "This Circle is inactive" }, { status: 409 })
    }

    const isOwner = (circle.owner_id || circle.creator_id) === user.id
    if (!isOwner) {
      const { data: member, error: memberError } = await supabase
        .from("circle_members")
        .select("status")
        .eq("circle_id", circleId)
        .eq("user_id", user.id)
        .maybeSingle()
      if (memberError) return NextResponse.json({ error: "Could not verify Circle membership" }, { status: 500 })
      if (!canCreateCircleActivity(isOwner, member?.status)) {
        return NextResponse.json({ error: "An active Circle membership is required" }, { status: 403 })
      }
    }

    const { error } = await supabase.from("circle_activity").insert({
      circle_id: circleId,
      actor_id: user.id,
      activity_type: normalized.value.activity_type,
      target_type: normalized.value.target_type,
      target_id: normalized.value.target_id,
      metadata: normalized.value.metadata,
    })

    if (error) {
      return NextResponse.json({ error: "Could not record Circle activity" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
