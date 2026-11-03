import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { notifyUser } from "@/lib/notifications";
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access";

function getCirclePostDetailClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServerClient()
}


// Get post details. Comments live under the dedicated
// /api/circles/[id]/posts/[postId]/comments route (circle_post_comments
// table) — this used to also query `comments` with `loop_id: postId`, which
// pointed at the loop feed's comment table using a circle post id, a
// leftover from an earlier draft that never matched real data.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string, postId: string }> }) {
  try {
    const supabase = getCirclePostDetailClient()
    if (!supabase) return NextResponse.json({ error: "Circle post service is unavailable" }, { status: 503 })
    const { id: circleId, postId } = await params
    const access = await checkCirclePrivateAccess(circleId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

    const viewer = await getUserFromRequest(request)
    const { data: membership } = viewer
      ? await supabase.from("circle_members")
          .select("role, status")
          .eq("circle_id", circleId)
          .eq("user_id", viewer.id)
          .maybeSingle()
      : { data: null }
    const canReviewPending = Boolean(
      membership &&
      ["active", "approved"].includes(String(membership.status || "")) &&
      ["owner", "admin", "moderator"].includes(String(membership.role || "")),
    )

    // Fetch post with author info
    const { data: post, error: postError } = await supabase
      .from("circle_posts")
      .select(`
        *,
        author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, badge_id)
      `)
      .eq("id", postId)
      .eq("circle_id", circleId)
      .maybeSingle()

    if (postError || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    // Hidden content is invisible to everyone. Pending posts are only visible
    // to active Circle staff; a guessed detail URL must not bypass feed rules.
    if (post.status === "hidden" || (post.status && post.status !== "published" && !canReviewPending)) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    const { data: interactions } = await supabase
      .from("circle_post_interactions")
      .select("interaction_type, user_id")
      .eq("post_id", postId)

    const likes = interactions?.filter(i => i.interaction_type === "like").length || 0
    const shares = interactions?.filter(i => i.interaction_type === "share").length || 0
    const isLiked = Boolean(viewer && interactions?.some(i => i.interaction_type === "like" && i.user_id === viewer.id))
    const isSaved = Boolean(viewer && interactions?.some(i => i.interaction_type === "save" && i.user_id === viewer.id))

    // Reaction counts (fire/clap/...) grouped by type.
    const { data: reactionRows } = await supabase
      .from("circle_post_reactions")
      .select("reaction_type")
      .eq("post_id", postId)
    const reactionCounts: Record<string, number> = {}
    for (const r of reactionRows || []) {
      reactionCounts[r.reaction_type] = (reactionCounts[r.reaction_type] || 0) + 1
    }

    // Attach the poll (same shape as the feed route) so PollCard renders on
    // the detail page too — previously polls were missing from this view.
    const { data: poll } = await supabase
      .from("circle_post_polls")
      .select("*")
      .eq("post_id", postId)
      .maybeSingle()

    // Increment view count (fire-and-forget)
    void Promise.resolve(
      supabase
        .from("circle_posts")
        .update({ view_count: (post.view_count || 0) + 1 })
        .eq("id", postId)
    ).catch(() => {})

    return NextResponse.json({
      success: true,
      post: {
        ...post,
        like_count: likes,
        share_count: shares,
        view_count: (post.view_count || 0) + 1,
        reaction_counts: reactionCounts,
        is_liked: isLiked,
        is_saved: isSaved,
        poll: poll || null,
      },
    })
  } catch (error) {
    console.error("Error fetching post details:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Handle post interactions (like, share, etc.)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string, postId: string }> }) {
  try {
    const user = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }

    const supabase = getCirclePostDetailClient()
    if (!supabase) return NextResponse.json({ error: "Circle post service is unavailable" }, { status: 503 })

    const { id: circleId, postId } = await params
    const body = await request.json() // like, share, save, report, react
    const { action } = body

    // Check if post exists
    const { data: post } = await supabase
      .from("circle_posts")
      .select("id, author_id")
      .eq("id", postId)
      .eq("circle_id", circleId)
      .maybeSingle()

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    // Check if user is a member of the circle
    const { data: member } = await supabase
      .from("circle_members")
      .select("id")
      .eq("circle_id", circleId)
      .eq("user_id", user.id)
      .in("status", ["active", "approved"])
      .maybeSingle()

    if (!member) {
      return NextResponse.json({ error: "You must be a member to interact with posts" }, { status: 403 })
    }

    // Handle different actions
    switch (action) {
      case "like":
        // Check if user already liked the post
        const { data: existingLike } = await supabase
          .from("circle_post_interactions")
          .select("id")
          .eq("user_id", user.id)
          .eq("post_id", postId)
          .eq("interaction_type", "like")
          .maybeSingle()

        if (existingLike) {
          // Remove like
          await supabase
            .from("circle_post_interactions")
            .delete()
            .eq("id", existingLike.id)

          if (post.author_id) {
            await supabase.rpc("increment_circle_contribution", {
              p_circle_id: circleId,
              p_user_id: post.author_id,
              p_amount: -1,
            })
          }

          return NextResponse.json({
            success: true,
            is_liked: false,
            message: "Like removed"
          })
        } else {
          // Add like
          await supabase
            .from("circle_post_interactions")
            .insert({
              user_id: user.id,
              post_id: postId,
              interaction_type: "like",
              created_at: new Date().toISOString()
            })

          if (post.author_id) {
            await supabase.rpc("increment_circle_contribution", {
              p_circle_id: circleId,
              p_user_id: post.author_id,
              p_amount: 1,
            })
            if (post.author_id !== user.id) {
              const { data: likerProfile } = await supabase
                .from("profiles")
                .select("username, display_name")
                .eq("id", user.id)
                .maybeSingle()
              const likerName = likerProfile?.display_name || likerProfile?.username || "Someone"
              await notifyUser(supabase, {
                userId: post.author_id,
                type: "circle_post_like",
                title: "New like",
                message: `${likerName} liked your post`,
                actionUrl: `/communities/${circleId}/posts/${postId}`,
                actorId: user.id,
                pushCategory: "social",
                data: { circleId, postId },
              })
            }
          }

          return NextResponse.json({
            success: true,
            is_liked: true,
            message: "Post liked"
          })
        }

      case "share":
        await supabase
          .from("circle_post_interactions")
          .insert({
            user_id: user.id,
            post_id: postId,
            interaction_type: "share",
            created_at: new Date().toISOString()
          })
        
        return NextResponse.json({
          success: true,
          message: "Post shared successfully"
        })

      case "save":
      case "unsave": {
        const { data: existingSave } = await supabase
          .from("circle_post_interactions")
          .select("id")
          .eq("user_id", user.id)
          .eq("post_id", postId)
          .eq("interaction_type", "save")
          .maybeSingle()

        if (existingSave) {
          await supabase.from("circle_post_interactions").delete().eq("id", existingSave.id)
          return NextResponse.json({ success: true, is_active: false, message: "Save removed" })
        }

        await supabase.from("circle_post_interactions").insert({
          user_id: user.id,
          post_id: postId,
          interaction_type: "save",
          created_at: new Date().toISOString(),
        })
        return NextResponse.json({ success: true, is_active: true, message: "Post saved" })
      }

      case "react": {
        // Post reactions (fire/clap/laugh/...) live in circle_post_reactions.
        // "like" stays on circle_post_interactions so existing counts keep working.
        const rawType = String(body.reaction_type || "like").toLowerCase()
        const allowed = ["fire", "clap", "thinking", "laugh", "rocket"]
        if (rawType === "like") {
          // Route plain likes through the same logic as action:"like" so the
          // like toggle and reaction row never disagree.
          const { data: existingLike } = await supabase
            .from("circle_post_interactions")
            .select("id")
            .eq("user_id", user.id)
            .eq("post_id", postId)
            .eq("interaction_type", "like")
            .maybeSingle()
          if (existingLike) {
            await supabase.from("circle_post_interactions").delete().eq("id", existingLike.id)
            return NextResponse.json({ success: true, reacted: false, reaction_type: "like" })
          }
          await supabase.from("circle_post_interactions").insert({
            user_id: user.id,
            post_id: postId,
            interaction_type: "like",
            created_at: new Date().toISOString(),
          })
          return NextResponse.json({ success: true, reacted: true, reaction_type: "like" })
        }
        if (!allowed.includes(rawType)) {
          return NextResponse.json({ error: "Invalid reaction type" }, { status: 400 })
        }
        const { data: existingReaction } = await supabase
          .from("circle_post_reactions")
          .select("id")
          .eq("user_id", user.id)
          .eq("post_id", postId)
          .eq("reaction_type", rawType)
          .maybeSingle()
        if (existingReaction) {
          await supabase.from("circle_post_reactions").delete().eq("id", existingReaction.id)
          return NextResponse.json({ success: true, reacted: false, reaction_type: rawType })
        }
        const { error: reactError } = await supabase.from("circle_post_reactions").insert({
          user_id: user.id,
          post_id: postId,
          reaction_type: rawType,
        })
        if (reactError) {
          return NextResponse.json({ error: "Failed to react" }, { status: 500 })
        }
        // Notify the author (best-effort, not for self-reactions)
        if (post.author_id && post.author_id !== user.id) {
          try {
            const { data: reactorProfile } = await supabase
              .from("profiles")
              .select("display_name, username")
              .eq("id", user.id)
              .maybeSingle()
            const reactorName = reactorProfile?.display_name || reactorProfile?.username || "Someone"
            await notifyUser(supabase, {
              userId: post.author_id,
              type: "community_reaction",
              title: `New ${rawType} reaction`,
              message: `${reactorName} reacted ${rawType === "fire" ? "🔥" : rawType === "clap" ? "👏" : rawType === "laugh" ? "😂" : rawType === "rocket" ? "🚀" : "🤔"} to your post`,
              actionUrl: `/communities/${circleId}/posts/${postId}`,
              actorId: user.id,
              pushCategory: "social",
              priority: "low",
              data: { circleId, postId, reactionType: rawType },
            })
          } catch { /* best-effort */ }
        }
        return NextResponse.json({ success: true, reacted: true, reaction_type: rawType })
      }

      case "report": {
        // Community reports land in community_reports for circle moderators
        // and the platform moderation queue.
        const reason = String(body.reason || "other").slice(0, 120)
        const details = String(body.details || "").slice(0, 1000)
        const targetAuthorId = post.author_id || null

        const { error: reportError } = await supabase.from("community_reports").insert({
          circle_id: circleId,
          reporter_id: user.id,
          target_type: "post",
          target_id: String(postId),
          target_author_id: targetAuthorId,
          reason,
          details: details || null,
          status: "open",
        })

        if (reportError) {
          console.error("Community report insert error:", reportError)
          return NextResponse.json({ error: "Failed to submit report" }, { status: 500 })
        }

        // Moderation audit trail (best-effort).
        try {
          await supabase.from("community_moderation_logs").insert({
            circle_id: circleId,
            moderator_id: null,
            action: "post_reported",
            target_user_id: targetAuthorId,
            target_type: "post",
            target_id: String(postId),
            reason,
          })
        } catch { /* log best-effort */ }

        return NextResponse.json({ success: true, message: "Report submitted" })
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Error interacting with post:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
