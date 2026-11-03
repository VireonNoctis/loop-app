import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"

/** GET /api/circles/[id]/badges — list circle badges and member progress */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: circleId } = await params
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Circle badges are unavailable" }, { status: 503 })
    }
    const access = await checkCirclePrivateAccess(circleId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("user_id")

    const supabase = createServerClient()

    // Get badges
    const { data: badges, error: badgeError } = await supabase
      .from("circle_badges")
      .select("*")
      .eq("circle_id", circleId)
      .order("created_at", { ascending: true })

    if (badgeError) {
      return NextResponse.json({ error: badgeError.message }, { status: 500 })
    }

    // If user_id provided, also get their earned badges
    let memberStats = null
    if (userId) {
      const { data: stats } = await supabase
        .from("circle_member_stats")
        .select("*")
        .eq("circle_id", circleId)
        .eq("user_id", userId)
        .maybeSingle()
      memberStats = stats
    }

    return NextResponse.json({
      success: true,
      badges: badges || [],
      member_stats: memberStats,
      earned_badges: memberStats?.earned_badges || [],
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

/** POST /api/circles/[id]/badges — create a badge (owner/admin only) */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: circleId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Circle badge management is unavailable" }, { status: 503 })
    }

    const supabase = createServerClient()
    const { data: circle, error: circleError } = await supabase
      .from("circles")
      .select("owner_id")
      .eq("id", circleId)
      .maybeSingle()

    if (circleError) {
      return NextResponse.json({ error: "Could not verify Circle ownership" }, { status: 503 })
    }
    if (!circle) return NextResponse.json({ error: "Circle not found" }, { status: 404 })

    if (circle.owner_id !== user.id) {
      const { data: member, error: memberError } = await supabase
        .from("circle_members")
        .select("role, status")
        .eq("circle_id", circleId)
        .eq("user_id", user.id)
        .eq("role", "admin")
        .in("status", ["active", "approved"])
        .maybeSingle()

      if (memberError) {
        return NextResponse.json({ error: "Could not verify Circle membership" }, { status: 503 })
      }
      if (!member) {
        return NextResponse.json({ error: "Only the Circle owner or an active admin can create badges" }, { status: 403 })
      }
    }

    const body = await request.json()
    const { name, description, icon, color, requirement_type, requirement_value, rarity } = body

    if (!name || !requirement_type) {
      return NextResponse.json({ error: "name and requirement_type are required" }, { status: 400 })
    }

    const { data: badge, error } = await supabase
      .from("circle_badges")
      .insert({
        circle_id: circleId,
        name,
        description: description || "",
        icon: icon || "⭐",
        color: color || "amber",
        requirement_type,
        requirement_value: requirement_value || 1,
        rarity: rarity || "common",
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, badge })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
