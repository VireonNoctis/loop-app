"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { resolveCircleMembershipAction } from "@/lib/circle-membership-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { COMMUNITY_CATEGORIES, getCategoryConfig } from "@/lib/community-categories"
import { VerifiedSeal } from "@/components/ui/verified-seal"
import {
  Search,
  Users,
  Flame,
  TrendingUp,
  Plus,
  ArrowRight,
  Lock,
  Activity,
  Clock,
  Zap,
} from "lucide-react"

interface CommunityItem {
  id: string | number
  name: string
  description: string
  avatar_url: string | null
  banner_url: string | null
  category: string
  member_count: number
  active_count: number
  is_private: boolean
  is_verified: boolean
  handle?: string
  accent_color?: string
  pulse: string
  is_member: boolean
  membership_status?: string | null
  user_role?: string
  created_at: string
  tags?: string[]
}

const SORTS = [
  { id: "trending", label: "Trending", icon: Flame },
  { id: "growing", label: "Growing", icon: TrendingUp },
  { id: "new", label: "New", icon: Clock },
  { id: "active", label: "Active Now", icon: Activity },
  { id: "recommended", label: "For You", icon: Zap },
] as const

const PULSE_STYLES: Record<string, string> = {
  quiet: "text-slate-500 border-slate-500/30 bg-slate-500/10",
  growing: "text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  active: "text-primary border-primary/30 bg-primary/10",
  very_active: "text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10",
  exploding: "text-red-600 dark:text-red-400 border-red-500/30 bg-red-500/10",
}

const PULSE_LABELS: Record<string, string> = {
  quiet: "Quiet",
  growing: "Growing",
  active: "Active",
  very_active: "Very active",
  exploding: "On fire",
}

