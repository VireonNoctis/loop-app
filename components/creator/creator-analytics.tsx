"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Eye,
  Heart,
  MessageCircle,
  Users,
  Clock,
  Zap,
  BarChart3,
  Calendar,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { cn } from "@/lib/utils"

interface AnalyticsData {
  totalViews: number
  totalLikes: number
  totalComments: number
  totalFollowers: number
  engagementRate: number
  bestPostingTime: string | null
  periodLabel: string
  comparisonNote: string
  previousPeriod: { postsPublished: number; lifetimeViewsOnPosts: number; lifetimeLikesOnPosts: number; lifetimeCommentsOnPosts: number } | null
  topPost: {
    content: string
    views: number
    likes: number
    created_at: string
  } | null
  weeklyActivity: number[]
  recentGrowth: {
    label: string
    value: number
    trend: "up" | "down" | "flat"
  }[]
}

function MetricCard({
  label,
  value,
  change,
  icon: Icon,
  color,
}: {
  label: string
  value: string | number
  change?: number
  icon: any
  color: string
}) {
  const isPositive = (change ?? 0) > 0
  const isNegative = (change ?? 0) < 0

  return (
    <div className="rounded-2xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-md">
      <div className="flex items-center justify-between mb-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        {change !== undefined && (
          <div
            className={cn(
              "flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded-full",
              isPositive && "bg-emerald-500/10 text-emerald-500",
              isNegative && "bg-rose-500/10 text-rose-500",
              !isPositive && !isNegative && "bg-muted text-muted-foreground"
            )}
          >
            {isPositive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : isNegative ? (
              <ArrowDownRight className="h-3 w-3" />
            ) : null}
            {Math.abs(change!).toFixed(1)}%
          </div>
        )}
      </div>
      <div className="text-2xl font-extrabold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  )
}

function MiniBarChart({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1)

  return (
    <div className="flex items-end gap-1 h-16">
      {data.map((value, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm transition-all duration-300"
          style={{
            height: `${(value / max) * 100}%`,
            backgroundColor: i === data.length - 1 ? color : undefined,
            opacity: i === data.length - 1 ? 1 : 0.5,
          }}
        >
          <div
            className="w-full h-full rounded-t-sm"
            style={{
              backgroundColor: `hsl(var(--${color === "primary" ? "primary" : "primary"}))`,
              opacity: 0.3 + (value / max) * 0.7,
            }}
          />
        </div>
      ))}
    </div>
  )
}

export function CreatorAnalytics() {
  const { user, getAuthHeader } = useAuth()
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "all">("30d")

  const fetchAnalytics = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const res = await fetch(`/api/creator/analytics?range=${timeRange}`, {
        headers: getAuthHeader(),
      })
      if (res.ok) {
        const data = await res.json()
        setAnalytics(data.analytics)
      }
    } catch (err) {
      console.error("Failed to fetch analytics:", err)
    } finally {
      setLoading(false)
    }
  }, [user, getAuthHeader, timeRange])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toString()
  }

  if (loading && !analytics) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    )
  }

  if (!analytics) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-bold text-foreground">No Analytics Yet</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Start posting to see your creator insights!
        </p>
      </div>
    )
  }

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-foreground">Creator Insights</h2>
          <p className="text-sm text-muted-foreground">{analytics.periodLabel} · performance of Loops published during this period</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-border bg-muted p-0.5">
            {(["7d", "30d", "all"] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={cn(
                  "px-3 py-1.5 text-xs font-bold rounded-lg transition-all",
                  timeRange === range
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {range === "7d" ? "7 Days" : range === "30d" ? "30 Days" : "All Time"}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchAnalytics}
            className="h-8 w-8 p-0 rounded-xl"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Total Views"
          value={formatNumber(analytics.totalViews)}
          icon={Eye}
          color="bg-blue-500/10 text-blue-500"
        />
        <MetricCard
          label="Total Likes"
          value={formatNumber(analytics.totalLikes)}
          icon={Heart}
          color="bg-rose-500/10 text-rose-500"
        />
        <MetricCard
          label="Comments"
          value={formatNumber(analytics.totalComments)}
          icon={MessageCircle}
          color="bg-emerald-500/10 text-emerald-500"
        />
        <MetricCard
          label="Followers"
          value={formatNumber(analytics.totalFollowers)}
          icon={Users}
          color="bg-violet-500/10 text-violet-500"
        />
      </div>

      {/* Engagement Rate */}
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Engagement Rate</p>
              <p className="text-3xl font-extrabold text-foreground mt-1">
                {analytics.engagementRate.toFixed(1)}%
              </p>
            </div>
            <span className="text-xs text-muted-foreground">Likes + comments / views</span>
          </div>
        </CardContent>
      </Card>

      {/* Weekly Activity Chart */}
      <Card className="border-border">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            Weekly Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex items-end gap-2 h-20">
            {analytics.weeklyActivity.map((value, i) => {
              const max = Math.max(...analytics.weeklyActivity, 1)
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-md bg-primary/80 transition-all duration-500"
                    style={{ height: `${(value / max) * 60}px` }}
                  />
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {dayLabels[i]}
                  </span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Observed posting hour */}
      {analytics.bestPostingTime && (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Most Active Posting Hour (UTC)</p>
            <p className="text-sm font-bold text-foreground">{analytics.bestPostingTime}</p>
          </div>
        </div>
      )}

      {/* Top Performing Post */}
      {analytics.topPost && (
        <Card className="border-border">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              Top Performing Post
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-sm text-foreground line-clamp-2 mb-3">
              {analytics.topPost.content}
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" /> {formatNumber(analytics.topPost.views)}
              </span>
              <span className="flex items-center gap-1">
                <Heart className="h-3.5 w-3.5" /> {formatNumber(analytics.topPost.likes)}
              </span>
              <span className="text-muted-foreground">
                {new Date(analytics.topPost.created_at).toLocaleDateString()}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Growth Stats */}
      {analytics.recentGrowth.length > 0 && (
        <Card className="border-border">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-bold">Publishing Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {analytics.recentGrowth.map((stat, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-sm text-foreground">{stat.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground">
                    {formatNumber(stat.value)}
                  </span>

                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">{analytics.comparisonNote}</p>
      {analytics.previousPeriod && (
        <Card className="border-border">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-bold">Previous period context</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 p-4 pt-0 text-sm">
            <div><p className="text-muted-foreground">Posts published</p><p className="font-semibold">{formatNumber(analytics.previousPeriod.postsPublished)}</p></div>
            <div><p className="text-muted-foreground">Lifetime views on those posts</p><p className="font-semibold">{formatNumber(analytics.previousPeriod.lifetimeViewsOnPosts)}</p></div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
