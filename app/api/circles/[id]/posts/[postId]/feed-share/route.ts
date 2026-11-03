import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import {
  canShareCircle,
  isShareablePost,
  sharePostToLoopFeed,
  unsharePostFromFeed,
} from "@/lib/community-feed-share"

function getCircleFeedShareClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServerClient()
}

/**
 * The explicit community → Loop feed control.
 *
 * Community discussions are community-only by default; this endpoint is the
 * only way one becomes a public Loop, and only the author (or community staff)
 * can make that call. Private communities can never be shared.
 */
async function loadContext(supabase: ReturnType<typeof createServerClient>, circleId: string, postId: string, userId: string) {
  const [{ data: post }, { data: circle }, { data: member }] = await Promise.all([
    supabase
      .from("circle_posts")
      .select("id, circle_id, author_id, content, media_url, media_urls, media_type, status, feed_loop_id, space_id")
      .eq("id", postId)
      .eq("circle_id", circleId)
      .maybeSingle(),
    supabase.from("circles").select("id, name, handle, is_private").eq("id", circleId).maybeSingle(),
    supabase
      .from("circle_members")
      .select("role, status")
      .eq("circle_id", circleId)
      .eq("user_id", userId)
      .in("status", ["active", "approved"])
      .maybeSingle(),
  ])
  return { post, circle, member }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  try {
    const { id: circleId, postId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const supabase = getCircleFeedShareClient()
    if (!supabase) return NextResponse.json({ error: "Circle sharing is unavailable" }, { status: 503 })

    const { post, circle, member } = await loadContext(supabase, circleId, postId, user.id)
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

    if (!member) return NextResponse.json({ error: "Join this Circle to share its posts" }, { status: 403 })
    const isStaff = ["owner", "admin", "moderator"].includes(member.role || "")
    if (post.author_id !== user.id && !isStaff) {
      return NextResponse.json({ error: "Only the author can share this discussion" }, { status: 403 })
    }
    if (!canShareCircle(circle)) {
      return NextResponse.json(
        { error: "Content in a private community can never be shared to the Loop feed" },
        { status: 403 },
      )
    }
    if (post.feed_loop_id) {
      return NextResponse.json({ success: true, shared_to_feed: true, loop_id: post.feed_loop_id })
    }
    if (!isShareablePost(post)) {
      return NextResponse.json({ error: "This discussion is not eligible to be shared" }, { status: 400 })
    }

    let spaceName: string | null = null
    if (post.space_id) {
      const { data: space } = await supabase
        .from("community_spaces")
        .select("name")
        .eq("id", post.space_id)
        .maybeSingle()
      spaceName = space?.name || null
    }

    const loopId = await sharePostToLoopFeed(supabase, {
      circle: circle!,
      postId: post.id,
      authorId: post.author_id,
      content: post.content || "",
      mediaUrl: post.media_url,
      mediaUrls: post.media_urls,
      mediaType: post.media_type,
      spaceName,
    })
    if (!loopId) return NextResponse.json({ error: "Could not share to the Loop feed" }, { status: 500 })

    await supabase.from("circle_posts").update({ feed_loop_id: loopId }).eq("id", post.id)
    return NextResponse.json({ success: true, shared_to_feed: true, loop_id: loopId })
  } catch (error: any) {
    console.error("[feed-share] POST error:", error)
    return NextResponse.json({ error: error.message || "Failed to share" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  try {
    const { id: circleId, postId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const supabase = getCircleFeedShareClient()
    if (!supabase) return NextResponse.json({ error: "Circle sharing is unavailable" }, { status: 503 })

    const { post, member } = await loadContext(supabase, circleId, postId, user.id)
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

    if (!member) return NextResponse.json({ error: "Join this Circle to manage shared posts" }, { status: 403 })
    const isStaff = ["owner", "admin", "moderator"].includes(member.role || "")
    if (post.author_id !== user.id && !isStaff) {
      return NextResponse.json({ error: "Only the author can stop sharing this discussion" }, { status: 403 })
    }

    await unsharePostFromFeed(supabase, post.feed_loop_id)
    await supabase.from("circle_posts").update({ feed_loop_id: null }).eq("id", post.id)
    return NextResponse.json({ success: true, shared_to_feed: false })
  } catch (error: any) {
    console.error("[feed-share] DELETE error:", error)
    return NextResponse.json({ error: error.message || "Failed to stop sharing" }, { status: 500 })
  }
}
