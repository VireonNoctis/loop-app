import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

/** Helper: check if user is a member with a given role or higher */
function hasPermission(role: string, minRole: string): boolean {
  const hierarchy = ["member", "moderator", "admin", "owner"]
  return hierarchy.indexOf(role) >= hierarchy.indexOf(minRole)
}

/** GET — group info + settings + pinned messages + members */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    const supabase = createServerClient()

    // Verify membership
    const { data: membership } = await supabase
      .from("conversation_participants")
      .select("role")
      .eq("conversation_id", id)
      .eq("user_id", user.id)
      .is("left_at", null)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 })

    // Get conversation
    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", id)
      .maybeSingle()
    if (convErr || !conv) return NextResponse.json({ error: "Group not found" }, { status: 404 })
    if (!conv.is_group) return NextResponse.json({ error: "Not a group" }, { status: 400 })

    // Get all members with profiles
    const { data: members } = await supabase
      .from("conversation_participants")
      .select(`
        id, user_id, role, joined_at, left_at, is_muted,
        can_delete_messages, can_mute_members, can_pin_messages, can_manage_settings,
        user:profiles!conversation_participants_user_id_fkey(
          id, username, display_name, avatar_url, is_verified, is_premium
        )
      `)
      .eq("conversation_id", id)
      .is("left_at", null)
      .order("role", { ascending: true }) // owner first

    // Get pinned messages
    const { data: pinnedMessages } = await supabase
      .from("messages")
      .select("id, content, author_id, created_at, message_type")
      .eq("conversation_id", id)
      .eq("is_pinned", true)
      .order("pinned_at", { ascending: false })
      .limit(10)

    // Count total members
    const { count: memberCount } = await supabase
      .from("conversation_participants")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", id)
      .is("left_at", null)

    return NextResponse.json({
      success: true,
      conversation: conv,
      members: members || [],
      member_count: memberCount || 0,
      pinned_messages: pinnedMessages || [],
      my_role: membership.role,
    })
  } catch (error: any) {
    console.error("[group] GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** PATCH — update group settings (name, avatar, description, topic, lock, who_can_send, who_can_add_members, member_limit) */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    const supabase = createServerClient()

    const { data: membership } = await supabase
      .from("conversation_participants")
      .select("role")
      .eq("conversation_id", id)
      .eq("user_id", user.id)
      .is("left_at", null)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 })

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("is_group")
      .eq("id", id)
      .maybeSingle()
    if (conversationError) {
      return NextResponse.json({ error: "Could not verify group conversation" }, { status: 500 })
    }
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
    if (!conversation.is_group) return NextResponse.json({ error: "Not a group" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const updates: Record<string, any> = {}

    // Admin/owner can update most settings
    if (hasPermission(membership.role, "admin")) {
      if (body.name !== undefined) updates.name = String(body.name).trim().slice(0, 100) || null
      if (body.avatar_url !== undefined) updates.avatar_url = body.avatar_url || null
      if (body.description !== undefined) updates.description = String(body.description).trim().slice(0, 500) || null
      if (body.topic !== undefined) updates.topic = String(body.topic).trim().slice(0, 100) || null
      if (body.who_can_send !== undefined) updates.who_can_send = body.who_can_send
      if (body.who_can_add_members !== undefined) updates.who_can_add_members = body.who_can_add_members
      if (body.member_limit !== undefined) {
        const limit = Math.min(Math.max(Number(body.member_limit) || 2, 2), 100)
        updates.member_limit = limit
      }
    }

    // Lock/unlock — only owner
    if (body.is_locked !== undefined) {
      if (!hasPermission(membership.role, "owner")) {
        return NextResponse.json({ error: "Only the group creator can lock/unlock" }, { status: 403 })
      }
      updates.is_locked = Boolean(body.is_locked)
      updates.locked_by = body.is_locked ? user.id : null

      // System message for lock/unlock
      await supabase.from("messages").insert({
        conversation_id: id,
        author_id: user.id,
        sender_id: user.id,
        content: body.is_locked ? "Group chat has been locked" : "Group chat has been unlocked",
        message_type: "system",
        system_event: body.is_locked ? "group_locked" : "group_unlocked",
        system_metadata: { actor_id: user.id },
      })
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }
    updates.updated_at = new Date().toISOString()

    const { error } = await supabase.from("conversations").update(updates).eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // System message for name change
    if (body.name && hasPermission(membership.role, "admin")) {
      await supabase.from("messages").insert({
        conversation_id: id,
        author_id: user.id,
        sender_id: user.id,
        content: `Group name changed to "${body.name}"`,
        message_type: "system",
        system_event: "name_changed",
        system_metadata: { actor_id: user.id, new_value: body.name },
      })
    }

    return NextResponse.json({ success: true, updates })
  } catch (error: any) {
    console.error("[group] PATCH error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
