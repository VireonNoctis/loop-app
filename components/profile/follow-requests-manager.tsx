"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Check, Clock3, Inbox, UserRoundCheck, UserRoundX, Users } from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { isRustApiUnavailable, rustApiRequest } from "@/lib/rust-api"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { VerifiedSeal } from "@/components/ui/verified-seal"

interface FollowRequestPerson {
  id: string
  username: string
  display_name: string
  avatar_url?: string | null
  video_avatar_url?: string | null
  is_verified?: boolean
  bio?: string | null
}

interface IncomingRequest {
  id: string
  created_at: string
  requester: FollowRequestPerson
}

interface OutgoingRequest {
  id: string
  target_id: string
  status: string
  created_at: string
  target: FollowRequestPerson
}

interface FollowRequestsResponse {
  success: boolean
  incoming: IncomingRequest[]
  outgoing: OutgoingRequest[]
}

type RequestTab = "incoming" | "outgoing"

function relativeDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Recently"
  const delta = Math.max(0, Date.now() - date.getTime())
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d ago` : date.toLocaleDateString()
}

export function FollowRequestsManager() {
  const { user, loading: authLoading, getAuthHeader } = useAuth()
  const { toast } = useToast()
  const [data, setData] = useState<FollowRequestsResponse>({ success: true, incoming: [], outgoing: [] })
  const [tab, setTab] = useState<RequestTab>("incoming")
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) {
      setData({ success: true, incoming: [], outgoing: [] })
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      let result: FollowRequestsResponse
      try {
        result = await rustApiRequest<FollowRequestsResponse>("follow-requests?limit=50", {
          headers: getAuthHeader(),
          cache: "no-store",
        })
      } catch (cause) {
        if (!isRustApiUnavailable(cause)) throw cause
        const response = await fetch("/api/users/follow-requests", {
          headers: getAuthHeader(),
          cache: "no-store",
        })
        if (!response.ok) throw new Error("Could not load follow requests")
        result = await response.json()
      }
      setData({
        success: true,
        incoming: Array.isArray(result.incoming) ? result.incoming : [],
        outgoing: Array.isArray(result.outgoing) ? result.outgoing : [],
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not load follow requests."
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [getAuthHeader, user])

  useEffect(() => {
    if (!authLoading) void load()
  }, [authLoading, load])

  const handleAction = async (requestId: string, action: "accept" | "decline" | "withdraw") => {
    setBusyId(requestId)
    try {
      try {
        await rustApiRequest(`follow-requests/${encodeURIComponent(requestId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({ action }),
        })
      } catch (cause) {
        if (!isRustApiUnavailable(cause)) throw cause
        const response = await fetch("/api/users/follow-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({ request_id: requestId, action }),
        })
        if (!response.ok) throw new Error(`Could not ${action} this request`)
      }

      setData((current) => ({
        ...current,
        incoming: action === "withdraw"
          ? current.incoming
          : current.incoming.filter((request) => request.id !== requestId),
        outgoing: action === "withdraw"
          ? current.outgoing.filter((request) => request.id !== requestId)
          : current.outgoing,
      }))
      toast({
        title: action === "accept"
          ? "Follow request accepted"
          : action === "decline"
            ? "Follow request declined"
            : "Follow request withdrawn",
        description: action === "accept"
          ? "They can now see your followers-only posts."
          : action === "withdraw"
            ? "The pending request was removed."
            : undefined,
      })
    } catch (cause) {
      toast({
        title: "Could not update request",
        description: cause instanceof Error ? cause.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  if (authLoading || loading) {
    return <div className="space-y-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-muted/50" />)}</div>
  }

  if (!user) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground" />
          <h2 className="font-semibold">Sign in to manage follow requests</h2>
          <Button onClick={() => window.location.assign("/login?redirect=/follow-requests")}>Sign in</Button>
        </CardContent>
      </Card>
    )
  }

  const current = tab === "incoming" ? data.incoming : data.outgoing

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl border border-border bg-muted/40 p-1">
          <button
            type="button"
            aria-pressed={tab === "incoming"}
            onClick={() => setTab("incoming")}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tab === "incoming" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Received <span className="ml-1 tabular-nums">{data.incoming.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={tab === "outgoing"}
            onClick={() => setTab("outgoing")}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tab === "outgoing" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Sent <span className="ml-1 tabular-nums">{data.outgoing.length}</span>
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} className="loop-tactile-flat">Refresh</Button>
      </div>

      {error ? (
        <Card className="rounded-2xl border-destructive/30">
          <CardContent className="flex flex-col gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={() => void load()}>Try again</Button>
          </CardContent>
        </Card>
      ) : current.length === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            {tab === "incoming" ? <Users className="h-7 w-7 text-muted-foreground" /> : <Clock3 className="h-7 w-7 text-muted-foreground" />}
            <h2 className="font-semibold">{tab === "incoming" ? "No pending requests" : "No outgoing requests"}</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {tab === "incoming" ? "When someone requests to follow your private profile, you’ll be able to review it here." : "Requests you send to private profiles will appear here until they’re reviewed."}
            </p>
            <Link href="/explore" className="text-sm font-medium text-primary hover:underline">Explore LOOP</Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tab === "incoming"
            ? data.incoming.map((request) => (
                <Card key={request.id} className="rounded-2xl border-border/70">
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <Link href={`/profile/${request.requester.username}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar className="h-11 w-11">
                        <AvatarImage src={request.requester.avatar_url || undefined} />
                        <AvatarFallback>{request.requester.display_name.slice(0, 1) || "?"}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
                          {request.requester.display_name}
                          {request.requester.is_verified ? <VerifiedSeal size={16} title="Verified" /> : null}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">@{request.requester.username}</span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">{relativeDate(request.created_at)}</span>
                      </span>
                    </Link>
                    <div className="flex gap-2 sm:shrink-0">
                      <Button
                        size="sm"
                        className="loop-tactile gap-1.5"
                        disabled={busyId === request.id}
                        onClick={() => void handleAction(request.id, "accept")}
                      >
                        <UserRoundCheck className="h-4 w-4" /> Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="loop-tactile-flat gap-1.5"
                        disabled={busyId === request.id}
                        onClick={() => void handleAction(request.id, "decline")}
                      >
                        <UserRoundX className="h-4 w-4" /> Decline
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            : data.outgoing.map((request) => (
                <Card key={request.id} className="rounded-2xl border-border/70">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Avatar className="h-11 w-11">
                      <AvatarImage src={request.target.avatar_url || undefined} />
                      <AvatarFallback>{request.target.display_name.slice(0, 1) || "?"}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{request.target.display_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">@{request.target.username}</span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">Sent {relativeDate(request.created_at)}</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="secondary" className="rounded-full">Pending</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="loop-tactile-flat gap-1.5"
                        disabled={busyId === request.id}
                        onClick={() => void handleAction(request.id, "withdraw")}
                        aria-label={`Withdraw follow request to ${request.target.display_name}`}
                      >
                        <UserRoundX className="h-4 w-4" /> Withdraw
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
        </div>
      )}
    </div>
  )
}
