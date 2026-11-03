import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"

/** GET /api/circles/[id]/coloop — list circle co-loop sessions */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: circleId } = await params
    const access = await checkCirclePrivateAccess(circleId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

    const supabase = createServerClient()

    const { data: sessions, error } = await supabase
      .from("circle_coloop_sessions")
      .select(`
        *,
        creator:profiles!created_by(id, username, display_name, avatar_url, is_premium, is_verified)
      `)
      .eq("circle_id", circleId)
      .order("created_at", { ascending: false })
      .limit(20)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, sessions: sessions || [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

/** POST /api/circles/[id]/coloop — start a circle co-loop session */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: circleId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = createServerClient()

    // Must be a member
    const { data: member } = await supabase
      .from("circle_members")
      .select("id")
      .eq("circle_id", circleId)
      .eq("user_id", user.id)
      .in("status", ["active", "approved"])
      .maybeSingle()

    if (!member) {
      return NextResponse.json({ error: "You must be a circle member to start a Co-Loop" }, { status: 403 })
    }

    const body = await request.json()
    const { title, description, max_collaborators } = body

    if (!title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 })
    }

    const sessionId = `coloop-${circleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const { data: session, error } = await supabase
      .from("circle_coloop_sessions")
      .insert({
        circle_id: circleId,
        session_id: sessionId,
        created_by: user.id,
        title: title.trim(),
        description: description?.trim() || null,
        max_collaborators: max_collaborators || 5,
        status: "active",
      })
      .select(`
        *,
        creator:profiles!created_by(id, username, display_name, avatar_url, is_premium, is_verified)
      `)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Log activity
    await supabase.from("circle_activity").insert({
      circle_id: circleId,
      actor_id: user.id,
      activity_type: "coloop_started",
      target_type: "coloop",
      target_id: String(session.id),
      metadata: { title: title.trim() },
    })

    // Update member stats
    try {
      await supabase.rpc("increment_circle_stat" as any, {
        p_circle_id: circleId,
        p_user_id: user.id,
        p_field: "posts_count",
      })
    } catch {
      // Fallback: manual update
      await supabase.from("circle_member_stats").upsert({
        circle_id: circleId,
        user_id: user.id,
        posts_count: 1,
        total_contribution_score: 10,
        updated_at: new Date().toISOString(),
      }, { onConflict: "circle_id,user_id", ignoreDuplicates: false })
    }

    return NextResponse.json({ success: true, session })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
