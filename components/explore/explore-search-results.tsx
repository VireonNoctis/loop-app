"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowUpRight, Bookmark, CalendarDays, GitBranch, Hash, Search, Users } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/skeletons"

type SearchRecord = Record<string, any>
type SocialSearchPayload = {
  loops?: SearchRecord[]
  users?: SearchRecord[]
  circles?: SearchRecord[]
  hashtags?: SearchRecord[]
  chains?: SearchRecord[]
  collections?: SearchRecord[]
}
type DropSearchPayload = { items?: SearchRecord[] }
type SearchResults = {
  loops: SearchRecord[]
  users: SearchRecord[]
  circles: SearchRecord[]
  hashtags: SearchRecord[]
  chains: SearchRecord[]
  collections: SearchRecord[]
  drops: SearchRecord[]
}

const EMPTY_RESULTS: SearchResults = {
  loops: [],
  users: [],
  circles: [],
  hashtags: [],
  chains: [],
  collections: [],
  drops: [],
}

function ResultSection({
  title,
  icon,
  children,
}: {
  title: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-primary">{icon}</span>
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  )
}

function ResultCard({
  href,
  title,
  description,
  meta,
}: {
  href: string
  title: string
  description?: string
  meta?: string
}) {
  return (
    <Link href={href} className="group block">
      <Card className="h-full rounded-2xl border-border/70 transition-colors group-hover:border-primary/40">
        <CardContent className="flex h-full min-h-28 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 font-semibold group-hover:text-primary">{title}</h3>
            <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
          </div>
          {description && <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>}
          {meta && <p className="mt-auto text-xs text-muted-foreground">{meta}</p>}
        </CardContent>
      </Card>
    </Link>
  )
}

