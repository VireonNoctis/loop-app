import { createServerClient } from "@/lib/supabase"
import { authDbPool } from "@/lib/auth"

type CircleAccessResult = { isPrivate: boolean; canView: boolean }

async function getUserIdFromToken(token: string, supabase: ReturnType<typeof createServerClient>): Promise<string | null> {
  // Better Auth's user ID is text, while Circle membership and ownership use
  // the canonical UUID in profiles. Resolve through the same email-aware
  // mapping used by the Rust API instead of comparing the two IDs directly.
  try {
    const res = await authDbPool.query(
      `
        SELECT profile.id::text AS profile_id
        FROM "session" AS auth_session
        JOIN "user" AS auth_user
          ON auth_user.id = auth_session."userId"
        JOIN LATERAL (
          SELECT candidate.id
          FROM profiles AS candidate
          WHERE candidate.id::text = auth_session."userId"
             OR lower(candidate.email) = lower(auth_user.email)
          ORDER BY (candidate.id::text = auth_session."userId") DESC
          LIMIT 1
        ) AS profile ON TRUE
        WHERE auth_session.token = $1
          AND auth_session."expiresAt" > NOW()
        LIMIT 1
      `,
      [token],
    )
    const profileId = res.rows[0]?.profile_id
    if (typeof profileId === "string") return profileId
  } catch {
    /* fall through to legacy Supabase JWT sessions */
  }

  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) return null
    const email = data.user.email
    if (email) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle()
      if (profile?.id) return String(profile.id)
    }
    // Legacy Supabase sessions may already use the profile UUID.
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.user.id)
      ? data.user.id
      : null
  } catch {
    return null
  }
}

/**
 * Private circles must not leak posts, events, rooms, or the member roster
 * to visitors who haven't been approved by an admin/owner. Call this from
 * any circle sub-resource GET route before returning content.
 *
 * When the service key or database lookup is unavailable, deny by default.
 * Unknown/missing Circles are not treated as public.
 */
export async function checkCirclePrivateAccess(
  circleId: string,
  authHeader: string | null,
): Promise<CircleAccessResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { isPrivate: true, canView: false }
  }

  try {
    const supabase = createServerClient()
    const { data: circleRow, error: circleError } = await supabase
      .from("circles")
      .select("is_private, owner_id, creator_id")
      .eq("id", circleId)
      .maybeSingle()

    if (circleError || !circleRow) {
      return { isPrivate: true, canView: false }
    }

    if (!circleRow.is_private) {
      return { isPrivate: false, canView: true }
    }

    const token = authHeader?.replace(/^Bearer\s+/i, "").trim() || null
    const userId = token ? await getUserIdFromToken(token, supabase) : null
    if (!userId) return { isPrivate: true, canView: false }

    // The canonical owner can view a private Circle even when their historic
    // membership row is absent; legacy records may use creator_id.
    const ownerId = circleRow.owner_id || circleRow.creator_id
    if (ownerId === userId) return { isPrivate: true, canView: true }

    const { data: memberRow, error: memberError } = await supabase
      .from("circle_members")
      .select("status")
      .eq("circle_id", circleId)
      .eq("user_id", userId)
      .maybeSingle()

    if (memberError || !memberRow) return { isPrivate: true, canView: false }

    const status = String(memberRow.status || "").toLowerCase()
    const canView = status === "active" || status === "approved"
    return { isPrivate: true, canView }
  } catch {
    // A transient database failure must never turn private content public.
    return { isPrivate: true, canView: false }
  }
}
