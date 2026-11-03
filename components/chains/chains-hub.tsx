"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ArrowRight, Compass, GitBranch, Plus, Sparkles, Users } from "lucide-react"

type Chain = {
  id: string
  title: string
  description: string
  prompt: string
  kind: string
  category: string
  creator_display_name: string
  creator_username: string
  creator_avatar_url: string | null
  circle_id: string | null
  cover_image_url: string | null
  contribution_count: number
  participant_count: number
  created_at: string
  updated_at: string
}

const FORMATS = [
  { id: "worldbuilding", label: "Worldbuilding", hint: "Build a shared universe, its places, people and lore." },
  { id: "story", label: "Collaborative story", hint: "Continue a story one contribution at a time." },
  { id: "ranking", label: "Ranking", hint: "Create a shared ranking and collect everyone's picks." },
  { id: "playlist", label: "Playlist", hint: "Build a collection of music, tracks and listening notes." },
  { id: "gallery", label: "Gallery", hint: "Collect different creative interpretations and images." },
  { id: "challenge", label: "Creative prompt", hint: "Invite people to respond to one shared prompt." },
  { id: "project", label: "Community project", hint: "Gather ideas and contributions around a project." },
  { id: "recommendations", label: "Recommendations", hint: "Build a list of recommendations together." },
  { id: "open", label: "Open-ended", hint: "Start with an idea and let the format evolve." },
] as const

