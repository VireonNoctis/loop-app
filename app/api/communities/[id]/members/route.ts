import { type NextRequest, NextResponse } from "next/server"
import { communityClient, logCommunityActivity, computeReputation, canModerate, canAdmin, isOwnerRole } from "@/lib/community-engine"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"

const RECOGNITION_KINDS = [
  { kind: "knowledge_keeper", label: "🧠 Knowledge Keeper", message: "For sharing knowledge that sticks." },
  { kind: "creator", label: "🎨 Creator", message: "For outstanding creative work." },
  { kind: "connector", label: "🤝 Connector", message: "For bringing people together." },
  { kind: "conversation_starter", label: "💬 Conversation Starter", message: "For sparking great discussions." },
  { kind: "organizer", label: "🧭 Organizer", message: "For organizing events and activities." },
  { kind: "top_contributor", label: "🔥 Top Contributor", message: "For exceptional overall contribution." },
]

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await checkCirclePrivateAccess(id, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }
    const user = await getUserFromRequest(request)
    const sb = communityClient()
    const { searchParams } = new URL(request.url)
    const roleFilter = searchParams.get("role")
    const search = searchParams.get("search")
    const requestedLimit = Number.parseInt(searchParams.get("limit") || "50")
    const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50

    let query = sb
      .from("circle_members")
      .select(`
        id, circle_id, user_id, role, status, custom_title, joined_at, contribution_score,
        user:profiles!user_id(id, username, display_name, avatar_url, is_verified)
      `)
      .eq("circle_id", id)
      .in("status", ["active", "approved"])
      .order("joined_at", { ascending: false })
      .limit(limit)

    if (roleFilter) query = query.eq("role", roleFilter)
    if (search) {
      const safeSearch = String(search).slice(0, 40).replace(/[^\p{L}\p{N}\s_-]/gu, "")
      if (!safeSearch.trim()) return NextResponse.json({ members: [] })
      const { data: matchedProfiles } = await sb
        .from("profiles")
        .select("id")
        .or(`username.ilike.%${safeSearch}%,display_name.ilike.%${safeSearch}%`)
        .limit(20)
      const ids = (matchedProfiles || []).map((p) => p.id)
      if (ids.length === 0) return NextResponse.json({ members: [] })
      query = query.in("user_id", ids)
    }

    const { data: members, error } = await query
    if (error) return NextResponse.json({ error: "Failed to load members" }, { status: 500 })

    // Resolve gradient role colors: custom_roles definitions matched by the
    // member's custom_title, falling back to staff default gradients.
    const STAFF_GRADIENTS: Record<string, string> = {
      owner: "linear-gradient(90deg, #f59e0b, #ef4444)",
      admin: "linear-gradient(90deg, #8b5cf6, #ec4899)",
      moderator: "linear-gradient(90deg, #10b981, #14b8a6)",
    }
    const { data: circleRow } = await sb.from("circles").select("custom_roles").eq("id", id).maybeSingle()
    const customRoles = Array.isArray((circleRow as any)?.custom_roles) ? (circleRow as any).custom_roles : []

    // Recognition counts (no FK from circle_members, count separately)
    const recMap = new Map<string, number>()
    if (members && members.length > 0) {
      const { data: recs } = await sb
        .from("community_recognitions")
        .select("receiver_id")
        .eq("circle_id", id)
        .limit(2000)
      for (const r of recs || []) recMap.set(String(r.receiver_id), (recMap.get(String(r.receiver_id)) || 0) + 1)
    }

    const enriched = (members || []).map((m: any) => ({
      ...m,
      recognition_count: recMap.get(String(m.user_id)) || 0,
      role_gradient: customRoles.find((cr: any) => cr?.name && cr.name === m.custom_title)?.gradient || STAFF_GRADIENTS[m.role] || null,
    }))

    return NextResponse.json({ members: enriched, custom_roles: customRoles })
  } catch (e: any) {
    console.error("[members] GET error:", e)
    return NextResponse.json({ error: e.message || "Failed to load members" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await getUserFromRequest(request)
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sb = communityClient()

    const { data: actorMembership, error: actorMembershipError } = await sb
      .from("circle_members")
      .select("role, status")
      .eq("circle_id", id)
      .eq("user_id", actor.id)
      .maybeSingle()
    if (actorMembershipError) return NextResponse.json({ error: "Could not verify Circle membership" }, { status: 503 })
    if (!actorMembership || !["active", "approved"].includes(String(actorMembership.status || ""))) {
      return NextResponse.json({ error: "Active Circle membership is required" }, { status: 403 })
    }
    const actorRole = actorMembership.role

    const body = await request.json()
    const { user_id, role, status, is_muted, muted_until, custom_title } = body
    if (!user_id) return NextResponse.json({ error: "Missing member" }, { status: 400 })

    const { data: target } = await sb.from("circle_members").select("role, user_id, status").eq("circle_id", id).eq("user_id", user_id).maybeSingle()
    if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 })

    // Join-request handling: moderators can approve pending requests; only
    // admins/owner can reject (delete) a pending member. Server-side only —
    // the UI never decides who gets in.
    if (status && status !== target.status) {
      if (status === "active" || status === "rejected") {
        if (!canModerate(actorRole)) {
          return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
        }
        if (status === "rejected" && !canAdmin(actorRole)) {
          return NextResponse.json({ error: "Only admins can reject join requests" }, { status: 403 })
        }
        if (status === "active") {
          const { error } = await sb
            .from("circle_members")
            .update({ status: "active", joined_at: new Date().toISOString() })
            .eq("circle_id", id)
            .eq("user_id", user_id)
          if (error) return NextResponse.json({ error: "Failed to approve member" }, { status: 500 })
          await logCommunityActivity(sb, id, actor.id, "join_request_approved", "member", user_id)
          return NextResponse.json({ success: true, status: "active" })
        }
        const { error: delError } = await sb.from("circle_members").delete().eq("circle_id", id).eq("user_id", user_id)
        if (delError) return NextResponse.json({ error: "Failed to reject request" }, { status: 500 })
        await logCommunityActivity(sb, id, actor.id, "join_request_rejected", "member", user_id)
        return NextResponse.json({ success: true, status: "rejected" })
      }
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }

    // Mute / unmute a member (moderators+). Muted members can't post or chat
    // until muted_until passes (null = indefinite).
    if (is_muted !== undefined) {
      if (!canModerate(actorRole)) {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
      }
      if (target.user_id === actor.id) {
        return NextResponse.json({ error: "You can't mute yourself" }, { status: 400 })
      }
      if (isOwnerRole(target.role) && !isOwnerRole(actorRole)) {
        return NextResponse.json({ error: "You can't mute the founder" }, { status: 403 })
      }
      const muteValue = Boolean(is_muted)
      const untilValue = muteValue ? (muted_until ? new Date(muted_until).toISOString() : null) : null
      const { error } = await sb
        .from("circle_members")
        .update({ is_muted: muteValue, muted_until: untilValue })
        .eq("circle_id", id)
        .eq("user_id", user_id)
      if (error) return NextResponse.json({ error: "Failed to update mute state" }, { status: 500 })
      await logCommunityActivity(sb, id, actor.id, muteValue ? "member_muted" : "member_unmuted", "member", user_id)
      return NextResponse.json({ success: true, is_muted: muteValue, muted_until: untilValue })
    }

    // Custom role assignment: admins/owner assign one of the community's
    // defined roles (Settings → Roles) or a short freeform label. Defined
    // roles render with their gradient everywhere; freeform labels render
    // neutral.
    if (custom_title !== undefined) {
      if (!canAdmin(actorRole)) {
        return NextResponse.json({ error: "Only admins can assign custom roles" }, { status: 403 })
      }
      if (isOwnerRole(target.role) && !isOwnerRole(actorRole)) {
        return NextResponse.json({ error: "You can't change the founder's role" }, { status: 403 })
      }
      const { data: circleRow } = await sb.from("circles").select("custom_roles").eq("id", id).maybeSingle()
      const customRoles = Array.isArray((circleRow as any)?.custom_roles) ? (circleRow as any).custom_roles : []
      const title = String(custom_title || "").trim().slice(0, 40)
      const known = customRoles.find((cr: any) => cr?.name && cr.name === title)
      const { error } = await sb
        .from("circle_members")
        .update({ custom_title: title || null })
        .eq("circle_id", id)
        .eq("user_id", user_id)
      if (error) return NextResponse.json({ error: "Failed to assign role" }, { status: 500 })
      await logCommunityActivity(sb, id, actor.id, "member_custom_role_changed", "member", user_id, {
        title: title || null,
        is_defined_role: Boolean(known),
      })
      return NextResponse.json({ success: true, custom_title: title || null, gradient: known?.gradient || null })
    }

    // Role changes: owner only for owner/admin changes; admins can promote to moderator
    if (role && role !== target.role) {
      if (!isOwnerRole(actorRole)) {
        if (role === "admin" || role === "owner") return NextResponse.json({ error: "Only the founder can assign that role" }, { status: 403 })
        if (!canAdmin(actorRole)) return NextResponse.json({ error: "Only admins can change roles" }, { status: 403 })
      }
      if (isOwnerRole(target.role) && !isOwnerRole(actorRole)) {
        return NextResponse.json({ error: "You can't change the founder's role" }, { status: 403 })
      }

      const { error } = await sb.from("circle_members").update({ role }).eq("circle_id", id).eq("user_id", user_id)
      if (error) return NextResponse.json({ error: "Failed to update role" }, { status: 500 })
      await logCommunityActivity(sb, id, actor.id, "member_role_changed", "member", user_id, { from: target.role, to: role })
      return NextResponse.json({ success: true, role })
    }

    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  } catch (e: any) {
    console.error("[members] PATCH error:", e)
    return NextResponse.json({ error: e.message || "Failed to update member" }, { status: 500 })
  }
}

