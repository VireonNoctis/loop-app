import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

type Action = "lock" | "unlock" | "delete" | "kick"

/**
 * Host controls for a Co-Loop room.
 *
 * - lock/unlock — the host freezes the draft for everyone else (the studio
 *   disables editing for non-hosts) while keeping the room open to read.
 * - delete — soft-retires the session once the Co-Loop is published (or any
 *   time the host wants out). The published Loop itself is untouched; only the
 *   studio session row gets `deleted_at`, after which nobody can rejoin.
 *
 * Only the session owner may call this.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const sessionId = body.session_id || body.sessionId
    const action = body.action as Action
    const targetUserId = body.target_user_id || body.targetUserId || null

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 })
    }
    if (!["lock", "unlock", "delete", "kick"].includes(action)) {
      return NextResponse.json({ error: "Unknown room action" }, { status: 400 })
    }
    if (action === "kick" && !targetUserId) {
      return NextResponse.json({ error: "target_user_id is required" }, { status: 400 })
    }

    const supabase = createServerClient()

    const { data: session } = await supabase
      .from("co_loop_sessions")
      .select("session_id, owner_id, locked, deleted_at, status, co_authors, feed_post_id, max_collaborators, open_invite_topic")
      .eq("session_id", sessionId)
      .maybeSingle()

    if (!session) {
      // Nothing recorded yet — a lock on an unseen room is meaningless, but a
      // delete should still succeed so the client can move on.
      if (action === "delete") return NextResponse.json({ success: true, session_id: sessionId, deleted: true })
      return NextResponse.json({ error: "This room does not exist" }, { status: 404 })
    }
    if (session.deleted_at) {
      return NextResponse.json({ error: "This room has been deleted" }, { status: 410 })
    }
    if (session.owner_id !== user.id) {
      return NextResponse.json({ error: "Only the host can do that" }, { status: 403 })
    }

    if (action === "delete") {
      const { error } = await supabase
        .from("co_loop_sessions")
        .update({
          deleted_at: new Date().toISOString(),
          status: "ended",
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", sessionId)
      if (error) {
        console.error("co_loop_sessions delete failed:", error.message)
        return NextResponse.json({ error: "Could not delete this room" }, { status: 500 })
      }
      return NextResponse.json({ success: true, session_id: sessionId, deleted: true })
    }

    if (action === "kick") {
      const targetId = typeof targetUserId === "string" ? targetUserId : ""
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)) {
        return NextResponse.json({ error: "A valid target_user_id is required" }, { status: 400 })
      }
      if (targetId === user.id) {
        return NextResponse.json({ error: "The host can't remove themselves" }, { status: 400 })
      }

      const { data: kickData, error: kickError } = await supabase.rpc("kick_co_loop_participant", {
        p_session_id: sessionId,
        p_owner_id: user.id,
        p_target_user_id: targetId,
      })
      if (kickError) {
        console.error("Atomic Co-Loop kick failed:", kickError.message)
        if (kickError.code === "P0002") {
          return NextResponse.json({ error: "Co-Loop or collaborator not found" }, { status: 404 })
        }
        if (kickError.code === "42501") {
          return NextResponse.json({ error: "Only the host can remove collaborators" }, { status: 403 })
        }
        if (kickError.code === "55000") {
          return NextResponse.json({ error: "This Co-Loop has already been deleted" }, { status: 410 })
        }
        if (kickError.code === "22023") {
          return NextResponse.json({ error: "Invalid collaborator" }, { status: 400 })
        }
        if (["42883", "42P01", "42703"].includes(kickError.code || "")) {
          return NextResponse.json({ error: "Co-Loop moderation is unavailable until the database migration is applied." }, { status: 503 })
        }
        return NextResponse.json({ error: "Could not remove that collaborator" }, { status: 500 })
      }

      const kickResult = (Array.isArray(kickData) ? kickData[0] : kickData) as {
        target_user_id?: string
        removed_entry?: unknown
      } | null
      if (!kickResult?.target_user_id) {
        return NextResponse.json({ error: "Collaborator removal returned an invalid result" }, { status: 500 })
      }

      // Revoke access has already committed. Delivery cleanup is best-effort.
      const { error: inviteNotificationError } = await supabase
        .from("notifications")
        .delete()
        .eq("user_id", targetId)
        .eq("type", "co_loop_invite")
        .filter("data->>session_id", "eq", sessionId)
      if (inviteNotificationError) console.warn("Kicked collaborator notification cleanup failed:", inviteNotificationError.message)

      const { error: inviteMessageError } = await supabase
        .from("messages")
        .delete()
        .eq("recipient_id", targetId)
        .eq("message_type", "co_loop_invite")
        .like("media_url", `%session=${encodeURIComponent(sessionId)}%`)
      if (inviteMessageError) console.warn("Kicked collaborator DM cleanup failed:", inviteMessageError.message)

      try {
        const channel = supabase.channel(`co-loop-studio:${sessionId}`)
        await channel.send({
          type: "broadcast",
          event: "co-author-kicked",
          payload: {
            user_id: targetId,
            by: user.user_metadata?.display_name || user.user_metadata?.username || "The host",
            participant: kickResult.removed_entry || undefined,
          },
        })
      } catch {
        // The database revoke is durable even if realtime delivery is offline.
      }

      return NextResponse.json({
        success: true,
        session_id: sessionId,
        kicked: true,
        target_user_id: targetId,
      })
    }

    const locked = action === "lock"
    const { error } = await supabase
      .from("co_loop_sessions")
      .update({
        locked,
        locked_at: locked ? new Date().toISOString() : null,
        locked_by: locked ? user.id : null,
        updated_at: new Date().toISOString(),
      })
      .eq("session_id", sessionId)

    if (error) {
      console.error("co_loop_sessions lock failed:", error.message)
      return NextResponse.json({ error: "Could not change the lock" }, { status: 500 })
    }

    return NextResponse.json({ success: true, session_id: sessionId, locked })
  } catch (error: any) {
    console.error("Co-Loop room-control error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
