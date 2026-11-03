import { createClient } from "@/lib/supabase"
import { getCategoryConfig, categoryDefaultSpaces } from "@/lib/community-categories"
import { canManageCircle, normalizeRole } from "@/lib/circle-permissions"
import { listPowers, viewerAbilities } from "@/lib/community-permissions"
import { isPrivateCircleDiscoverable } from "@/lib/circle-membership-state"
import type { SupabaseClient } from "@supabase/supabase-js"

// The community engine works against a fast-evolving schema — the generated
// Database types can't keep up, so the client is intentionally untyped here.
// Server-side permission checks still gate every mutation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

export function communityClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("Community server operations require SUPABASE_SERVICE_ROLE_KEY")
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------
export function canModerate(role?: string | null) {
  return canManageCircle(role)
}
export function canAdmin(role?: string | null) {
  const r = normalizeRole(role)
  return r === "owner" || r === "admin"
}
export function isOwnerRole(role?: string | null) {
  return normalizeRole(role) === "owner"
}

// ---------------------------------------------------------------------------
// Activity logging (existing circle_activity table)
// ---------------------------------------------------------------------------
export async function logCommunityActivity(
  sb: SB,
  circleId: number | string,
  actorId: string,
  activityType: string,
  targetType?: string,
  targetId?: string | number,
  metadata: Record<string, unknown> = {}
) {
  const { error } = await sb.from("circle_activity").insert({
    circle_id: circleId,
    actor_id: actorId,
    activity_type: activityType,
    target_type: targetType || null,
    target_id: targetId != null ? String(targetId) : null,
    metadata: metadata || {},
  })
  if (error) console.error("[community-engine] activity log error:", error.message)
}

// ---------------------------------------------------------------------------
// Upsert category config into the DB (keeps category engine in sync)
// ---------------------------------------------------------------------------
export async function upsertCategoryConfig(sb: SB, categoryId: string) {
  const cfg = getCategoryConfig(categoryId)
  const { error } = await sb.from("community_category_configs").upsert(
    { category: cfg.id, config: cfg as unknown as Record<string, unknown> },
    { onConflict: "category" }
  )
  if (error) console.error("[community-engine] category config upsert error:", error.message)
}

// ---------------------------------------------------------------------------
// Ensure default spaces exist for a community (idempotent)
// ---------------------------------------------------------------------------
/** The three spaces a "start minimal" community is born with. */
const MINIMAL_SPACES = [
  { name: "Home", type: "feed", icon: "home", description: "The front door — updates from across the community." },
  { name: "Discussions", type: "discussion", icon: "messages-square", description: "Threads, questions and everything worth replying to." },
  { name: "Media", type: "gallery", icon: "image", description: "Art, clips and screenshots from members." },
] as const

