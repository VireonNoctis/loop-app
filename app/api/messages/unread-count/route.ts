import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const user = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json({ success: true, count: 0 })
    }

    // Get conversation IDs where user is active participant
    const { data: memberships } = await supabase
      .from("conversation_participants")
      .select("conversation_id, last_read_at")
      .eq("user_id", user.id)
      .is("left_at", null)

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ success: true, count: 0 })
    }

    const conversationIds = memberships.map((m) => m.conversation_id)

    // Count unread messages (sender != user.id and is_read = false, or created_at > last_read_at)
    const { count, error } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("conversation_id", conversationIds)
      .neq("sender_id", user.id)
      .neq("author_id", user.id)
      .eq("is_read", false)

    if (error) {
      // Fallback: query without is_read filter if column doesn't exist yet
      const { count: fallbackCount } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .in("conversation_id", conversationIds)
        .neq("sender_id", user.id)
      
      return NextResponse.json({ success: true, count: fallbackCount || 0 })
    }

    return NextResponse.json({ success: true, count: count || 0 })
  } catch (error) {
    console.error("Error getting unread count:", error)
    return NextResponse.json({ success: true, count: 0 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const conversationId =
      typeof body?.conversation_id === "string" ? body.conversation_id : ""

    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id is required" }, { status: 400 })
    }

    const { data: membership, error: membershipError } = await supabase
      .from("conversation_participants")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .is("left_at", null)
      .maybeSingle()

    if (membershipError) {
      console.error("Conversation read permission lookup failed:", membershipError)
      return NextResponse.json({ error: "Could not verify conversation access" }, { status: 500 })
    }
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const readAt = new Date().toISOString()
    const { error: markReadError } = await supabase
      .from("messages")
      .update({ is_read: true })
      .eq("conversation_id", conversationId)
      .neq("sender_id", user.id)
      .neq("author_id", user.id)

    if (markReadError) {
      console.error("Mark messages read failed:", markReadError)
      return NextResponse.json({ error: "Could not mark messages as read" }, { status: 500 })
    }

    const { error: participantUpdateError } = await supabase
      .from("conversation_participants")
      .update({ last_read_at: readAt })
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .is("left_at", null)

    if (participantUpdateError) {
      console.error("Update last-read timestamp failed:", participantUpdateError)
      return NextResponse.json({ error: "Could not update read status" }, { status: 500 })
    }

    // Tell the sender live that this user just read the conversation — so
      // double-ticks flip even when the reader isn't inside the chat (e.g.
      // they opened it from a notification or a second device).
    try {
      await supabase.channel(`conversation:${conversationId}`).send({
          type: "broadcast",
          event: "read",
        payload: { user_id: user.id, read_at: readAt },
      })
    } catch { /* intentionally silent */ }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: "Failed marking read" }, { status: 500 })
  }
}
