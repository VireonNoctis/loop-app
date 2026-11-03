import { createServerClient } from "@/lib/supabase"

/**
 * Check if user A has blocked user B (or vice versa).
 * Returns { blocked: boolean, direction: "by_me" | "by_them" | null }
 */
export async function checkBlockStatus(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  otherUserId: string,
): Promise<{ blocked: boolean; direction: "by_me" | "by_them" | null }> {
  if (userId === otherUserId) return { blocked: false, direction: null }

  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .or(`and(blocker_id.eq.${userId},blocked_id.eq.${otherUserId}),and(blocker_id.eq.${otherUserId},blocked_id.eq.${userId})`)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error("Could not verify profile block status")
  if (!data) return { blocked: false, direction: null }

  return {
    blocked: true,
    direction: data.blocker_id === userId ? "by_me" : "by_them",
  }
}

/**
 * Check if a user is blocked by any of the given user IDs.
 * Useful for filtering search results, conversation lists, etc.
 */
export async function getBlockedUserIds(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocker_id", userId)

  const { data: blockedBy } = await supabase
    .from("user_blocks")
    .select("blocker_id")
    .eq("blocked_id", userId)

  const ids = new Set<string>()
  for (const row of data || []) ids.add(row.blocked_id)
  for (const row of blockedBy || []) ids.add(row.blocker_id)
  return ids
}

/**
 * Check if user A has blocked user B specifically.
 */
export async function isBlockedBy(
  supabase: ReturnType<typeof createServerClient>,
  blockerId: string,
  blockedId: string,
): Promise<boolean> {
  if (blockerId === blockedId) return false
  const { data } = await supabase
    .from("user_blocks")
    .select("id")
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId)
    .maybeSingle()
  return Boolean(data)
}

/**
 * Get all user IDs blocked by the given user, or who blocked the given user.
 * Returns a Set of user IDs that should be hidden from the given user's view.
 */
export async function getHiddenUserIds(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<Set<string>> {
  const ids = new Set<string>()

  // Users I blocked
  const { data: iBlocked } = await supabase
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocker_id", userId)
  for (const row of iBlocked || []) ids.add(row.blocked_id)

  // Users who blocked me
  const { data: blockedMe } = await supabase
    .from("user_blocks")
    .select("blocker_id")
    .eq("blocked_id", userId)
  for (const row of blockedMe || []) ids.add(row.blocker_id)

  return ids
}
