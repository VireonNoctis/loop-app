import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { checkCirclePrivateAccess } from "@/lib/circle-access";
import { getUserFromRequest } from "@/lib/server-auth";
import { getMediaLimit } from "@/lib/circle-limits";
import { canShareCircle, isShareablePost, sharePostToLoopFeed } from "@/lib/community-feed-share";

function getCirclePostsClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServerClient()
}

// Get circle posts
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = getCirclePostsClient()
    if (!supabase) return NextResponse.json({ error: "Circle post service is unavailable" }, { status: 503 })

    const { searchParams } = new URL(request.url)
    const limit = Number.parseInt(searchParams.get("limit") || "20")
    const offset = Number.parseInt(searchParams.get("offset") || "0")
    // UI sends "latest" | "top"; map to real column + order. Before this
    // mapping, "latest" was passed to .order() as a column name and Postgres
    // rejected it — the feed showed "Failed to fetch posts".
    const sortMode = searchParams.get("sort") || "latest"
    const orderBy = searchParams.get("order_by") || ""
    const sortBy = orderBy === "comment_count" ? "comment_count" : sortMode === "top" ? "like_count" : "created_at"
    const order = searchParams.get("order") || (sortMode === "top" ? "desc" : "desc")

    const { id: circleId } = await params

    // Private circles: only approved members (or the owner) may read posts.
    const authHeader = request.headers.get("authorization")
    const access = await checkCirclePrivateAccess(circleId, authHeader)
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ success: true, posts: [], hasMore: false, locked: true })
    }

    const currentUser = await getUserFromRequest(request)
    const spaceFilter = searchParams.get("space_id")

    // Staff see everything (including pending), everyone else sees published.
    let viewerRole: string | null = null
    if (currentUser) {
      const { data: vMem } = await supabase
        .from("circle_members")
        .select("role")
        .eq("circle_id", circleId)
        .eq("user_id", currentUser.id)
        .maybeSingle()
      viewerRole = vMem?.role || null
    }
    const isStaff = ["owner", "admin", "moderator"].includes(viewerRole || "")

    // Fetch posts with author info
    let query = supabase
      .from("circle_posts")
      .select(`
        *,
        author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, badge_id, equipped_frame_id),
        thread:community_threads!thread_id(id, title, is_live)
      `)
      .eq("circle_id", circleId)
      .order(sortBy, { ascending: order === "asc" })
      .range(offset, offset + limit - 1)

    if (!isStaff) {
      query = query.or("status.is.null,status.eq.published")
    }

    if (spaceFilter && spaceFilter !== "all") {
      query = query.eq("space_id", Number(spaceFilter))
    } else if (spaceFilter === "all") {
      query = query.not("space_id", "is", null)
    }

    const { data: posts, error } = await query

    if (error) {
      console.error("Database error:", error)
      return NextResponse.json({ error: "Failed to fetch posts" }, { status: 500 })
    }

    // Get interaction counts + polls for each post
    const postIds = posts?.map(post => post.id) || []
    let pollByPostId = new Map<string, any>()
    if (postIds.length > 0) {
      const { data: pollRows } = await supabase.from("circle_post_polls").select("*").in("post_id", postIds)
      pollByPostId = new Map((pollRows || []).map((p: any) => [p.post_id, p]))
    }
    // Reaction counts (fire/clap/...) grouped per post for the reaction chips.
    let reactionsByPostId = new Map<string, Record<string, number>>()
    if (postIds.length > 0) {
      const { data: reactionRows } = await supabase
        .from("circle_post_reactions")
        .select("post_id, reaction_type")
        .in("post_id", postIds)
      for (const r of reactionRows || []) {
        const counts = reactionsByPostId.get(r.post_id) || {}
        counts[r.reaction_type] = (counts[r.reaction_type] || 0) + 1
        reactionsByPostId.set(r.post_id, counts)
      }
    }

    if (postIds.length > 0) {
      const { data: interactions } = await supabase
        .from("circle_post_interactions")
        .select("post_id, user_id, interaction_type")
        .in("post_id", postIds)

      // Add interaction counts + poll to posts. Previously never reported
      // is_liked at all, so the like button always rendered "not liked"
      // even for posts the viewer had already liked.
      const postsWithCounts = posts?.map(post => {
        const postInteractions = interactions?.filter(interaction => interaction.post_id === post.id) || []
        const likes = postInteractions.filter(i => i.interaction_type === "like").length
        const shares = postInteractions.filter(i => i.interaction_type === "share").length
        const isLiked = Boolean(
          currentUser && postInteractions.some((i) => i.interaction_type === "like" && i.user_id === currentUser.id),
        )
        const isSaved = Boolean(
          currentUser && postInteractions.some((i) => i.interaction_type === "save" && i.user_id === currentUser.id),
        )

        return {
          ...post,
          like_count: likes,
          share_count: shares,
          is_liked: isLiked,
          is_saved: isSaved,
          reaction_counts: reactionsByPostId.get(post.id) || {},
          poll: pollByPostId.get(post.id) || null,
        }
      }) || []

      return NextResponse.json({
        success: true,
        posts: postsWithCounts,
        hasMore: posts?.length === limit,
      })
    }

    return NextResponse.json({
      success: true,
      posts: (posts || []).map((p: any) => ({ ...p, poll: pollByPostId.get(p.id) || null })),
      hasMore: posts?.length === limit,
    })
  } catch (error) {
    console.error("Error fetching circle posts:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Create a new circle post
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = getCirclePostsClient()
    if (!supabase) return NextResponse.json({ error: "Circle post service is unavailable" }, { status: 503 })

    const { id: circleId } = await params
    const body = await request.json()
    const { content, media_url, media_type, hashtags, poll, room_id } = body
    const mediaUrls: string[] = Array.isArray(body.media_urls)
      ? body.media_urls.filter((u: any) => typeof u === "string" && u.trim())
      : media_url
        ? [media_url]
        : []

    // Post tags must come from the circle's admin-curated vocabulary.
    // Unknown tags are silently dropped — admins own the tag set.
    let validTags: string[] = []
    if (Array.isArray(body.tags) && body.tags.length) {
      const rawTags: unknown[] = Array.isArray(body.tags) ? body.tags : []
      const requested: string[] = [
        ...new Set(rawTags.map((t) => String(t || "").trim().replace(/^#/, "").toLowerCase()).filter((s) => Boolean(s))),
      ]
      if (requested.length) {
        const { data: vocab } = await supabase
          .from("circle_tags")
          .select("name")
          .eq("circle_id", circleId)
        const allowed = new Set((vocab || []).map((t) => t.name))
        validTags = requested.filter((t) => allowed.has(t)).slice(0, 5)
      }
    }

    // Check if user is a member of the circle (role needed for announcement-room + max-files checks)
    const { data: member } = await supabase
      .from("circle_members")
      .select("id, role, permissions, is_muted, muted_until")
      .eq("circle_id", circleId)
      .eq("user_id", user.id)
      .in("status", ["active", "approved"])
      .single()

    if (!member) {
      return NextResponse.json({ error: "You must be a member to post" }, { status: 403 })
    }

    // Muted members can't post until their mute expires (staff bypass).
    if (member.is_muted && !["owner", "admin", "moderator"].includes(member.role)) {
      const until = member.muted_until ? new Date(member.muted_until) : null
      if (!until || until > new Date()) {
        return NextResponse.json(
          { error: until ? `You are muted until ${until.toLocaleString()}` : "You are muted in this community" },
          { status: 403 },
        )
      }
    }

    // Community admins can turn off member posting via settings.allow_posts.
    // Owners/admins/moderators can still post so they can announce the freeze.
    const isCircleStaff = ["owner", "admin", "moderator"].includes(member.role)
    if (!isCircleStaff) {
      const { data: circleRow } = await supabase
        .from("circles")
        .select("settings")
        .eq("id", circleId)
        .maybeSingle()
      const allowPosts = circleRow?.settings?.allow_posts
      if (allowPosts === false) {
        return NextResponse.json(
          {
            error: "Posting is temporarily turned off by community admins.",
            allow_posts: false,
          },
          { status: 403 },
        )
      }
    }

    // Announcement rooms are read-for-everyone, post-for-admins-only (or a
    // member explicitly granted can_post_announcements).
    if (room_id) {
      const { data: room } = await supabase.from("circle_rooms").select("type").eq("id", room_id).eq("circle_id", circleId).maybeSingle()
      const isCircleAdmin = ["owner", "admin", "moderator"].includes(member.role)
      if (room?.type === "announcement" && !isCircleAdmin && !member.permissions?.can_post_announcements) {
        return NextResponse.json({ error: "Only circle admins can post in an announcement channel" }, { status: 403 })
      }
    }

    // Server-side media cap: Free: 2 · Verified: 4 · Pro: up to 10. Read from
    // the user's real account state — never trust a client-sent Pro flag.
    if (mediaUrls.length > 1) {
      const { data: authorProfile } = await supabase
        .from("profiles")
        .select("is_premium, is_verified")
        .eq("id", user.id)
        .maybeSingle()
      const maxFiles = getMediaLimit(authorProfile?.is_premium, authorProfile?.is_verified)
      if (mediaUrls.length > maxFiles) {
        return NextResponse.json(
          { error: `Up to ${maxFiles} media files allowed on your account. Upgrade to Pro for up to 10.` },
          { status: 400 },
        )
      }
    }

    // Validate content
    if (!content?.trim() && mediaUrls.length === 0 && !poll?.question) {
      return NextResponse.json({ error: "Content, media, or a poll is required" }, { status: 400 })
    }
    if (poll && (!poll.question?.trim() || !Array.isArray(poll.options) || poll.options.length < 2)) {
      return NextResponse.json({ error: "Poll requires a question and at least 2 options" }, { status: 400 })
    }

    // Moderation: blocked words + approval mode are enforced server-side.
    let postStatus = "published"
    let blockedHit: string | null = null
    let approvalOn = false
    if (!isCircleStaff) {
      const { data: modRow } = await supabase
        .from("circles")
        .select("moderation_settings")
        .eq("id", circleId)
        .maybeSingle()
      const modSettings = (modRow as any)?.moderation_settings || {}
      const blocked: string[] = Array.isArray(modSettings.blocked_words) ? modSettings.blocked_words : []
      if (blocked.length) {
        const lower = String(content || "").toLowerCase()
        blockedHit = blocked.find((w) => w && lower.includes(String(w).toLowerCase())) || null
      }
      approvalOn = Boolean(modSettings.post_approval)
      if (blockedHit) {
        return NextResponse.json(
          { error: `Your post contains a word blocked by this community (${blockedHit}).` },
          { status: 403 }
        )
      }
      if (approvalOn) postStatus = "pending"
    }

    // Optional space scoping — validate the space belongs to this circle
    let spaceId: number | null = null
    let spaceName: string | null = null
    if (body.space_id) {
      const { data: space } = await supabase
        .from("community_spaces")
        .select("id, name")
        .eq("id", body.space_id)
        .eq("circle_id", circleId)
        .maybeSingle()
      if (space) {
        spaceId = space.id
        spaceName = space.name || null
      }
    }

    // Discussion kind. Anything unknown lands as a plain discussion rather
    // than being rejected — the community can also start Co-Loops and Duels,
    // and those carry their own metadata below.
    const POST_TYPES = new Set([
      "discussion",
      "question",
      "media",
      "poll",
      "announcement",
      "resource",
      "coloop",
      "duel",
    ])
    const postType = POST_TYPES.has(String(body.post_type || "")) ? String(body.post_type) : poll?.question ? "poll" : "discussion"
    const contentMetadata =
      body.content_metadata && typeof body.content_metadata === "object" && !Array.isArray(body.content_metadata)
        ? { ...body.content_metadata }
        : {}

    // Optional thread attachment — a post can land inside a community thread,
    // which is how a thread shows real contributions instead of a counter.
    let threadId: number | null = null
    if (body.thread_id) {
      const { data: thread } = await supabase
        .from("community_threads")
        .select("id, state")
        .eq("id", body.thread_id)
        .eq("circle_id", circleId)
        .maybeSingle()
      if (thread && thread.state !== "archived") threadId = thread.id
    }

    // Create post
    const nowIso = new Date().toISOString()
    const { data: post, error: insertError } = await supabase
      .from("circle_posts")
      .insert({
        circle_id: circleId,
        author_id: user.id,
        content: content?.trim() || "",
        media_url: mediaUrls[0] || null,
        media_urls: mediaUrls,
        media_type: mediaUrls.length ? media_type || "image" : null,
        hashtags: hashtags || [],
        tags: validTags,
        space_id: spaceId,
        thread_id: threadId,
        post_type: postType,
        content_metadata: contentMetadata,
        status: postStatus,
        moderation_note: postStatus === "pending" ? "Awaiting moderator approval" : null,
        created_at: nowIso,
        updated_at: nowIso,
        last_activity_at: nowIso
      })
      .select(`
        *,
        author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, badge_id, equipped_frame_id)
      `)
      .single()

    if (insertError) {
      console.error("Database insert error:", insertError)
      return NextResponse.json({ error: "Failed to create post" }, { status: 500 })
    }

    let createdPoll: any = null
    if (poll?.question) {
      // Options arrive as strings (legacy writers) OR objects { text, image_url }
      // (image polls). Never stringify an object into "[object Object]" — that
      // was the community poll bug where options rendered as objects.
      const formattedOptions = (poll.options || []).map((opt: any, idx: number) => {
        const isObj = typeof opt === "object" && opt !== null
        return {
          id: isObj && opt.id ? String(opt.id) : `opt_${idx + 1}`,
          text: String(isObj ? (opt.text ?? opt.label ?? "") : opt).slice(0, 140),
          votes: Number(isObj ? opt.votes || 0 : 0),
          image_url: isObj && opt.image_url ? String(opt.image_url).slice(0, 1000) : null,
        }
      }).filter((o: any) => o.text.trim())
      const { data: pollRow } = await supabase
        .from("circle_post_polls")
        .insert({
          post_id: post.id,
          circle_id: circleId,
          question: poll.question.trim(),
          options: formattedOptions,
          total_votes: 0,
          expires_at: new Date(Date.now() + (poll.durationHours || 24) * 3600 * 1000).toISOString(),
        })
        .select()
        .single()
      createdPoll = pollRow
    }

    // ── Optional share to the global Loop feed ──
    // Community content is community-only unless the author explicitly asks
    // for it, and a private community can never be shared at all.
    let feedLoopId: string | null = null
    if (body.share_to_feed) {
      const { data: circleRow } = await supabase
        .from("circles")
        .select("id, name, handle, is_private")
        .eq("id", circleId)
        .maybeSingle()
      if (!canShareCircle(circleRow)) {
        // Silently stay community-only rather than failing the post.
        feedLoopId = null
      } else if (isShareablePost({ ...post, status: postStatus })) {
        feedLoopId = await sharePostToLoopFeed(supabase, {
          circle: circleRow!,
          postId: post.id,
          authorId: user.id,
          content: post.content || "",
          mediaUrl: post.media_url,
          mediaUrls: post.media_urls,
          mediaType: post.media_type,
          spaceName,
        })
        if (feedLoopId) {
          await supabase.from("circle_posts").update({ feed_loop_id: feedLoopId }).eq("id", post.id)
          post.feed_loop_id = feedLoopId
        }
      }
    }

    // Update circle post count + this author's leaderboard score (published only)
    if (postStatus === "published") {
      await supabase.rpc('increment_circle_post_count', { circle_id: circleId })
      await supabase.rpc('increment_circle_contribution', { p_circle_id: circleId, p_user_id: user.id, p_amount: 5 })
    }

    if (postStatus === "pending") {
      try {
        await supabase.from("community_moderation_logs").insert({
          circle_id: circleId,
          moderator_id: null,
          action: "post_awaiting_approval",
          target_user_id: user.id,
          target_type: "post",
          target_id: String(post.id),
          reason: "Auto-flagged by approval mode",
        })
      } catch { /* log best-effort */ }
    }

    try {
      const { processMentions, extractMentions, attachMentionsColumn } = await import("@/lib/mentions")
      const text = String(content || "")
      const usernames = extractMentions(text)
      if (usernames.length) {
        await attachMentionsColumn(supabase, "circle_posts", post.id, usernames)
        const { data: actorProfile } = await supabase
          .from("profiles")
          .select("username, display_name")
          .eq("id", user.id)
          .maybeSingle()
        await processMentions(supabase, text, {
          source: "circle_post",
          circle_id: circleId,
          post_id: post.id,
          actor_id: user.id,
          actor_username: actorProfile?.username || user.user_metadata?.username,
          actor_display_name: actorProfile?.display_name || user.user_metadata?.display_name,
          href: `/communities/${circleId}/posts/${post.id}`,
        })
      }
    } catch (mentionError) {
      console.error("Circle post mention error:", mentionError)
    }

    // Thread followers get told — per-thread, so muting one thread doesn't
    // silence the community. "mentions" mode only fires when they're named.
    if (threadId && postStatus === "published") {
      try {
        const { data: followers } = await supabase
          .from("community_thread_follows")
          .select("user_id, mode")
          .eq("thread_id", threadId)
          .neq("user_id", user.id)

        if (followers && followers.length > 0) {
          const { data: threadRow } = await supabase
            .from("community_threads")
            .select("title")
            .eq("id", threadId)
            .maybeSingle()

          const mentioned = new Set<string>()
          try {
            const { extractMentions } = await import("@/lib/mentions")
            for (const name of extractMentions(String(content || ""))) mentioned.add(String(name).toLowerCase())
          } catch {
            /* mentions are best-effort */
          }

          const ids = followers.map((f: any) => f.user_id)
          let nameById = new Map<string, string>()
          if (mentioned.size > 0) {
            const { data: profiles } = await supabase.from("profiles").select("id, username").in("id", ids)
            nameById = new Map((profiles || []).map((p: any) => [p.id, String(p.username || "").toLowerCase()]))
          }

          const targets = followers
            .filter((f: any) => {
              const mode = f.mode || "none"
              if (mode === "none") return false
              if (mode === "all") return true
              return mentioned.has(nameById.get(f.user_id) || "\u0000")
            })
            .map((f: any) => f.user_id)

          if (targets.length > 0) {
            const { notifyUsers } = await import("@/lib/notifications")
            await notifyUsers(supabase, targets, {
              type: "community_thread",
              title: threadRow?.title ? `New in "${threadRow.title}"` : "New in a thread you follow",
              message: (String(content || "").trim() || "Sent an attachment").slice(0, 140),
              actionUrl: `/communities/${circleId}?tab=threads`,
              inAppOnly: true,
            })
          }
        }
      } catch (threadNotifyError) {
        console.error("Thread follower notify error:", threadNotifyError)
      }
    }

    return NextResponse.json({
      success: true,
      post: { ...post, poll: createdPoll, shared_to_feed: Boolean(feedLoopId) },
      message: "Post created successfully"
    })
  } catch (error) {
    console.error("Error creating circle post:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Update a circle post
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = getCirclePostsClient()
    if (!supabase) return NextResponse.json({ error: "Circle post service is unavailable" }, { status: 503 })

    const { id: circleId } = await params
    const body = await request.json()
    const { postId, content, media_url, media_type, hashtags, is_pinned } = body

    // Check if post exists
    const { data: post } = await supabase
      .from("circle_posts")
      .select("author_id, is_pinned")
      .eq("id", postId)
      .eq("circle_id", circleId)
      .single()

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    // Pin/unpin can be done by author, circle admins/moderators, or a
    // member explicitly granted can_pin_posts.
    if (typeof is_pinned === "boolean") {
      let hasPermission = post.author_id === user.id
      if (!hasPermission) {
        const { data: member } = await supabase
          .from("circle_members")
          .select("role, permissions")
          .eq("circle_id", circleId)
          .eq("user_id", user.id)
          .maybeSingle()
        hasPermission = Boolean(member && (["owner", "admin", "moderator"].includes(member.role) || member.permissions?.can_pin_posts))
      }

      if (!hasPermission) {
        return NextResponse.json({ error: "Insufficient permissions to pin posts" }, { status: 403 })
      }

      const { data: updatedPost, error: updateError } = await supabase
        .from("circle_posts")
        .update({
          is_pinned,
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId)
        .select(`
          *,
          author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, badge_id, equipped_frame_id)
        `)
        .single()

      if (updateError) {
        // Column may not exist yet — still return optimistic success for UI stability.
        if (updateError.code === "PGRST204" || /is_pinned/i.test(updateError.message || "")) {
          return NextResponse.json({
            success: true,
            post: { id: postId, is_pinned },
            message: "Pin preference saved locally (column unavailable)",
          })
        }
        console.error("Database pin update error:", updateError)
        return NextResponse.json({ error: "Failed to pin post" }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        post: updatedPost,
        message: is_pinned ? "Post pinned" : "Post unpinned",
      })
    }

    if (post.author_id !== user.id) {
      return NextResponse.json({ error: "You can only edit your own posts" }, { status: 403 })
    }

    if (typeof content === "string" && !content.trim()) {
      return NextResponse.json({ error: "Post content cannot be empty" }, { status: 400 })
    }

    // Only touch fields that were actually sent — omitting media_url/
    // hashtags previously wiped them out on every plain text edit.
    const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() }
    if (typeof content === "string") updatePayload.content = content.trim()
    if (media_url !== undefined) updatePayload.media_url = media_url
    if (media_type !== undefined) updatePayload.media_type = media_type
    if (Array.isArray(hashtags)) updatePayload.hashtags = hashtags

    if (Object.keys(updatePayload).length <= 1) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 })
    }

    // Update post content
    const { data: updatedPost, error: updateError } = await supabase
      .from("circle_posts")
      .update(updatePayload)
      .eq("id", postId)
      .select(`
        *,
        author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, badge_id, equipped_frame_id)
      `)
      .single()

    if (updateError) {
      console.error("Database update error:", updateError)
      return NextResponse.json({ error: "Failed to update post" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      post: updatedPost,
      message: "Post updated successfully"
    })
  } catch (error) {
    console.error("Error updating circle post:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Delete a circle post
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = getCirclePostsClient()
    if (!supabase) return NextResponse.json({ error: "Circle post service is unavailable" }, { status: 503 })

    const { id: circleId } = await params
    const { searchParams } = new URL(request.url)
    const postId = searchParams.get("postId")

    if (!postId) {
      return NextResponse.json({ error: "Post ID is required" }, { status: 400 })
    }

    // Check if post exists and user is the author or has admin permissions
    const { data: post } = await supabase
      .from("circle_posts")
      .select("author_id")
      .eq("id", postId)
      .eq("circle_id", circleId)
      .single()

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    // Check if user is author, has admin/moderator role, or was granted can_moderate
    let hasPermission = post.author_id === user.id
    
    if (!hasPermission) {
      const { data: member } = await supabase
        .from("circle_members")
        .select("role, permissions")
        .eq("circle_id", circleId)
        .eq("user_id", user.id)
        .maybeSingle()
      
      hasPermission = Boolean(member && (["owner", "admin", "moderator"].includes(member.role) || member.permissions?.can_moderate))
    }

    if (!hasPermission) {
      return NextResponse.json({ error: "You can only delete your own posts or posts in circles where you have moderator permissions" }, { status: 403 })
    }

    // Delete post
    const { error: deleteError } = await supabase
      .from("circle_posts")
      .delete()
      .eq("id", postId)

    if (deleteError) {
      console.error("Database delete error:", deleteError)
      return NextResponse.json({ error: "Failed to delete post" }, { status: 500 })
    }

    // Update circle post count
    await supabase.rpc('decrement_circle_post_count', { circle_id: circleId })

    return NextResponse.json({
      success: true,
      message: "Post deleted successfully"
    })
  } catch (error) {
    console.error("Error deleting circle post:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
