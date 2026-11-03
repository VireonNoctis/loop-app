"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, GitBranch, TreePine, Zap, TrendingUp, Hash, RefreshCw, Users, Sparkles } from "lucide-react"
import { LoopCard } from "@/components/loop-card"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { normalizeLoops, type NormalizedLoop } from "@/lib/normalize-loop"
import { getSupabaseBrowserClient } from "@/lib/supabase-browser"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

import { GlobalEventsHub } from "@/components/events/global-events-hub"
import { GlobalEventBanner } from "@/components/events/global-event-banner"
import { ParticipationDiscovery } from "@/components/explore/participation-discovery"
import { ExploreSearchAutocomplete } from "@/components/explore/explore-search-autocomplete"
import { Calendar } from "lucide-react"
import { Spinner } from "@/components/ui/skeletons"
import { ExploreSearchResults } from "@/components/explore/explore-search-results"
import { DiscoveryPreferencesPanel } from "@/components/explore/discovery-preferences-panel"

type ExploreTab = "events" | "recent" | "personalized" | "following" | "community" | "deepest" | "creative" | "hashtags"

interface TrendingHashtag {
  tag: string
  usage_count?: number
  count?: number
  growth?: string | number
}

interface CollaborativeChain {
  id: string
  title: string
  description: string
  prompt: string
  kind: string
  creator_display_name: string
  creator_username: string
  contribution_count: number
  participant_count: number
  updated_at: string
}

