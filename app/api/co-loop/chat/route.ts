import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { broadcastRealtime } from "@/lib/realtime-server"
import { canWriteCoLoopSession, checkCoLoopInvitationRevocation } from "@/lib/co-loop-session-access"

export const dynamic = "force-dynamic"

const MAX_MESSAGES = 100
const MAX_LENGTH = 1000

/** `{ "<emoji>": ["<user_id>", …] }` — same shape the community chat uses. */
type ReactionMap = Record<string, string[]>

function readReactions(value: unknown): ReactionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const map: ReactionMap = {}
  for (const [emoji, users] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(users)) map[emoji] = users.filter((id): id is string => typeof id === "string")
  }
  return map
}

/**
 * A participant is anyone who can see the room: the owner, a listed co-author,
 * or an open-invite participant. A brand-new studio has no session row yet, so
 * the first message is allowed and the row is created by the studio itself.
 */
async function isParticipant(supabase: any, sessionId: string, userId: string) {
  const { data: session } = await supabase
    .from("co_loop_sessions")
    .select("owner_id, co_authors, deleted_at, status")
    .eq("session_id", sessionId)
    .maybeSingle()

  if (!session) return { ok: false, deleted: false }
  if (session.deleted_at) return { ok: false, deleted: true }
  const revocation = await checkCoLoopInvitationRevocation(supabase, sessionId, userId)
  if (revocation.error || revocation.revoked) return { ok: false, deleted: false }
  if (session.owner_id === userId) return { ok: true, deleted: false, canWrite: canWriteCoLoopSession(session) }
  const inRoster = (Array.isArray(session.co_authors) ? session.co_authors : []).some(
    (c: any) => c?.id === userId,
  )
  if (inRoster) return { ok: true, deleted: false, canWrite: canWriteCoLoopSession(session) }

  const { data: openJoin } = await supabase
    .from("open_co_loop_participants")
    .select("id")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle()

  return { ok: Boolean(openJoin), deleted: false, canWrite: canWriteCoLoopSession(session) }
}

function shapeMessage(row: any, profile: any) {
  return {
    id: String(row.id),
    sender_id: String(row.sender_id),
    sender_name: profile?.display_name || profile?.username || "Collaborator",
    sender_avatar: profile?.avatar_url ?? null,
    sender_video_avatar_url: profile?.video_avatar_url ?? null,
    sender_is_premium: Boolean(profile?.is_premium),
    text: String(row.content || ""),
    timestamp: new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    createdAt: new Date(row.created_at).getTime(),
    reactions: readReactions(row.reactions),
  }
}

async function profileMap(supabase: any, senderIds: string[]) {
  if (!senderIds.length) return new Map<string, any>()
  const { data } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, video_avatar_url, is_premium")
    .in("id", senderIds)
  return new Map((data || []).map((p: any) => [String(p.id), p]))
}

/** GET — the room's recent chat, oldest first, so a late joiner sees history. */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get("session_id") || searchParams.get("session")
    if (!sessionId) return NextResponse.json({ error: "session_id is required" }, { status: 400 })

    const supabase = createServerClient()
    const membership = await isParticipant(supabase, sessionId, user.id)
    if (!membership.ok) {
      return NextResponse.json(
        { error: membership.deleted ? "This room has been deleted" : "You are not in this room" },
        { status: membership.deleted ? 410 : 403 },
      )
    }

    const { data, error } = await supabase
      .from("co_loop_chat_messages")
      .select("id, session_id, sender_id, content, reactions, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(MAX_MESSAGES)

    if (error) {
      // Table not migrated yet on an older deployment — degrade to live-only.
      console.warn("co_loop_chat_messages select failed:", error.message)
      return NextResponse.json({ success: true, messages: [], degraded: true })
    }

    const rows = (data || []).slice().reverse()
    const profiles = await profileMap(supabase, Array.from(new Set(rows.map((r: any) => String(r.sender_id)))))
    const messages = rows.map((row: any) => shapeMessage(row, profiles.get(String(row.sender_id))))

    return NextResponse.json({ success: true, messages })
  } catch (error: any) {
    console.error("Co-Loop chat GET error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

/** POST — send one message. Stored, then fanned out to the room. */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const sessionId = body.session_id || body.sessionId
    const content = String(body.content || "").trim().slice(0, MAX_LENGTH)

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 })
    }
    if (!content) return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 })

    const supabase = createServerClient()
    const membership = await isParticipant(supabase, sessionId, user.id)
    if (!membership.ok) {
      return NextResponse.json(
        { error: membership.deleted ? "This room has been deleted" : "You are not in this room" },
        { status: membership.deleted ? 410 : 403 },
      )
    }

    if (!membership.canWrite) {
      return NextResponse.json({ error: "This Co-Loop is no longer accepting messages" }, { status: 409 })
    }

    const { data: inserted, error } = await supabase
      .from("co_loop_chat_messages")
      .insert({ session_id: sessionId, sender_id: user.id, content })
      .select("id, session_id, sender_id, content, reactions, created_at")
      .single()

    if (error) {
      console.error("Co-Loop chat insert failed:", error)
      return NextResponse.json({ error: "Could not send that message" }, { status: 500 })
    }

    const profiles = await profileMap(supabase, [String(inserted.sender_id)])
    const message = shapeMessage(inserted, profiles.get(String(inserted.sender_id)))

    await broadcastRealtime(`co-loop-studio:${sessionId}`, "chat-msg", message)

    return NextResponse.json({ success: true, message })
  } catch (error: any) {
    console.error("Co-Loop chat POST error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

/** PATCH — toggle an emoji reaction on a room message. */
export async function PATCH(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const messageId = body.message_id || body.messageId
    const emoji = String(body.emoji || "").slice(0, 8)
    if (!messageId || !emoji) {
      return NextResponse.json({ error: "message_id and emoji are required" }, { status: 400 })
    }

    const supabase = createServerClient()
    const { data: message } = await supabase
      .from("co_loop_chat_messages")
      .select("id, session_id, reactions")
      .eq("id", messageId)
      .maybeSingle()

    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    const membership = await isParticipant(supabase, message.session_id, user.id)
    if (!membership.ok) {
      return NextResponse.json(
        { error: membership.deleted ? "This room has been deleted" : "You are not in this room" },
        { status: membership.deleted ? 410 : 403 },
      )
    }

    if (!membership.canWrite) {
      return NextResponse.json({ error: "This Co-Loop is no longer accepting reactions" }, { status: 409 })
    }

    const current = readReactions(message.reactions)
    const reactors = current[emoji] || []
    const has = reactors.includes(user.id)
    const next: ReactionMap = { ...current }
    if (has) {
      const remaining = reactors.filter((id) => id !== user.id)
      if (remaining.length) next[emoji] = remaining
      else delete next[emoji]
    } else {
      next[emoji] = [...reactors, user.id]
    }

    const { error } = await supabase
      .from("co_loop_chat_messages")
      .update({ reactions: next })
      .eq("id", messageId)

    if (error) {
      console.error("Co-Loop chat reaction failed:", error)
      return NextResponse.json({ error: "Could not save that reaction" }, { status: 500 })
    }

    await broadcastRealtime(`co-loop-studio:${message.session_id}`, "chat-reaction", {
      message_id: messageId,
      reactions: next,
      user_id: user.id,
    })

    return NextResponse.json({ success: true, reactions: next, reacted: !has })
  } catch (error: any) {
    console.error("Co-Loop chat reaction error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
