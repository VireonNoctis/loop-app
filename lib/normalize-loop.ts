import { maskAuthor } from "@/lib/user-status"

export type NormalizedLoop = {
  id: string
  author_id: string
  content: string
  content_title?: string | null
  media_type: string
  media_url?: string
  media_urls?: string[]
  hashtags?: string[]
  created_at: string
  updated_at?: string
  parent_loop_id?: string | null
  /** The loop this post was branched from (joined by the feed APIs). */
  parent_loop?: {
    id: string
    content?: string | null
    author?: {
      id?: string
      username?: string
      display_name?: string
      avatar_url?: string
      video_avatar_url?: string | null
      is_verified?: boolean
      is_premium?: boolean
      is_team_member?: boolean
    } | null
  } | null
  author: {
    id: string
    username: string
    display_name: string
    avatar_url?: string
    video_avatar_url?: string | null
    is_verified?: boolean
    is_team_member?: boolean
    is_sponsor?: boolean
    is_premium?: boolean
    is_organization?: boolean
    organization_badge_url?: string
    organization_name?: string
    equipped_frame_id?: string | number | null
    badge_id?: string | null
    level?: number
    cosmetics?: Record<string, any> | null
    active_cosmetics?: Record<string, any> | null
  }
  stats: {
    likes_count: number
    comments_count: number
    branches_count: number
    /** Rebranches that quoted this post (loops.quote_count). */
    quotes_count: number
    shares_count: number
    views_count: number
  }
  user_interactions: {
    is_liked: boolean
    is_saved: boolean
    has_viewed?: boolean
    has_shared?: boolean
  }
  visibility?: string
  category?: string
  post_type?: string
  poll?: any
  duel?: any
  is_featured?: boolean
  is_pinned?: boolean
  comments_disabled?: boolean
  /** Author hid the rich link-preview card — applies to every viewer. */
  link_preview_disabled?: boolean
  /** Depth of this post in its branch tree (0 = original post). */
  tree_depth?: number
  /** Id of the post this one quotes (quote rebranches are top-level posts). */
  quoted_loop_id?: string | null
  /** How many quote posts this post has collected. */
  quote_count?: number
  /** Branch-tree limits owned by the root post. `null` = unlimited. */
  max_branch_depth?: number | null
  max_branches_per_user?: number | null
  engagement_score?: number
  gifts_received?: number
  total_gift_value?: number
  is_co_loop?: boolean
  co_authors?: Array<{
    id: string
    username: string
    display_name: string
    avatar_url?: string
    is_verified?: boolean
    role?: string
  }>
  content_metadata?: Record<string, any> | null
  is_spoiler?: boolean
  /** Why this item was surfaced by Discover; omitted for non-personalized feeds. */
  discovery_reason?: string
  /** ML recommendation engine extras (For You tab) */
  recommendation_reason?: string
  match_percentage?: number
  ml_score?: number
}

const defaultStats = {
  likes_count: 0,
  comments_count: 0,
  branches_count: 0,
  quotes_count: 0,
  shares_count: 0,
  views_count: 0,
}

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value || undefined
}