export function ExploreContent({ initialTab = "recent" }: { initialTab?: ExploreTab }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [loops, setLoops] = useState<NormalizedLoop[]>([])
  const [chains, setChains] = useState<CollaborativeChain[]>([])
  const [hashtags, setHashtags] = useState<TrendingHashtag[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTab, setSelectedTab] = useState<ExploreTab>(initialTab)
  const [searchQuery, setSearchQuery] = useState("")
  const [interacting, setInteracting] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  const authToken = user?.access_token || user?.token || ""

  const fetchExplore = useCallback(async (
    tab: ExploreTab = selectedTab,
    silent = false,
    offset = 0,
    append = false,
    preserveOffset = false,
  ) => {
    if (!silent && !append) setLoading(true)
    if (append && !silent) setLoadingMore(true)
    try {
      if (tab === "hashtags") {
        const response = await fetch("/api/explore/trending?type=hashtags&limit=24", { cache: "no-store" })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || "Failed to load hashtags")
        const rows: TrendingHashtag[] = data.hashtags || data.data || []
        setHashtags(rows)
        setLoops([])
        setChains([])
        setHasMore(false)
        setNextOffset(0)
        return
      }

      if (tab === "deepest") {
        const params = new URLSearchParams({ limit: "24", sort: "contributions" })
        const response = await fetch(`/api/v1/chains?${params.toString()}`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          cache: "no-store",
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || data.error || "Failed to discover Chains")
        setChains(Array.isArray(data.chains) ? data.chains : [])
        setLoops([])
        setHashtags([])
        setHasMore(false)
        setNextOffset(0)
        return
      }

      const sort = tab === "creative" ? "creative"
        : tab === "personalized" ? "personalized"
          : tab === "following" ? "following"
          : tab === "community" ? "community"
            : "recent"
      const response = await fetch(`/api/explore/trending?type=loops&sort=${sort}&limit=24&offset=${offset}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        cache: "no-store",
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Failed to load explore")
      const incoming = normalizeLoops(data.loops || data.data || [])
      setLoops((previous) => {
        if (!append) return incoming
        const merged = new Map(previous.map((loop) => [loop.id, loop]))
        for (const loop of incoming) merged.set(loop.id, loop)
        return [...merged.values()]
      })
      setHasMore(data.pagination?.has_more === true)
      if (!preserveOffset) {
        setNextOffset(Number.isFinite(data.pagination?.next_offset)
          ? Number(data.pagination.next_offset)
          : offset + incoming.length)
      }
      setChains([])
      setHashtags([])
    } catch (error: any) {
      console.error("Explore fetch error:", error)
      if (!silent) {
        toast({
          title: "Could not load explore",
          description: error?.message || "Please try again",
          variant: "destructive",
        })
      }
    } finally {
      if (!silent && !append) setLoading(false)
      if (append && !silent) setLoadingMore(false)
    }
  }, [authToken, selectedTab, toast])

  useEffect(() => {
    void fetchExplore(selectedTab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, authToken])

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    const refresh = () => void fetchExplore(selectedTab, true, 0, true, true)

    const loopsChannel = supabase
      .channel("explore:loops")
      .on("postgres_changes", { event: "*", schema: "public", table: "loops" }, refresh)
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") setLive(true)
      })

    const interactionsChannel = supabase
      .channel("explore:loop_interactions")
      .on("postgres_changes", { event: "*", schema: "public", table: "loop_interactions" }, refresh)
      .subscribe()

    const commentsChannel = supabase
      .channel("explore:comments")
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, refresh)
      .subscribe()

    const poll = setInterval(refresh, 20000)

    return () => {
      supabase.removeChannel(loopsChannel)
      supabase.removeChannel(interactionsChannel)
      supabase.removeChannel(commentsChannel)
      clearInterval(poll)
      setLive(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, authToken])

  const handleInteraction = async (loopId: string, type: "like" | "save") => {
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Log in to like, save, gift, and branch loops.",
        variant: "destructive",
      })
      return
    }

    setInteracting(`${loopId}-${type}`)
    try {
      const response = await fetch(`/api/loops/${loopId}/interactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ interaction_type: type }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Interaction failed")
      }

      setLoops((prev) =>
        prev.map((loop) => {
          if (loop.id !== loopId) return loop
          const next = { ...loop, user_interactions: { ...loop.user_interactions }, stats: { ...loop.stats } }
          if (type === "like") {
            const liked = Boolean(data.is_liked ?? data.is_active)
            next.user_interactions.is_liked = liked
            next.stats.likes_count = Math.max(
              0,
              next.stats.likes_count + (liked ? 1 : -1),
            )
            if (data.stats?.likes_count != null) next.stats.likes_count = Number(data.stats.likes_count)
          }
          if (type === "save") {
            next.user_interactions.is_saved = Boolean(data.is_saved ?? data.is_active)
          }
          return next
        }),
      )
    } catch (error: any) {
      toast({
        title: "Could not update",
        description: error?.message || "Try again",
        variant: "destructive",
      })
    } finally {
      setInteracting(null)
    }
  }

  const formatNumber = (num: number) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return String(num)
  }

  const renderLoadMore = () => hasMore ? (
    <div className="flex justify-center pt-3">
      <Button
        variant="outline"
        className="min-w-40 rounded-full"
        disabled={loadingMore || loading}
        onClick={() => void fetchExplore(selectedTab, false, nextOffset, true)}
      >
        {loadingMore ? <Spinner className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
        {loadingMore ? "Loading more…" : "Load more"}
      </Button>
    </div>
  ) : null

  const renderLoops = (items: NormalizedLoop[], emptyLabel: string) => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Spinner className="mr-2 h-5 w-5" />
          Loading loops…
        </div>
      )
    }

    if (items.length === 0) {
      return <EmptyState title={emptyLabel} icon={<Zap className="h-6 w-6" />} />
    }

    return (
      <div className="space-y-4">
        {items.map((loop) => (
          <div key={loop.id} className="space-y-2">
            {loop.discovery_reason && (
              <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{loop.discovery_reason}</span>
              </div>
            )}
            <LoopCard
              loop={loop}
              interacting={interacting}
              onInteraction={handleInteraction}
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <GlobalEventBanner />

      {/* Search Autocomplete */}
      <ExploreSearchAutocomplete onSearch={setSearchQuery} />

      {searchQuery.trim() ? (
        <ExploreSearchResults query={searchQuery} onClear={() => setSearchQuery("")} />
      ) : (
        <>
          {/* Participation discovery — live duels, co-loops, circles, creators */}
          <ParticipationDiscovery />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`inline-flex h-2 w-2 rounded-full ${live ? "bg-emerald-500" : "bg-amber-500"}`} />
          {live ? "Live updates connected" : "Refreshing every 20s"}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void fetchExplore(selectedTab)}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Tabs value={selectedTab} onValueChange={(value) => setSelectedTab(value as ExploreTab)} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/40 p-1 sm:grid-cols-8">
          <TabsTrigger value="events" className="rounded-xl">
            <Calendar className="mr-1.5 h-4 w-4 text-cyan-400" />
            Global Events
          </TabsTrigger>
          <TabsTrigger value="recent" className="rounded-xl">
            <Clock className="mr-1.5 h-4 w-4" />
            Recent
          </TabsTrigger>
          {user && (
            <TabsTrigger value="personalized" className="rounded-xl">
              <Sparkles className="mr-1.5 h-4 w-4" />
              For you
            </TabsTrigger>
          )}
          {user && (
            <TabsTrigger value="following" className="rounded-xl">
              <Users className="mr-1.5 h-4 w-4" />
              Following
            </TabsTrigger>
          )}
          <TabsTrigger value="community" className="rounded-xl">
            <Users className="mr-1.5 h-4 w-4" />
            From Circles
          </TabsTrigger>
          <TabsTrigger value="deepest" className="rounded-xl">
            <TreePine className="mr-1.5 h-4 w-4" />
            Chains
          </TabsTrigger>
          <TabsTrigger value="creative" className="rounded-xl">
            <Zap className="mr-1.5 h-4 w-4" />
            Creative
          </TabsTrigger>
          <TabsTrigger value="hashtags" className="rounded-xl">
            <Hash className="mr-1.5 h-4 w-4" />
            Hashtags
          </TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="mt-6">
          <GlobalEventsHub />
        </TabsContent>

        <TabsContent value="recent" className="mt-6 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Recent Loops</h2>
            <Badge variant="secondary">Newest first</Badge>
          </div>
          {renderLoops(loops, "No recent loops yet")}
          {renderLoadMore()}
        </TabsContent>

        {user && (
          <TabsContent value="personalized" className="mt-6 space-y-4">
            <DiscoveryPreferencesPanel onChanged={() => void fetchExplore("personalized")} />
            <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />
                A feed shaped by your interests
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Recommendations use topic tags from public Loops you have liked or saved. Private posts are never used as signals or shown here. Latest, Following and From Circles remain available whenever you prefer a different view.
              </p>
            </div>
            {renderLoops(loops, "No interest matches yet. Like or save public Loops with topic tags to build this feed.")}
          {renderLoadMore()}
          </TabsContent>
        )}

        {user && (
          <TabsContent value="following" className="mt-6 space-y-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">From people you follow</h2>
              <Badge variant="secondary">Latest first</Badge>
            </div>
            {renderLoops(loops, "No recent public Loops from people you follow yet")}
          {renderLoadMore()}
          </TabsContent>
        )}

        <TabsContent value="community" className="mt-6 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">From Circles</h2>
            <Badge variant="secondary">Public community work</Badge>
          </div>
          {renderLoops(loops, "No public Circle Loops found yet")}
          {renderLoadMore()}
        </TabsContent>

        <TabsContent value="deepest" className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Collaborative Chains</h2>
              <Badge variant="secondary">Most contributions</Badge>
            </div>
            <Link href="/chains" className="text-xs font-semibold text-primary hover:underline">Explore all Chains</Link>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Spinner className="mr-2 h-5 w-5" /> Loading Chains…
            </div>
          ) : chains.length === 0 ? (
            <EmptyState title="No collaborative Chains yet" icon={<GitBranch className="h-6 w-6" />} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {chains.map((chain) => (
                <Link
                  key={chain.id}
                  href={`/chains/${chain.id}`}
                  className="group flex min-h-48 flex-col rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary" className="capitalize">{chain.kind.replace(/_/g, " ")}</Badge>
                    <GitBranch className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                  <h3 className="mt-3 line-clamp-2 text-base font-bold">{chain.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {chain.prompt || chain.description || "An idea waiting for its next contribution."}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" /> {chain.contribution_count} contributions</span>
                    <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {chain.participant_count} people</span>
                    <span className="ml-auto truncate">by {chain.creator_display_name || chain.creator_username}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="creative" className="mt-6 space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            <h2 className="text-xl font-semibold">Most Creative</h2>
            <Badge variant="secondary">Highest engagement</Badge>
          </div>
          {renderLoops(loops, "No creative loops yet")}
          {renderLoadMore()}
        </TabsContent>

        <TabsContent value="hashtags" className="mt-6 space-y-4">
          <div className="flex items-center gap-2">
            <Hash className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Trending Hashtags</h2>
            <Badge variant="secondary">Live</Badge>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Spinner className="mr-2 h-5 w-5" />
              Loading hashtags…
            </div>
          ) : hashtags.length === 0 ? (
            <EmptyState title="No hashtags trending yet" icon={<Hash className="h-6 w-6" />} />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {hashtags.map((hashtag, index) => {
                const count = Number(hashtag.usage_count ?? hashtag.count ?? 0)
                return (
                  <Link key={hashtag.tag} href={`/hashtag/${encodeURIComponent(hashtag.tag)}`}>
                    <Card className="transition hover:bg-muted/40">
                      <CardContent className="p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl font-bold text-muted-foreground">#{index + 1}</span>
                            <Hash className="h-5 w-5 text-primary" />
                          </div>
                          <Badge variant="secondary" className="gap-1">
                            <TrendingUp className="h-3 w-3" />
                            {hashtag.growth ?? "hot"}
                          </Badge>
                        </div>
                        <h3 className="text-lg font-bold text-primary">#{hashtag.tag}</h3>
                        <p className="text-sm text-muted-foreground">{formatNumber(count)} loops</p>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
        </>
      )}
    </div>
  )
}
