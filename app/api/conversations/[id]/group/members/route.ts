import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

function hasPermission(role: string, minRole: string): boolean {
  const hierarchy = ["member", "moderator", "admin", "owner"]
  return hierarchy.indexOf(role) >= hierarchy.indexOf(minRole)
}

function canManage(actorRole: string, targetRole: string): boolean {
  if (actorRole === "owner") return true
  if (actorRole === "admin" && targetRole !== "owner" && targetRole !== "admin") return true
  return false
}

/** POST — add members to the group */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const { data: conv } = await supabase.from("conversations").select("is_group, who_can_add_members, member_limit").eq("id", id).maybeSingle()
    if (!conv) return NextResponse.json({ error: "Not a group" }, { status: 400 })
    const convAny = conv as any
    if (!convAny.is_group) return NextResponse.json({ error: "Not a group" }, { status: 400 })

    // Check permission to add members
    if (convAny.who_can_add_members === "admins" && !hasPermission(membership.role, "admin")) {
      return NextResponse.json({ error: "Only admins can add members" }, { status: 403 })
    }

    const body = await request.json()
    const { user_ids } = body
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return NextResponse.json({ error: "user_ids array required" }, { status: 400 })
    }

    // Check member limit
    const { count: currentCount } = await supabase
      .from("conversation_participants")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", id)
      .is("left_at", null)
    if ((currentCount || 0) + user_ids.length > (convAny.member_limit || 100)) {
      return NextResponse.json({ error: `Group is limited to ${convAny.member_limit} members` }, { status: 400 })
    }

    // Filter out already members
    const { data: existingMembers } = await supabase
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", id)
      .in("user_id", user_ids)
      .is("left_at", null)
    const existingIds = new Set((existingMembers || []).map((m) => m.user_id))
    const newUserIds = user_ids.filter((uid: string) => uid !== user.id && !existingIds.has(uid))

    if (newUserIds.length === 0) {
      return NextResponse.json({ error: "All users are already members" }, { status: 400 })
    }

    // Add members
    const { error } = await supabase.from("conversation_participants").insert(
      newUserIds.map((uid: string) => ({
        conversation_id: id,
        user_id: uid,
        role: "member",
        joined_at: new Date().toISOString(),
      })),
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // System messages for each added user
    const profiles = await supabase.from("profiles").select("id, username, display_name").in("id", newUserIds)
    const profileMap = new Map((profiles.data || []).map((p) => [p.id, p]))

    for (const uid of newUserIds) {
      const profile = profileMap.get(uid)
      const name = profile?.display_name || profile?.username || "Someone"
      await supabase.from("messages").insert({
        conversation_id: id,
        author_id: user.id,
        sender_id: user.id,
        content: `${name} was added to the group`,
        message_type: "system",
        system_event: "member_joined",
        system_metadata: { actor_id: user.id, target_id: uid },
      })
    }

    return NextResponse.json({ success: true, added: newUserIds.length })
  } catch (error: any) {
    console.error("[group-members] POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** PATCH — promote or demote a member */
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
    const { user_id: targetUserId, role: newRole, permissions } = body
    if (!targetUserId || !newRole) return NextResponse.json({ error: "user_id and role required" }, { status: 400 })

    const validRoles = ["member", "moderator", "admin"]
    if (!validRoles.includes(newRole)) return NextResponse.json({ error: "Invalid role" }, { status: 400 })

    // Get target's current role
    const { data: target } = await supabase
      .from("conversation_participants")
      .select("role")
      .eq("conversation_id", id)
      .eq("user_id", targetUserId)
      .is("left_at", null)
      .maybeSingle()
    if (!target) return NextResponse.json({ error: "Target not a member" }, { status: 404 })

    // Permission check
    if (!canManage(membership.role, target.role)) {
      return NextResponse.json({ error: "Cannot change this member's role" }, { status: 403 })
    }

    // Only owner can promote to admin
    if (newRole === "admin" && membership.role !== "owner") {
      return NextResponse.json({ error: "Only the group creator can promote to admin" }, { status: 403 })
    }

    const updates: Record<string, any> = { role: newRole }
    // Moderator granular permissions
    if (newRole === "moderator" && permissions && typeof permissions === "object") {
      updates.can_delete_messages = Boolean(permissions.can_delete_messages)
      updates.can_mute_members = Boolean(permissions.can_mute_members)
      updates.can_pin_messages = Boolean(permissions.can_pin_messages)
    }
    // Admins get all permissions by default
    if (newRole === "admin") {
      updates.can_delete_messages = true
      updates.can_mute_members = true
      updates.can_pin_messages = true
      updates.can_manage_settings = true
    }
    // Members lose special permissions
    if (newRole === "member") {
      updates.can_delete_messages = false
      updates.can_mute_members = false
      updates.can_pin_messages = false
      updates.can_manage_settings = false
    }

    const { error } = await supabase
      .from("conversation_participants")
      .update(updates)
      .eq("conversation_id", id)
      .eq("user_id", targetUserId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // System message
    const { data: targetProfile } = await supabase.from("profiles").select("display_name, username").eq("id", targetUserId).maybeSingle()
    const targetName = targetProfile?.display_name || targetProfile?.username || "Someone"
    await supabase.from("messages").insert({
      conversation_id: id,
      author_id: user.id,
      sender_id: user.id,
      content: `${targetName} is now ${newRole === "admin" ? "an admin" : newRole === "moderator" ? "a moderator" : "a regular member"}`,
      message_type: "system",
      system_event: "member_promoted",
      system_metadata: { actor_id: user.id, target_id: targetUserId, new_value: newRole },
    })

    return NextResponse.json({ success: true, role: newRole })
  } catch (error: any) {
    console.error("[group-members] PATCH error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** DELETE — remove a member or leave the group */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const targetUserId = typeof body.user_id === "string" ? body.user_id : user.id

    // Self-leave
    if (targetUserId === user.id) {
      if (membership.role === "owner") {
        return NextResponse.json({ error: "The group creator cannot leave. Transfer ownership or delete the group." }, { status: 400 })
      }
      const { error } = await supabase
        .from("conversation_participants")
        .update({ left_at: new Date().toISOString() })
        .eq("conversation_id", id)
        .eq("user_id", user.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      await supabase.from("messages").insert({
        conversation_id: id,
        author_id: user.id,
        sender_id: user.id,
        content: "left the group",
        message_type: "system",
        system_event: "member_left",
        system_metadata: { actor_id: user.id },
      })

      return NextResponse.json({ success: true })
    }

    // Admin/mod removing someone else
    const { data: target } = await supabase
      .from("conversation_participants")
      .select("role")
      .eq("conversation_id", id)
      .eq("user_id", targetUserId)
      .is("left_at", null)
      .maybeSingle()
    if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 })

    if (!canManage(membership.role, target.role)) {
      return NextResponse.json({ error: "Cannot remove this member" }, { status: 403 })
    }

    // Can only remove if you have admin+ permissions
    if (!hasPermission(membership.role, "admin")) {
      return NextResponse.json({ error: "Only admins can remove members" }, { status: 403 })
    }

    const { error } = await supabase
      .from("conversation_participants")
      .update({ left_at: new Date().toISOString() })
      .eq("conversation_id", id)
      .eq("user_id", targetUserId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: targetProfile } = await supabase.from("profiles").select("display_name, username").eq("id", targetUserId).maybeSingle()
    const targetName = targetProfile?.display_name || targetProfile?.username || "Someone"
    await supabase.from("messages").insert({
      conversation_id: id,
      author_id: user.id,
      sender_id: user.id,
      content: `${targetName} was removed from the group`,
      message_type: "system",
      system_event: "member_removed",
      system_metadata: { actor_id: user.id, target_id: targetUserId },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[group-members] DELETE error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
