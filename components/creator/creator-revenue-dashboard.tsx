"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { VideoAvatar } from "@/components/cosmetics/video-avatar"
import { useAuth } from "@/hooks/use-auth"
import {
  DollarSign,
  TrendingUp,
  Coins,
  Gift,
  Download,
  Star,
  ArrowUpRight,
  Clock,
  Users,
  Zap,
  Award,
  Wallet,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface RevenueData {
  balance: {
    loop_coins: number
    total_earnings: number
    available_earnings: number
    is_verified: boolean
  }
  revenue_breakdown: {
    gifts: number
    tips: number
    creator_fund: number
    boosts: number
    live_streams: number
    subscriptions: number
  }
  monthly_trend: Array<{
    month: string
    earnings: number
    gifts: number
    engagement: number
  }>
  top_earning_content: Array<{
    id: string
    title: string
    type: string
    earnings: number
    views: number
    engagement_rate: number
  }>
  pending_withdrawals: number
  next_payout_date: string
}

interface CreatorRevenueDashboardProps {
  className?: string
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

export function CreatorRevenueDashboard({ className }: CreatorRevenueDashboardProps) {
  const { user, getAuthHeader } = useAuth()
  const [data, setData] = useState<RevenueData | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "all">("30d")

  useEffect(() => {
    fetchRevenueData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange])

  const fetchRevenueData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/creator/revenue?range=${timeRange}`, {
        headers: getAuthHeader(),
      })
      if (res.ok) {
        const result = await res.json()
        setData(result)
      }
    } catch (err) {
      console.error("Failed to fetch revenue data:", err)
    } finally {
      setLoading(false)
    }
  }

  const formatCoins = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return String(n)
  }

  const formatUsd = (n: number) => {
    return `$${n.toFixed(2)}`
  }

  if (loading) {
    return (
      <div className={cn("space-y-4", className)}>
        <div className="h-20 rounded-2xl bg-muted/50 animate-pulse" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted/50 animate-pulse" />
          ))}
        </div>
        <div className="h-40 rounded-2xl bg-muted/50 animate-pulse" />
      </div>
    )
  }

  if (!data) return null

  const totalRevenue = Object.values(data.revenue_breakdown).reduce((a, b) => a + b, 0)

  const revenueSources = [
    { name: "Gifts", amount: data.revenue_breakdown.gifts, icon: Gift, color: "text-rose-500", bg: "bg-rose-500/10" },
    { name: "Live Tips", amount: data.revenue_breakdown.live_streams, icon: Zap, color: "text-amber-500", bg: "bg-amber-500/10" },
    { name: "Creator Fund", amount: data.revenue_breakdown.creator_fund, icon: Award, color: "text-violet-500", bg: "bg-violet-500/10" },
    { name: "Subscriptions", amount: data.revenue_breakdown.subscriptions, icon: Star, color: "text-cyan-500", bg: "bg-cyan-500/10" },
    { name: "Post Boosts", amount: data.revenue_breakdown.boosts, icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { name: "Tips", amount: data.revenue_breakdown.tips, icon: Coins, color: "text-orange-500", bg: "bg-orange-500/10" },
  ].filter((s) => s.amount > 0)

  return (
    <div className={cn("space-y-4", className)}>
      {/* Time Range Toggle */}
      <div className="flex items-center gap-2">
        {(["7d", "30d", "all"] as const).map((range) => (
          <Button
            key={range}
            variant={timeRange === range ? "default" : "outline"}
            size="sm"
            onClick={() => setTimeRange(range)}
            className="text-xs rounded-full"
          >
            {range === "7d" ? "7 Days" : range === "30d" ? "30 Days" : "All Time"}
          </Button>
        ))}
      </div>

      {/* Balance Card */}
      <Card className="overflow-hidden border-border/50 bg-gradient-to-br from-violet-500/10 via-card to-cyan-500/10">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-violet-500 to-cyan-500">
                <Wallet className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Available Balance</p>
                <p className="text-2xl font-bold">
                  {formatCoins(data.balance.available_earnings)}
                  <span className="text-sm font-normal text-muted-foreground ml-1">coins</span>
                </p>
              </div>
            </div>
            {data.balance.available_earnings > 0 && (
              <Button size="sm" variant="outline" className="rounded-full text-xs gap-1">
                <Download className="h-3.5 w-3.5" />
                Withdraw
              </Button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/50">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Total Earned</p>
              <p className="text-sm font-bold">{formatCoins(data.balance.total_earnings)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Gift Coins This Period</p>
              <p className="text-sm font-bold">{formatCoins(totalRevenue)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Pending</p>
              <p className="text-sm font-bold">{data.pending_withdrawals}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Revenue Sources */}
      {revenueSources.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Revenue Sources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {revenueSources.map((source) => (
              <div key={source.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", source.bg)}>
                    <source.icon className={cn("h-4 w-4", source.color)} />
                  </div>
                  <span className="text-sm font-medium">{source.name}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold">{formatCoins(source.amount)}</span>
                  {totalRevenue > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      {((source.amount / totalRevenue) * 100).toFixed(0)}%
                    </p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Top Content Performance */}
      {data.top_earning_content.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Top Earning Content</CardTitle>
            <Link href="/earnings" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.top_earning_content.slice(0, 3).map((item, i) => (
              <div key={item.id} className="flex items-center gap-3 rounded-xl bg-muted/30 p-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.title || "Untitled"}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.views.toLocaleString()} views · {item.engagement_rate.toFixed(1)}% engagement
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold text-emerald-500">
                  {formatNumber(item.views)} views
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Withdrawal status */}
      {data.next_payout_date && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border/50 bg-muted/20 p-3">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Payout timing is provided after a withdrawal request is reviewed.
          </span>
        </div>
      )}

      {/* Creator Fund CTA */}
      {!data.balance.is_verified && (
        <Card className="overflow-hidden border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-orange-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
                <Award className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-bold">Join the Creator Fund</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Get verified to unlock revenue sharing, creator badges, and priority in the algorithm.
                </p>
                <Button asChild size="sm" variant="outline" className="mt-2 rounded-full text-xs">
                  <Link href="/verification">Apply for Verification</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
