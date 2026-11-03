import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { requireModerator } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const CONTENT_TABLES: Record<string, string> = {
  loop: "loops",
  circle_post: "circle_posts",
  comment: "comments",
  reels: "loops",
  reel: "loops",
  moment: "moments",
}

// POST /api/admin/moderation/delete-content
// body: { content_type, content_id }  — content_type: loop | circle_post | comment | reel(s) | moment
export async function POST(request: NextRequest) {
  try {
    const { user, response } = await requireModerator(request)
    if (response) return response

    const supabase = createServerClient()
    const body = await request.json()
    const contentType = String(body.content_type || "").toLowerCase()
    const contentId = String(body.content_id || "")

    if (!contentType || !contentId) {
      return NextResponse.json({ error: "content_type and content_id are required" }, { status: 400 })
    }

    const table = CONTENT_TABLES[contentType]
    if (!table) {
      return NextResponse.json({ error: `Unsupported content type: ${contentType}` }, { status: 400 })
    }

    const { data: existing, error: findError } = await supabase
      .from(table as "loops")
      .select("id")
      .eq("id", contentId)
      .maybeSingle()
    if (findError || !existing) {
      return NextResponse.json({ error: "Content not found" }, { status: 404 })
    }

    const { error: deleteError } = await supabase.from(table as "loops").delete().eq("id", contentId)
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    // Resolve every open flag on this content so the queue clears.
    await supabase
      .from("content_flags")
      .update({ status: "resolved", action_taken: "content_removed" })
      .eq("content_type", contentType)
      .eq("content_id", contentId)
      .in("status", ["pending", "reviewed"])

    // Notify the reporter their report was actioned.
    const { data: flags } = await supabase
      .from("content_flags")
      .select("reporter_id")
      .eq("content_type", contentType)
      .eq("content_id", contentId)
    const reporters = new Set((flags || []).map((f) => f.reporter_id).filter(Boolean) as string[])
    reporters.delete(user.id)
    if (reporters.size > 0) {
      await supabase.from("notifications").insert(
        Array.from(reporters).map((reporterId) => ({
          user_id: reporterId,
          type: "moderation",
          title: "Report actioned ✅",
          message: "The content you reported was reviewed and removed by our team.",
          data: { content_type: contentType, content_id: contentId },
        })),
      )
    }

    return NextResponse.json({ success: true, removed: { content_type: contentType, content_id: contentId } })
  } catch (error) {
    console.error("Delete reported content error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
