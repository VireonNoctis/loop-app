import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { checkCirclePrivateAccess } from "@/lib/circle-access"

/** GET /api/circles/[id]/stats — member stats for leaderboard */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: circleId } = await params
    const access = await checkCirclePrivateAccess(circleId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

    const supabase = createServerClient()

    const { data: stats, error } = await supabase
      .from("circle_member_stats")
      .select(`
        *,
        profile:profiles!user_id(id, username, display_name, avatar_url, video_avatar_url, is_premium, is_verified)
      `)
      .eq("circle_id", circleId)
      .order("total_contribution_score", { ascending: false })
      .limit(50)

    if (error) {
      // Table might not exist yet — return empty
      if (error.message?.includes("does not exist") || error.code === "42P01") {
        return NextResponse.json({ success: true, stats: [] })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, stats: stats || [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
