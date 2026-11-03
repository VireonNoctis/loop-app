"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/skeletons"
import { VerifiedSeal } from "@/components/ui/verified-seal"
import { DeleteCommunityDialog, EditCommunityDialog, ManageMembersDialog } from "@/components/communities/forum/community-admin"
import { RolesDialog } from "@/components/communities/forum/roles-panel"
import { CircleEvents } from "@/components/communities/forum/circle-events"
import { RoleChip, type RoleBadgeLike } from "@/components/communities/forum/role-chip"
import { uploadMediaFile } from "@/lib/client-media-upload"
import { cn } from "@/lib/utils"
import {
  ArrowBigUp,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Clock,
  Eye,
  Flame,
  GitBranch,
  Hash,
  ImagePlus,
  Loader2,
  Lock,
  MessageSquare,
  MessagesSquare,
  Pin,
  Plus,
  Radio,
  Search,
  SearchX,
  Settings2,
  Shield,
  Sparkles,
  Swords,
  Trash2,
  Users,
} from "lucide-react"

type Author = {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  is_verified?: boolean
  role_badge?: RoleBadgeLike | null
}

type Thread = {
  id: string
  title: string
  excerpt: string
  author: Author | null
  forum: { id: string; name: string; icon?: string | null } | null
  tags: string[]
  replies: number
  votes: number
  views: number
  pinned: boolean
  locked: boolean
  created_at: string
  last_activity_at: string
}

type Forum = { id: string; name: string; icon?: string | null; description?: string | null; count: number }

type CircleChain = {
  id: string
  title: string
  description: string
  prompt: string
  kind: string
  contribution_count: number
  participant_count: number
  creator_display_name: string
  creator_username: string
  updated_at: string
}

type ForumData = {
  community: any
  viewer: {
    is_member: boolean
    can_post: boolean
    can_create?: boolean
    is_staff: boolean
    can_manage: boolean
    role: string | null
  }
  threads: Thread[]
  forums: Forum[]
  staff: Array<{ role: string; user: Author }>
  members: Author[]
  coloops: Array<{ id: string; session_id: string; title: string; description: string | null; status: string; creator: Author | null }>
  duels: Array<{
    id: string
    loop_id: string | null
    prompt: string
    status: string
    votes: number
    entrants: number
    creator: Author | null
  }>
  counts: { threads: number; replies: number; members: number }
}

const SORTS = [
  { id: "latest", label: "Latest", icon: Clock },
  { id: "newest", label: "New", icon: Sparkles },
  { id: "top", label: "Top", icon: Flame },
  { id: "views", label: "Most read", icon: Eye },
] as const

function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diff) || diff < 0) return "now"
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function initials(name?: string | null) {
  return (name || "?").trim().slice(0, 2).toUpperCase()
}