export async function ensureDefaultSpaces(
  sb: SB,
  circle: any,
  creatorId: string | null,
  opts?: { template?: string },
) {
  const { count } = await sb
    .from("community_spaces")
    .select("id", { count: "exact", head: true })
    .eq("circle_id", circle.id)
  if (count && count > 0) return false

  // "Start minimal" means exactly that: the three core spaces, nothing else.
  const defaults =
    opts?.template === "minimal"
      ? MINIMAL_SPACES.slice()
      : categoryDefaultSpaces(circle.category).slice(0, 8)
  const rows = defaults.map((s, i) => ({
    circle_id: circle.id,
    name: s.name,
    slug: s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    type: s.type,
    icon: s.icon,
    description: s.description,
    visibility: "members",
    sort_order: i,
    created_by: creatorId,
  }))
  const { error } = await sb.from("community_spaces").insert(rows)
  if (error) {
    console.error("[community-engine] default spaces error:", error.message)
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Pulse — real activity state, never fabricated
// ---------------------------------------------------------------------------
export interface CommunityPulse {
  active_now: number
  discussing: number
  creating: number
  voting: number
  in_live_rooms: number
  new_members_24h: number
  posts_24h: number
  comments_24h: number
  reactions_24h: number
  projects_active: number
  challenges_active: number
  events_upcoming: number
  messages_24h: number
  state: "quiet" | "growing" | "active" | "very_active" | "exploding"
  label: string
  emoji: string
}

export function pulseState(score: number): CommunityPulse["state"] {
  if (score >= 60) return "exploding"
  if (score >= 30) return "very_active"
  if (score >= 12) return "active"
  if (score >= 4) return "growing"
  return "quiet"
}

export async function computePulse(sb: SB, circleId: number | string): Promise<CommunityPulse> {
  const id = Number(circleId)

  // Scoping parents: room messages and post interactions don't carry circle_id,
  // so resolve their parent ids first (pagination-free since we only need counts).
  const [{ data: roomRows }, { data: postRows }] = await Promise.all([
    sb.from("circle_rooms").select("id").eq("circle_id", id).limit(500),
    sb.from("circle_posts").select("id").eq("circle_id", id).limit(500),
  ])
  const roomIds = (roomRows || []).map((r: any) => r.id)
  const postIds = (postRows || []).map((p: any) => p.id)

  const [active, members, posts, comments, reactions, messages, rooms, projects, challenges, events] =
    await Promise.all([
      sb.from("circle_activity").select("actor_id", { count: "exact", head: true }).eq("circle_id", id).gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString()),
      sb.from("circle_activity").select("actor_id", { count: "exact", head: true }).eq("circle_id", id).gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      sb.from("circle_posts").select("id", { count: "exact", head: true }).eq("circle_id", id).gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      sb.from("circle_post_comments").select("id", { count: "exact", head: true }).eq("circle_id", id).gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      postIds.length > 0
        ? sb.from("circle_post_interactions").select("id", { count: "exact", head: true }).in("post_id", postIds).gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        : Promise.resolve({ count: 0 }),
      roomIds.length > 0
        ? sb.from("circle_room_messages").select("id", { count: "exact", head: true }).in("room_id", roomIds).gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        : Promise.resolve({ count: 0 }),
      sb.from("circle_room_presence").select("user_id", { count: "exact", head: true }).eq("circle_id", id),
      sb.from("community_projects").select("id", { count: "exact", head: true }).eq("circle_id", id).eq("status", "active"),
      sb.from("circle_challenges").select("id", { count: "exact", head: true }).eq("circle_id", id).eq("status", "active"),
      sb.from("circle_events").select("id", { count: "exact", head: true }).eq("circle_id", id).gte("starts_at", new Date().toISOString()),
    ])

  const activeNow = active.count || 0
  const discussing = (posts.count || 0) + (comments.count || 0)
  const creating = (posts.count || 0) + (projects.count || 0)
  const voting = reactions.count || 0
  const inLiveRooms = rooms.count || 0
  const newMembers24h = members.count || 0

  const score =
    activeNow * 4 +
    discussing * 0.4 +
    creating * 0.6 +
    voting * 0.2 +
    inLiveRooms * 2 +
    newMembers24h * 0.3

  const state = pulseState(Math.round(score))

  const labels: Record<CommunityPulse["state"], string> = {
    quiet: "Quiet",
    growing: "Growing",
    active: "Active",
    very_active: "Very Active",
    exploding: "Exploding",
  }
  const emojis: Record<CommunityPulse["state"], string> = {
    quiet: "🌙",
    growing: "🌱",
    active: "💫",
    very_active: "⚡",
    exploding: "🔥",
  }

  return {
    active_now: activeNow,
    discussing: discussing,
    creating: creating,
    voting: voting,
    in_live_rooms: inLiveRooms,
    new_members_24h: newMembers24h,
    posts_24h: posts.count || 0,
    comments_24h: comments.count || 0,
    reactions_24h: reactions.count || 0,
    messages_24h: messages.count || 0,
    projects_active: projects.count || 0,
    challenges_active: challenges.count || 0,
    events_upcoming: events.count || 0,
    state,
    label: labels[state],
    emoji: emojis[state],
  }
}

// ---------------------------------------------------------------------------
// DNA — measured from real community behavior
// ---------------------------------------------------------------------------
export interface CommunityDNA {
  creativity: number
  debate: number
  humor: number
  knowledge: number
  collaboration: number
  energy: number
}

export async function computeDNA(sb: SB, circleId: number | string): Promise<CommunityDNA> {
  const id = Number(circleId)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: activity } = await sb
    .from("circle_activity")
    .select("activity_type, metadata")
    .eq("circle_id", id)
    .gte("created_at", since)
    .limit(500)

  const { count: posts } = await sb.from("circle_posts").select("id", { count: "exact", head: true }).eq("circle_id", id)
  const { count: projects } = await sb.from("community_projects").select("id", { count: "exact", head: true }).eq("circle_id", id)

  let creativity = 0
  let debate = 0
  let humor = 0
  let knowledge = 0
  let collaboration = 0

  for (const a of activity || []) {
    const t = a.activity_type || ""
    const meta = (a.metadata || {}) as any
    if (/media|art|gallery|meme|creation|upload|fan_art|showcase/i.test(t)) creativity += 3
    if (/discussion|comment|reply|debate|thread|poll_vote|argument/i.test(t)) debate += 2
    if (/humor|meme|funny|laugh/i.test(t)) humor += 2
    if (/qa|question|answer|resource|knowledge|guide|wiki|help/i.test(t)) knowledge += 2
    if (/project|coloop|co_loop|collab|contribut|task|challenge_entry/i.test(t)) collaboration += 3
    if (meta?.media_type && /image|video/i.test(String(meta.media_type))) creativity += 1
    if (meta?.kind === "humor") humor += 3
  }
  if (projects) collaboration += Math.min(projects * 2, 25)
  if (posts) creativity += Math.min(posts * 0.05, 10)

  const clamp = (n: number) => Math.max(8, Math.min(97, Math.round(n)))
  return {
    creativity: clamp(creativity + 18),
    debate: clamp(debate + 16),
    humor: clamp(humor + 12),
    knowledge: clamp(knowledge + 14),
    collaboration: clamp(collaboration + 20),
    energy: clamp(Math.round((creativity + debate + humor + knowledge + collaboration) / 5) + 8),
  }
}

