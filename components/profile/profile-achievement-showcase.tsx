"use client"

import { useEffect, useState } from "react"
import { Award, Flame, Gem, Medal, Star, Trophy } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

interface EarnedAchievement {
  id: string
  earned_at: string
  achievement: {
    id: string
    name: string
    description: string
    category: string
    level: string
    xp_reward: number
    coins_reward: number
    icon: string | null
  } | null
}

interface AchievementResponse {
  achievements: EarnedAchievement[]
  stats: {
    total_xp: number
    level: number
    loops_created: number
    total_likes_received: number
    total_comments_received: number
    total_shares_received: number
    followers_count: number
    following_count: number
  }
  achievement_stats: {
    total_earned: number
    total_available: number
    by_category: Record<string, { earned: number; total: number }>
    by_level: Record<string, { earned: number; total: number }>
  }
}

const levelStyles: Record<string, string> = {
  bronze: "border-orange-700/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  silver: "border-slate-400/40 bg-slate-400/10 text-slate-700 dark:text-slate-200",
  gold: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  platinum: "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  diamond: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
}

const rarityIcon: Record<string, typeof Medal> = {
  bronze: Medal,
  silver: Medal,
  gold: Star,
  platinum: Gem,
  diamond: Trophy,
}

export function ProfileAchievementShowcase({
  userId,
  getAuthHeader,
}: {
  userId: string
  getAuthHeader?: () => Record<string, string>
}) {
  const [data, setData] = useState<AchievementResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(false)
      try {
        const response = await fetch(`/api/users/achievements?userId=${encodeURIComponent(userId)}`, {
          headers: getAuthHeader?.(),
          cache: "no-store",
        })
        if (!response.ok) {
          if (!cancelled) setError(true)
          return
        }
        const result = (await response.json()) as AchievementResponse
        if (!cancelled) setData(result)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [userId, getAuthHeader])

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Card className="rounded-2xl border-border/70">
        <CardContent className="flex items-center gap-3 p-4">
          <Trophy className="h-5 w-5 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Achievements unavailable</p>
            <p className="text-xs text-muted-foreground">Progression details couldn't be loaded right now.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const achievements = (data?.achievements || []).filter((entry) => entry.achievement)
  const stats = data?.stats
  const summary = data?.achievement_stats
  const xp = Math.max(0, Number(stats?.total_xp || 0))
  const level = Math.max(1, Number(stats?.level || 1))
  const earned = Number(summary?.total_earned || achievements.length)
  const total = Number(summary?.total_available || 0)

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Card className="rounded-xl border-border/70">
          <CardContent className="p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Level</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{level}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-border/70">
          <CardContent className="p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Experience</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{xp.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">XP</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-border/70">
          <CardContent className="p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Earned</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{earned}</p>
            <p className="text-[10px] text-muted-foreground">{total ? `of ${total}` : "achievements"}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Achievements</h2>
          <p className="text-xs text-muted-foreground">Recognition earned through creating and contributing.</p>
        </div>
        {total > 0 ? <Badge variant="outline">{Math.round((earned / total) * 100)}% complete</Badge> : null}
      </div>

      {achievements.length === 0 ? (
        <Card className="rounded-2xl border-dashed border-border/70 bg-muted/10">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Flame className="h-7 w-7 text-muted-foreground/50" />
            <p className="text-sm font-medium">The first milestone is still ahead</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Achievements appear here as you create Loops, join conversations and contribute to the community.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {achievements.map((entry) => {
            const achievement = entry.achievement!
            const Icon = rarityIcon[achievement.level] || Award
            return (
              <Card key={entry.id} className="rounded-2xl border-border/70">
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
                    {achievement.icon || <Icon className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{achievement.name}</p>
                      <Badge variant="outline" className={levelStyles[achievement.level] || ""}>
                        {achievement.level}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{achievement.description}</p>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Earned {new Date(entry.earned_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}
