"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowUpRight, CalendarClock, GitBranch, ImagePlus, Loader2, RefreshCw, Send, ThumbsUp } from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { uploadMediaFile } from "@/lib/client-media-upload"
import { ProxyImg } from "@/components/ui/proxy-img"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type Author = {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  is_verified: boolean
}

type Challenge = {
  id: string
  circle_id: string
  title: string
  description: string | null
  challenge_type: string
  status: string
  starts_at: string | null
  ends_at: string | null
  created_at: string
  created_by: string
  creator: Author | Author[] | null
}

type ChallengeResponse = {
  success: boolean
  challenge: Challenge
  can_submit: boolean
  is_member: boolean
  can_create_chain: boolean
  viewer_id: string | null
}

type Entry = {
  id: string
  user_id: string
  content: string
  media_url: string | null
  vote_count: number
  created_at: string
  has_voted: boolean
  author: Author | Author[] | null
}

function oneAuthor(value: Author | Author[] | null | undefined): Author | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function formatDate(value: string | null) {
  if (!value) return "No closing time"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Time to be announced"
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

export function ChallengeDetailClient({
  circleId,
  challengeId,
}: {
  circleId: string
  challengeId: string
}) {
  const { user, loading: authLoading, getAuthHeader } = useAuth()
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<ChallengeResponse | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [content, setContent] = useState("")
  const [image, setImage] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [voting, setVoting] = useState<string | null>(null)
  const [actionError, setActionError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const headers = getAuthHeader()
      const challengeUrl =
        "/api/communities/" + encodeURIComponent(circleId) +
        "/challenges/" + encodeURIComponent(challengeId)
      const entriesUrl = challengeUrl + "/entries"
      const [challengeResponse, entriesResponse] = await Promise.all([
        fetch(challengeUrl, { headers, cache: "no-store" }),
        fetch(entriesUrl, { headers, cache: "no-store" }),
      ])
      const [challengeJson, entriesJson] = await Promise.all([
        challengeResponse.json(),
        entriesResponse.json(),
      ])
      if (!challengeResponse.ok) {
        throw new Error(challengeJson.error || "This Drop is unavailable")
      }
      if (!entriesResponse.ok) {
        throw new Error(entriesJson.error || "Could not load entries")
      }
      setData(challengeJson as ChallengeResponse)
      setEntries(Array.isArray(entriesJson.entries) ? entriesJson.entries as Entry[] : [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load this Drop")
    } finally {
      setLoading(false)
    }
  }, [challengeId, circleId, getAuthHeader])

  useEffect(() => {
    if (!authLoading) void load()
  }, [authLoading, load, user?.id])

  const submitEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) {
      router.push("/login?redirect=/communities/" + circleId + "/challenges/" + challengeId)
      return
    }
    if (!content.trim() && !image) {
      setActionError("Add some text or an image to submit an entry.")
      return
    }

    setSubmitting(true)
    setActionError("")
    try {
      let mediaUrl: string | undefined
      if (image) {
        const uploaded = await uploadMediaFile(image, {
          type: "image",
          folder: "drop-entries",
          authHeaders: getAuthHeader(),
        })
        mediaUrl = uploaded.url
      }

      const response = await fetch(
        "/api/communities/" + encodeURIComponent(circleId) +
          "/challenges/" + encodeURIComponent(challengeId) + "/entries",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({
            content: content.trim(),
            media_url: mediaUrl,
          }),
        },
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Could not submit your entry")

      setContent("")
      setImage(null)
      if (fileRef.current) fileRef.current.value = ""
      await load()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not submit your entry")
    } finally {
      setSubmitting(false)
    }
  }

  const vote = async (entry: Entry) => {
    if (!user) {
      router.push("/login?redirect=/communities/" + circleId + "/challenges/" + challengeId)
      return
    }
    setVoting(entry.id)
    setActionError("")
    try {
      const response = await fetch(
        "/api/communities/" + encodeURIComponent(circleId) +
          "/challenges/" + encodeURIComponent(challengeId) + "/entries",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({ action: "vote", entry_id: entry.id }),
        },
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Could not save your vote")
      setEntries((current) => current.map((item) =>
        item.id === entry.id
          ? { ...item, has_voted: Boolean(result.voted), vote_count: Number(result.vote_count) || 0 }
          : item,
      ))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save your vote")
    } finally {
      setVoting(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-36 animate-pulse rounded-2xl bg-muted" />
        <div className="h-48 animate-pulse rounded-2xl bg-muted" />
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <section className="space-y-4 py-12 text-center">
        <h1 className="text-xl font-semibold">Drop unavailable</h1>
        <p className="text-sm text-muted-foreground">{loadError || "This Drop could not be loaded."}</p>
        <Link href="/drops" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to Drops
        </Link>
      </section>
    )
  }

  const challenge = data.challenge
  const creator = oneAuthor(challenge.creator)
  const acceptingEntries = data.can_submit
  const startsAt = challenge.starts_at ? new Date(challenge.starts_at).getTime() : null
  const endsAt = challenge.ends_at ? new Date(challenge.ends_at).getTime() : null
  const isUpcoming = challenge.status === "active" && startsAt !== null && startsAt > Date.now()
  const isEnded = challenge.status !== "active" || (endsAt !== null && endsAt < Date.now())
  const challengePhase = isEnded
    ? "Closed"
    : isUpcoming
      ? "Upcoming"
      : acceptingEntries
        ? "Open for entries"
        : "Not accepting entries"
  const chainParams = new URLSearchParams({
    circle_id: circleId,
    source_drop_id: challenge.id,
    title: (`Continue: ${challenge.title}`).slice(0, 120),
    description: (challenge.description || "").slice(0, 2_000),
    prompt: (`Continue the community idea from the Drop: ${challenge.title}`).slice(0, 1_200),
    kind: "challenge",
    create: "1",
  })

  return (
    <div className="space-y-6">
      <Link href="/drops" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Drops
      </Link>

      <header className="space-y-3 rounded-3xl border border-border/70 bg-gradient-to-br from-primary/10 via-card to-cyan-500/10 p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          <CalendarClock className="h-4 w-4" />
          {challenge.challenge_type.replace(/_/g, " ")}
          <span className="text-muted-foreground">·</span>
          {challengePhase}
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{challenge.title}</h1>
        {challenge.description ? (
          <p className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {challenge.description}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>Created by {creator?.display_name || creator?.username || "Circle member"}</span>
          <span>·</span>
          {challenge.starts_at && <span>Starts {formatDate(challenge.starts_at)}</span>}
          <span>Closes {formatDate(challenge.ends_at)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={"/communities/" + circleId} className="inline-flex text-xs font-semibold text-primary hover:underline">
            Open Circle
          </Link>
          {data.can_create_chain && (
            <Link
              href={"/chains?" + chainParams.toString()}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/10"
            >
              <GitBranch className="h-3.5 w-3.5" />
              Continue as a Chain
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </header>

      {acceptingEntries ? (
        <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
          <div className="mb-3 space-y-1">
            <h2 className="font-semibold">Add your entry</h2>
            <p className="text-xs text-muted-foreground">
              Share an idea or an image. Community votes are feedback, not rewards or stakes.
            </p>
          </div>
          <form onSubmit={submitEntry} className="space-y-3">
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Add your contribution…"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:bg-muted">
                  <ImagePlus className="h-4 w-4" />
                  Add image
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    disabled={submitting}
                    onChange={(event) => setImage(event.target.files?.[0] || null)}
                    className="sr-only"
                  />
                </label>
                {image ? <p className="mt-1 max-w-60 truncate text-xs text-muted-foreground">{image.name}</p> : null}
              </div>
              <Button type="submit" disabled={submitting || (!content.trim() && !image)}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                {submitting ? "Submitting…" : "Submit entry"}
              </Button>
            </div>
            {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
          </form>
        </section>
      ) : !data.is_member ? (
        <section className="rounded-2xl border border-dashed border-border p-5">
          <p className="font-semibold">Join this Circle to take part.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This Drop is hosted inside a Circle, and only members can submit entries or vote.
          </p>
          <Link href={"/communities/" + circleId} className="mt-3 inline-flex text-sm font-semibold text-primary hover:underline">
            Open Circle
          </Link>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          This Drop is not accepting new entries right now.
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Community entries</h2>
            <p className="text-xs text-muted-foreground">
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <ImagePlus className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-2 font-medium">Be the first to contribute.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Share a response and get the conversation started.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {entries.map((entry) => {
              const author = oneAuthor(entry.author)
              const ownEntry = entry.user_id === user?.id
              return (
                <article key={entry.id} className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    {author?.username ? (
                      <Link href={"/profile/" + author.username} className="min-w-0 truncate text-sm font-semibold hover:underline">
                        {author.display_name || author.username}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {author?.display_name || "Circle member"}
                      </span>
                    )}
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(entry.created_at)}</span>
                  </div>
                  {entry.content ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{entry.content}</p> : null}
                  {entry.media_url ? (
                    <ProxyImg
                      src={entry.media_url}
                      alt="Community entry"
                      className="max-h-80 w-auto max-w-full rounded-xl object-contain"
                    />
                  ) : null}
                  <div className="flex items-center justify-between border-t border-border/70 pt-3">
                    <span className="text-xs text-muted-foreground">
                      {entry.vote_count} {entry.vote_count === 1 ? "vote" : "votes"}
                    </span>
                    <Button
                      size="sm"
                      variant={entry.has_voted ? "secondary" : "outline"}
                      disabled={!data.is_member || ownEntry || voting === entry.id}
                      onClick={() => void vote(entry)}
                    >
                      {voting === entry.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />}
                      {entry.has_voted ? "Voted" : "Vote"}
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