// ---------------------------------------------------------------------------
// What's Happening — dynamic modules computed from real data
// ---------------------------------------------------------------------------
export interface HappeningItem {
  kind: string
  emoji: string
  title: string
  description: string
  ref_type?: string
  ref_id?: string | number
  ref_username?: string | null
  post_id?: string | number | null
}

export async function computeHappening(sb: SB, circleId: number | string): Promise<HappeningItem[]> {
  const id = Number(circleId)
  const items: HappeningItem[] = []

  // What the community is working on right now, and what it last settled.
  // Threads lead: they are the unit of work, so they belong at the top.
  const { data: liveThread } = await sb
    .from("community_threads")
    .select("id, title, contribution_count, last_activity_at")
    .eq("circle_id", id)
    .eq("state", "open")
    .order("last_activity_at", { ascending: false })
    .limit(1)
  if (liveThread && liveThread.length > 0) {
    const t = liveThread[0]
    items.push({
      kind: "open_thread",
      emoji: "🧵",
      title: "Thread in progress",
      description: `${t.title}${t.contribution_count ? ` — ${t.contribution_count} contributions` : " — nothing added yet"}`,
      ref_type: "thread",
      ref_id: t.id,
    })
  }

  const { data: decidedThread } = await sb
    .from("community_threads")
    .select("id, title, outcome, decided_at")
    .eq("circle_id", id)
    .eq("state", "decided")
    .order("decided_at", { ascending: false })
    .limit(1)
  if (decidedThread && decidedThread.length > 0) {
    const t = decidedThread[0]
    items.push({
      kind: "recent_decision",
      emoji: "⚖️",
      title: "Decided",
      description: t.outcome ? `${t.title} — ${t.outcome}` : t.title,
      ref_type: "thread",
      ref_id: t.id,
    })
  }

  // Trending discussion — most commented post
  const { data: topPost } = await sb
    .from("circle_posts")
    .select("id, content, comment_count, author_id, created_at")
    .eq("circle_id", id)
    .order("comment_count", { ascending: false })
    .limit(1)
  if (topPost && topPost.length > 0 && (topPost[0].comment_count || 0) > 0) {
    items.push({
      kind: "trending_discussion",
      emoji: "🔥",
      title: "Trending discussion",
      description: (topPost[0].content || "").slice(0, 110),
      ref_type: "post",
      ref_id: topPost[0].id,
    })
  }

  // New community project
  const { data: newProject } = await sb
    .from("community_projects")
    .select("id, title, description")
    .eq("circle_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
  if (newProject && newProject.length > 0) {
    items.push({
      kind: "new_project",
      emoji: "🚀",
      title: "New community project",
      description: `"${newProject[0].title}" ${(newProject[0].description || "").slice(0, 80)}`,
      ref_type: "project",
      ref_id: newProject[0].id,
    })
  }

  // Current challenge
  const { data: challenge } = await sb
    .from("circle_challenges")
    .select("id, title, description, ends_at")
    .eq("circle_id", id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
  if (challenge && challenge.length > 0) {
    items.push({
      kind: "active_challenge",
      emoji: "🏆",
      title: "Current challenge",
      description: `"${challenge[0].title}" — ends ${timeAgo(challenge[0].ends_at)}`,
      ref_type: "challenge",
      ref_id: challenge[0].id,
    })
  }

  // Popular post — most liked
  const { data: likedPost } = await sb
    .from("circle_posts")
    .select("id, content, like_count")
    .eq("circle_id", id)
    .order("like_count", { ascending: false })
    .limit(1)
  if (likedPost && likedPost.length > 0 && (likedPost[0].like_count || 0) > 0) {
    items.push({
      kind: "popular_post",
      emoji: "💬",
      title: "Most liked post",
      description: (likedPost[0].content || "").slice(0, 110),
      ref_type: "post",
      ref_id: likedPost[0].id,
    })
  }

  // Active poll
  const { data: poll } = await sb
    .from("circle_post_polls")
    .select("id, question, post_id")
    .eq("circle_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
  if (poll && poll.length > 0) {
    items.push({
      kind: "active_poll",
      emoji: "🗳️",
      title: "Community poll",
      description: (poll[0].question || "").slice(0, 100),
      ref_type: "poll",
      ref_id: poll[0].id,
      post_id: poll[0].post_id || poll[0].id,
    })
  }

  // Upcoming event
  const { data: event } = await sb
    .from("circle_events")
    .select("id, title, starts_at")
    .eq("circle_id", id)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
  if (event && event.length > 0) {
    items.push({
      kind: "upcoming_event",
      emoji: "📅",
      title: "Upcoming event",
      description: `${event[0].title} — ${formatDate(event[0].starts_at)}`,
      ref_type: "event",
      ref_id: event[0].id,
    })
  }

  // Recently featured member (latest recognition receiver)
  const { data: recognition } = await sb
    .from("community_recognitions")
    .select("id, receiver_id, kind, label, created_at, receiver:profiles!receiver_id(username, display_name, avatar_url)")
    .eq("circle_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
  if (recognition && recognition.length > 0) {
    const r = recognition[0]
    items.push({
      kind: "featured_member",
      emoji: "✨",
      title: "Recently recognized",
      description: `${r.receiver?.display_name || r.receiver?.username || "A member"} earned "${r.label || r.kind}"`,
      ref_type: "member",
      ref_id: r.receiver_id,
      ref_username: r.receiver?.username || null,
    })
  }

  // New milestone
  const { data: milestone } = await sb
    .from("community_memory")
    .select("id, title")
    .eq("circle_id", id)
    .eq("kind", "milestone")
    .order("happened_at", { ascending: false })
    .limit(1)
  if (milestone && milestone.length > 0) {
    items.push({
      kind: "milestone",
      emoji: "🎉",
      title: "New milestone",
      description: milestone[0].title,
      ref_type: "memory",
      ref_id: milestone[0].id,
    })
  }

  return items.slice(0, 6)
}

// ---------------------------------------------------------------------------
// Community Loop — how ideas become discussions, votes, builds and history
// ---------------------------------------------------------------------------
export interface CommunityLoopStage {
  key: string
  label: string
  emoji: string
  count: number
  refs: Array<{ id: number | string; title: string; ref_type: string }>
}

export interface CommunityLoopFlow {
  post_id: number
  content: string
  comment_count: number
  created_at: string
  poll: { id: number; question: string; total_votes: number } | null
}

export async function computeCommunityLoop(sb: SB, circleId: number | string) {
  const id = Number(circleId)
  const since = new Date(Date.now() - 14 * 86400000).toISOString()

  const stages: CommunityLoopStage[] = []
  let flows: CommunityLoopFlow[] = []

  // Idea → discussion: posts created in the window, plus the loudest threads.
  const { data: windowPosts } = await sb
    .from("circle_posts")
    .select("id, content, comment_count, created_at, author_id")
    .eq("circle_id", id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(400)
  const windowPostsData = windowPosts || []
  const ideaCount = windowPostsData.length

  const loudThreads =
    (await sb
      .from("circle_posts")
      .select("id, content, comment_count, created_at, author_id")
      .eq("circle_id", id)
      .gte("created_at", since)
      .order("comment_count", { ascending: false })
      .limit(3)) || { data: [] }
  const hotThreads: any[] = (loudThreads as any).data || []

  if (ideaCount > 0) {
    stages.push({
      key: "idea",
      label: "New ideas",
      emoji: "💡",
      count: ideaCount,
      refs: windowPostsData.slice(0, 5).map((p: any) => ({ id: p.id, title: (p.content || "New post").slice(0, 80), ref_type: "post" })),
    })
  }

  const discussed = windowPostsData.filter((p: any) => (p.comment_count || 0) > 0)
  if (discussed.length > 0) {
    stages.push({
      key: "discussion",
      label: "Became discussions",
      emoji: "💬",
      count: discussed.length,
      refs: discussed
        .slice()
        .sort((a: any, b: any) => (b.comment_count || 0) - (a.comment_count || 0))
        .slice(0, 5)
        .map((p: any) => ({ id: p.id, title: `${(p.content || "Thread").slice(0, 70)} — ${p.comment_count} replies`, ref_type: "post" })),
    })
  }

  // Vote: polls created in the window (linked to their posts).
  const { data: polls } = await sb
    .from("circle_post_polls")
    .select("id, question, post_id, total_votes, created_at")
    .eq("circle_id", id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50)
  const pollRows = polls || []
  if (pollRows.length > 0) {
    stages.push({
      key: "vote",
      label: "Put to a vote",
      emoji: "🗳️",
      count: pollRows.reduce((n: number, p: any) => n + Number(p.total_votes || 0), 0),
      refs: pollRows.slice(0, 5).map((p: any) => ({ id: p.post_id || p.id, title: (p.question || "Poll").slice(0, 80), ref_type: "post" })),
    })
  }

  // Build: projects + challenges started in the window.
  const [{ data: projects }, { data: challenges }] = await Promise.all([
    sb.from("community_projects").select("id, title, created_at").eq("circle_id", id).gte("created_at", since).limit(50),
    sb.from("circle_challenges").select("id, title, created_at").eq("circle_id", id).gte("created_at", since).limit(50),
  ])
  const builds = [
    ...(projects || []).map((p: any) => ({ id: p.id, title: (p.title || "Project").slice(0, 80), ref_type: "project" })),
    ...(challenges || []).map((c: any) => ({ id: c.id, title: `Challenge: ${(c.title || "").slice(0, 60)}`, ref_type: "challenge" })),
  ]
  if (builds.length > 0) {
    stages.push({ key: "build", label: "Built together", emoji: "🛠️", count: builds.length, refs: builds.slice(0, 6) })
  }

  // Memory: milestone rows recorded in the window.
  const { data: memoryRows } = await sb
    .from("community_memory")
    .select("id, title, happened_at")
    .eq("circle_id", id)
    .gte("happened_at", since)
    .order("happened_at", { ascending: false })
    .limit(20)
  const memoryRowsData = memoryRows || []
  if (memoryRowsData.length > 0) {
    stages.push({
      key: "memory",
      label: "Becoming history",
      emoji: "📜",
      count: memoryRowsData.length,
      refs: memoryRowsData.slice(0, 5).map((m: any) => ({ id: m.id, title: (m.title || "Milestone").slice(0, 80), ref_type: "memory" })),
    })
  }

  // Hot threads, each with any poll linked straight to it.
  const pollByPost = new Map<number, any>()
  for (const p of pollRows) if (p.post_id) pollByPost.set(Number(p.post_id), p)
  flows = hotThreads
    .filter((p: any) => (p.comment_count || 0) > 0 || pollByPost.has(Number(p.id)))
    .slice(0, 4)
    .map((p: any) => {
      const poll = pollByPost.get(Number(p.id))
      return {
        post_id: p.id,
        content: p.content || "",
        comment_count: p.comment_count || 0,
        created_at: p.created_at,
        poll: poll ? { id: poll.id, question: poll.question || "", total_votes: Number(poll.total_votes || 0) } : null,
      }
    })

  return { stages, flows, window_days: 14 }
}

// ---------------------------------------------------------------------------
// Memory — the community archive
// ---------------------------------------------------------------------------
export async function computeMemory(sb: SB, circleId: number | string, memberCount: number) {
  const id = Number(circleId)
  const milestones: any[] = []

  // Auto milestones from real data
  if (memberCount >= 10) milestones.push({ kind: "milestone", title: `Reached ${memberCount} members`, description: "The world is growing.", is_auto: true })
  const { count: posts } = await sb.from("circle_posts").select("id", { count: "exact", head: true }).eq("circle_id", id)
  if ((posts?.count || 0) >= 100) milestones.push({ kind: "milestone", title: `100+ discussions (${posts?.count})`, description: "The community never stops talking.", is_auto: true })
  if ((posts?.count || 0) >= 1000) milestones.push({ kind: "milestone", title: `1,000+ discussions (${posts?.count})`, description: "A legendary archive.", is_auto: true })

  const { data: bigPost } = await sb
    .from("circle_posts")
    .select("id, content, comment_count")
    .eq("circle_id", id)
    .order("comment_count", { ascending: false })
    .limit(1)
  if (bigPost && bigPost.length > 0 && (bigPost[0].comment_count || 0) >= 10) {
    milestones.push({
      kind: "legend",
      title: "Biggest discussion",
      description: `"${(bigPost[0].content || "").slice(0, 60)}…" with ${bigPost[0].comment_count} replies`,
      is_auto: true,
      ref_type: "post",
      ref_id: bigPost[0].id,
    })
  }

  const { data: projects } = await sb.from("community_projects").select("id, title").eq("circle_id", id).limit(1)
  if (projects && projects.length > 0) {
    milestones.push({ kind: "milestone", title: "First community project", description: `"${projects[0].title}"`, is_auto: true, ref_type: "project", ref_id: projects[0].id })
  }

  const { data: challengeRows } = await sb.from("circle_challenges").select("id").eq("circle_id", id).limit(200)
  const challengeIds = (challengeRows || []).map((ch: any) => ch.id)
  let topVoted = 0
  if (challengeIds.length > 0) {
    const { data: winners } = await sb
      .from("community_challenge_entries")
      .select("challenge_id, vote_count, user_id")
      .in("challenge_id", challengeIds)
      .order("vote_count", { ascending: false })
      .limit(1)
    topVoted = winners?.[0]?.vote_count || 0
  }
  if (topVoted >= 5) {
    milestones.push({ kind: "legend", title: "Challenge crowned", description: "A community favorite won with votes.", is_auto: true })
  }

  // Manual memories
  const { data: manual } = await sb
    .from("community_memory")
    .select("*")
    .eq("circle_id", id)
    .eq("is_auto", false)
    .order("happened_at", { ascending: false })
    .limit(20)

  return {
    auto: milestones.slice(0, 6),
    manual: manual || [],
    all: [...(manual || []), ...milestones.slice(0, 4)].sort((a, b) => {
      const ad = a.happened_at || a.created_at || 0
      const bd = b.happened_at || b.created_at || 0
      return String(bd).localeCompare(String(ad))
    }),
  }
}

// ---------------------------------------------------------------------------
// Moments — surfaced highlights
// ---------------------------------------------------------------------------
export async function computeMoments(sb: SB, circleId: number | string) {
  const id = Number(circleId)
  const moments: any[] = []

  const { data: topPost } = await sb.from("circle_posts").select("id, content, like_count, comment_count").eq("circle_id", id).order("like_count", { ascending: false }).limit(1)
  if (topPost && topPost.length > 0 && (topPost[0].like_count || 0) >= 5) {
    moments.push({ kind: "favorite", emoji: "🎨", title: "Community favorite", description: (topPost[0].content || "").slice(0, 100), ref_type: "post", ref_id: topPost[0].id, is_auto: true })
  }
  const { data: hotPost } = await sb.from("circle_posts").select("id, content, comment_count").eq("circle_id", id).order("comment_count", { ascending: false }).limit(1)
  if (hotPost && hotPost.length > 0 && (hotPost[0].comment_count || 0) >= 5) {
    moments.push({ kind: "most_discussed", emoji: "🔥", title: "Most discussed", description: (hotPost[0].content || "").slice(0, 100), ref_type: "post", ref_id: hotPost[0].id, is_auto: true })
  }
  const { data: challengeRows2 } = await sb.from("circle_challenges").select("id").eq("circle_id", id).limit(200)
  const challengeIds2 = (challengeRows2 || []).map((ch: any) => ch.id)
  let topEntry: any = null
  if (challengeIds2.length > 0) {
    const { data: topEntryRows } = await sb
      .from("community_challenge_entries")
      .select("id, content, vote_count, challenge_id")
      .in("challenge_id", challengeIds2)
      .order("vote_count", { ascending: false })
      .limit(1)
    topEntry = topEntryRows?.[0] || null
  }
  if (topEntry && (topEntry.vote_count || 0) >= 3) {
    moments.push({ kind: "top_contribution", emoji: "🏆", title: "Top contribution", description: (topEntry.content || "").slice(0, 100), ref_type: "challenge_entry", ref_id: topEntry.id, is_auto: true })
  }

  const { data: manual } = await sb.from("community_moments").select("*").eq("circle_id", id).eq("is_manual", true).order("created_at", { ascending: false }).limit(10)
  return { auto: moments, manual: manual || [], all: [...(manual || []), ...moments] }
}

// ---------------------------------------------------------------------------
// Reputation — community-specific, contribution-weighted
// ---------------------------------------------------------------------------
export async function computeReputation(sb: SB, circleId: number | string, userId: string) {
  const id = Number(circleId)

  const [{ data: member }, { data: postRows }, { data: comments }, { data: recognitions }, { data: projects }] =
    await Promise.all([
      sb.from("circle_members").select("contribution_score, joined_at, role").eq("circle_id", id).eq("user_id", userId).maybeSingle(),
      sb.from("circle_posts").select("id, like_count").eq("circle_id", id).eq("author_id", userId).limit(200),
      sb.from("circle_post_comments").select("id", { count: "exact", head: true }).eq("circle_id", id).eq("author_id", userId),
      sb.from("community_recognitions").select("id, kind", { count: "exact", head: true }).eq("circle_id", id).eq("receiver_id", userId),
      sb.from("community_project_members").select("id", { count: "exact", head: true }).eq("user_id", userId),
    ])

  const postCount = postRows?.length || 0
  const likesReceived = (postRows || []).reduce((sum: number, p: any) => sum + (Number(p.like_count) || 0), 0)
  const commentCount = comments?.count || 0
  const recCount = recognitions?.count || 0
  const projectCount = projects?.count || 0

  // Meaningful contributions: posts + likes received, comments, recognitions, project membership
  const reputation = Math.round(
    (member?.contribution_score || 0) * 2 +
      postCount * 6 +
      likesReceived +
      commentCount * 2 +
      recCount * 25 +
      projectCount * 15
  )

  const { count: totalMembers } = await sb.from("circle_members").select("id", { count: "exact", head: true }).eq("circle_id", id).neq("status", "banned")
  const contributionRank = Math.min(postCount + commentCount * 0.5 + recCount * 5, totalMembers || 1)
  const percentile = Math.max(1, Math.min(100, 100 - Math.round((contributionRank / Math.max(totalMembers || 1, 1)) * 100)))

  return {
    reputation,
    posts: postCount,
    comments: commentCount,
    recognitions: recCount,
    projects: projectCount,
    role: member?.role || "guest",
    joined_at: member?.joined_at || null,
    percentile,
  }
}

// ---------------------------------------------------------------------------
// Evolution recommendations — from real activity, owner-approved
// ---------------------------------------------------------------------------
export async function computeEvolution(sb: SB, circleId: number | string, enabledFeatures: Record<string, boolean>, existingSpaces: string[]) {
  const id = Number(circleId)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: activity } = await sb.from("circle_activity").select("activity_type, metadata").eq("circle_id", id).gte("created_at", since).limit(300)
  const acts: any[] = activity || []

  const mediaShare = acts.filter((a: any) => /media|art|gallery|meme|upload|creation/i.test(a.activity_type)).length
  const discussionShare = acts.filter((a: any) => /discussion|comment|reply|thread|debate/i.test(a.activity_type)).length
  const projectShare = acts.filter((a: any) => /project|coloop|collab|contribut|task/i.test(a.activity_type)).length
  const total = Math.max(acts.length, 1)
  const recs: any[] = []

  if (mediaShare / total >= 0.25 && !enabledFeatures.creator_gallery) {
    recs.push({
      kind: "feature",
      title: "Enable Creator Gallery",
      description: `${Math.round((mediaShare / total) * 100)}% of recent activity is visual creation. A gallery space will showcase it.`,
      payload: { feature: "creator_gallery", space: { name: "Gallery", type: "gallery", icon: "image" } },
    })
  }
  if (projectShare / total >= 0.15 && !enabledFeatures.art_challenges && existingSpaces.includes("projects")) {
    recs.push({
      kind: "feature",
      title: "Enable Art Challenges",
      description: "Members are collaborating heavily. Weekly challenges keep that momentum.",
      payload: { feature: "art_challenges" },
    })
  }
  if (discussionShare / total >= 0.3 && !existingSpaces.includes("challenges")) {
    recs.push({
      kind: "space",
      title: "Add a Challenges space",
      description: "Discussions are thriving — structured challenges will turn talk into creations.",
      payload: { space: { name: "Challenges", type: "challenges", icon: "flame" } },
    })
  }
  if (acts.length >= 20 && !existingSpaces.includes("qa")) {
    recs.push({
      kind: "space",
      title: "Add a Q&A space",
      description: "With this much activity, a Q&A space will help knowledge stick.",
      payload: { space: { name: "Q&A", type: "qa", icon: "help-circle" } },
    })
  }
  if (acts.length >= 30 && existingSpaces.length < 6) {
    recs.push({
      kind: "module",
      title: "Add a Media space",
      description: "The world is active — give members a visual home.",
      payload: { space: { name: "Media", type: "media", icon: "image" } },
    })
  }
  if (acts.length >= 40) {
    recs.push({
      kind: "role",
      title: "Create a custom role",
      description: "Your community is big enough for recognition roles beyond the defaults.",
      payload: { role: { name: "Top Contributor", color: "#f59e0b" } },
    })
  }

  return recs.slice(0, 4)
}

// ---------------------------------------------------------------------------
// World bundle — one fetch powers the whole Community World page
// ---------------------------------------------------------------------------
export async function getWorldBundle(sb: SB, circleId: number | string, viewerId: string | null) {
  const id = Number(circleId)

  const { data: circle, error } = await sb
    .from("circles")
    .select(`
      *,
      owner:profiles!owner_id(id, username, display_name, avatar_url, is_verified, is_premium),
      creator:profiles!creator_id(id, username, display_name, avatar_url, is_verified, is_premium),
      member_count:circle_members(count)
    `)
    .eq("id", id)
    .single()

  if (error || !circle) return null

  const memberCount = Number(Array.isArray(circle.member_count) ? circle.member_count[0]?.count : circle.member_count || 0)

  // Membership + role
  let membership: any = null
  if (viewerId) {
    const { data: m } = await sb
      .from("circle_members")
      .select("*")
      .eq("circle_id", id)
      .eq("user_id", viewerId)
      .maybeSingle()
    membership = m
  }

  const role = membership?.role || "guest"
  const isMember = Boolean(membership && membership.status === "active")

  // Seed default spaces on first visit (migration path for existing circles)
  await ensureDefaultSpaces(sb, circle, viewerId)

  const [
    spaces,
    pulse,
    happening,
    memory,
    moments,
    recentMembers,
    projects,
    challenges,
    threads,
    onlineMembers,
    abilities,
  ] = await Promise.all([
    sb.from("community_spaces").select("*").eq("circle_id", id).eq("is_archived", false).order("sort_order").limit(30),
    computePulse(sb, id),
    computeHappening(sb, id),
    computeMemory(sb, id, memberCount),
    computeMoments(sb, id),
    sb.from("circle_members").select("user_id, role, joined_at, last_active, user:profiles!user_id(id, username, display_name, avatar_url, is_verified, is_premium)").eq("circle_id", id).neq("status", "banned").order("joined_at", { ascending: false }).limit(12),
    sb.from("community_projects").select("*, creator:profiles!created_by(id, username, display_name, avatar_url)").eq("circle_id", id).order("created_at", { ascending: false }).limit(8),
    sb.from("circle_challenges").select("*").eq("circle_id", id).order("created_at", { ascending: false }).limit(6),
    // Threads are the front door, so the bundle carries the live board.
    sb
      .from("community_threads")
      .select(
        `*,
         creator:profiles!created_by(id, username, display_name, avatar_url, is_verified),
         space:community_spaces!space_id(id, name, icon, type)`,
      )
      .eq("circle_id", id)
      .order("is_pinned", { ascending: false })
      .order("last_activity_at", { ascending: false })
      .limit(14),
    // Who is around right now (last 15 minutes of activity).
    sb
      .from("circle_members")
      .select("user_id, role, last_active, user:profiles!user_id(id, username, display_name, avatar_url, is_verified, is_premium)")
      .eq("circle_id", id)
      .eq("status", "active")
      .gte("last_active", new Date(Date.now() - 15 * 60 * 1000).toISOString())
      .order("last_active", { ascending: false })
      .limit(14),
    viewerAbilities(sb, id, viewerId),
  ])

  const spacesData = spaces.data || []

  // Per-space activity stats (post count + last activity) for richer cards
  if (spacesData.length > 0) {
    const { data: spacePosts } = await sb
      .from("circle_posts")
      .select("space_id, created_at")
      .in(
        "space_id",
        spacesData.map((s: any) => s.id),
      )
    const bySpace: Record<string, { count: number; last: string | null }> = {}
    for (const p of spacePosts || []) {
      const k = String(p.space_id)
      const cur = bySpace[k] || { count: 0, last: null }
      cur.count += 1
      if (!cur.last || (p.created_at && p.created_at > cur.last)) cur.last = p.created_at
      bySpace[k] = cur
    }
    for (const s of spacesData) {
      const stat = bySpace[String(s.id)] || { count: 0, last: null }
      ;(s as any).post_count = stat.count
      ;(s as any).last_activity_at = stat.last
    }
  }

  // Which Power was handed to which member — needed to draw role chips.
  const powers = await listPowers(sb, id)

  const threadRows = (threads.data || []).map((t: any) => ({ ...t, follow_mode: null }))

  return {
    community: circle,
    member_count: memberCount,
    membership,
    role,
    is_member: isMember,
    is_moderator: canModerate(role),
    is_admin: canAdmin(role),
    is_owner: isOwnerRole(role),
    spaces: spacesData,
    pulse,
    happening,
    memory,
    moments,
    threads: threadRows,
    powers: powers.roles,
    power_assignments: powers.by_user,
    abilities: {
      role: abilities.role,
      permissions: Array.from(abilities.permissions),
      powers: abilities.powers.map((p: any) => ({ id: p.id, name: p.name, color: p.color })),
    },
    online_members: onlineMembers.data || [],
    recent_members: recentMembers.data || [],
    projects: projects.data || [],
    challenges: challenges.data || [],
    viewer: viewerId,
  }
}

// ---------------------------------------------------------------------------
// Discovery ranking helpers
// ---------------------------------------------------------------------------
export async function listCommunitiesForDiscovery(sb: SB, opts: { sort?: string; category?: string; search?: string; viewerId?: string | null; limit?: number; offset?: number; excludePrivateFrom?: string | null }) {
  const { sort = "trending", category, search, viewerId = null, limit = 24, offset = 0 } = opts

  let query = sb
    .from("circles")
    .select(`
      *,
      owner:profiles!owner_id(id, username, display_name, avatar_url),
      member_count:circle_members(count)
    `)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (category) query = query.eq("category", category)
  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,handle.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) return { communities: [], error }

  // Fetch viewer memberships once for is_member flags
  const memberMap = new Map<string, any>()
  if (viewerId && data) {
    const ids = data.map((c: any) => c.id)
    const { data: memberships } = await sb
      .from("circle_members")
      .select("circle_id, role, status")
      .in("circle_id", ids)
      .eq("user_id", viewerId)
    for (const m of memberships || []) memberMap.set(String(m.circle_id), m)
  }

  // Private Circles are visible in discovery only to their owners, members
  // and pending applicants.
  const visibleCommunities = (data || []).filter((circle: any) => {
    const membership = memberMap.get(String(circle.id))
    return isPrivateCircleDiscoverable({
      isPrivate: Boolean(circle.is_private),
      viewerId,
      ownerId: circle.owner_id || null,
      membershipStatus: membership?.status,
    })
  })

  // Count recent activity only for Circles this viewer may discover.
  const activeMap = new Map<string, number>()
  if (visibleCommunities.length > 0) {
    const ids = visibleCommunities.map((c: any) => c.id)
    const { data: activity } = await sb
      .from("circle_activity")
      .select("circle_id")
      .in("circle_id", ids)
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .limit(3000)
    for (const a of activity || []) {
      activeMap.set(String(a.circle_id), (activeMap.get(String(a.circle_id)) || 0) + 1)
    }
  }

  const now = Date.now()
  const enriched = visibleCommunities.map((c: any) => {
    const memberCount = Number(Array.isArray(c.member_count) ? c.member_count[0]?.count : c.member_count || 0)
    const activeCount = activeMap.get(String(c.id)) || 0
    const createdAt = new Date(c.created_at).getTime()
    const ageDays = Math.max(1, (now - createdAt) / 86400000)
    const pulse = pulseState(Math.round(activeCount * 2 + memberCount * 0.05 + 30 / ageDays))
    const membership = memberMap.get(String(c.id))
    return {
      ...c,
      member_count: memberCount,
      active_count: activeCount,
      pulse,
      is_member: membership?.status === "active" || membership?.status === "approved",
      membership_status: membership?.status || null,
      user_role: membership?.role || "guest",
      category_config: getCategoryConfig(c.category),
      score:
        sort === "growing" ? (activeCount * 0.5 + (memberCount / ageDays) * 3) :
        sort === "new" ? createdAt / 1000 :
        sort === "active" ? activeCount * 1.5 + memberCount * 0.02 :
        sort === "recommended" ? activeCount * 0.8 + memberCount * 0.1 + 40 / ageDays :
        memberCount * 0.5 + activeCount * 1.2 + 20 / ageDays,
    }
  })

  enriched.sort((a: any, b: any) => b.score - a.score)
  return { communities: enriched, error: null }
}

// ---------------------------------------------------------------------------
// Small date helpers
// ---------------------------------------------------------------------------
export function timeAgo(value: string | Date | null | undefined, future = false) {
  if (!value) return future ? "soon" : "just now"
  const t = new Date(value).getTime()
  const diff = t - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60000)
  const suffix = diff >= 0 ? (future ? " left" : " from now") : " ago"
  if (mins < 1) return diff >= 0 ? "now" : "just now"
  if (mins < 60) return `${mins}m${suffix}`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h${suffix}`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d${suffix}`
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return ""
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function formatNumber(n: number | string | null | undefined) {
  const num = Number(n || 0)
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "k"
  return String(num)
}