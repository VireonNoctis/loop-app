import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { requireAdmin } from "@/lib/server-auth"
import { resolveStaffRole } from "@/lib/staff-roles"
import { maskAdminCopy } from "@/lib/notification-copy"
import { deleteAccountAsAdmin } from "@/lib/admin-delete-account"

export const dynamic = "force-dynamic"

/**
 * Admin-initiated changes are delivered to the user as plain platform events —
 * "You received 100 Loop Coins", not "An admin gave you 100 coins". Nothing in
 * the copy (or the notification payload) should expose manual intervention.
 */
function userFacingNotice(
  action: string,
  body: Record<string, unknown>,
  updated: Record<string, unknown> | null,
): { type: string; title: string; message: string } {
  const amount = Math.max(0, Number(body?.amount) || 0)
  switch (action) {
    case "add_coins":
      return {
        type: "coin_reward",
        title: "You received Loop Coins",
        message: `You received ${amount.toLocaleString()} Loop Coins — spend them in the shop or send a gift.`,
      }
    case "grant_premium": {
      const until = updated?.premium_expires_at
      return {
        type: "pro_grant",
        title: "Loop Pro unlocked",
        message: until
          ? `Your Loop Pro membership is active until ${new Date(String(until)).toLocaleDateString()}.`
          : "Your Loop Pro membership is now active.",
      }
    }
    case "revoke_premium":
      return {
        type: "system",
        title: "Loop Pro membership ended",
        message: "Your Loop Pro membership has ended. You can resubscribe any time.",
      }
    case "ban":
      return {
        type: "system",
        title: "Account suspended",
        message: maskAdminCopy(
          body?.reason
            ? `Your account was suspended for violating the community guidelines. Reason: ${String(body.reason)}`
            : "Your account was suspended for violating the community guidelines.",
        ),
      }
    case "unban":
      return {
        type: "system",
        title: "Account restored",
        message: "Your account is active again. Welcome back.",
      }
    case "make_admin":
    case "remove_admin":
      return {
        type: "system",
        title: "Account permissions updated",
        message: "Your account permissions were updated.",
      }
    default:
      return { type: "system", title: "Account updated", message: "Your account was updated." }
  }
}