/**
 * DELETE — remove (kick) a member. Moderators can remove regular members;
 * admins+ can remove moderators; only the founder can remove other admins.
 * Body: { user_id }
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await getUserFromRequest(request)
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sb = communityClient()

    const { data: actorMembership, error: actorMembershipError } = await sb
      .from("circle_members")
      .select("role, status")
      .eq("circle_id", id)
      .eq("user_id", actor.id)
      .maybeSingle()
    if (actorMembershipError) return NextResponse.json({ error: "Could not verify Circle membership" }, { status: 503 })
    if (!actorMembership || !["active", "approved"].includes(String(actorMembership.status || ""))) {
      return NextResponse.json({ error: "Active Circle membership is required" }, { status: 403 })
    }
    const actorRole = actorMembership.role
    if (!canModerate(actorRole)) {
      return NextResponse.json({ error: "Only moderators and admins can remove members" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const { user_id } = body
    if (!user_id) return NextResponse.json({ error: "Missing member" }, { status: 400 })
    if (user_id === actor.id) return NextResponse.json({ error: "Leave the community instead" }, { status: 400 })

    const { data: target } = await sb.from("circle_members").select("role, user_id").eq("circle_id", id).eq("user_id", user_id).maybeSingle()
    if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 })
    if (isOwnerRole(target.role)) {
      return NextResponse.json({ error: "The founder can't be removed" }, { status: 403 })
    }
    if (canAdmin(target.role) && !isOwnerRole(actorRole)) {
      return NextResponse.json({ error: "Only the founder can remove an admin" }, { status: 403 })
    }
    if (target.role === "moderator" && !canAdmin(actorRole)) {
      return NextResponse.json({ error: "Only admins can remove a moderator" }, { status: 403 })
    }

    const { error } = await sb.from("circle_members").delete().eq("circle_id", id).eq("user_id", user_id)
    if (error) return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })
    await logCommunityActivity(sb, id, actor.id, "member_removed", "member", user_id, { by_role: actorRole })

    // Best-effort notification so the removed member isn't left guessing
    try {
      const { notifyUser } = await import("@/lib/notifications")
      const { data: circleRow } = await sb.from("circles").select("name").eq("id", id).maybeSingle()
      await notifyUser(sb, {
        userId: user_id,
        type: "system",
        title: "Removed from community",
        message: `You were removed from ${circleRow?.name || "a community"}.`,
        actionUrl: `/communities`,
        inAppOnly: true,
      })
    } catch { /* best-effort */ }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error("[members] DELETE error:", e)
    return NextResponse.json({ error: e.message || "Failed to remove member" }, { status: 500 })
  }
}

