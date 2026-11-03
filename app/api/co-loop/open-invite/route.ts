import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"

/**
 * POST – Creator publishes an open Co-Loop invite as a feed post.
 * Body: { session_id, topic, max_collaborators? }
 * Creates a loop post of type "open_coloop_invite" + updates the session record.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = createServerClient()
    const { session_id, topic, max_collaborators = 4 } = await request.json()

    if (!session_id || !topic?.trim()) {
      return NextResponse.json({ error: "session_id and topic are required" }, { status: 400 })
    }

    if (max_collaborators < 2 || max_collaborators > 4) {
      return NextResponse.json({ error: "max_collaborators must be between 2 and 4" }, { status: 400 })
    }

    // Get creator profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, video_avatar_url, is_verified, is_premium, level, active_cosmetics, cosmetics, badge_id")
      .eq("id", user.id)
      .single()

    // Ensure session exists and user is owner
    const { data: session } = await supabase
      .from("co_loop_sessions")
      .select("*")
      .eq("session_id", session_id)
      .maybeSingle()

    if (session && session.owner_id !== user.id) {
      return NextResponse.json({ error: "Only the session owner can create an open invite" }, { status: 403 })
    }

    // If session doesn't exist yet, create it — and never ignore a failure
    // here: a silently-skipped session row leaves an orphan feed post whose
    // joins all fail with "Session not found".
    if (!session) {
      const { error: insertError } = await supabase.from("co_loop_sessions").insert({
        session_id,
        owner_id: user.id,
        owner_username: profile?.username || user.email?.split("@")[0] || "creator",
        co_authors: [],
        is_open_invite: true,
        max_collaborators,
        open_invite_topic: topic.trim(),
      })
      if (insertError && insertError.code !== "23505") {
        console.error("Failed to create co_loop_sessions row:", insertError)
        return NextResponse.json(
          { error: "Could not create the Co-Loop session: " + insertError.message },
          { status: 500 },
        )
      }
    } else {
      // Update existing session with open invite info
      const { error: updateError } = await supabase
        .from("co_loop_sessions")
        .update({
          is_open_invite: true,
          max_collaborators,
          open_invite_topic: topic.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", session_id)

      if (updateError) {
        console.error("Failed to update co_loop_sessions row:", updateError)
        return NextResponse.json(
          { error: "Could not open the Co-Loop session: " + updateError.message },
          { status: 500 },
        )
      }
    }

    // Create the feed post (open co-loop invite card)
    const { data: loop, error: loopError } = await supabase
      .from("loops")
      .insert({
        author_id: user.id,
        content: topic.trim(),
        content_text: topic.trim(),
        content_title: `🤝 Open Co-Loop: ${topic.trim()}`,
        post_type: "open_coloop_invite",
        content_type: "open_coloop_invite",
        visibility: "public",
        content_metadata: {
          is_open_coloop_invite: true,
          session_id,
          max_collaborators,
          topic: topic.trim(),
          current_participants: 1,
          status: "open",
        },
      })
      .select("*, author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_premium, level, active_cosmetics, cosmetics, badge_id)")
      .single()

    if (loopError) {
      console.error("Failed to create open co-loop invite post:", loopError)
      return NextResponse.json({ error: "Failed to create feed post" }, { status: 500 })
    }

    // Link the post back to the session
    await supabase
      .from("co_loop_sessions")
      .update({ feed_post_id: loop.id, updated_at: new Date().toISOString() })
      .eq("session_id", session_id)

    // Initialize loop_stats
    await supabase.from("loop_stats").insert({
      loop_id: loop.id,
      likes_count: 0,
      comments_count: 0,
      branches_count: 0,
      shares_count: 0,
      views_count: 0,
    })

    // Broadcast open invite to realtime channel
    try {
      const channel = supabase.channel(`co-loop-studio:${session_id}`)
      await channel.send({
        type: "broadcast",
        event: "open_invite_published",
        payload: {
          session_id,
          topic: topic.trim(),
          max_collaborators,
          post_id: loop.id,
          creator: profile?.display_name || profile?.username,
        },
      })
    } catch {
      // best-effort
    }

    return NextResponse.json({
      success: true,
      loop,
      session_id,
      post_id: loop.id,
    })
  } catch (error: any) {
    console.error("Open co-loop invite error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

/**
 * PATCH – Join an open Co-Loop invite (any user can join up to the max).
 * Body: { session_id, post_id? }
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = createServerClient()
    const { session_id } = await request.json()

    if (!session_id) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 })
    }

    // Get session
    const { data: foundSession, error: sessionError } = await supabase
      .from("co_loop_sessions")
      .select("*")
      .eq("session_id", session_id)
      .maybeSingle()

    let session: any = sessionError ? null : foundSession

    // Self-heal: the feed post can outlive its session row (the session insert
    // failed silently on older schemas, or the room row was removed). Rebuild
    // the session from the post itself so joining works instead of failing
    // with "Session not found".
    if (!session || !session.is_open_invite) {
      const { data: posts } = await supabase
        .from("loops")
        .select("id, author_id, content_metadata, author:profiles!author_id(username)")
        .contains("content_metadata", { session_id })
        .eq("post_type", "open_coloop_invite")
        .limit(1)
      const post: any = posts?.[0]
      const meta: any = post?.content_metadata || {}

      if (!session && !post) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 })
      }

      if (!session && post) {
        const { data: rebuilt, error: healError } = await supabase
          .from("co_loop_sessions")
          .insert({
            session_id,
            owner_id: post.author_id,
            owner_username: post.author?.username || "creator",
            co_authors: [],
            is_open_invite: true,
            max_collaborators: Number(meta.max_collaborators) || 4,
            open_invite_topic: meta.topic || "",
            feed_post_id: String(post.id),
          })
          .select("*")
          .maybeSingle()

        if (healError && healError.code !== "23505") {
          console.error("Failed to rebuild co_loop session:", healError)
          return NextResponse.json({ error: "Could not open this Co-Loop session" }, { status: 500 })
        }
        if (healError?.code === "23505") {
          const { data: again } = await supabase
            .from("co_loop_sessions")
            .select("*")
            .eq("session_id", session_id)
            .maybeSingle()
          session = again
        } else {
          session = rebuilt
        }
      } else if (session && post) {
        // Session row exists but was never flagged as an open invite (an
        // earlier update failed) — flag it from the post's metadata now.
        const { error: healError } = await supabase
          .from("co_loop_sessions")
          .update({
            is_open_invite: true,
            max_collaborators: Number(meta.max_collaborators) || session.max_collaborators,
            feed_post_id: session.feed_post_id || String(post.id),
            updated_at: new Date().toISOString(),
          })
          .eq("session_id", session_id)
        if (!healError) session = { ...session, is_open_invite: true }
      }

      if (!session) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 })
      }
      if (!session.is_open_invite) {
        return NextResponse.json({ error: "This is not an open invite session" }, { status: 400 })
      }
    }

    if (session.deleted_at) {
      return NextResponse.json({ error: "This room was deleted by its host" }, { status: 410 })
    }

    if (session.status === "published") {
      return NextResponse.json({ error: "This Co-Loop has been published and is no longer accepting collaborators" }, { status: 410 })
    }
    if (session.status === "ended") {
      return NextResponse.json({ error: "This Co-Loop session has ended" }, { status: 410 })
    }
    if (session.status !== "active") {
      return NextResponse.json({ error: "This session is no longer active" }, { status: 400 })
    }

    const { data: joined, error: joinError } = await supabase.rpc("join_open_co_loop_session", {
      p_session_id: session_id,
      p_user_id: user.id,
    })
    if (joinError) {
      console.error("Atomic open Co-Loop join failed:", joinError.message)
      if (/session_full/.test(joinError.message)) {
        return NextResponse.json({ error: "This session is full" }, { status: 409 })
      }
      if (/session_deleted/.test(joinError.message)) {
        return NextResponse.json({ error: "This room was deleted by its host" }, { status: 410 })
      }
      if (/session_inactive/.test(joinError.message)) {
        return NextResponse.json({ error: "This Co-Loop is no longer accepting collaborators" }, { status: 410 })
      }
      if (/session_not_open/.test(joinError.message)) {
        return NextResponse.json({ error: "This is not an open invite session" }, { status: 403 })
      }
      return NextResponse.json({ error: "Could not join this Co-Loop session" }, { status: 500 })
    }

    const result = joined as {
      owner_id: string
      owner_username: string
      topic: string
      current_count: number
      max: number
      is_full: boolean
      already_joined: boolean
      is_owner: boolean
      co_author_entry: {
        id: string
        username: string
        display_name: string
        avatar_url: string | null
        role: string
      }
    }

    if (result.already_joined || result.is_owner) {
      return NextResponse.json({
        success: true,
        message: "You are already in this Co-Loop session.",
        studio_url: `/co-loop/studio?session=${encodeURIComponent(session_id)}`,
        current_count: result.current_count,
        max: result.max,
        is_full: result.is_full,
        already_joined: true,
        is_owner: result.is_owner,
      })
    }

    const coAuthorEntry = result.co_author_entry
    const joinerProfile = {
      id: coAuthorEntry.id,
      username: coAuthorEntry.username,
      display_name: coAuthorEntry.display_name,
      avatar_url: coAuthorEntry.avatar_url,
    }
    const newCount = result.current_count
    const isFull = result.is_full
    // Notify the session owner
    try {
      const { notifyUser } = await import("@/lib/notifications")
      await notifyUser(supabase, {
        userId: session.owner_id,
        type: "co_loop_open_join",
        title: "Someone Joined Your Open Co-Loop! 🤝",
        message: `${joinerProfile?.display_name || joinerProfile?.username || "A user"} joined your open session: "${session.open_invite_topic || "Co-Loop"}"`,
        actorId: user.id,
        actionUrl: `/co-loop/studio?session=${session_id}`,
        data: {
          session_id,
          joiner_id: user.id,
          joiner_name: joinerProfile?.display_name || joinerProfile?.username,
          joiner_avatar: joinerProfile?.avatar_url,
          topic: session.open_invite_topic,
        },
        pushCategory: "social",
      })
    } catch (notifyErr) {
      console.warn("Open co-loop join notification failed:", notifyErr)
    }

    // Broadcast join to studio
    try {
      const channel = supabase.channel(`co-loop-studio:${session_id}`)
      await channel.send({
        type: "broadcast",
        event: "co-author-accepted",
        payload: { user: coAuthorEntry },
      })
    } catch {
      // best-effort
    }

    return NextResponse.json({
      success: true,
      message: "You joined the Co-Loop session!",
      studio_url: `/co-loop/studio?session=${session_id}`,
      current_count: newCount,
      max: session.max_collaborators,
      is_full: isFull,
    })
  } catch (error: any) {
    console.error("Open co-loop join error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

/**
 * GET – join state for an open invite, so the feed card can restore "Enter
 * Studio" (and a real participant count) after a reload instead of showing a
 * Join button that errors out.
 * Query: ?session_id=...
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const session_id = searchParams.get("session_id") || searchParams.get("session")
    if (!session_id) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 })
    }

    const supabase = createServerClient()
    const user = await getUserFromRequest(request).catch(() => null)

    const { data: session } = await supabase
      .from("co_loop_sessions")
      .select("*")
      .eq("session_id", session_id)
      .maybeSingle()

    if (session) {
      const max = session.max_collaborators || 4
      const { count } = await supabase
        .from("open_co_loop_participants")
        .select("id", { count: "exact", head: true })
        .eq("session_id", session_id)
      const currentCount = (count || 0) + 1 // +1 for the owner

      let joined = false
      let isOwner = false
      if (user) {
        if (session.owner_id === user.id) {
          joined = true
          isOwner = true
        } else {
          const { data: participant } = await supabase
            .from("open_co_loop_participants")
            .select("id")
            .eq("session_id", session_id)
            .eq("user_id", user.id)
            .maybeSingle()
          joined = Boolean(participant)
        }
      }

      const status = session.deleted_at
        ? "deleted"
        : session.status === "published"
          ? "published"
          : session.status === "ended"
            ? "ended"
            : currentCount >= max
              ? "full"
              : "open"

      return NextResponse.json({
        exists: true,
        session_id,
        is_open_invite: Boolean(session.is_open_invite),
        is_owner: isOwner,
        joined,
        current_count: currentCount,
        max,
        status,
        is_full: status === "full",
      })
    }

    // No session row — fall back to the feed post's metadata so the card can
    // still render honest numbers (a join attempt will self-heal the session).
    const { data: posts } = await supabase
      .from("loops")
      .select("id, author_id, content_metadata")
      .contains("content_metadata", { session_id })
      .eq("post_type", "open_coloop_invite")
      .limit(1)
    const post: any = posts?.[0]
    if (!post) {
      return NextResponse.json({ exists: false, session_id })
    }

    const meta: any = post.content_metadata || {}
    const max = Number(meta.max_collaborators) || 4
    const currentCount = Number(meta.current_participants) || 1
    const status = currentCount >= max || meta.status === "full" ? "full" : meta.status || "open"

    return NextResponse.json({
      exists: true,
      session_id,
      is_open_invite: true,
      is_owner: Boolean(user && user.id === post.author_id),
      joined: Boolean(user && user.id === post.author_id),
      current_count: currentCount,
      max,
      status,
      is_full: status === "full",
      needs_repair: true,
    })
  } catch (error: any) {
    console.error("Open co-loop state error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