function compact(n: number) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`
}

/**
 * The community forum.
 *
 * A thread is a post with a title; a forum is a space; replies live under the
 * thread. Owners and admins edit the community and manage members from the
 * header, so the page stays one stream with no extra tabs.
 */
export function ForumHome({ communityId }: { communityId: string }) {
  const router = useRouter()
  const { user, getAuthHeader } = useAuth()
  const { toast } = useToast()

  const [data, setData] = useState<ForumData | null>(null)
  const [circleChains, setCircleChains] = useState<CircleChain[]>([])
  const [chainsLoading, setChainsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("latest")
  const [forum, setForum] = useState("all")
  const [query, setQuery] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [joining, setJoining] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [rolesOpen, setRolesOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // debounce the search box so typing doesn't hammer the API
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(query.trim()), 350)
    return () => clearTimeout(t)
  }, [query])

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      try {
        const params = new URLSearchParams({ sort, forum, limit: "30" })
        if (searchTerm) params.set("q", searchTerm)
        const res = await fetch(`/api/communities/${communityId}/forum?${params.toString()}`, {
          headers: { ...getAuthHeader() },
          cache: "no-store",
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || "Failed to load forum")
        setData(json)
        setError(null)
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    },
    [communityId, sort, forum, searchTerm, getAuthHeader, user?.id],
  )

  useEffect(() => {
    void load()
  }, [load])

  // The Circle page is also the home for the collaborative objects built by
  // its members. The Rust API applies the same Circle membership/privacy rules
  // used on /chains; this is only a presentation layer, never an access check.
  useEffect(() => {
    if (!data?.community) return
    let cancelled = false
    setChainsLoading(true)
    const params = new URLSearchParams({ circle_id: communityId, limit: "24", sort: "active" })
    void fetch(`/api/v1/chains?${params.toString()}`, {
      headers: getAuthHeader(),
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.message || result.error || "Could not load Circle Chains")
        if (!cancelled) setCircleChains(Array.isArray(result.chains) ? result.chains : [])
      })
      .catch(() => {
        if (!cancelled) setCircleChains([])
      })
      .finally(() => {
        if (!cancelled) setChainsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [communityId, Boolean(data?.community), getAuthHeader, data?.viewer?.is_member, user?.id])

  const community = data?.community
  const viewer = data?.viewer
  // Only the founder and admins may destroy the whole world; moderators can
  // still run it from Settings and People.
  const canDeleteCommunity = viewer?.role === "owner" || viewer?.role === "admin"
  const forums = useMemo(() => data?.forums || [], [data?.forums])
  const rules: string[] = useMemo(
    () => (Array.isArray(community?.rules) ? community.rules.filter((r: any) => typeof r === "string" && r.trim()) : []),
    [community?.rules],
  )

  const join = async () => {
    if (!user) {
      router.push(`/auth?returnTo=/communities/${communityId}`)
      return
    }
    setJoining(true)
    try {
      const res = await fetch(`/api/circles/${communityId}/join`, {
        method: "POST",
        headers: { ...getAuthHeader() },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Could not join")
      toast({
        title: json.status === "pending" ? "Request sent" : "Welcome in",
        description:
          json.status === "pending" ? "A moderator will review your request." : "You can start a thread now.",
      })
      await load({ silent: true })
    } catch (e: any) {
      toast({ title: "Could not join", description: e.message, variant: "destructive" })
    } finally {
      setJoining(false)
    }
  }

  const canCreateThread = Boolean(viewer?.can_create ?? viewer?.can_post)

  const openComposer = () => {
    if (!user) {
      router.push(`/auth?returnTo=/communities/${communityId}`)
      return
    }
    if (!viewer?.is_member) {
      toast({ title: "Members only", description: "Join this community to start a thread." })
      return
    }
    if (!canCreateThread) {
      toast({
        title: "Threads are restricted here",
        description: "Only the roles your owners picked may start new threads in this community.",
      })
      return
    }
    setComposerOpen(true)
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="h-7 w-7 text-primary" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <p className="text-sm font-medium text-foreground">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    )
  }

  if (!data || !community) return null

  const banner = community.banner_url || community.cover_url || null
  const accent: string = community.accent_color || "#5e6ad2"
  const activeForum = forums.find((f) => f.id === forum)
  const liveCount = (data.coloops?.length || 0) + (data.duels?.length || 0)

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 pb-4 text-xs font-medium text-muted-foreground">
        <Link href="/communities" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Communities
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="truncate text-foreground/70">{community.name}</span>
      </div>

      {/* ── World header ── */}
      <section className="overflow-hidden rounded-[28px] border border-border bg-card">
        <div className="relative h-40 sm:h-56">
          {banner ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={banner} alt="" className="h-full w-full object-cover" />
          ) : (
            <div
              className="h-full w-full"
              style={{
                backgroundImage: `radial-gradient(120% 140% at 12% 0%, ${accent}55 0%, ${accent}18 38%, transparent 72%)`,
              }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/45 to-transparent" />
          <div className="absolute right-4 top-4 flex flex-wrap items-center gap-1.5">
            {community.is_verified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">
                <BadgeCheck className="h-3.5 w-3.5 text-emerald-500" /> Official
              </span>
            )}
            {community.is_private && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-semibold text-amber-600 backdrop-blur dark:text-amber-400">
                <Lock className="h-3.5 w-3.5" /> Private
              </span>
            )}
            {community.category && (
              <span className="rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-semibold capitalize backdrop-blur">
                {String(community.category).replace(/_/g, " ")}
              </span>
            )}
          </div>
        </div>

        <div className="-mt-14 px-5 pb-6 sm:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 items-end gap-4 sm:gap-5">
              <Avatar className="h-24 w-24 shrink-0 rounded-3xl border-4 border-card shadow-xl sm:h-28 sm:w-28">
                <AvatarImage src={community.avatar_url || undefined} alt={community.name} />
                <AvatarFallback className="rounded-3xl text-2xl font-black">{initials(community.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 pb-1">
                <h1 className="truncate text-3xl font-black leading-[1.05] tracking-tight text-foreground sm:text-4xl md:text-5xl">
                  {community.name}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {community.handle ? `c/${community.handle}` : `c/${community.id}`}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pb-1">
              {!viewer?.is_member ? (
                <Button onClick={join} disabled={joining} size="lg" className="rounded-full px-6">
                  {joining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                  {community.is_private ? "Request to join" : "Join this world"}
                </Button>
              ) : (
                <Button onClick={openComposer} size="lg" className="rounded-full px-6">
                  <Plus className="mr-2 h-4 w-4" />
                  New thread
                </Button>
              )}
              {viewer?.can_manage && (
                <div className="flex items-center gap-1 rounded-full border border-border bg-background/60 p-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full px-3 text-xs"
                    onClick={() => setEditOpen(true)}
                  >
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Settings
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full px-3 text-xs"
                    onClick={() => setMembersOpen(true)}
                  >
                    <Users className="mr-1.5 h-3.5 w-3.5" /> People
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full px-3 text-xs"
                    onClick={() => setRolesOpen(true)}
                  >
                    <Shield className="mr-1.5 h-3.5 w-3.5" /> Roles
                  </Button>
                </div>
              )}
            </div>
          </div>

          {community.description && (
            <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {community.description}
            </p>
          )}

          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
            {[
              { id: "threads", label: "Threads", value: data.counts.threads, icon: MessagesSquare },
              { id: "replies", label: "Replies", value: data.counts.replies, icon: MessageSquare },
              { id: "members", label: "Members", value: data.counts.members, icon: Users },
              { id: "live", label: "Live now", value: liveCount, icon: Radio },
            ].map((stat) => {
              const Icon = stat.icon
              return (
                <div key={stat.id} className="bg-card px-4 py-3.5 sm:px-5 sm:py-4">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    {stat.label}
                  </div>
                  <p className="mt-1 text-2xl font-black tabular-nums tracking-tight text-foreground">
                    {compact(stat.value)}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Live in this world ── */}
      {liveCount > 0 && (
        <section className="mt-6">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Live in this world
            </h2>
          </div>
          <div className="mt-3 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {(data.coloops || []).map((c) => (
              <Link
                key={`coloop-${c.id}`}
                href={`/co-loop/studio?session=${encodeURIComponent(c.session_id)}`}
                className="group flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Radio className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">Co-Loop live</p>
                  <p className="mt-0.5 line-clamp-1 text-sm font-semibold text-foreground">{c.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {c.creator?.display_name || c.creator?.username || "Someone"} is working in the open
                  </p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </Link>
            ))}
            {(data.duels || []).map((d) => {
              const body = (
                <>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <Swords className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400">
                      Duel · {d.status || "open"}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-sm font-semibold text-foreground">{d.prompt}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {d.entrants} {d.entrants === 1 ? "entry" : "entries"} · {d.votes} votes
                    </p>
                  </div>
                </>
              )
              return d.loop_id ? (
                <Link
                  key={`duel-${d.id}`}
                  href={`/loop/${d.loop_id}`}
                  className="group flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-amber-500/40 hover:bg-muted/30"
                >
                  {body}
                </Link>
              ) : (
                <div key={`duel-${d.id}`} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
                  {body}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Collaborative Chains ── */}
      <section className="mt-7 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Made by this Circle</p>
            <h2 className="mt-1 text-xl font-bold tracking-tight">Chains being built here</h2>
            <p className="mt-1 text-xs text-muted-foreground">Shared stories, rankings, projects and ideas that grow through contributions.</p>
          </div>
          <Link
            href={`/chains?circle_id=${encodeURIComponent(communityId)}`}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold transition hover:border-primary/40 hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" /> Start a Chain
          </Link>
        </div>

        {chainsLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-2xl border border-border bg-card" />
            ))}
          </div>
        ) : circleChains.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {circleChains.map((chain) => (
              <Link
                key={chain.id}
                href={`/chains/${chain.id}`}
                className="group flex min-h-36 flex-col rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                    <GitBranch className="h-3 w-3" /> {chain.kind.replace(/_/g, " ")}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
                <h3 className="mt-3 line-clamp-2 text-sm font-bold">{chain.title}</h3>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {chain.prompt || chain.description || "An idea waiting for its next contribution."}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-3 text-[11px] text-muted-foreground">
                  <span>{chain.contribution_count} contributions</span>
                  <span>{chain.participant_count} contributors</span>
                  <span className="ml-auto truncate">by {chain.creator_display_name || chain.creator_username}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border bg-card px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">This Circle hasn&apos;t started a Chain yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">Start a shared story, world, ranking or community project.</p>
            </div>
            <Link
              href={`/chains?circle_id=${encodeURIComponent(communityId)}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" /> Create the first Chain
            </Link>
          </div>
        )}
      </section>

      <CircleEvents communityId={communityId} isMember={Boolean(viewer?.is_member)} />

      {/* ── Forums ── */}
      <div className="mt-7 flex gap-1.5 overflow-x-auto rounded-2xl border border-border bg-card p-1.5">
        {forums.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setForum(f.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-colors",
              forum === f.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {f.id === "all" ? (
              <MessagesSquare className="h-4 w-4" />
            ) : f.id === "unanswered" ? (
              <MessageSquare className="h-4 w-4" />
            ) : (
              <Hash className="h-4 w-4" />
            )}
            {f.name}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                forum === f.id ? "bg-primary-foreground/20" : "bg-muted",
              )}
            >
              {f.count}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_336px]">
        {/* ── Thread list ── */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={activeForum && activeForum.id !== "all" ? `Search ${activeForum.name}…` : "Search threads…"}
                className="h-11 rounded-xl pl-10 text-sm"
              />
            </div>
            <div className="flex items-center gap-0.5 rounded-xl border border-border bg-card p-1">
              {SORTS.map((s) => {
                const Icon = s.icon
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSort(s.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                      sort === s.id
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center rounded-2xl border border-border bg-card py-20">
              <Spinner className="h-6 w-6 text-muted-foreground" />
            </div>
          ) : data.threads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-20 text-center">
              {searchTerm ? (
                <SearchX className="mx-auto h-9 w-9 text-muted-foreground/50" />
              ) : (
                <MessagesSquare className="mx-auto h-9 w-9 text-muted-foreground/50" />
              )}
              <p className="mt-3 text-base font-bold text-foreground">
                {searchTerm ? "No threads match that search" : "No threads here yet"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                {searchTerm
                  ? "Try a different phrase, or clear the search to see everything."
                  : "Every community starts with one conversation. Yours could be the first."}
              </p>
              {!searchTerm && (
                <Button onClick={openComposer} className="mt-5 rounded-full" size="sm">
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Start a thread
                </Button>
              )}
            </div>
          ) : (
            <ul className="space-y-2.5">
              {data.threads.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/communities/${communityId}/posts/${t.id}`}
                    className={cn(
                      "group flex gap-4 rounded-2xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:bg-muted/20 sm:p-5",
                      t.pinned && "border-emerald-500/30 bg-emerald-500/[0.04]",
                    )}
                  >
                    <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 self-start rounded-xl border border-border/60 bg-muted/40 px-1 py-2">
                      <ArrowBigUp className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs font-bold tabular-nums">{compact(t.votes)}</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {t.pinned && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                            <Pin className="h-2.5 w-2.5" /> Pinned
                          </span>
                        )}
                        {t.locked && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                            <Lock className="h-2.5 w-2.5" /> Locked
                          </span>
                        )}
                        {t.forum && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/80">
                            <Hash className="h-2.5 w-2.5" />
                            {t.forum.name}
                          </span>
                        )}
                      </div>

                      <h2 className="mt-1 line-clamp-2 text-base font-bold leading-snug text-foreground transition-colors group-hover:text-primary sm:text-lg">
                        {t.title}
                      </h2>
                      {t.excerpt && (
                        <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                          {t.excerpt}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-muted-foreground">
                        {t.author && (
                          <span className="inline-flex items-center gap-1.5">
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={t.author.avatar_url || undefined} alt="" />
                              <AvatarFallback className="text-[8px]">
                                {initials(t.author.display_name || t.author.username)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-semibold text-foreground/80">
                              {t.author.display_name || t.author.username}
                            </span>
                            {t.author.role_badge && <RoleChip badge={t.author.role_badge} />}
                            {t.author.is_verified && <VerifiedSeal size={12} variant="emerald" />}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {timeAgo(t.last_activity_at)}
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-foreground/70">
                          <MessageSquare className="h-3 w-3" /> {t.replies}{" "}
                          {t.replies === 1 ? "reply" : "replies"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Eye className="h-3 w-3" /> {compact(t.views)}
                        </span>
                        {t.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Sidebar ── */}
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">About</h3>
            <p className="mt-2 text-sm leading-relaxed text-foreground/80">
              {community.description || "A world built by the people in it."}
            </p>
            <dl className="mt-4 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> Members
                </dt>
                <dd className="font-semibold tabular-nums">{community.member_count?.toLocaleString?.() ?? data.counts.members}</dd>
              </div>
              {community.category && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" /> Category
                  </dt>
                  <dd className="font-semibold capitalize">{String(community.category).replace(/_/g, " ")}</dd>
                </div>
              )}
              {community.created_at && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" /> Founded
                  </dt>
                  <dd className="font-semibold">
                    {new Date(community.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      year: "numeric",
                    })}
                  </dd>
                </div>
              )}
            </dl>
            {!viewer?.is_member && (
              <Button onClick={join} disabled={joining} variant="outline" className="mt-4 w-full rounded-full text-xs">
                {joining ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                {community.is_private ? "Request to join" : "Join community"}
              </Button>
            )}
          </div>

          {rules.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <Shield className="h-3.5 w-3.5" /> House rules
              </h3>
              <ol className="mt-3 space-y-2 text-[13px] leading-relaxed text-foreground/80">
                {rules.slice(0, 8).map((rule, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-px font-mono text-[11px] font-bold text-muted-foreground/70">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {data.staff.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Moderators</h3>
              <ul className="mt-3 space-y-2.5">
                {data.staff.map((s) => (
                  <li key={`${s.user.id}-${s.role}`} className="flex items-center gap-2.5">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={s.user.avatar_url || undefined} alt="" />
                      <AvatarFallback className="text-[9px]">
                        {initials(s.user.display_name || s.user.username)}
                      </AvatarFallback>
                    </Avatar>
                    <Link
                      href={`/profile/${s.user.username || s.user.id}`}
                      className="min-w-0 flex-1 truncate text-[13px] font-semibold hover:underline"
                    >
                      {s.user.display_name || s.user.username}
                    </Link>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                      {s.role}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.members.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Members</h3>
                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {compact(data.counts.members)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {data.members.map((m) => (
                  <Link key={m.id} href={`/profile/${m.username || m.id}`} title={m.display_name || m.username || ""}>
                    <Avatar className="h-8 w-8 ring-1 ring-border transition-transform hover:scale-105">
                      <AvatarImage src={m.avatar_url || undefined} alt="" />
                      <AvatarFallback className="text-[9px]">
                        {initials(m.display_name || m.username)}
                      </AvatarFallback>
                    </Avatar>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      <NewThreadSheet
        open={composerOpen}
        onOpenChange={setComposerOpen}
        communityId={communityId}
        forums={forums.filter((f) => f.id !== "all" && f.id !== "unanswered")}
        defaultForum={forum !== "all" && forum !== "unanswered" ? forum : ""}
        onCreated={(href) => {
          setComposerOpen(false)
          router.push(href)
        }}
      />

      {viewer?.can_manage && (
        <>
          <EditCommunityDialog
            community={community}
            open={editOpen}
            onOpenChange={setEditOpen}
            onSaved={() => void load({ silent: true })}
            onRequestDelete={canDeleteCommunity ? () => setDeleteOpen(true) : undefined}
          />
          <ManageMembersDialog
            communityId={communityId}
            open={membersOpen}
            onOpenChange={setMembersOpen}
            onChanged={() => void load({ silent: true })}
          />
          {canDeleteCommunity && (
            <DeleteCommunityDialog
              community={community}
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              onDeleted={() => router.push("/communities")}
            />
          )}
        </>
      )}

      <RolesDialog communityId={communityId} open={rolesOpen} onOpenChange={setRolesOpen} />
    </div>
  )
}

/* ─────────────────────────── New thread ─────────────────────────── */

function NewThreadSheet({
  open,
  onOpenChange,
  communityId,
  forums,
  defaultForum,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  communityId: string
  forums: Forum[]
  defaultForum: string
  onCreated: (href: string) => void
}) {
  const { getAuthHeader } = useAuth()
  const { toast } = useToast()
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [spaceId, setSpaceId] = useState(defaultForum)
  const [tags, setTags] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [media, setMedia] = useState<{ url: string; type: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [pollOn, setPollOn] = useState(false)
  const [pollQuestion, setPollQuestion] = useState("")
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""])

  const attach = async (file?: File | null) => {
    if (!file) return
    setUploading(true)
    try {
      const isVideo = file.type.startsWith("video/")
      const { url } = await uploadMediaFile(file, {
        type: isVideo ? "video" : "image",
        folder: "community-threads",
        authHeaders: getAuthHeader(),
      })
      setMedia({ url, type: isVideo ? "video" : "image" })
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" })
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    if (open) setSpaceId(defaultForum)
  }, [open, defaultForum])

  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/communities/${communityId}/forum`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({
          title,
          content,
          space_id: spaceId || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          media_url: media?.url || null,
          media_type: media?.type || null,
          poll: pollOn && pollQuestion.trim()
            ? { question: pollQuestion.trim(), options: pollOptions.map((o) => o.trim()).filter(Boolean) }
            : null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to create thread")
      setTitle("")
      setContent("")
      setTags("")
      setMedia(null)
      setPollOn(false)
      setPollQuestion("")
      setPollOptions(["", ""])
      onCreated(json.thread.href)
    } catch (e: any) {
      toast({ title: "Could not post", description: e.message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-lg font-bold">Start a thread</SheetTitle>
        </SheetHeader>
        <div className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What should the community talk about?"
              maxLength={160}
              className="mt-1.5 h-11 rounded-xl"
            />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Body</label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Give people something to reply to — context, a question, an idea."
              rows={9}
              className="mt-1.5 resize-none rounded-xl"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted/60">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
              {media ? (media.type === "video" ? "Video attached" : "Image attached") : "Add image or video"}
              <input
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => {
                  void attach(e.target.files?.[0])
                  e.currentTarget.value = ""
                }}
              />
            </label>
            {media && (
              <button
                type="button"
                onClick={() => setMedia(null)}
                className="rounded-full px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/60"
              >
                Remove
              </button>
            )}
            <button
              type="button"
              aria-pressed={pollOn}
              onClick={() => setPollOn((v) => !v)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                pollOn ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {pollOn ? "Poll on" : "Add a poll"}
            </button>
          </div>

          {media && media.type === "image" && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={media.url} alt="" className="h-28 w-full rounded-xl object-cover" />
          )}

          {pollOn && (
            <div className="space-y-2 rounded-xl border border-border p-3">
              <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Question</label>
              <Input
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                maxLength={200}
                placeholder="Which one wins?"
                className="h-10 rounded-xl"
              />
              <div className="space-y-1.5">
                {pollOptions.map((option, index) => (
                  <Input
                    key={index}
                    value={option}
                    maxLength={140}
                    placeholder={`Option ${index + 1}`}
                    onChange={(e) =>
                      setPollOptions((prev) => prev.map((o, i) => (i === index ? e.target.value : o)))
                    }
                    className="h-9 rounded-xl"
                  />
                ))}
              </div>
              {pollOptions.length < 6 && (
                <button
                  type="button"
                  onClick={() => setPollOptions((prev) => [...prev, ""])}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  + Add option
                </button>
              )}
            </div>
          )}
          {forums.length > 0 && (
            <div>
              <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Forum</label>
              <select
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">General</option>
                {forums.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Tags (comma separated)
            </label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="feedback, season 2"
              className="mt-1.5 h-10 rounded-xl"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={
                submitting ||
                title.trim().length < 3 ||
                (!content.trim() && !media && (!pollOn || !pollQuestion.trim()))
              }
            >
              {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
              Post thread
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}