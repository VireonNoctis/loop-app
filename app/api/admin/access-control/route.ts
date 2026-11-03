import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { requireDashboardAccess } from "@/lib/server-auth"
import { resolveStaffRole } from "@/lib/staff-roles"
import { AVAILABLE_PERMISSIONS } from "@/lib/team-permissions"

export const dynamic = "force-dynamic"
const MODERATOR_KEYS = new Set(["moderation", "support"])

export async function GET(request: NextRequest) {
  try {
    const { user, profile, response } = await requireDashboardAccess(request)
    if (response) return response
    const actorRole = resolveStaffRole(profile)
    const supabase = createServerClient()
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 80) || ""
    let requestQuery = supabase.from("profiles")
      .select("id, username, display_name, avatar_url, email, is_admin, is_moderator, is_team_member, staff_role, created_at")
      .order("created_at", { ascending: false })
      .limit(60)
    const safeQuery = query.replace(/[^\\p{L}\\p{N} ._@-]/gu, "").trim()
    if (safeQuery) requestQuery = requestQuery.or(`username.ilike.%${safeQuery}%,display_name.ilike.%${safeQuery}%,email.ilike.%${safeQuery}%`)
    const { data: profiles, error } = await requestQuery
    if (error) {
      console.error("Access-control profile query failed:", error)
      return NextResponse.json({ error: "Could not load accounts" }, { status: 500 })
    }

    const ids = (profiles || []).map((entry) => entry.id).filter(Boolean)
    const { data: grants, error: grantsError } = ids.length
      ? await supabase.from("team_permissions").select("user_id, permission_key").in("user_id", ids)
      : { data: [], error: null }
    if (grantsError) {
      console.error("Access-control permission query failed:", grantsError)
      return NextResponse.json({ error: "Could not load permissions" }, { status: 500 })
    }

    const byUser = new Map<string, string[]>()
    for (const grant of grants || []) byUser.set(grant.user_id, [...(byUser.get(grant.user_id) || []), grant.permission_key])
    if (!actorRole) return NextResponse.json({ error: "Staff role required" }, { status: 403 })

    let accessAudit: Array<Record<string, unknown>> = []
    if (actorRole === "developer" || actorRole === "admin") {
      const { data: auditRows, error: auditError } = await supabase
        .from("admin_access_audit")
        .select("id, actor_id, target_user_id, previous_role, next_role, previous_permissions, next_permissions, created_at")
        .order("created_at", { ascending: false })
        .limit(15)
      if (auditError) {
        console.error("Access-control audit query failed:", auditError)
        return NextResponse.json({ error: "Could not load access history" }, { status: 500 })
      }
      const auditUserIds = [...new Set((auditRows || []).flatMap((row) => [row.actor_id, row.target_user_id]).filter(Boolean))]
      const { data: auditProfiles } = auditUserIds.length
        ? await supabase.from("profiles").select("id, username, display_name").in("id", auditUserIds)
        : { data: [] }
      const auditNames = new Map((auditProfiles || []).map((entry) => [
        entry.id,
        entry.display_name || entry.username || entry.id,
      ]))
      accessAudit = (auditRows || []).map((row) => ({
        ...row,
        actor_name: row.actor_id ? auditNames.get(row.actor_id) || row.actor_id : "Deleted account",
        target_name: row.target_user_id ? auditNames.get(row.target_user_id) || row.target_user_id : "Deleted account",
      }))
    }

    const users = (profiles || []).map((entry) => ({
      id: entry.id,
      username: entry.username,
      display_name: entry.display_name,
      avatar_url: entry.avatar_url,
      email: entry.email,
      created_at: entry.created_at,
      staff_role: resolveStaffRole(entry) || "user",
      permissions: byUser.get(entry.id) || [],
    }))
    return NextResponse.json({
      users,
      available_permissions: actorRole === "moderator"
        ? AVAILABLE_PERMISSIONS.filter((permission) => MODERATOR_KEYS.has(permission.key))
        : AVAILABLE_PERMISSIONS,
      actor_role: actorRole,
      can_manage_roles: actorRole === "developer",
      can_assign_moderators: actorRole === "developer" || actorRole === "admin",
      current_user_id: user?.id,
      access_audit: accessAudit,
    })
  } catch (error) {
    console.error("Access-control GET failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, profile, response } = await requireDashboardAccess(request)
    if (response) return response
    const body = await request.json().catch(() => null)
    const targetId = typeof body?.user_id === "string" ? body.user_id : ""
    const staffRole = typeof body?.staff_role === "string" ? body.staff_role : ""
    const permissions = body?.permissions
    const roles = ["user", "developer", "admin", "moderator"]
    if (!targetId || !roles.includes(staffRole) || !Array.isArray(permissions)) {
      return NextResponse.json({ error: "A user, valid role and permission list are required" }, { status: 400 })
    }
    if (permissions.length > AVAILABLE_PERMISSIONS.length || permissions.some((key: unknown) => typeof key !== "string")) {
      return NextResponse.json({ error: "Invalid permission selection" }, { status: 400 })
    }
    const valid = new Set(AVAILABLE_PERMISSIONS.map((permission) => permission.key))
    if (permissions.some((key: string) => !valid.has(key))) {
      return NextResponse.json({ error: "One or more permissions are not recognised" }, { status: 400 })
    }
    const actorRole = resolveStaffRole(profile)
    if (!actorRole) return NextResponse.json({ error: "Admin dashboard access required" }, { status: 403 })
    if (actorRole === "moderator" && (staffRole !== "user" || permissions.some((key: string) => !MODERATOR_KEYS.has(key)))) {
      return NextResponse.json({ error: "Moderators may only grant Moderation and Support permissions to regular users" }, { status: 403 })
    }

    const supabase = createServerClient()
    const { data, error } = await supabase.rpc("admin_update_access", {
      p_actor_id: user!.id,
      p_target_id: targetId,
      p_new_role: staffRole,
      p_permissions: [...new Set(permissions as string[])],
    })
    if (error) {
      const detail = error.message || "Access update failed"
      const expected = ["cannot change your own", "cannot edit Developer", "Moderators can only", "Moderators cannot", "Moderators may only", "Admins cannot edit", "Admins may only", "last Developer", "Target account not found", "Invalid staff role", "not recognised", "Duplicate permissions"]
      const rejected = expected.some((part) => detail.toLowerCase().includes(part.toLowerCase()))
      if (!rejected) console.error("Access-control RPC failed:", error)
      return NextResponse.json({
        error: rejected ? detail : "The access update could not be completed. Confirm the access-control migration is applied.",
      }, { status: rejected ? 403 : 500 })
    }
    return NextResponse.json({ success: true, access: data })
  } catch (error) {
    console.error("Access-control POST failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
