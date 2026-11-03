"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowUpRight, CalendarDays, CircleDot, Clock3, Flame, Gift, Plus, Radio, RefreshCw, Search, Users, Zap } from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { rustApiRequest } from "@/lib/rust-api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ProxyImg } from "@/components/ui/proxy-img"
import { AnimatedIconView } from "@/components/icons/animated/animated-icon-view"
import FlameIcon from "@/components/icons/animated/flame-icon"

type DropKind = "event" | "challenge"
type DropFilter = "all" | "live" | "upcoming" | "event" | "challenge"

interface DropItem {
  id: string
  kind: DropKind
  source: string
  title: string
  description: string
  category: string
  starts_at: string | null
  ends_at: string | null
  status: "live" | "upcoming" | "active" | "ended"
  is_live: boolean
  image_url: string | null
  participants_count: number
  reward_coins: number
  circle_id: string | null
  circle_name: string | null
  action_url: string
  created_at: string
}

interface DropsResponse {
  success: boolean
  items: DropItem[]
  total: number
  limit: number
  offset: number
  has_more: boolean
  live_count: number
  challenge_count: number
  event_count: number
}

const FILTERS: Array<{ value: DropFilter; label: string }> = [
  { value: "all", label: "All activity" },
  { value: "live", label: "Live now" },
  { value: "upcoming", label: "Coming up" },
  { value: "challenge", label: "Challenges" },
  { value: "event", label: "Events" },
]

