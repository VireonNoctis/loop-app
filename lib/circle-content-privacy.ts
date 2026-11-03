import { isProUser } from "@/lib/pro-features"

export interface CircleScopedContent {
  circle_id?: string | null
}

/**
 * A public Loop is not public merely because its Loop visibility flag says so:
 * Circle privacy and Pro-only access remain authoritative for Circle content.
 * Missing Circles, failed lookups and unknown membership states fail closed.
 */
export async function filterCircleScopedContent<T extends CircleScopedContent>(
  supabase: any,
  rows: T[],
  viewerId: string | null,
): Promise<T[]> {
  const scopedRows = rows.filter((row) => typeof row.circle_id === "string" && row.circle_id.length > 0)
  if (!scopedRows.length) return rows

  const circleIds = [...new Set(scopedRows.map((row) => row.circle_id as string))]
  const [circlesResult, membershipsResult, profileResult] = await Promise.all([
    supabase
      .from("circles")
      .select("id, owner_id, is_private, is_premium_only")
      .in("id", circleIds),
    viewerId
      ? supabase
          .from("circle_members")
          .select("circle_id, status")
          .eq("user_id", viewerId)
          .in("circle_id", circleIds)
      : Promise.resolve({ data: [], error: null }),
    viewerId
      ? supabase
          .from("profiles")
          .select("is_premium, premium_expires_at")
          .eq("id", viewerId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (circlesResult.error || !Array.isArray(circlesResult.data)) {
    console.error("Circle content visibility lookup failed; hiding scoped content:", circlesResult.error)
    return rows.filter((row) => !row.circle_id)
  }
  if (membershipsResult.error || !Array.isArray(membershipsResult.data)) {
    console.error("Circle membership visibility lookup failed; hiding scoped content:", membershipsResult.error)
    return rows.filter((row) => !row.circle_id)
  }
  if (profileResult.error) {
    console.error("Circle Pro visibility lookup failed; hiding scoped content:", profileResult.error)
    return rows.filter((row) => !row.circle_id)
  }

  const circles = new Map((circlesResult.data as Array<{
    id: string
    owner_id?: string | null
    is_private?: boolean | null
    is_premium_only?: boolean | null
  }>).map((circle) => [circle.id, circle]))
  const activeMemberships = new Set(
    (membershipsResult.data as Array<{ circle_id: string; status?: string | null }>)
      .filter((membership) => membership.status === "active" || membership.status === "approved")
      .map((membership) => membership.circle_id),
  )
  const viewerIsPro = isProUser(profileResult.data || {})

  return rows.filter((row) => {
    if (!row.circle_id) return true
    const circle = circles.get(row.circle_id)
    if (!circle) return false
    if (circle.is_premium_only && !viewerIsPro) return false
    if (circle.is_private) {
      return Boolean(
        viewerId
        && (circle.owner_id === viewerId || activeMemberships.has(circle.id)),
      )
    }
    return true
  })
}
