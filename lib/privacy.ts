/**
 * Shared server-side privacy helpers.
 *
 * Public surfaces use these helpers so profile visibility and account blocks
 * are enforced before rows are ranked, paginated or serialized.
 */

export function isGatedVisibility(visibility: unknown): boolean {
  return visibility === "private" || visibility === "followers"
}

/**
 * Resolve users hidden by either side of a block relationship. If the block
 * table cannot be checked, fail closed for non-self authors.
 */
export async function getBlockedProfileIds(
  supabase: any,
  viewerId: string | null,
  authorIds: Array<string | null | undefined>,
): Promise<Set<string>> {
  const ids = [...new Set(authorIds.filter((id): id is string => Boolean(id) && id !== viewerId))]
  if (!viewerId || ids.length === 0) return new Set()

  const [outgoing, incoming] = await Promise.all([
    supabase.from("user_blocks").select("blocked_id").eq("blocker_id", viewerId).in("blocked_id", ids),
    supabase.from("user_blocks").select("blocker_id").eq("blocked_id", viewerId).in("blocker_id", ids),
  ])

  if (outgoing.error || incoming.error) {
    console.error("Block privacy lookup failed; hiding non-self content:", outgoing.error || incoming.error)
    return new Set(ids)
  }

  const hidden = new Set<string>()
  for (const row of outgoing.data || []) if (row.blocked_id) hidden.add(row.blocked_id)
  for (const row of incoming.data || []) if (row.blocker_id) hidden.add(row.blocker_id)
  return hidden
}

/** Returns the ids of profiles whose visibility gates their content. */
export async function getPrivateProfileIds(
  supabase: any,
  userIds: Array<string | null | undefined>,
): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))]
  if (!ids.length) return new Set()

  const { data, error } = await supabase.from("profiles").select("id, privacy_settings").in("id", ids)
  if (error) {
    console.error("Profile privacy lookup failed; hiding the queried profiles:", error)
    return new Set(ids)
  }

  return new Set(
    (data || [])
      .filter((profile: any) => isGatedVisibility((profile.privacy_settings || {})?.profile_visibility))
      .map((profile: any) => profile.id),
  )
}

/**
 * Drops rows authored by private/followers-only profiles not followed by the
 * viewer, and rows from either side of a block relationship.
 */
export async function filterPrivateContent<T extends { author_id?: string }>(
  supabase: any,
  rows: T[],
  viewerId: string | null,
  followingIds: Set<string> | string[],
): Promise<T[]> {
  if (!rows.length) return rows
  const authorIds = rows.map((row) => row.author_id)
  const [privateIds, blockedIds] = await Promise.all([
    getPrivateProfileIds(supabase, authorIds),
    getBlockedProfileIds(supabase, viewerId, authorIds),
  ])
  const followed = new Set(Array.from(followingIds))

  return rows.filter((row) => {
    const authorId = row.author_id
    if (!authorId) return false
    if (viewerId && authorId === viewerId) return true
    if (blockedIds.has(authorId)) return false
    if (!privateIds.has(authorId)) return true
    return followed.has(authorId)
  })
}

/** Resolve profile visibility and blocks before exposing a profile or its content. */
export async function canViewProfile(
  supabase: any,
  viewerId: string | null,
  targetId: string,
): Promise<{ allowed: boolean; isPrivate: boolean }> {
  const { data, error } = await supabase.from("profiles")
    .select("privacy_settings").eq("id", targetId).maybeSingle()
  if (error || !data) return { allowed: false, isPrivate: true }

  const privacy = (data as any)?.privacy_settings || {}
  if (viewerId && viewerId !== targetId) {
    const [outgoing, incoming] = await Promise.all([
      supabase.from("user_blocks").select("id").eq("blocker_id", viewerId).eq("blocked_id", targetId).maybeSingle(),
      supabase.from("user_blocks").select("id").eq("blocker_id", targetId).eq("blocked_id", viewerId).maybeSingle(),
    ])
    if (outgoing.error || incoming.error || outgoing.data || incoming.data) {
      return { allowed: false, isPrivate: isGatedVisibility(privacy.profile_visibility) }
    }
  }

  if (!isGatedVisibility(privacy.profile_visibility)) return { allowed: true, isPrivate: false }
  if (!viewerId || viewerId === targetId) return { allowed: viewerId === targetId, isPrivate: true }

  const { data: follow, error: followError } = await supabase.from("follows")
    .select("id").eq("follower_id", viewerId).eq("following_id", targetId).maybeSingle()
  return { allowed: Boolean(follow) && !followError, isPrivate: true }
}

/** Fetch the viewer's approved following ids (Set). */
export async function getFollowingIds(supabase: any, viewerId: string | null): Promise<Set<string>> {
  const ids = new Set<string>()
  if (!viewerId) return ids
  const { data, error } = await supabase.from("follows").select("following_id").eq("follower_id", viewerId)
  if (error) {
    console.error("Following lookup failed:", error)
    return ids
  }
  for (const row of data || []) if (row.following_id) ids.add(row.following_id)
  return ids
}
