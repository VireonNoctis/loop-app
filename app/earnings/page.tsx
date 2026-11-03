"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Coins,
  Gift,
  TrendingUp,
  Radio,
  Zap,
  RefreshCw,
  ArrowUpRight,
  Video,
  Home,
  DollarSign,
  Eye,
  Heart,
  MessageCircle,
} from "lucide-react"

interface EarningsData {
  balance: {
    loop_coins: number
    total_earnings: number
    available_earnings: number
    is_verified: boolean
  }
  gifts: {
    received_count: number
    received_coins: number
    recent: Array<{
      id: string
      gift_name: string
      cost: number
      is_anonymous: boolean
      created_at: string
      context_type?: string
    }>
  }
  top_loops: Array<{
    id: string
    content_title?: string
    content_text?: string
    content?: string
    media_type?: string
    like_count: number
    comment_count: number
    view_count: number
    share_count: number
    created_at: string
  }>
  top_reels: Array<{
    id: string
    title?: string
    like_count: number
    comment_count: number
    view_count: number
    share_count: number
    created_at: string
  }>
  live: {
    streams: Array<{ id: string; title: string; max_viewers: number; total_earnings: number; status: string }>
    peak_viewers: number
    total_earnings: number
  }
  boosts: { total_spend_coins: number; count: number }
  withdrawals: Array<{ id: string; coins_amount: number; estimated_usd: number; status: string; created_at: string }>
}

export default function EarningsPage() {
  const { user, loading: authLoading, getAuthHeader } = useAuth()
  const [data, setData] = useState<EarningsData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchEarnings = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/earnings", { headers: { ...getAuthHeader() } })
      if (res.ok) {
        const json = await res.json()
        if (json.success) setData(json)
      }
    } catch (err) {
      console.error("Failed to load earnings:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading && user) fetchEarnings()
  }, [authLoading, user])

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-muted-foreground">Sign in to see your Creator Studio.</p>
        <Link href="/login">
          <Button className="rounded-full">Log in</Button>
        </Link>
      </div>
    )
  }

  const b = data?.balance
  const topContent = [
    ...(data?.top_loops || []).map((l) => ({ ...l, kind: "loop" as const, title: l.content_title || l.content_text || l.content || "Untitled loop" })),
    ...(data?.top_reels || []).map((r) => ({ ...r, kind: "reel" as const, title: r.title || "Untitled reel" })),
  ]
    .sort((a, b) => (b.like_count || 0) - (a.like_count || 0))
    .slice(0, 6)

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6 sm:py-8 space-y-6">
      <div className="flex flex-col gap-1 border-b border-border/60 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Creator Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your performance and money at a glance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchEarnings} disabled={loading} className="rounded-lg text-xs">
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button asChild variant="secondary" size="sm" className="rounded-lg text-xs font-medium">
            <Link href="/wallet">Wallet & Payouts</Link>
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Top summary cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Coins className="h-4 w-4 text-yellow-500" /> Loop Coins
                </div>
                <p className="mt-2 text-2xl font-bold">{(b?.loop_coins || 0).toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <DollarSign className="h-4 w-4 text-emerald-500" /> Available Earnings
                </div>
                <p className="mt-2 text-2xl font-bold">${(b?.available_earnings || 0).toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <TrendingUp className="h-4 w-4 text-sky-500" /> Lifetime Earnings
                </div>
                <p className="mt-2 text-2xl font-bold">${(b?.total_earnings || 0).toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Gift className="h-4 w-4 text-rose-500" /> Gifts Received
                </div>
                <p className="mt-2 text-2xl font-bold">{data?.gifts.received_count || 0}</p>
                <p className="text-xs text-muted-foreground">{(data?.gifts.received_coins || 0).toLocaleString()} coins total</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Top performing content */}
            <Card className="border-border/60 lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4 text-violet-500" /> Top Loops & Reels
                </CardTitle>
                <CardDescription className="text-xs">Your best-performing posts by likes.</CardDescription>
              </CardHeader>
              <CardContent>
                {topContent.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No posts yet.{" "}
                    <Link href="/create" className="font-medium text-primary underline">
                      Create your first Loop
                    </Link>
                  </div>
                ) : (
                  <div className="divide-y divide-border/40">
                    {topContent.map((item) => (
                      <div key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={`rounded-lg p-2 ${item.kind === "reel" ? "bg-blue-500/10 text-blue-500" : "bg-purple-500/10 text-purple-500"}`}>
                            {item.kind === "reel" ? <Video className="h-4 w-4" /> : <Home className="h-4 w-4" />}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{item.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(item.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Heart className="h-3.5 w-3.5" /> {item.like_count || 0}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageCircle className="h-3.5 w-3.5" /> {item.comment_count || 0}
                          </span>
                          <span className="flex items-center gap-1">
                            <Eye className="h-3.5 w-3.5" /> {item.view_count || 0}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Live + Boosts */}
            <div className="space-y-6">
              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Radio className="h-4 w-4 text-red-500" /> Live Peaks
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Peak concurrent viewers</span>
                    <span className="font-semibold">{data?.live.peak_viewers || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Live earnings</span>
                    <span className="font-semibold">${(data?.live.total_earnings || 0).toFixed(2)}</span>
                  </div>
                  {(data?.live.streams.length || 0) === 0 && (
                    <p className="pt-2 text-xs text-muted-foreground">
                      No streams yet.{" "}
                      <Link href="/create/stream" className="font-medium text-primary underline">
                        Go live
                      </Link>
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="h-4 w-4 text-amber-500" /> Boost Spend
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total spent boosting</span>
                    <span className="font-semibold">{(data?.boosts.total_spend_coins || 0).toLocaleString()} coins</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Boosts purchased</span>
                    <span className="font-semibold">{data?.boosts.count || 0}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-muted/20">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold">Loop Coin cashouts</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Verified creators can request a manual payout from their Loop Coin balance in Wallet. USD creator earnings are tracked separately and are not currently withdrawable.
                  </p>
                  <Button asChild size="sm" variant="outline" className="mt-3 w-full rounded-lg">
                    <Link href="/wallet?tab=withdrawals">
                      Open Wallet <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Recent gifts */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Gift className="h-4 w-4 text-rose-500" /> Recent Gifts
              </CardTitle>
              <CardDescription className="text-xs">Gifts fans sent on your loops, reels, and streams.</CardDescription>
            </CardHeader>
            <CardContent>
              {(data?.gifts.recent.length || 0) === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No gifts yet. Share your best work to start earning.
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {data!.gifts.recent.map((g) => (
                    <div key={g.id} className="flex items-center justify-between py-3 text-sm">
                      <div>
                        <p className="font-medium">{g.gift_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {g.is_anonymous ? "From a supporter" : "From a fan"} ·{" "}
                          {new Date(g.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        +{g.cost} coins
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