function formatLabel(kind: string) {
  return FORMATS.find((format) => format.id === kind)?.label || "Collaborative Chain"
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "Recently updated"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function ChainsHub() {
  const { user, loading: authLoading, getAuthHeader } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedCircleId = searchParams.get("circle_id") || ""
  const requestedSourceDropId = searchParams.get("source_drop_id") || ""
  const requestedTitle = searchParams.get("title") || ""
  const requestedDescription = searchParams.get("description") || ""
  const requestedPrompt = searchParams.get("prompt") || ""
  const requestedKind = searchParams.get("kind") || "worldbuilding"
  const shouldCreateFromContext = searchParams.get("create") === "1"
  const [chains, setChains] = useState<Chain[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [sort, setSort] = useState<"recent" | "active" | "contributions">("recent")
  const [kind, setKind] = useState("all")
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [title, setTitle] = useState(requestedTitle.slice(0, 120))
  const [description, setDescription] = useState(requestedDescription.slice(0, 2_000))
  const [prompt, setPrompt] = useState(requestedPrompt.slice(0, 1_200))
  const [newKind, setNewKind] = useState(FORMATS.some((format) => format.id === requestedKind) ? requestedKind : "worldbuilding")
  const [circles, setCircles] = useState<Array<{ id: string; name: string }>>([])
  const [selectedCircleId, setSelectedCircleId] = useState(requestedCircleId)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({ limit: "36", offset: "0", sort })
      if (kind !== "all") params.set("kind", kind)
      if (search.trim()) params.set("search", search.trim())
      const response = await fetch("/api/v1/chains?" + params.toString(), {
        headers: getAuthHeader(),
        cache: "no-store",
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || data.error || "Could not load Chains")
      setChains(Array.isArray(data.chains) ? data.chains : [])
      setHasMore(Boolean(data.has_more))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Chains")
    } finally {
      setLoading(false)
    }
  }, [getAuthHeader, kind, search, sort, user?.id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (shouldCreateFromContext && user) setCreating(true)
  }, [shouldCreateFromContext, user?.id])

  useEffect(() => {
    if (!user) {
      setCircles([])
      setSelectedCircleId("")
      return
    }
    let cancelled = false
    void fetch("/api/communities?sort=recommended&limit=50", {
      headers: getAuthHeader(),
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || "Could not load your Circles")
        if (!cancelled) {
          const memberships = Array.isArray(result.communities)
            ? result.communities.filter((circle: { is_member?: boolean; id: string | number; name: string }) => circle.is_member)
            : []
          const availableCircles = memberships.map((circle: { id: string | number; name: string }) => ({ id: String(circle.id), name: circle.name }))
          setCircles(availableCircles)
          if (requestedCircleId && availableCircles.some((circle: { id: string }) => circle.id === requestedCircleId)) {
            setSelectedCircleId(requestedCircleId)
          }
        }
      })
      .catch(() => {
        if (!cancelled) setCircles([])
      })
    return () => {
      cancelled = true
    }
  }, [getAuthHeader, requestedCircleId, user])

  const loadMore = async () => {
    if (!hasMore || loadingMore) return
    setLoadingMore(true)
    setError("")
    try {
      const params = new URLSearchParams({ limit: "36", offset: String(chains.length), sort })
      if (kind !== "all") params.set("kind", kind)
      if (search.trim()) params.set("search", search.trim())
      const response = await fetch("/api/v1/chains?" + params.toString(), {
        headers: getAuthHeader(),
        cache: "no-store",
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || data.error || "Could not load more Chains")
      const next: Chain[] = Array.isArray(data.chains) ? data.chains : []
      setChains((current) => {
        const known = new Set(current.map((chain) => chain.id))
        return [...current, ...next.filter((chain) => !known.has(chain.id))]
      })
      setHasMore(Boolean(data.has_more))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more Chains")
    } finally {
      setLoadingMore(false)
    }
  }

  const createChain = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) {
      router.push("/auth?returnTo=/chains")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      const response = await fetch("/api/v1/chains", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          prompt: prompt.trim(),
          kind: newKind,
          category: "general",
          contribution_policy: selectedCircleId ? "circle_members" : "open",
          circle_id: selectedCircleId || null,
          source_drop_id: selectedCircleId === requestedCircleId ? requestedSourceDropId || null : null,
          visibility: selectedCircleId ? "circle" : "public",
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || data.error || "Could not create Chain")
      router.push("/chains/" + data.id)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create Chain")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[30px] border border-border bg-card p-6 sm:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ backgroundImage: "radial-gradient(65% 100% at 100% 0%, hsl(var(--primary) / 0.20), transparent 70%)" }}
        />
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5 text-primary" />
            The collaborative layer
          </div>
          <h1 className="mt-5 text-4xl font-black tracking-tight sm:text-6xl">
            One idea.
            <br />
            <span className="text-muted-foreground">A thousand directions.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Chains start with one person and grow through everyone who contributes.
            Build a story, shape a universe, make a ranking, gather recommendations or create something with a Circle.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button onClick={() => user ? setCreating((value) => !value) : router.push("/auth?returnTo=/chains")}>
              <Plus className="h-4 w-4" />
              Start a Chain
            </Button>
            <Link
              href="/communities"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold transition hover:bg-muted"
            >
              <Users className="h-4 w-4" />
              Find a Circle
            </Link>
          </div>
          {!user && !authLoading && (
            <p className="mt-3 text-xs text-muted-foreground">Explore public Chains without an account. Sign in when you're ready to contribute.</p>
          )}
        </div>
      </section>

      {creating && (
        <form onSubmit={createChain} className="space-y-5 rounded-3xl border border-border bg-card p-5 sm:p-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Start something together</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Create a Chain</h2>
            <p className="mt-1 text-sm text-muted-foreground">Choose a format to give contributors a useful starting point. You can expand the format system as Chains evolve.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="chain-title" className="text-sm font-medium">Chain title</label>
              <Input id="chain-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required placeholder="e.g. Build the world of Asterfall" />
            </div>
            <div className="space-y-2">
              <label htmlFor="chain-format" className="text-sm font-medium">Starting format</label>
              <select id="chain-format" value={newKind} onChange={(event) => setNewKind(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                {FORMATS.map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">{FORMATS.find((format) => format.id === newKind)?.hint}</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="chain-circle" className="text-sm font-medium">Build inside a Circle (optional)</label>
              <select id="chain-circle" value={selectedCircleId} onChange={(event) => setSelectedCircleId(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Public Chain</option>
                {circles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Circle Chains are visible to their members and are contributed to by that community.</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="chain-prompt" className="text-sm font-medium">Opening prompt</label>
              <Input id="chain-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={1200} placeholder="What should contributors add?" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="chain-description" className="text-sm font-medium">Description</label>
              <Textarea id="chain-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} placeholder="Explain the idea, contribution style and any helpful context." />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? "Creating…" : "Create Chain"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </form>
      )}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Open invitations to create</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Discover Chains</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["recent", "active", "contributions"] as const).map((value) => (
              <button key={value} type="button" onClick={() => setSort(value)} className={"rounded-full border px-3 py-1.5 text-xs font-semibold transition " + (sort === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
                {value === "recent" ? "Newest" : value === "active" ? "Recently active" : "Most contributions"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ideas, prompts and Chains…" />
          <select value={kind} onChange={(event) => setKind(event.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
            <option value="all">All formats</option>
            {FORMATS.map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}
          </select>
        </div>

        {error && !creating && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-56 animate-pulse rounded-2xl border border-border bg-card" />)}
          </div>
        ) : chains.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border px-6 py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Compass className="h-6 w-6" /></div>
            <h3 className="mt-4 text-lg font-semibold">The next great Chain hasn't started yet.</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Start with an idea, invite a Circle and let the result grow through contributions.</p>
            <Button className="mt-5" onClick={() => user ? setCreating(true) : router.push("/auth?returnTo=/chains")}>
              <Sparkles className="h-4 w-4" /> Start the first Chain
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {chains.map((chain) => (
              <Link key={chain.id} href={"/chains/" + chain.id} className="group flex min-h-60 flex-col overflow-hidden rounded-2xl border border-border bg-card transition duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5">
                <div className="relative h-24 overflow-hidden border-b border-border bg-muted" style={{ backgroundImage: chain.cover_image_url ? "url(" + chain.cover_image_url + ")" : "radial-gradient(90% 150% at 100% 0%, hsl(var(--primary) / 0.26), transparent 70%)", backgroundSize: "cover", backgroundPosition: "center" }}>
                  <span className="absolute bottom-3 left-3 rounded-full border border-white/20 bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">{formatLabel(chain.kind)}</span>
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h3 className="line-clamp-2 text-base font-bold tracking-tight transition-colors group-hover:text-primary">{chain.title}</h3>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{chain.prompt || chain.description || "An open invitation to contribute."}</p>
                  <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-xs text-muted-foreground">
                    <span className="truncate">by {chain.creator_display_name || chain.creator_username}</span>
                    <span className="shrink-0">{formatDate(chain.updated_at)}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><GitBranch className="h-3.5 w-3.5" /> {chain.contribution_count} contributions</span>
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {chain.participant_count} people</span>
                    <span className="ml-auto inline-flex items-center gap-1 font-semibold text-primary">Open <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
        {hasMore && !loading && (
          <div className="flex justify-center pt-3">
            <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? "Loading Chains…" : "Load more Chains"}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
