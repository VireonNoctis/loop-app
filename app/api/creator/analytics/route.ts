import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { buildWeeklyPostingActivity, calculateEngagementRate, getMostActivePostingHourUtc, sumCreatorLoopStats } from "@/lib/creator-analytics"

export const dynamic = "force-dynamic"
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder",
)
const PAGE_SIZE = 1000
const DAY_MS = 86_400_000

async function fetchAllRows<T>(buildQuery: () => any): Promise<{ data: T[]; error: any }> {
  const rows: T[] = []
  for (let offset = 0; offset < 100_000; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1)
    if (error) return { data: [], error }
    const page = (data || []) as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return { data: rows, error: null }
  }
  return { data: [], error: new Error("Creator analytics exceeded the supported pagination limit.") }
}

function rangeBounds(range: string, now: Date): { start: Date | null; previousStart: Date | null; previousEnd: Date | null } | null {
  if (range === "all") return { start: null, previousStart: null, previousEnd: null }
  if (range !== "7d" && range !== "30d") return null
  const days = range === "7d" ? 7 : 30
  const start = new Date(now.getTime() - days * DAY_MS)
  return { start, previousStart: new Date(start.getTime() - days * DAY_MS), previousEnd: start }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const range = new URL(request.url).searchParams.get("range") || "30d"
    const bounds = rangeBounds(range, new Date())
    if (!bounds) return NextResponse.json({ error: "Range must be 7d, 30d or all." }, { status: 400 })

    const buildLoopQuery = (start: Date | null, end?: Date | null) => {
      let query = supabase.from("loops").select("id, content, created_at").eq("author_id", user.id)
      if (start) query = query.gte("created_at", start.toISOString())
      if (end) query = query.lt("created_at", end.toISOString())
      return query.order("created_at", { ascending: false })
    }
    const [currentLoopsResult, previousLoopsResult, followersResult] = await Promise.all([
      fetchAllRows<{ id: string; content: string | null; created_at: string }>(() => buildLoopQuery(bounds.start)),
      bounds.previousStart && bounds.previousEnd
        ? fetchAllRows<{ id: string; content: string | null; created_at: string }>(() => buildLoopQuery(bounds.previousStart, bounds.previousEnd))
        : Promise.resolve({ data: [], error: null }),
      supabase.from("follows").select("id", { count: "exact", head: true }).eq("following_id", user.id),
    ])
    if (currentLoopsResult.error || previousLoopsResult.error || followersResult.error) {
      console.error("Creator analytics content lookup failed:", currentLoopsResult.error || previousLoopsResult.error || followersResult.error)
      return NextResponse.json({ error: "Could not load creator analytics." }, { status: 500 })
    }

    const currentLoops = currentLoopsResult.data
    const previousLoops = previousLoopsResult.data
    const currentIds = currentLoops.map((loop) => loop.id)
    const previousIds = previousLoops.map((loop) => loop.id)
    const [currentStatsResult, previousStatsResult] = await Promise.all([
      currentIds.length ? supabase.from("loop_stats").select("loop_id, views_count, likes_count, comments_count").in("loop_id", currentIds) : Promise.resolve({ data: [], error: null }),
      previousIds.length ? supabase.from("loop_stats").select("loop_id, views_count, likes_count, comments_count").in("loop_id", previousIds) : Promise.resolve({ data: [], error: null }),
    ])
    if (currentStatsResult.error || previousStatsResult.error) {
      console.error("Creator analytics stat lookup failed:", currentStatsResult.error || previousStatsResult.error)
      return NextResponse.json({ error: "Could not load creator post statistics." }, { status: 500 })
    }

    const totals = sumCreatorLoopStats(currentStatsResult.data || [])
    const previousTotals = sumCreatorLoopStats(previousStatsResult.data || [])
    const bestPostingTime = getMostActivePostingHourUtc(currentLoops)
    const statsByLoop = new Map((currentStatsResult.data || []).map((row: any) => [row.loop_id, row]))
    const top = currentLoops.reduce<{ loop: typeof currentLoops[number]; score: number } | null>((best, loop) => {
      const stat: any = statsByLoop.get(loop.id)
      const score = Number(stat?.views_count || 0) + Number(stat?.likes_count || 0) * 3
      return !best || score > best.score ? { loop, score } : best
    }, null)
    const topStat: any = top ? statsByLoop.get(top.loop.id) : null
    const count = currentLoops.length

    return NextResponse.json({ analytics: {
      totalViews: totals.views,
      totalLikes: totals.likes,
      totalComments: totals.comments,
      totalFollowers: Number(followersResult.count || 0),
      engagementRate: calculateEngagementRate(totals),
      bestPostingTime,
      topPost: top ? { content: top.loop.content || "", views: Number(topStat?.views_count || 0), likes: Number(topStat?.likes_count || 0), created_at: top.loop.created_at } : null,
      weeklyActivity: buildWeeklyPostingActivity(currentLoops),
      recentGrowth: [
        { label: "Posts published", value: count },
        { label: "Average lifetime views per post", value: count ? Math.round(totals.views / count) : 0 },
        { label: "Average lifetime likes per post", value: count ? Math.round(totals.likes / count) : 0 },
      ],
      periodLabel: range === "all" ? "All time" : range === "7d" ? "Last 7 days" : "Last 30 days",
      comparisonNote: bounds.start
        ? "Views, likes and comments are lifetime totals on Loops published in this period. They are not impressions generated only during these dates."
        : "Views, likes and comments are lifetime totals across all of your Loops.",
      previousPeriod: bounds.start ? {
        postsPublished: previousLoops.length,
        lifetimeViewsOnPosts: previousTotals.views,
        lifetimeLikesOnPosts: previousTotals.likes,
        lifetimeCommentsOnPosts: previousTotals.comments,
      } : null,
    } })
  } catch (error) {
    console.error("Creator analytics error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
