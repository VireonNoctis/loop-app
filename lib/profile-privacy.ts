/**
 * Resolve whether a profile's content and identifying media can be exposed
 * in public surfaces such as server-rendered metadata and search previews.
 *
 * Legacy rows with no visibility setting remain public for compatibility.
 * Unknown configured values fail closed so a malformed setting cannot turn a
 * restricted profile into a public one.
 */
export function isRestrictedProfileVisibility(privacySettings: unknown): boolean {
  if (privacySettings === null || privacySettings === undefined) return false
  if (typeof privacySettings !== "object" || Array.isArray(privacySettings)) return true

  const visibility = (privacySettings as Record<string, unknown>).profile_visibility
  if (typeof visibility !== "string" || !visibility.trim()) return false

  const normalized = visibility.trim().toLowerCase()
  return normalized !== "public" && normalized !== "unlisted"
}


export interface RestrictedProfileIdentity {
  id: string
  username: string
  display_name: string
  avatar_url?: string | null
  video_avatar_url?: string | null
  banner_url?: string | null
  bio?: string | null
  is_verified?: boolean
}

export function buildRestrictedProfileView(
  profile: RestrictedProfileIdentity,
  options: {
    isPrivate: boolean
    hasPendingRequest: boolean
    isBlocked: boolean
    blockDirection: "by_me" | "by_them" | null
  },
) {
  return {
    id: profile.id,
    username: profile.username,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url ?? null,
    video_avatar_url: profile.video_avatar_url ?? null,
    banner_url: profile.banner_url ?? null,
    bio: profile.bio ?? null,
    is_verified: Boolean(profile.is_verified),
    is_private: options.isPrivate,
    is_following: false,
    is_follower: false,
    is_self: false,
    has_pending_follow_request: options.isBlocked ? false : options.hasPendingRequest,
    is_blocked: options.isBlocked,
    block_direction: options.blockDirection,
    can_view_full: false,
    // Restricted views intentionally do not disclose social or activity totals.
    followers_count: 0,
    following_count: 0,
    loops_count: 0,
    branches_count: 0,
    comments_count: 0,
    likes_received: 0,
    recent_loops: [],
    recent_branches: [],
    media_loops: [],
    active_cosmetics: null,
    active_effects: [],
  }
}


/**
 * Explicit public profile identity. Never spread the database row into a
 * public response: profile rows also contain contact, account and earnings
 * fields that are not part of a public creator identity.
 */
export function buildPublicProfileIdentity(
  profile: Record<string, any>,
  isSelf: boolean,
) {
  const organizationConfig = profile.organization_config && typeof profile.organization_config === "object"
    ? { coin_rate_multiplier: profile.organization_config.coin_rate_multiplier }
    : null

  const identity: Record<string, unknown> = {
    id: profile.id,
    username: profile.username,
    display_name: profile.display_name,
    bio: profile.bio ?? null,
    avatar_url: profile.avatar_url ?? null,
    video_avatar_url: profile.video_avatar_url ?? null,
    banner_url: profile.banner_url ?? null,
    created_at: profile.created_at,
    pronouns: profile.pronouns ?? null,
    website: profile.website ?? null,
    location: profile.location ?? null,
    tagged_circles: Array.isArray(profile.tagged_circles) ? profile.tagged_circles : [],
    is_verified: Boolean(profile.is_verified),
    is_team_member: Boolean(profile.is_team_member),
    is_sponsor: Boolean(profile.is_sponsor),
    is_premium: Boolean(profile.is_premium),
    badge_id: profile.badge_id ?? null,
    equipped_frame_id: profile.equipped_frame_id ?? null,
    is_organization: Boolean(profile.is_organization),
    organization_name: profile.organization_name ?? null,
    organization_badge_url: profile.organization_badge_url ?? null,
    organization_config: organizationConfig,
    level: Number(profile.level ?? 1),
    xp_points: Number(profile.xp_points ?? 0),
    achievements: Array.isArray(profile.achievements) ? profile.achievements : [],
    active_theme: profile.active_theme ?? null,
    theme_preferences: profile.theme_preferences ?? null,
    active_cosmetics: profile.active_cosmetics ?? null,
  }

  if (isSelf) {
    identity.is_admin = Boolean(profile.is_admin)
    identity.loop_coins = Number(profile.loop_coins ?? 0)
    identity.available_earnings = Number(profile.available_earnings ?? 0)
    identity.total_earnings = Number(profile.total_earnings ?? 0)
  }

  return identity
}
