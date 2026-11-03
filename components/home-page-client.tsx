"use client"

import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { Header } from "@/components/header"
import { HomeHighlights } from "@/components/home/home-highlights"
import { FeedTabs } from "@/components/feed-tabs"
import { TrendingSidebar } from "@/components/trending-sidebar"
import { UserSuggestions } from "@/components/users/user-suggestions"
import { PWAInstallPrompt } from "@/components/pwa/pwa-install-prompt"
import { AppDownloadBadges } from "@/components/app-download-badges"
import { FeedTour } from "@/components/tour/feed-tour"
import { Button } from "@/components/ui/button"
import { LogIn, Smartphone, ArrowRight, Download, CheckCircle } from "lucide-react"
import { useEffect, useState, useCallback } from "react"

export function HomePageClient() {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  // Keep the server render and the browser's first render identical. Auth,
  // persisted theme and feed widgets mount only after hydration has completed.
  if (!hydrated) {
    return (
      <div data-home-hydrated="false" className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border/70 bg-background/90">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
            <Link href="/" className="text-sm font-bold tracking-tight">loopapp.me</Link>
            <nav aria-label="Primary" className="flex items-center gap-3 text-sm">
              <Link href="/explore" className="text-muted-foreground hover:text-foreground">Explore</Link>
              <Link href="/login" className="text-muted-foreground hover:text-foreground">Log in</Link>
              <Link href="/signup" className="rounded-full bg-foreground px-3 py-1.5 text-background">Join free</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-3 pb-24 pt-6 sm:px-6 sm:pt-10">
          <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-8">
            <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
              Build together.
              <span className="text-muted-foreground"> Not just post into the void.</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Create with other people, discover ideas worth joining, and build communities around shared interests.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/signup" className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background">Join free</Link>
              <Link href="/explore" className="rounded-full border border-border px-4 py-2 text-sm font-medium">Explore Loop</Link>
            </div>
          </section>
        </main>
      </div>
    )
  }

  return <HomePageInteractive />
}

function HomePageInteractive() {
  const { user } = useAuth()

  // Treat unresolved auth as guest so SSR/crawlers get real content + <h1>
  // instead of an empty loading shell.
  const isGuest = !user

  return (
    <div data-home-hydrated="true" className="min-h-screen bg-background text-foreground transition-colors duration-300">
      <Header />

      <main className="container mx-auto px-2 pb-24 pt-3 sm:px-4 sm:py-6 lg:pb-6">
        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-2.5 sm:space-y-3">
            {isGuest ? (
              <section className="rounded-2xl border border-border/60 bg-card/50 overflow-hidden">
                <div className="p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="max-w-xl">
                      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                        Build together.
                        <span className="text-muted-foreground"> Not just post into the void.</span>
                      </h1>
                      <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                        Co-write posts live with friends, settle debates in public Duels, and build communities that actually work for the people in them.
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button asChild className="rounded-full bg-foreground text-background hover:opacity-90" size="sm">
                        <Link href="/signup">Join free</Link>
                      </Button>
                      <Button asChild variant="outline" className="rounded-full" size="sm">
                        <Link href="/login">
                          <LogIn className="mr-1.5 h-4 w-4" />
                          Log in
                        </Link>
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> No waitlist</span>
                    <span className="inline-flex items-center gap-1.5"><CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> Free to start</span>
                    <span className="inline-flex items-center gap-1.5"><CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> Your content stays yours</span>
                  </div>
                </div>
              </section>
            ) : (
              <>
                {/*
                 * One row of chrome, not five stacked cards: the quick actions
                 * stay visible and the promotional cards live behind the
                 * Highlights toggle (see HomeHighlights).
                 */}
                <HomeHighlights />
                {/* One-time coach-mark tour over the real feed UI */}
                <FeedTour />
              </>
            )}

            {/* Guests still get the nav chips — their quick actions have no
                other home; signed-in users get them from HomeHighlights. */}
            {isGuest && (
              <div className="relative group">
                <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-background to-transparent z-10" />
                <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-background to-transparent z-10" />
                <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-0.5 px-0.5 scroll-smooth">
                  <Link
                    href="/explore"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                  >
                    Explore
                  </Link>
                  <Link
                    href="/trees"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                  >
                    Trees
                  </Link>
                  <Link
                    href="/landing"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                  >
                    What is Loop?
                  </Link>
                </div>
              </div>
            )}

            <FeedTabs guestMode={isGuest} />

            {!isGuest && (
              <div className="lg:hidden">
                <UserSuggestions title="Who to follow" limit={4} compact />
              </div>
            )}
          </div>

          <aside className="hidden lg:block">
            <div className="sticky top-20 space-y-4">
              {isGuest ? (
                <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
                  <h2 className="text-sm font-semibold">What makes Loop different</h2>
                  <ul className="mt-3 space-y-2.5 text-xs text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/30" />
                      <span><strong className="text-foreground">Co-Loop</strong> — Co-write and publish live with up to 4 people.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/30" />
                      <span><strong className="text-foreground">Duels</strong> — Stake coins, let the community vote on a winner.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/30" />
                      <span><strong className="text-foreground">Circles</strong> — Build communities around your interests.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/30" />
                      <span><strong className="text-foreground">Coins</strong> — Earn, gift, and boost content across Loop.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/30" />
                      <span><strong className="text-foreground">Quests</strong> — Complete missions, play games, earn rewards.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/30" />
                      <span><strong className="text-foreground">Reels</strong> — Short-form video with a dedicated Explore grid.</span>
                    </li>
                  </ul>

                  <div className="mt-4">
                    <StatsBlock />
                  </div>

                  <Button asChild className="mt-4 w-full rounded-full bg-foreground text-background hover:opacity-90" size="sm">
                    <Link href="/signup">Create account</Link>
                  </Button>
                  <Button asChild variant="ghost" className="mt-1 w-full rounded-full" size="sm">
                    <Link href="/landing">What is Loop?</Link>
                  </Button>
                </div>
              ) : null}
              {isGuest && (
                <DownloadCard />
              )}
              <TrendingSidebar />
              {!isGuest && <UserSuggestions title="Who to follow" limit={5} compact />}
            </div>
          </aside>
        </div>
      </main>

      <PWAInstallPrompt />
    </div>
  )
}