export async function GET(request: NextRequest) {
  try {
    const { response } = await requireAdmin(request)
    if (response) return response
    const supabase = createServerClient()
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get("q") || "").trim()
    const filter = searchParams.get("filter") || "all"
    const limit = Number.parseInt(searchParams.get("limit") || "40")

    // Deleted accounts survive as masked rows for FK integrity; an admin list
    // is the one place they must never show up again.
    let query = supabase
      .from("profiles")
      .select(
        "id, username, display_name, avatar_url, email, is_verified, is_team_member, is_sponsor, is_premium, is_admin, is_banned, ban_reason, premium_expires_at, loop_coins, created_at, last_active",
      )
      .is("deletion_executed_at", null)
      .not("is_deleted", "is", true)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (q) query = query.or(`username.ilike.%${q}%,display_name.ilike.%${q}%,email.ilike.%${q}%`)
    if (filter === "verified") query = query.eq("is_verified", true)
    if (filter === "premium") query = query.eq("is_premium", true)
    if (filter === "admin") query = query.eq("is_admin", true)
    if (filter === "unverified") query = query.eq("is_verified", false)
    if (filter === "banned") query = query.eq("is_banned", true)

    const { data: users, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const liveProfiles = () => {
      const q = supabase.from("profiles").select("id", { count: "exact" as const, head: true })
      return q.is("deletion_executed_at", null).not("is_deleted", "is", true)
    }
    const { count: totalUsers } = await liveProfiles()
    const { count: verifiedCount } = await liveProfiles().eq("is_verified", true)
    const { count: premiumCount } = await liveProfiles().eq("is_premium", true)
    const { count: bannedCount } = await liveProfiles().eq("is_banned", true)

    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const { count: newThisWeek } = await liveProfiles().gte("created_at", weekAgo)

    return NextResponse.json({
      success: true,
      users: users || [],
      stats: {
        total_users: totalUsers || 0,
        verified: verifiedCount || 0,
        premium: premiumCount || 0,
        banned: bannedCount || 0,
        new_this_week: newThisWeek || 0,
      },
    })
  } catch (error) {
    console.error("Admin users GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

const USER_FIELDS =
  "id, username, display_name, avatar_url, email, is_verified, is_team_member, is_sponsor, is_premium, is_admin, is_banned, ban_reason, premium_expires_at, loop_coins, created_at, last_active"

export async function POST(request: NextRequest) {
  try {
    const { user: adminUser, profile: adminProfile, response } = await requireAdmin(request)
    if (response) return response
    const supabase = createServerClient()

    const body = await request.json()
    const action = String(body.action || "")
    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 })
    }
    if ((action === "make_admin" || action === "remove_admin") && resolveStaffRole(adminProfile) !== "developer") {
      return NextResponse.json({ error: "Only Developers can change Admin roles" }, { status: 403 })
    }

    // Bulk mode: user_ids array applies the same action to many users.
    const userIds: string[] = Array.isArray(body.user_ids)
      ? body.user_ids.filter((x: unknown) => typeof x === "string" && x)
      : []
    const singleUserId = body.user_id as string | undefined
    if (userIds.length === 0 && !singleUserId) {
      return NextResponse.json({ error: "user_id or user_ids is required" }, { status: 400 })
    }

    // Account deletion is a multi-step server operation (auth rows, sessions,
    // profile masking), so it does not go through the generic update switch.
    if (action === "delete") {
      if (userIds.length > 0) {
        return NextResponse.json({ error: "Delete one account at a time" }, { status: 400 })
      }
      const deleted = await deleteAccountAsAdmin({
        actorId: adminUser!.id,
        targetId: singleUserId,
        reason: (body.reason as string) || "Admin deletion",
      })
      if (!deleted.ok) return NextResponse.json({ error: deleted.error }, { status: 400 })
      return NextResponse.json({
        success: true,
        deleted: true,
        message: `Account for @${deleted.username} has been deleted.`,
      })
    }

    const targets = userIds.length > 0 ? userIds : [singleUserId as string]
    const results: { user_id: string; success: boolean; error?: string; user?: unknown }[] = []

    // Role changes use the same locked database transaction as the Access & Roles
    // workspace. This keeps audit history and the last-Developer safeguard intact.
    if (action === "make_admin" || action === "remove_admin") {
      const roleResults: { user_id: string; success: boolean; error?: string; access?: unknown }[] = []
      for (const targetId of targets) {
        const { data: existingGrants, error: grantsError } = await supabase
          .from("team_permissions")
          .select("permission_key")
          .eq("user_id", targetId)
        if (grantsError) {
          roleResults.push({ user_id: targetId, success: false, error: "Could not read existing permissions" })
          continue
        }

        const { data: access, error: accessError } = await supabase.rpc("admin_update_access", {
          p_actor_id: adminUser!.id,
          p_target_id: targetId,
          p_new_role: action === "make_admin" ? "admin" : "user",
          p_permissions: (existingGrants || []).map((grant) => grant.permission_key),
        })
        if (accessError) {
          roleResults.push({ user_id: targetId, success: false, error: accessError.message })
        } else {
          roleResults.push({ user_id: targetId, success: true, access })
        }
      }

      const success = roleResults.every((result) => result.success)
      return NextResponse.json({ success, results: roleResults }, { status: success ? 200 : 400 })
    }

    for (const userId of targets) {
      try {
        const { data: target } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle()
        if (!target) {
          results.push({ user_id: userId, success: false, error: "User not found" })
          continue
        }

        const actorRole = resolveStaffRole(adminProfile)
        const targetRole = resolveStaffRole(target)
        if (actorRole === "admin" && (targetRole === "developer" || targetRole === "admin")) {
          results.push({ user_id: userId, success: false, error: "Admins cannot modify Developer or Admin accounts" })
          continue
        }

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

        switch (action) {
          case "verify":
          case "grant_creator_badge":
            updates.is_verified = true
            break
          case "unverify":
          case "revoke_creator_badge":
            updates.is_verified = false
            break
          case "grant_team_badge":
            updates.is_team_member = true
            break
          case "revoke_team_badge":
            updates.is_team_member = false
            break
          case "grant_sponsor_badge":
            updates.is_sponsor = true
            break
          case "revoke_sponsor_badge":
            updates.is_sponsor = false
            break
          case "grant_premium": {
            const months = Number(body.months) || 1
            const current = target.premium_expires_at ? new Date(target.premium_expires_at) : null
            const base = current && current > new Date() ? current : new Date()
            updates.is_premium = true
            updates.premium_expires_at = new Date(base.setMonth(base.getMonth() + months)).toISOString()
            break
          }
          case "revoke_premium":
            updates.is_premium = false
            break
          case "make_admin":
            updates.staff_role = "admin"
            updates.is_admin = true
            updates.is_moderator = false
            break
          case "remove_admin":
            updates.staff_role = null
            updates.is_admin = false
            updates.is_moderator = false
            break
          case "add_coins": {
            const amount = Math.max(0, Number(body.amount) || 0)
            updates.loop_coins = Number(target.loop_coins || 0) + amount
            break
          }
          case "ban":
            if (userId === adminUser.id) {
              results.push({ user_id: userId, success: false, error: "You cannot ban yourself" })
              continue
            }
            updates.is_banned = true
            updates.ban_reason = String(body.reason || "Violated community guidelines")
            updates.suspended_at = new Date().toISOString()
            break
          case "unban":
            updates.is_banned = false
            updates.ban_reason = null
            updates.suspended_at = null
            break
          default:
            return NextResponse.json({ error: "Unknown action" }, { status: 400 })
        }

        const { data: updated, error } = await supabase
          .from("profiles")
          .update(updates)
          .eq("id", userId)
          .select(USER_FIELDS)
          .single()

        if (error) {
          results.push({ user_id: userId, success: false, error: error.message })
          continue
        }

        // User-facing copy must never reveal that an admin acted — it is
        // framed as something that simply happened to the user, and reads as
        // coming from Loop. No actor_id / admin_* payload either, otherwise the
        // notification list would render the admin's name and avatar.
        const notice = userFacingNotice(action, body, updated)
        await supabase.from("notifications").insert({
          user_id: userId,
          type: notice.type,
          title: notice.title,
          message: notice.message,
          data: { action },
        })

        try {
          await supabase.channel("admin:users").send({
            type: "broadcast",
            event: "user_updated",
            payload: { user: updated, action, admin_id: adminUser.id },
          })
          await supabase.channel(`user:${userId}`).send({
            type: "broadcast",
            event: "profile_updated",
            payload: { user: updated, action },
          })
        } catch { /* intentionally silent */ }

        results.push({ user_id: userId, success: true, user: updated })
      } catch (err: any) {
        results.push({ user_id: userId, success: false, error: err?.message || "Action failed" })
      }
    }

    const failed = results.filter((r) => !r.success).length
    if (userIds.length > 0) {
      return NextResponse.json({ success: failed === 0, results, failed })
    }
    if (failed > 0) {
      return NextResponse.json({ error: results[0]?.error || "Action failed" }, { status: 400 })
    }
    return NextResponse.json({ success: true, user: results[0]?.user })
  } catch (error) {
    console.error("Admin users POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