function formatDropTime(value: string | null, status: DropItem["status"]): string {
  if (status === "live") return "Live now"
  if (status === "active") return "Open now"
  if (!value) return "Time to be announced"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Time to be announced"

  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toDateString() === date.toDateString()
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

  if (sameDay) return `Today · ${time}`
  if (tomorrow) return `Tomorrow · ${time}`
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`
}

function DropCard({ item }: { item: DropItem }) {
  const isChallenge = item.kind === "challenge"
  const sourceLabel = item.source === "official_event"
    ? "LOOP official"
    : item.source === "circle_challenge"
      ? "Circle challenge"
      : item.circle_name || "Community activity"

  return (
    <Card className="group overflow-hidden rounded-2xl border-border/70 bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg hover:shadow-black/5">
      {item.image_url ? (
        <div className="relative aspect-[16/7] overflow-hidden bg-muted">
          <ProxyImg
            src={item.image_url}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            <Badge className={item.is_live ? "border-0 bg-rose-500 text-white" : "border border-white/20 bg-black/55 text-white"}>
              {item.is_live ? <Radio className="mr-1 h-3 w-3" /> : isChallenge ? <Zap className="mr-1 h-3 w-3" /> : <CalendarDays className="mr-1 h-3 w-3" />}
              {item.is_live ? "LIVE" : isChallenge ? "CHALLENGE" : "EVENT"}
            </Badge>
          </div>
        </div>
      ) : (
        <div className="relative flex h-24 items-start justify-between overflow-hidden bg-gradient-to-br from-primary/15 via-muted/60 to-cyan-500/10 p-4">
          <div className="absolute -right-5 -top-8 h-32 w-32 rounded-full border border-current/10" />
          <div className="absolute -right-1 -top-2 h-20 w-20 rounded-full border border-current/10" />
          <Badge variant="secondary" className="relative z-10 rounded-full">
            {item.is_live ? "LIVE" : isChallenge ? "CHALLENGE" : "EVENT"}
          </Badge>
          <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-xl bg-background/75 text-primary shadow-sm">
            {isChallenge ? <Zap className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
          </span>
        </div>
      )}

      <CardContent className="flex h-full flex-col gap-4 p-4 sm:p-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{sourceLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{item.category}</span>
          </div>
          <h2 className="line-clamp-2 text-lg font-semibold tracking-tight">{item.title}</h2>
          {item.description ? (
            <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isChallenge ? "Join the Circle and add your contribution." : "Open the activity to see details and take part."}
            </p>
          )}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5" />
            {isChallenge
              ? item.status === "upcoming"
                ? `Starts ${formatDropTime(item.starts_at, "upcoming")}`
                : item.ends_at
                  ? `Closes ${formatDropTime(item.ends_at, "upcoming")}`
                  : "Open challenge"
              : formatDropTime(item.starts_at, item.status)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            {item.participants_count} {isChallenge ? "entries" : "participants"}
          </span>
          {item.reward_coins > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <Gift className="h-3.5 w-3.5" />
              {item.reward_coins.toLocaleString()} Loop Coins
            </span>
          ) : null}
        </div>

        <Link
          href={item.action_url}
          className="loop-tactile inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {isChallenge ? "View challenge" : "Open activity"}
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  )
}

export function DropsHub() {
  const { user, loading: authLoading, getAuthHeader } = useAuth()
  const router = useRouter()
  const [response, setResponse] = useState<DropsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<DropFilter>("all")
  const [activeCategory, setActiveCategory] = useState("all")
  const [knownCategories, setKnownCategories] = useState<string[]>([])
  const [sort, setSort] = useState<"recommended" | "upcoming" | "popular" | "recent">("recommended")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [joinedCircles, setJoinedCircles] = useState<Array<{ id: string; name: string }>>([])
  const [circlesLoading, setCirclesLoading] = useState(false)
  const [selectedCircleId, setSelectedCircleId] = useState("")
  const [dropTitle, setDropTitle] = useState("")
  const [dropDescription, setDropDescription] = useState("")
  const [dropType, setDropType] = useState("creative")
  const [dropStartsAt, setDropStartsAt] = useState("")
  const [dropEndsAt, setDropEndsAt] = useState("")
  const [creatingDrop, setCreatingDrop] = useState(false)
  const [createDropError, setCreateDropError] = useState("")

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [search])

  const loadDrops = useCallback(async (silent = false) => {
    if (!user) {
      setResponse(null)
      setLoading(false)
      return
    }

    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ limit: "60", offset: "0", sort })
      if (debouncedSearch) params.set("search", debouncedSearch)
      if (activeFilter === "event" || activeFilter === "challenge") params.set("kind", activeFilter)
      if (activeFilter === "live") params.set("live", "true")
      if (activeFilter === "upcoming") params.set("upcoming", "true")
      if (activeCategory !== "all") params.set("category", activeCategory)
      const data = await rustApiRequest<DropsResponse>("drops?" + params.toString(), {
        headers: getAuthHeader(),
        cache: "no-store",
      })
      setResponse(data)
      setKnownCategories((current) => Array.from(new Set([
        ...current,
        ...(data.items || []).map((item: DropItem) => item.category).filter(Boolean),
      ])).sort((left, right) => left.localeCompare(right)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Drops.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeCategory, activeFilter, debouncedSearch, getAuthHeader, sort, user])

  const loadMoreDrops = async () => {
    if (!response?.has_more || loadingMore) return
    setLoadingMore(true)
    try {
      const params = new URLSearchParams({ limit: "60", offset: String(response.items.length), sort })
      if (debouncedSearch) params.set("search", debouncedSearch)
      if (activeFilter === "event" || activeFilter === "challenge") params.set("kind", activeFilter)
      if (activeFilter === "live") params.set("live", "true")
      if (activeFilter === "upcoming") params.set("upcoming", "true")
      if (activeCategory !== "all") params.set("category", activeCategory)
      const page = await rustApiRequest<DropsResponse>("drops?" + params.toString(), {
        headers: getAuthHeader(),
        cache: "no-store",
      })
      setResponse((current) => current ? {
        ...page,
        items: [...current.items, ...page.items.filter((item) => !current.items.some((existing) => existing.id === item.id && existing.source === item.source))],
      } : page)
      setKnownCategories((current) => Array.from(new Set([
        ...current,
        ...(page.items || []).map((item: DropItem) => item.category).filter(Boolean),
      ])).sort((left, right) => left.localeCompare(right)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more activity.")
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (!authLoading) void loadDrops()
  }, [authLoading, loadDrops])

  useEffect(() => {
    if (!createOpen || !user) return
    let cancelled = false
    setCirclesLoading(true)
    void fetch("/api/communities?sort=recommended&limit=50", {
      headers: getAuthHeader(),
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Could not load your Circles")
        if (cancelled) return
        const circles = (Array.isArray(data.communities) ? data.communities : [])
          .filter((circle: { is_member?: boolean; id: string | number; name: string }) => circle.is_member)
          .map((circle: { id: string | number; name: string }) => ({ id: String(circle.id), name: circle.name }))
        setJoinedCircles(circles)
        if (!circles.some((circle: { id: string }) => circle.id === selectedCircleId)) {
          setSelectedCircleId(circles[0]?.id || "")
        }
      })
      .catch((cause) => {
        if (!cancelled) setCreateDropError(cause instanceof Error ? cause.message : "Could not load your Circles")
      })
      .finally(() => {
        if (!cancelled) setCirclesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [createOpen, getAuthHeader, selectedCircleId, user?.id])

  const createDrop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) {
      router.push("/auth?redirect=/drops")
      return
    }
    if (!selectedCircleId) {
      setCreateDropError("Join a Circle before creating a community Drop.")
      return
    }
    setCreatingDrop(true)
    setCreateDropError("")
    try {
      const startsAt = dropStartsAt ? new Date(dropStartsAt) : new Date()
      const endsAt = dropEndsAt ? new Date(dropEndsAt) : new Date(startsAt.getTime() + 7 * 86400000)
      if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
        throw new Error("Choose an end time after the start time.")
      }
      const response = await fetch(`/api/communities/${encodeURIComponent(selectedCircleId)}/challenges`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({
          title: dropTitle.trim(),
          description: dropDescription.trim(),
          challenge_type: dropType,
          reward_coins: 0,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not create Drop")
      setDropTitle("")
      setDropDescription("")
      setDropStartsAt("")
      setDropEndsAt("")
      setDropType("creative")
      setCreateOpen(false)
      await loadDrops(true)
    } catch (cause) {
      setCreateDropError(cause instanceof Error ? cause.message : "Could not create Drop")
    } finally {
      setCreatingDrop(false)
    }
  }

  const filteredItems = useMemo(() => {
    return (response?.items || []).filter((item) => {
      if (activeFilter === "live" && !item.is_live) return false
      if (activeFilter === "upcoming" && item.status !== "upcoming") return false
      if (activeFilter === "event" && item.kind !== "event") return false
      if (activeFilter === "challenge" && item.kind !== "challenge") return false
      return true
    })
  }, [activeFilter, response?.items])

  if (authLoading || loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-[310px] animate-pulse rounded-2xl border border-border/60 bg-muted/35" />
        ))}
      </div>
    )
  }

  if (!user) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Flame className="h-6 w-6" />
          </span>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Drops are better with your Circles</h2>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Sign in to see activity from your communities, join challenges and keep up with events.
            </p>
          </div>
          <Button onClick={() => router.push("/login?redirect=/drops")}>Sign in to explore Drops</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-primary/10 via-card to-cyan-500/10 p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full border border-primary/10" />
        <div className="pointer-events-none absolute -right-3 -top-7 h-36 w-36 rounded-full border border-primary/10" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl space-y-2">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              <AnimatedIconView component={FlameIcon} size={16} />
              Participate in something
            </div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">There’s always something happening.</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Live stages, upcoming events and community challenges from the Circles you’re part of — all in one place.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => {
              if (!user) router.push("/auth?redirect=/drops")
              else {
                setCreateDropError("")
                setCreateOpen((value) => !value)
              }
            }}>
              <Plus className="h-4 w-4" />
              Create a Drop
            </Button>
            <Link href="/communities" className="loop-tactile inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background/80 px-4 text-sm font-medium hover:bg-background">
              <CircleDot className="h-4 w-4" />
              Find Circles
            </Link>
            <Link href="/events" className="loop-tactile inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              Browse events
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
          {response ? (
            <div className="flex flex-wrap gap-4 border-t border-border/60 pt-4 text-xs text-muted-foreground">
              <span><strong className="text-foreground">{response.live_count}</strong> live</span>
              <span><strong className="text-foreground">{response.event_count}</strong> events</span>
              <span><strong className="text-foreground">{response.challenge_count}</strong> challenges</span>
            </div>
          ) : null}
      </section>

      {createOpen && (
        <Card className="rounded-2xl border-primary/20">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Community-created activity</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">Start a Drop</h2>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Give your Circle a prompt, theme or collaborative activity. Taking part is always optional.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>Close</Button>
            </div>

            {joinedCircles.length === 0 && !circlesLoading ? (
              <div className="rounded-xl border border-dashed border-border p-4">
                <p className="text-sm font-medium">Join a Circle to host a Drop.</p>
                <p className="mt-1 text-xs text-muted-foreground">Drops live in a community, so members can take part together.</p>
                <Link href="/communities" className="mt-3 inline-flex text-sm font-semibold text-primary hover:underline">Explore Circles</Link>
              </div>
            ) : (
              <form onSubmit={createDrop} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <label htmlFor="drop-title" className="text-sm font-medium">Drop title</label>
                    <Input id="drop-title" value={dropTitle} onChange={(event) => setDropTitle(event.target.value)} maxLength={120} required placeholder="e.g. Design a new place in our shared universe" />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="drop-circle" className="text-sm font-medium">Circle</label>
                    <select id="drop-circle" value={selectedCircleId} onChange={(event) => setSelectedCircleId(event.target.value)} disabled={circlesLoading} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                      {joinedCircles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
                    </select>
                    {circlesLoading && <p className="text-xs text-muted-foreground">Loading your Circles…</p>}
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="drop-type" className="text-sm font-medium">Activity format</label>
                    <select id="drop-type" value={dropType} onChange={(event) => setDropType(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                      <option value="creative">Creative prompt</option>
                      <option value="photography">Photography theme</option>
                      <option value="poll">Community poll</option>
                      <option value="guessing">Guessing game</option>
                      <option value="collaborative">Collaborative activity</option>
                      <option value="discussion">Open discussion</option>
                    </select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <label htmlFor="drop-description" className="text-sm font-medium">What should people do?</label>
                    <Textarea id="drop-description" value={dropDescription} onChange={(event) => setDropDescription(event.target.value)} maxLength={2000} rows={3} placeholder="Explain the prompt, how to take part and any helpful context." />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="drop-start" className="text-sm font-medium">Starts</label>
                    <Input id="drop-start" type="datetime-local" value={dropStartsAt} onChange={(event) => setDropStartsAt(event.target.value)} />
                    <p className="text-[11px] text-muted-foreground">Leave empty to start now.</p>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="drop-end" className="text-sm font-medium">Ends</label>
                    <Input id="drop-end" type="datetime-local" value={dropEndsAt} onChange={(event) => setDropEndsAt(event.target.value)} />
                    <p className="text-[11px] text-muted-foreground">Leave empty for a seven-day activity.</p>
                  </div>
                </div>

                {createDropError && <p role="alert" className="text-sm text-destructive">{createDropError}</p>}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={creatingDrop || circlesLoading || !selectedCircleId || !dropTitle.trim()}>
                    {creatingDrop ? "Creating…" : "Publish Drop"}
                    <ArrowUpRight className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={activeFilter === filter.value}
              onClick={() => setActiveFilter(filter.value)}
              className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeFilter === filter.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find something…"
              className="h-10 rounded-xl pl-9"
              aria-label="Search Drops"
            />
          </div>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
            aria-label="Sort Drops"
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="recommended">Recommended</option>
            <option value="upcoming">Soonest</option>
            <option value="popular">Most participants</option>
            <option value="recent">Recently added</option>
          </select>
          <select
            value={activeCategory}
            onChange={(event) => setActiveCategory(event.target.value)}
            aria-label="Filter Drop category"
            className="h-10 max-w-36 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="all">All categories</option>
            {knownCategories.map((category) => <option key={category.toLowerCase()} value={category.toLowerCase()}>{category}</option>)}
          </select>
          <Button variant="outline" size="icon" onClick={() => void loadDrops(true)} disabled={refreshing} aria-label="Refresh Drops">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="rounded-2xl border-destructive/30">
          <CardContent className="flex flex-col items-start gap-3 py-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h3 className="font-semibold">Drops couldn’t load</h3>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
            <Button variant="outline" onClick={() => void loadDrops()}>Try again</Button>
          </CardContent>
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Zap className="h-5 w-5" />
            </span>
            <h3 className="font-semibold">{search || activeFilter !== "all" ? "No matching Drops" : "Nothing on the board yet"}</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              {search || activeFilter !== "all"
                ? "Try another filter or search term."
                : "Join a Circle or check back later. New events and challenges will show up here automatically."}
            </p>
            <Link href="/communities" className="text-sm font-semibold text-primary hover:underline">Explore Circles</Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => <DropCard key={`${item.source}:${item.id}`} item={item} />)}
        </div>
      )}

      {response?.has_more && !error && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMoreDrops()} disabled={loadingMore}>
            {loadingMore ? "Loading activity…" : "Load more activity"}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{filteredItems.length} {filteredItems.length === 1 ? "activity" : "activities"} shown</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Synced from Events and Circle Challenges
        </span>
      </div>
    </div>
  )
}