function StatsBlock() {
  const [stats, setStats] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function fetchStats() {
      try {
        const res = await fetch(`/api/stats`, { cache: "no-store" })
        const data = await res.json()
        if (!mounted) return
        if (!res.ok) throw new Error(data?.error || "Failed to load stats")
        setStats(data)
      } catch (err: any) {
        console.error("Stats fetch error:", err)
        setError(err.message || "Failed to load")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void fetchStats()
    return () => {
      mounted = false
    }
  }, [])

  if (loading) return <p className="mt-3 text-sm text-muted-foreground">Loading live activity…</p>
  if (error) return <p className="mt-3 text-sm text-red-500">Couldn't load activity</p>
  if (!stats) return null

  // Only show counts if they're non-trivial (threshold: 10)
  const showCount = (n: number | null | undefined) => typeof n === "number" && n >= 10
  const counts = [
    showCount(stats.total_loops) ? { label: "Loops created", value: stats.total_loops } : null,
    showCount(stats.total_users) ? { label: "People on Loop", value: stats.total_users } : null,
    showCount(stats.total_circles) ? { label: "Circles", value: stats.total_circles } : null,
    showCount(stats.active_co_loops) ? { label: "People building right now", value: stats.active_co_loops } : null,
  ].filter(Boolean)

  if (counts.length > 0) {
    return (
      <div className="mt-4 border-t border-border/60 pt-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Live activity</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {counts.map((c: any) => (
            <div key={c.label} className="rounded-md bg-muted/20 p-2 text-sm">
              <div className="text-lg font-bold">{c.value.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{c.label}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Fallback: show a few recent items (loops or circles) if counts are low
  const recentLoops = (stats.recent_loops || []).slice(0, 3)
  const recentCircles = (stats.recent_circles || []).slice(0, 3)

  if (recentLoops.length || recentCircles.length) {
    return (
      <div className="mt-4 border-t border-border/60 pt-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Recent activity</p>
        <div className="mt-2 space-y-2">
          {recentLoops.map((l: any) => (
            <Link key={l.id} href={`/loop/${l.id}`} className="block text-sm text-foreground/90 hover:underline">
              {l.preview}
              <div className="text-xs text-muted-foreground">by @{l.author_username}</div>
            </Link>
          ))}
          {recentCircles.map((c: any) => (
            <Link key={c.id} href={`/communities/${c.id}`} className="block text-sm text-foreground/90 hover:underline">
              {c.name}
              <div className="text-xs text-muted-foreground">{c.member_count ?? "Active"} active</div>
            </Link>
          ))}
        </div>
      </div>
    )
  }

  return <p className="mt-3 text-sm text-muted-foreground">Join free to start building with others.</p>
}

function DownloadCard() {
  const [downloadState, setDownloadState] = useState<"idle" | "downloading" | "done" | "error">("idle")
  const [progress, setProgress] = useState(0)

  const handleDownload = useCallback(async () => {
    if (downloadState === "downloading") return
    setDownloadState("downloading")
    setProgress(0)
    try {
      const res = await fetch("/api/download/apk")
      if (!res.ok) throw new Error("Not available")
      const contentLength = Number(res.headers.get("content-length")) || 0
      const reader = res.body?.getReader()
      if (!reader) throw new Error("No stream")
      let received = 0
      const chunks: Uint8Array[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        if (contentLength > 0) setProgress(Math.round((received / contentLength) * 100))
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
      const merged = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      const blob = new Blob([merged.buffer], { type: "application/vnd.android.package-archive" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "loop.apk"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setProgress(100)
      setDownloadState("done")
    } catch {
      setDownloadState("error")
    }
  }, [downloadState])

  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10">
          <Smartphone className="h-4 w-4 text-emerald-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Get the app</p>
          <p className="text-xs text-muted-foreground">Android available now</p>
        </div>
      </div>

      {downloadState === "idle" && (
        <Button onClick={handleDownload} className="mt-3 w-full rounded-xl" size="sm">
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Download for Android
        </Button>
      )}
      {downloadState === "downloading" && (
        <div className="mt-3 space-y-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-center text-[11px] text-muted-foreground">{progress}%</p>
        </div>
      )}
      {downloadState === "done" && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-emerald-500/10 p-2 text-xs text-emerald-500">
          <CheckCircle className="h-3.5 w-3.5" />
          Downloaded!
        </div>
      )}
      {downloadState === "error" && (
        <Button onClick={handleDownload} variant="outline" className="mt-3 w-full rounded-xl" size="sm">
          Try again
        </Button>
      )}

      <Link href="/download" className="mt-2 flex items-center justify-center gap-1 text-xs text-primary hover:underline">
        Learn more
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  )
}
