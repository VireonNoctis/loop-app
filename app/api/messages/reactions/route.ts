import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { broadcastRealtime } from "@/lib/realtime-server"

export const dynamic = "force-dynamic"

const getUser = getUserFromRequest

interface GroupedReaction {
  emoji: string
  count: number
  users: string[]
}

function groupRows(rows: Array<{ emoji: string | null; user_id: string | null }>): GroupedReaction[] {
  const perEmoji = new Map<string, string[]>()
  for (const row of rows) {
    if (!row?.emoji || !row.user_id) continue
    const users = perEmoji.get(row.emoji) || []
    if (!users.includes(row.user_id)) users.push(row.user_id)
    perEmoji.set(row.emoji, users)
  }
  return Array.from(perEmoji.entries()).map(([emoji, users]) => ({
    emoji,
    count: users.length,
    users,
  }))
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const messageId = request.nextUrl.searchParams.get("message_id")
    if (!messageId) return NextResponse.json({ error: "message_id required" }, { status: 400 })

    const supabase = createServerClient()
    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select("id, conversation_id, reactions")
      .eq("id", messageId)
      .maybeSingle()

    if (messageError) return NextResponse.json({ error: "Could not load message" }, { status: 500 })
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    const { data: membership, error: membershipError } = await supabase
      .from("conversation_participants")
      .select("id")
      .eq("conversation_id", message.conversation_id)
      .eq("user_id", user.id)
      .is("left_at", null)
      .maybeSingle()

    if (membershipError) return NextResponse.json({ error: "Could not verify conversation access" }, { status: 500 })
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Prefer dedicated table; fall back to reactions JSON on message
    const { data: rows, error } = await supabase
      .from("message_reactions")
      .select("emoji, user_id, created_at")
      .eq("message_id", messageId)

    if (!error) {
      const grouped = groupRows(rows || []).map((reaction) => ({
        ...reaction,
        reacted: reaction.users.includes(user.id),
      }))
      return NextResponse.json({ success: true, reactions: grouped })
    }

    const raw = Array.isArray(message.reactions) ? message.reactions : []
    return NextResponse.json({ success: true, reactions: raw })
  } catch (error) {
    console.error("Message reactions GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const messageId = typeof body.message_id === "string" ? body.message_id : ""
    const emoji = String(body.emoji || "").trim().slice(0, 8)
    const action = body.action === "remove" ? "remove" : "add"

    if (!messageId || !emoji) {
      return NextResponse.json({ error: "Message ID and emoji are required" }, { status: 400 })
    }

    const supabase = createServerClient()
    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select("id, conversation_id, reactions")
      .eq("id", messageId)
      .maybeSingle()

    if (messageError) return NextResponse.json({ error: "Could not load message" }, { status: 500 })
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 })

    const { data: membership, error: membershipError } = await supabase
      .from("conversation_participants")
      .select("id")
      .eq("conversation_id", message.conversation_id)
      .eq("user_id", user.id)
      .is("left_at", null)
      .maybeSingle()

    if (membershipError) return NextResponse.json({ error: "Could not verify conversation access" }, { status: 500 })
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    let reactions: GroupedReaction[] | null = null

    // Try dedicated table first
    if (action === "add") {
      const { error } = await supabase.from("message_reactions").upsert(
        {
          message_id: messageId,
          user_id: user.id,
          emoji,
          created_at: new Date().toISOString(),
        },
        { onConflict: "message_id,user_id,emoji" },
      )
      if (error) console.warn("message_reactions insert:", error.message)
    } else {
      const { error } = await supabase
        .from("message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", user.id)
        .eq("emoji", emoji)
      if (error) console.warn("message_reactions delete:", error.message)
    }

    // Re-read the table so the response (and the mirror) is the real state,
    // not an optimistic guess.
    const { data: rows, error: readError } = await supabase
      .from("message_reactions")
      .select("emoji, user_id")
      .eq("message_id", messageId)

    if (!readError) {
      reactions = groupRows(rows || [])
    } else {
      // JSONB fallback on messages.reactions
      const current: GroupedReaction[] = Array.isArray(message.reactions) ? [...message.reactions] : []
      const idx = current.findIndex((r: any) => r.emoji === emoji)
      if (action === "add") {
        if (idx >= 0) {
          const users = Array.from(new Set<string>([...(current[idx].users || []), user.id]))
          current[idx] = { emoji, count: users.length, users }
        } else {
          current.push({ emoji, count: 1, users: [user.id] })
        }
      } else if (idx >= 0) {
        const users = (current[idx].users || []).filter((id: string) => id !== user.id)
        if (users.length) current[idx] = { emoji, count: users.length, users }
        else current.splice(idx, 1)
      }
      reactions = current
    }

    // Mirror the grouped counts so readers using the legacy column agree.
    const mirror = await supabase.from("messages").update({ reactions }).eq("id", messageId)
    if (mirror.error) console.warn("message reaction mirror:", mirror.error.message)

    await broadcastRealtime(`conversation:${message.conversation_id}`, "reaction", {
      message_id: messageId,
      emoji,
      action,
      user_id: user.id,
      reactions,
    })

    return NextResponse.json({
      success: true,
      message: action === "add" ? "Reaction added" : "Reaction removed",
      reactions,
    })
  } catch (error) {
    console.error("Message reaction error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