/** Give a recognition badge (POST { user_id, kind, message? }) */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await getUserFromRequest(request)
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sb = communityClient()

    const { data: actorMembership, error: actorMembershipError } = await sb.from("circle_members").select("role, status").eq("circle_id", id).eq("user_id", actor.id).maybeSingle()
    if (actorMembershipError) return NextResponse.json({ error: "Could not verify Circle membership" }, { status: 503 })
    if (!actorMembership || !["active", "approved"].includes(String(actorMembership.status || ""))) {
      return NextResponse.json({ error: "Join the community first" }, { status: 403 })
    }

    const body = await request.json()
    const { user_id, kind, message = "" } = body
    if (!user_id) return NextResponse.json({ error: "Missing member" }, { status: 400 })
    if (user_id === actor.id) return NextResponse.json({ error: "You can't recognize yourself" }, { status: 400 })

    const def = RECOGNITION_KINDS.find((k) => k.kind === kind)
    if (!def && !canModerate(actorMembership?.role)) {
      return NextResponse.json({ error: "Unknown recognition" }, { status: 400 })
    }

    const { data: target } = await sb.from("circle_members").select("id, status").eq("circle_id", id).eq("user_id", user_id).maybeSingle()
    if (!target || !["active", "approved"].includes(String(target.status || ""))) {
      return NextResponse.json({ error: "Active member not found" }, { status: 404 })
    }

    const { data: recognition, error } = await sb
      .from("community_recognitions")
      .insert({
        circle_id: id,
        giver_id: actor.id,
        receiver_id: user_id,
        kind: def?.kind || kind,
        label: def?.label || body.label || kind,
        message: message.slice(0, 300),
      })
      .select()
      .single()

    if (error || !recognition) return NextResponse.json({ error: "Failed to recognize member" }, { status: 500 })
    await logCommunityActivity(sb, id, actor.id, "recognition_given", "member", user_id, { kind: recognition.kind })

    // Slight contribution bump for the receiver
    await sb.from("circle_members").update({ contribution_score: (target as any).contribution_score || 0 }).eq("id", target.id)
    const { data: targetFull } = await sb.from("circle_members").select("contribution_score").eq("id", target.id).maybeSingle()
    await sb.from("circle_members").update({ contribution_score: (targetFull?.contribution_score || 0) + 5 }).eq("id", target.id)

    return NextResponse.json({ recognition }, { status: 201 })
  } catch (e: any) {
    console.error("[members] POST error:", e)
    return NextResponse.json({ error: e.message || "Failed to recognize member" }, { status: 500 })
  }
}