export function DiscoverCommunities() {
  const { user, loading: authLoading, getAuthHeader } = useAuth()
  const router = useRouter()
  const [sort, setSort] = useState<string>("trending")
  const [category, setCategory] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [communities, setCommunities] = useState<CommunityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState<string | null>(null)
  const [error, setError] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({ sort, limit: "48" })
      if (category !== "all") params.set("category", category)
      if (search.trim()) params.set("search", search.trim())
      const res = await fetch(`/api/communities?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to load")
      setCommunities(data.communities || [])
    } catch (e: any) {
      setError(e.message || "Failed to load communities")
    } finally {
      setLoading(false)
    }
  }, [sort, category, search, user?.id])

  useEffect(() => {
    load()
  }, [load])

  const onSearchChange = (v: string) => {
    setSearch(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(), 350)
  }

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const joinCommunity = async (id: string | number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!user) {
      router.push(`/auth?returnTo=/communities/${id}`)
      return
    }
    setJoining(String(id))
    try {
      const res = await fetch(`/api/circles/${id}/join`, { method: "POST", headers: getAuthHeader() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to join")
      if (data.status !== "active" && data.status !== "pending") throw new Error("Unknown Circle membership state")
      setCommunities((prev) => prev.map((c) => String(c.id) === String(id)
        ? { ...c, is_member: data.status === "active", membership_status: data.status }
        : c))
      router.refresh()
    } catch (e: any) {
      setError(e.message || "Could not join Circle")
    } finally {
      setJoining(null)
    }
  }

  const cancelJoinRequest = async (id: string | number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setJoining(String(id))
    try {
      const res = await fetch(`/api/circles/${id}/join`, { method: "DELETE", headers: getAuthHeader() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not cancel request")
      setCommunities((prev) => prev.map((c) => String(c.id) === String(id)
        ? { ...c, is_member: false, membership_status: null }
        : c))
      router.refresh()
    } catch (e: any) {
      setError(e.message || "Could not cancel request")
    } finally {
      setJoining(null)
    }
  }

  const showJoin = !authLoading

  return (
    <div className="space-y-6">
      {/* Search + filters */}
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search communities, topics, handles…"
            className="pl-10 h-11 rounded-2xl"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSort(s.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                sort === s.id
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                  : "border border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
          <button
            onClick={() => setCategory("all")}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              category === "all"
                ? "bg-foreground text-background"
                : "border border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          {COMMUNITY_CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(category === c.id ? "all" : c.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                category === c.id
                  ? "bg-foreground text-background"
                  : "border border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-xl" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ) : communities.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Search className="h-6 w-6" />
          </div>
          <p className="font-semibold">No communities found</p>
          <p className="text-sm text-muted-foreground">Try a different filter — or create the world you want to see.</p>
          <Link href="/communities/create">
            <Button className="mt-2 rounded-full">
              <Plus className="h-4 w-4" /> Create one
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {communities.map((c) => {
            const cfg = getCategoryConfig(c.category)
            const pulseStyle = PULSE_STYLES[c.pulse] || PULSE_STYLES.growing
            return (
              <Link
                key={c.id}
                href={`/communities/${c.id}`}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
              >
                {/* Banner */}
                <div
                  className="relative h-20 w-full overflow-hidden"
                  style={{ background: c.accent_color || cfg.accent }}
                >
                  {c.banner_url ? (
                    <Image src={c.banner_url} alt="" fill className="object-cover opacity-90 transition-transform duration-500 group-hover:scale-[1.03]" unoptimized />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-black/25 via-transparent to-transparent" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-card/80 via-transparent to-transparent" />
                  <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide backdrop-blur ${pulseStyle}`}>
                      {PULSE_LABELS[c.pulse] || "Growing"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="relative">
                        <Avatar className="h-11 w-11 rounded-xl border-2 border-background shadow-md">
                          <AvatarImage src={c.avatar_url || ""} alt={c.name} />
                          <AvatarFallback className="rounded-xl bg-primary text-primary-foreground font-black text-sm">
                            {c.name.slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        {c.is_verified && (
                          <span className="absolute -bottom-1 -right-1 rounded-full bg-background p-0.5">
                            <VerifiedSeal size={16} variant="emerald" title="Official Community" />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="truncate text-sm font-semibold transition-colors group-hover:text-primary">
                            {c.name}
                          </h3>
                          {c.is_private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {cfg.emoji} {cfg.label}
                        </p>
                      </div>
                    </div>
                  </div>

                  <p className="line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">{c.description}</p>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {c.member_count.toLocaleString()}</span>
                    {c.active_count > 0 && (
                      <span className="flex items-center gap-1"><Activity className="h-3 w-3 text-emerald-500" /> {c.active_count} active</span>
                    )}
                    {c.tags && c.tags.length > 0 && (
                      <span className="truncate text-[10px]">#{c.tags.slice(0, 2).join(" #")}</span>
                    )}
                  </div>

                  <div className="mt-auto flex items-center gap-2 pt-1">
                    {showJoin && (() => {
                      const action = resolveCircleMembershipAction(c.membership_status, c.is_private, c.is_member)
                      if (action.kind === "enter") {
                        return (
                          <Button size="sm" variant="outline" className="flex-1 rounded-full text-xs"
                            onClick={(e) => { e.preventDefault(); router.push(`/communities/${c.id}`) }}>
                            Enter Circle <ArrowRight className="h-3 w-3 ml-1" />
                          </Button>
                        )
                      }
                      const busy = joining === String(c.id)
                      const cancelling = action.kind === "cancel-request"
                      return (
                        <Button size="sm" variant={cancelling || action.kind === "unavailable" ? "outline" : "default"}
                          className="flex-1 rounded-full text-xs"
                          disabled={busy || action.kind === "unavailable"}
                          onClick={(e) => cancelling ? cancelJoinRequest(c.id, e) : joinCommunity(c.id, e)}>
                          {busy ? (cancelling ? "Cancelling…" : "Joining…") : action.label}
                        </Button>
                      )
                    })()}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}