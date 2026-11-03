import { resolveStaffRole } from "@/lib/staff-roles"
import { randomUUID } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { auth, authDbPool } from "@/lib/auth"
import { createServerClient } from "@/lib/supabase"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim())
}

export function getBearerToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null
  return authHeader.replace("Bearer ", "")
}

/**
 * Every app table keys a user by `profiles.id`, which is a **uuid** column,
 * while Better Auth owns `user.id` as free-form text. A legacy or misconfigured
 * account can therefore carry an id like "6", and passing that straight into
 * `.eq("id", user.id)` makes PostgREST throw
 * `invalid input syntax for type uuid: "6"` — which used to surface verbatim in
 * onboarding/profile forms and break every write for that account.
 *
 * Bridge the two formats once, here, so all routes receive a real UUID:
 *  - UUID ids are used as-is (profiles.id === Better Auth user id)
 *  - anything else is resolved through the account email, and if the account
 *    has no profile row yet a canonical one is created with a fresh UUID.
 */
async function resolveProfileId(baseId: string, email?: string | null): Promise<string | null> {
  if (isUuid(baseId)) return baseId

  const supabase = createServerClient()

  if (email) {
    const { data } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle()
    if (isUuid(data?.id)) return data.id
  }

  const id = randomUUID()
  const local = (email?.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16) || "user"
  const { data: created, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id,
        email: email || null,
        username: `${local}_${id.slice(0, 6)}`,
        display_name: local,
        onboarding_completed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("id")
    .maybeSingle()

  if (error) {
    console.error(
      `[server-auth] Could not bridge non-UUID Better Auth user id "${baseId}" to a profile row:`,
      error.message,
    )
    return null
  }

  console.warn(`[server-auth] Bridged non-UUID Better Auth user id "${baseId}" to profile ${created?.id || id}`)
  return (created?.id as string) || id
}

export async function getUserFromRequest(request: NextRequest) {
  let base: { id: string; email?: string; name?: string; image?: string | null } | null = null

  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    })
    if (session?.user) {
      base = session.user
    } else {
      const token = getBearerToken(request)
      if (token) {
        const res = await authDbPool.query(
          'SELECT s."userId", u.email, u.name, u.image FROM "session" s JOIN "user" u ON s."userId" = u.id WHERE s.token = $1 AND s."expiresAt" > NOW();',
          [token]
        )
        if (res.rows.length > 0) {
          const u = res.rows[0]
          base = { id: u.userId, email: u.email, name: u.name, image: u.image }
        }
      }
    }
  } catch (error) {
    console.error("Error in getUserFromRequest:", error)
  }

  if (!base) return null

  // Everything downstream writes to uuid columns, so hand back the canonical
  // profile id rather than whatever Better Auth happens to store.
  let id = base.id
  try {
    const resolved = await resolveProfileId(base.id, base.email)
    if (resolved) id = resolved
  } catch (error) {
    console.error("Error resolving profile id:", error)
  }

  // Canonical app profile (username + display name) lives in the profiles
  // table keyed by the same id as the Better Auth user.
  let username: string | undefined
  try {
    const supabase = createServerClient()
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", id)
      .maybeSingle()
    username = profile?.username || undefined
  } catch {
    /* non-blocking — fall back to name */
  }

  return {
    id,
    email: base.email,
    name: base.name,
    user_metadata: {
      username,
      display_name: base.name || username,
      avatar_url: base.image,
    },
  }
}

export async function requireUser(request: NextRequest) {
  const user = await getUserFromRequest(request)
  if (!user) {
    return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  return { user, response: null }
}

export async function requireAdmin(request: NextRequest) {
  const { user, response } = await requireUser(request)
  if (!user) return { user: null, profile: null, response }

  const supabase = createServerClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, is_admin, is_moderator, staff_role")
    .eq("id", user.id)
    .maybeSingle()

  // Privileged access must come only from the canonical profile role.
  // An email address is user-controlled identity data, never an authorization claim.
  const staffRole = resolveStaffRole(profile)

  if (staffRole !== "developer" && staffRole !== "admin") {
    return {
      user,
      profile,
      response: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    }
  }

  return { user, profile: profile ? { ...profile, staff_role: staffRole } : profile, response: null }
}

export async function requireDeveloper(request: NextRequest) {
  const { user, profile, response } = await requireAdmin(request)
  if (response || !user) return { user, profile, response }
  if (resolveStaffRole(profile) !== "developer") {
    return { user, profile, response: NextResponse.json({ error: "Developer access required" }, { status: 403 }) }
  }
  return { user, profile, response: null }
}

export async function requireDashboardAccess(request: NextRequest) {
  const { user, response: authResponse } = await requireUser(request)
  if (authResponse || !user) return { user: null, profile: null, response: authResponse }

  const supabase = createServerClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, is_admin, is_moderator, is_team_member, staff_role")
    .eq("id", user.id)
    .maybeSingle()

  const staffRole = resolveStaffRole(profile)
  if (!staffRole) {
    return {
      user,
      profile,
      response: NextResponse.json({ error: "Admin dashboard access required" }, { status: 403 }),
    }
  }

  return { user, profile: profile ? { ...profile, staff_role: staffRole } : profile, response: null }
}

export async function requireModerator(request: NextRequest) {
  const { user, response } = await requireUser(request)
  if (!user) return { user: null, profile: null, response }

  const supabase = createServerClient()
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, is_admin, is_moderator, staff_role")
    .eq("id", user.id)
    .maybeSingle()

  const staffRole = resolveStaffRole(profile)
  if (error || !staffRole) {
    return {
      user,
      profile,
      response: NextResponse.json({ error: "Admin or moderator access required" }, { status: 403 }),
    }
  }

  return { user, profile: profile ? { ...profile, staff_role: staffRole } : profile, response: null }
}