export function normalizeLoop(row: any, interactionTypes: string[] = []): NormalizedLoop {
  // Deleted / suspended accounts are masked so their content stops rendering
  // under their identity — feed shows “Deleted User” / “Suspended User”.
  const rawAuthor = first(row?.author) || first(row?.profiles) || row?.profile || {}
  const author = maskAuthor(rawAuthor) || {}
  const stats = first(row?.stats) || first(row?.loop_stats) || row?.loop_stats || {}
  const interactions = interactionTypes.length
    ? interactionTypes
    : Array.isArray(row?.loop_interactions)
      ? row.loop_interactions.map((interaction: any) => interaction.interaction_type)
      : []

  return {
    id: row?.id || "",
    author_id: row?.author_id || author?.id || "",
    content: row?.content_text ?? row?.content ?? row?.text ?? "",
    content_title: row?.content_title ?? row?.title ?? null,
    media_type: row?.content_type ?? row?.media_type ?? "text",
    media_url: row?.content_media_url ?? row?.media_url ?? undefined,
    media_urls:
      row?.media_urls ??
      (Array.isArray(row?.content_metadata?.media_urls) && row.content_metadata.media_urls.length > 0
        ? row.content_metadata.media_urls
        : row?.content_media_url || row?.media_url
          ? [row.content_media_url || row.media_url]
          : undefined),
    hashtags: Array.isArray(row?.hashtags) ? row.hashtags : [],
    created_at: row?.created_at || new Date().toISOString(),
    updated_at: row?.updated_at || row?.created_at,
    parent_loop_id: row?.parent_loop_id ?? null,
    parent_loop: (() => {
      const parent = first(row?.parent_loop) || first(row?.parent) || null
      if (!parent || typeof parent !== "object") return null
      const parentAuthor = maskAuthor(first(parent.author) || first(parent.profiles) || {}) || {}
      return {
        id: parent?.id || row?.parent_loop_id || "",
        content: parent?.content_text ?? parent?.content ?? parent?.text ?? null,
        author: {
          id: parentAuthor?.id || parent?.author_id || "",
          username: parentAuthor?.username || "",
          display_name: parentAuthor?.display_name || parentAuthor?.username || "",
          avatar_url: parentAuthor?.avatar_url || undefined,
          video_avatar_url: parentAuthor?.video_avatar_url || null,
          is_verified: Boolean(parentAuthor?.is_verified),
          is_premium: Boolean(parentAuthor?.is_premium),
          is_team_member: Boolean(parentAuthor?.is_team_member),
        },
      }
    })(),
    author: {
      id: author?.id || row?.author_id || "",
      username: author?.username || "unknown",
      display_name: author?.display_name || author?.username || "Unknown User",
      avatar_url: author?.avatar_url || undefined,
      video_avatar_url: author?.video_avatar_url || null,
      is_verified: Boolean(author?.is_verified),
      is_team_member: Boolean(author?.is_team_member || author?.email === "useehamza0@gmail.com"),
      is_sponsor: Boolean(author?.is_sponsor),
      is_premium: Boolean(author?.is_premium),
      is_organization: Boolean(author?.is_organization),
      organization_badge_url: author?.organization_badge_url || undefined,
      organization_name: author?.organization_name || undefined,
      equipped_frame_id: author?.equipped_frame_id || null,
      badge_id: author?.badge_id || null,
      level: author?.level,
      cosmetics: author?.cosmetics || author?.active_cosmetics || null,
      active_cosmetics: author?.active_cosmetics || author?.cosmetics || null,
    },
    stats: {
      likes_count: Number(stats?.likes_count ?? stats?.likes ?? defaultStats.likes_count),
      comments_count: Number(stats?.comments_count ?? stats?.comments ?? defaultStats.comments_count),
      branches_count: Number(stats?.branches_count ?? stats?.branches ?? defaultStats.branches_count),
      // Quote rebranches live on loops.quote_count (not loop_stats), so read
      // them off the row — this is what keeps rebranch stats visible anywhere
      // the normalized stats are rendered.
      quotes_count: Number(row?.quote_count ?? stats?.quotes_count ?? defaultStats.quotes_count),
      shares_count: Number(stats?.shares_count ?? stats?.shares ?? defaultStats.shares_count),
      views_count: Number(stats?.views_count ?? stats?.views ?? defaultStats.views_count),
    },
    user_interactions: {
      is_liked: Boolean(row?.user_interactions?.is_liked ?? interactions.includes("like")),
      is_saved: Boolean(row?.user_interactions?.is_saved ?? interactions.includes("save")),
      has_viewed: Boolean(row?.user_interactions?.has_viewed ?? interactions.includes("view")),
      has_shared: Boolean(row?.user_interactions?.has_shared ?? interactions.includes("share")),
    },
    visibility: row?.visibility,
    category: row?.category,
    post_type: row?.post_type ?? row?.content_type ?? "standard",
    poll: row?.poll ?? (Array.isArray(row?.loop_polls) ? row?.loop_polls[0] : row?.loop_polls) ?? undefined,
    duel: row?.duel ?? (Array.isArray(row?.loop_duels) ? row?.loop_duels[0] : row?.loop_duels) ?? undefined,
    // Coerced to a real boolean: these feed straight into `{value && <Badge/>}`
    // JSX guards, where a numeric 0 renders a literal "0" on the post row.
    is_featured: Boolean(row?.is_featured),
    is_pinned: Boolean(row?.is_pinned),
    comments_disabled: Boolean(row?.comments_disabled),
    link_preview_disabled: Boolean(row?.link_preview_disabled),
    tree_depth: Number(row?.tree_depth ?? 0),
    quoted_loop_id: row?.quoted_loop_id ?? null,
    quote_count: Number(row?.quote_count ?? 0),
    max_branch_depth:
      row?.max_branch_depth == null ? null : Number(row.max_branch_depth) || null,
    max_branches_per_user:
      row?.max_branches_per_user == null ? null : Number(row.max_branches_per_user) || null,
    engagement_score: Number(
      row?.engagement_score ??
        (Number(stats?.likes_count ?? 0) * 3 + Number(stats?.comments_count ?? 0) * 4 + Number(stats?.branches_count ?? 0) * 5 + Number(stats?.views_count ?? 0)),
    ),
    gifts_received: Number(row?.gifts_received ?? 0) || undefined,
    total_gift_value: Number(row?.total_gift_value ?? 0) || undefined,
    is_co_loop: Boolean(
      row?.is_co_loop ||
      row?.content_metadata?.is_co_loop ||
      (Array.isArray(row?.co_authors) && row.co_authors.length > 0) ||
      (Array.isArray(row?.content_metadata?.co_authors) && row.content_metadata.co_authors.length > 0)
    ),
    co_authors: Array.isArray(row?.co_authors)
      ? row.co_authors
      : Array.isArray(row?.content_metadata?.co_authors)
      ? row.content_metadata.co_authors
      : [],
    is_spoiler: Boolean(
      row?.is_spoiler ?? row?.content_metadata?.is_spoiler ?? false
    ),
    discovery_reason: typeof row?.discovery_reason === "string" ? row.discovery_reason : undefined,
    content_metadata:
      row?.content_metadata && typeof row.content_metadata === "object" ? row.content_metadata : null,
  }
}

export function normalizeLoops(rows: any[] = [], interactionMap: Map<string, string[]> = new Map()) {
  return rows.map((row) => normalizeLoop(row, interactionMap.get(row?.id) || []))
}
