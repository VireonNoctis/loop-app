import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"

function getCircleBookmarksClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServerClient()
}

/**
 * GET /api/circles/[id]/bookmarks
 * Posts the current user saved inside this community
 * (circle_post_interactions where interaction_type = "save").
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const supabase = getCircleBookmarksClient()
    if (!supabase) return NextResponse.json({ error: "Circle bookmarks are unavailable" }, { status: 503 })

    const { id: circleId } = await params
    const access = await checkCirclePrivateAccess(circleId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }


    const { data: saves, error } = await supabase
      .from("circle_post_interactions")
      .select(`
        id,
        created_at,
        post:circle_posts!post_id(
          id, circle_id, content, post_type, status, created_at, like_count, comment_count,
          author:profiles!author_id(id, username, display_name, avatar_url, is_verified)
        )
      `)
      .eq("user_id", user.id)
      .eq("interaction_type", "save")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Community bookmarks fetch error:", error)
      return NextResponse.json({ error: "Failed to load bookmarks" }, { status: 500 })
    }

    // circle_id is a bigint, so PostgREST returns it as a JS number while the
    // route param is a string — the old strict `!==` compared number vs string
    // and filtered out EVERY bookmark, which is why the Saved tab looked empty.
    const bookmarks = (saves || [])
      .map((save: any) => {
        const post = Array.isArray(save.post) ? save.post[0] : save.post
        if (
          !post ||
          String(post.circle_id) !== String(circleId) ||
          (post.status && post.status !== "published")
        ) return null
        const author = Array.isArray(post.author) ? post.author[0] : post.author
        return {
          id: post.id,
          content: post.content,
          post_type: post.post_type || "discussion",
          created_at: post.created_at,
          author,
          like_count: post.like_count || 0,
          comment_count: post.comment_count || 0,
          saved_at: save.created_at,
        }
      })
      .filter(Boolean)

    return NextResponse.json({ success: true, bookmarks })
  } catch (error: any) {
    console.error("Community bookmarks error:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