export function ExploreSearchResults({
  query,
  onClear,
}: {
  query: string
  onClear: () => void
}) {
  const { user, getAuthHeader } = useAuth()
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedType, setSelectedType] = useState<"all" | keyof SearchResults>("all")
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => window.clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    setLoading(true)
    setError("")

    const load = async () => {
      const value = debouncedQuery
      if (!value) {
        setResults(EMPTY_RESULTS)
        setLoading(false)
        return
      }

      const headers = getAuthHeader()
      const requests = await Promise.allSettled([
        fetch(
          "/api/search?q=" + encodeURIComponent(value) + "&type=all&limit=12",
          { headers, cache: "no-store", signal: controller.signal },
        ).then(async (response) => {
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || "Universal search failed")
          return data as SocialSearchPayload
        }),
        user
          ? fetch(
              "/api/v1/drops?" + new URLSearchParams({ search: value, limit: "12", sort: "recent" }),
              { headers, cache: "no-store", signal: controller.signal },
            ).then(async (response) => {
              const data = await response.json()
              if (!response.ok) throw new Error(data.message || data.error || "Drops search failed")
              return data as DropSearchPayload
            })
          : Promise.resolve({ items: [] } as DropSearchPayload),
      ])

      if (!active) return
      const [social, drops] = requests

      if (requests.every((item) => item.status === "rejected")) {
        const firstError = requests.find((item) => item.status === "rejected")
        setError(firstError?.status === "rejected" && firstError.reason instanceof Error
          ? firstError.reason.message
          : "Search is temporarily unavailable.")
        setResults(EMPTY_RESULTS)
      } else {
        setResults({
          loops: social.status === "fulfilled" ? social.value.loops || [] : [],
          users: social.status === "fulfilled" ? social.value.users || [] : [],
          circles: social.status === "fulfilled" ? social.value.circles || [] : [],
          hashtags: social.status === "fulfilled" ? social.value.hashtags || [] : [],
          chains: social.status === "fulfilled" ? social.value.chains || [] : [],
          collections: social.status === "fulfilled" ? social.value.collections || [] : [],
          drops: drops.status === "fulfilled" ? drops.value.items || [] : [],
        })
        if (requests.some((item) => item.status === "rejected")) {
          setError("Some result types could not be loaded. Available results are still shown.")
        }
      }
      setLoading(false)
    }

    void load().catch((cause) => {
      if (!active || controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : "Search is temporarily unavailable.")
      setLoading(false)
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [debouncedQuery, getAuthHeader, user?.id])

  const counts = useMemo(() => ({
    all: Object.values(results).reduce((sum, items) => sum + items.length, 0),
    chains: results.chains.length,
    collections: results.collections.length,
    drops: results.drops.length,
    circles: results.circles.length,
    users: results.users.length,
    loops: results.loops.length,
    hashtags: results.hashtags.length,
  }), [results])
  const total = counts.all
  const visibleTotal = selectedType === "all" ? total : counts[selectedType]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Search results</p>
          <h1 className="mt-1 text-xl font-semibold">{query}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={onClear}>Back to Discover</Button>
      </div>

      {error && <p role="status" className="text-sm text-muted-foreground">{error}</p>}

      {!loading && total > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Filter search result types">
          {([
            ["all", "All"],
            ["chains", "Chains"],
            ["collections", "Collections"],
            ["drops", "Drops"],
            ["circles", "Circles"],
            ["users", "People"],
            ["loops", "Loops"],
            ["hashtags", "Hashtags"],
          ] as const).map(([type, label]) => (
            <button
              key={type}
              type="button"
              aria-pressed={selectedType === type}
              onClick={() => setSelectedType(type)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selectedType === type
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {label} <span className="ml-1 tabular-nums opacity-75">{counts[type]}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Spinner className="h-5 w-5" /> Searching LOOP…
        </div>
      ) : visibleTotal === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Search className="h-6 w-6 text-muted-foreground" />
            <h2 className="font-semibold">{total === 0 ? "No results found" : "No results in this category"}</h2>
            <p className="text-sm text-muted-foreground">{total === 0 ? "Try a different name, topic or phrase." : "Choose another result type or return to All."}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Showing {visibleTotal} of {total} matching results across public content and communities.</p>

          {(selectedType === "all" || selectedType === "chains") && results.chains.length > 0 && (
            <ResultSection title="Chains" icon={<GitBranch className="h-4 w-4" />}>
              {results.chains.map((item) => (
                <ResultCard key={item.id} href={"/chains/" + item.id} title={item.title}
                  description={item.description || item.prompt}
                  meta={(item.contribution_count ?? 0) + " contributions · " + (item.participant_count ?? 0) + " contributors"} />
              ))}
            </ResultSection>
          )}

          {(selectedType === "all" || selectedType === "drops") && results.drops.length > 0 && (
            <ResultSection title="Drops" icon={<CalendarDays className="h-4 w-4" />}>
              {results.drops.map((item) => (
                <ResultCard key={item.source + ":" + item.id} href={item.action_url}
                  title={item.title} description={item.description}
                  meta={(item.kind === "challenge" ? "Challenge" : "Event") + " · " + item.category + " · " + (item.participants_count ?? 0) + (item.kind === "challenge" ? " entries" : " participants")} />
              ))}
            </ResultSection>
          )}

          {(selectedType === "all" || selectedType === "collections") && results.collections.length > 0 && (
            <ResultSection title="Collections" icon={<Bookmark className="h-4 w-4" />}>
              {results.collections.map((item) => (
                <ResultCard key={item.id} href={"/collections/" + item.id} title={item.title}
                  description={item.description} meta={item.is_collaborative ? "Collaborative collection" : "Public collection"} />
              ))}
            </ResultSection>
          )}

          {(selectedType === "all" || selectedType === "circles") && results.circles.length > 0 && (
            <ResultSection title="Circles" icon={<Users className="h-4 w-4" />}>
              {results.circles.map((item) => (
                <ResultCard key={item.id} href={"/circles/" + (item.slug || item.id)} title={item.name}
                  description={item.description} meta={(item.member_count ?? 0) + " members"} />
              ))}
            </ResultSection>
          )}

          {(selectedType === "all" || selectedType === "users") && results.users.length > 0 && (
            <ResultSection title="People" icon={<Users className="h-4 w-4" />}>
              {results.users.map((item) => (
                <ResultCard key={item.id} href={"/profile/" + item.username}
                  title={item.display_name || item.username} description={item.bio}
                  meta={"@" + item.username + (item.is_verified ? " · Verified" : "")} />
              ))}
            </ResultSection>
          )}

          {(selectedType === "all" || selectedType === "loops") && results.loops.length > 0 && (
            <ResultSection title="Loops" icon={<Search className="h-4 w-4" />}>
              {results.loops.map((item) => (
                <ResultCard key={item.id} href={"/loop/" + item.id}
                  title={item.content_title || item.content_text?.slice(0, 72) || "Loop"}
                  description={item.content_text || item.description}
                  meta={item.author?.username ? "by @" + item.author.username : "Loop"} />
              ))}
            </ResultSection>
          )}

          {(selectedType === "all" || selectedType === "hashtags") && results.hashtags.length > 0 && (
            <ResultSection title="Hashtags" icon={<Hash className="h-4 w-4" />}>
              {results.hashtags.map((item) => {
                const tag = String(item.tag || "").replace(/^#/, "")
                return <ResultCard key={tag} href={"/hashtag/" + encodeURIComponent(tag)}
                  title={"#" + tag} meta={(item.usage_count ?? item.count ?? 0) + " uses"} />
              })}
            </ResultSection>
          )}
        </>
      )}
    </div>
  )
}
