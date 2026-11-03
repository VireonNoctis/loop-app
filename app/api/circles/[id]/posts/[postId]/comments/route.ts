import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { notifyUser } from "@/lib/notifications"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access";

function getCircleCommentsClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServerClient()
}


export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  try {
    const supabase = getCircleCommentsClient()
    if (!supabase) return NextResponse.json({ error: "Circle comments are unavailable" }, { status: 503 })

    const { id: circleId, postId } = await params
    const access = await checkCirclePrivateAccess(circleId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }
    const { data: parentPost } = await supabase
      .from("circle_posts")
      .select("id, status")
      .eq("id", postId)
      .eq("circle_id", circleId)
      .maybeSingle()
    if (!parentPost || parentPost.status === "hidden") {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    const { data: comments, error } = await supabase
      .from("circle_post_comments")
      .select(
        `
        *,
        author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, badge_id, equipped_frame_id, level, active_cosmetics, cosmetics)
      `,
      )
      .eq("post_id", postId)
      .is("hidden_at", null)
      .order("created_at", { ascending: true })

    if (error) {
      // Fallback empty if table missing mid-deploy
      console.error("circle_post_comments GET:", error)
      return NextResponse.json({ success: true, comments: [] })
    }

    return NextResponse.json({ success: true, circle_id: circleId, comments: comments || [] })
  } catch (error) {
    console.error("Error fetching circle comments:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Invalid token" }, { status: 401 })

    const supabase = getCircleCommentsClient()
    if (!supabase) return NextResponse.json({ error: "Circle comments are unavailable" }, { status: 503 })

    const { id: circleId, postId } = await params
    const body = await request.json().catch(() => ({}))
    const content = String(body.content || "").trim()
    const parentCommentId = body.parent_comment_id || null

    if (!content) return NextResponse.json({ error: "Content is required" }, { status: 400 })

    const { data: post } = await supabase
      .from("circle_posts")
      .select("id, comment_count, author_id, status, comments_locked")
      .eq("id", postId)
      .eq("circle_id", circleId)
      .maybeSingle()
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })
    if (post.status === "hidden") {
      return NextResponse.json({ error: "This discussion is no longer available" }, { status: 403 })
    }

    const { data: member } = await supabase
      .from("circle_members")
      .select("id, role")
      .eq("circle_id", circleId)
      .eq("user_id", user.id)
      .in("status", ["active", "approved"])
      .maybeSingle()
    if (!member) return NextResponse.json({ error: "Join the circle to comment" }, { status: 403 })

    // Members can report a reply; it lands in the same queue the moderators
    // review discussions in, so replies are reviewable too.
    if (body.action === "report") {
      const commentId = body.comment_id
      if (!commentId) return NextResponse.json({ error: "Missing reply" }, { status: 400 })
      const { data: reportedComment } = await supabase
        .from("circle_post_comments")
        .select("id, author_id")
        .eq("id", commentId)
        .eq("circle_id", circleId)
        .maybeSingle()
      if (!reportedComment) return NextResponse.json({ error: "Reply not found" }, { status: 404 })

      const { error: reportError } = await supabase.from("community_reports").insert({
        circle_id: circleId,
        reporter_id: user.id,
        target_type: "comment",
        target_id: String(commentId),
        target_author_id: reportedComment.author_id || null,
        reason: String(body.reason || "other").slice(0, 120),
        details: String(body.details || "").slice(0, 1000) || null,
        status: "open",
      })
      if (reportError) {
        console.error("Community reply report insert error:", reportError)
        return NextResponse.json({ error: "Failed to submit report" }, { status: 500 })
      }
      try {
        await supabase.from("community_moderation_logs").insert({
          circle_id: circleId,
          moderator_id: null,
          action: "comment_reported",
          target_user_id: reportedComment.author_id || null,
          target_type: "comment",
          target_id: String(commentId),
          reason: String(body.reason || "other").slice(0, 120),
        })
      } catch {
        /* audit log is best-effort */
      }
      return NextResponse.json({ success: true, message: "Report submitted" })
    }

    // A locked discussion stays readable; only staff can still reply.
    const isStaffRole = ["owner", "admin", "moderator"].includes(member.role || "")
    if (post.comments_locked && !isStaffRole) {
      return NextResponse.json({ error: "Replies are closed on this discussion" }, { status: 403 })
    }

    const { data: comment, error } = await supabase
      .from("circle_post_comments")
      .insert({
        circle_id: circleId,
        post_id: postId,
        author_id: user.id,
        content,
        parent_comment_id: parentCommentId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select(
        `
        *,
        author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, badge_id, equipped_frame_id, level, active_cosmetics, cosmetics)
      `,
      )
      .single()

    if (error) {
      console.error("circle comment insert:", error)
      return NextResponse.json({ error: error.message || "Failed to create comment" }, { status: 500 })
    }

    // Bumping last_activity_at here keeps the community discussion list's
    // "Most active" ordering correct even before the DB trigger migration runs.
    const activityStamp = new Date().toISOString()
    await supabase
      .from("circle_posts")
      .update({
        comment_count: Number(post.comment_count || 0) + 1,
        updated_at: activityStamp,
        last_activity_at: activityStamp,
      })
      .eq("id", postId)

    // Commenting counts toward the circle leaderboard.
    await supabase.rpc("increment_circle_contribution", { p_circle_id: circleId, p_user_id: user.id, p_amount: 2 })

    if (post.author_id && post.author_id !== user.id) {
      const commenterName = comment.author?.display_name || comment.author?.username || "Someone"
      await notifyUser(supabase, {
        userId: post.author_id,
        type: "circle_post_comment",
        title: "New comment on your post",
        message: `${commenterName} commented: "${content.slice(0, 80)}"`,
        actionUrl: `/communities/${circleId}/posts/${postId}`,
        actorId: user.id,
        pushCategory: "social",
        data: { circleId, postId },
      })
    }

    try {
      const { processMentions, extractMentions } = await import("@/lib/mentions")
      if (extractMentions(content).length) {
        await processMentions(supabase, content, {
          source: "circle_comment",
          circle_id: circleId,
          post_id: postId,
          comment_id: comment.id,
          actor_id: user.id,
          actor_username: user.user_metadata?.username,
          actor_display_name: user.user_metadata?.display_name || user.email,
          href: `/circles/${circleId}`,
        })
      }
    } catch (mentionError) {
      console.error("Circle comment mention error:", mentionError)
    }

    try {
      await supabase.channel(`circle:${circleId}`).send({
        type: "broadcast",
        event: "post_comment",
        payload: { post_id: postId, comment },
      })
    } catch {
      /* ignore */
    }

    return NextResponse.json({ success: true, comment })
  } catch (error) {
    console.error("Error creating circle comment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
