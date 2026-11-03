import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 1000
const DAY_MS = 86_400_000

async function fetchAllRows<T>(buildQuery: () => any): Promise<{ data: T[]; error: any }> {
  const output: T[] = []
  for (let offset = 0; offset < 20_000; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1)
    if (error) return { data: [], error }
    const page = (data || []) as T[]
    output.push(...page)
    if (page.length < PAGE_SIZE) return { data: output, error: null }
  }
  return { data: [], error: new Error("Revenue history exceeded its pagination limit.") }
}

function sumCoins(rows: Array<{ cost?: number | string | null }>): number {
  return rows.reduce((sum, row) => {
    const cost = Number(row.cost)
    return Number.isFinite(cost) && cost > 0 ? sum + cost : sum
  }, 0)
}

function buildMonthlyGiftActivity(rows: Array<{ cost?: number | string | null; created_at?: string | null }>, now: Date) {
  const months = new Map<string, { month: string; earnings: number; gifts: number; engagement: number }>()
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
    months.set(key, {
      month: date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
      earnings: 0,
      gifts: 0,
      engagement: 0,
    })
  }
  for (const row of rows) {
    const date = new Date(String(row.created_at || ""))
    const cost = Number(row.cost)
    if (Number.isNaN(date.getTime()) || !Number.isFinite(cost) || cost <= 0) continue
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
    const month = months.get(key)
    if (!month) continue
    month.earnings += cost
    month.gifts += 1
  }
  return [...months.values()]
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const range = new URL(request.url).searchParams.get("range") || "30d"
    if (!["7d", "30d", "all"].includes(range)) {
      return NextResponse.json({ error: "Range must be 7d, 30d or all." }, { status: 400 })
    }

    const now = new Date()
    const start = range === "all" ? null : new Date(now.getTime() - (range === "7d" ? 7 : 30) * DAY_MS)
    const sixMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1))
    const db = createServerClient()
    const buildGiftQuery = (since: Date | null) => {
      let query = db.from("gifts").select("cost, created_at").eq("recipient_id", user.id)
      if (since) query = query.gte("created_at", since.toISOString())
      return query.order("created_at", { ascending: false })
    }

    const [profile, rangeGifts, monthGifts, boosts, topPosts, withdrawals] = await Promise.all([
      db.from("profiles").select("loop_coins, total_earnings, available_earnings, is_verified").eq("id", user.id).maybeSingle(),
      fetchAllRows<{ cost: number; created_at: string }>(() => buildGiftQuery(start)),
      fetchAllRows<{ cost: number; created_at: string }>(() => buildGiftQuery(sixMonthStart)),
      db.from("loop_boosts").select("coins").eq("user_id", user.id)
        .gte("created_at", start?.toISOString() || "1970-01-01T00:00:00.000Z"),
      db.from("loops").select("id, content_title, content_text, media_type, like_count, view_count, comment_count, created_at")
        .eq("author_id", user.id).order("view_count", { ascending: false }).limit(5),
      db.from("withdrawal_requests").select("id").eq("user_id", user.id)
        .in("status", ["pending", "pending_review"]),
    ])

    const errors = [profile.error, rangeGifts.error, monthGifts.error, boosts.error, topPosts.error, withdrawals.error].filter(Boolean)
    if (errors.length) {
      console.error("Creator revenue lookup failed:", errors)
      return NextResponse.json({ error: "Could not load creator revenue data." }, { status: 500 })
    }

    const giftsReceived = sumCoins(rangeGifts.data)
    const promotionCoinsSpent = (boosts.data || []).reduce((sum: number, row: any) => {
      const coins = Number(row.coins)
      return Number.isFinite(coins) && coins > 0 ? sum + coins : sum
    }, 0)
    const monthlyTrend = buildMonthlyGiftActivity(monthGifts.data, now)
    const topContent = (topPosts.data || []).map((post: any) => {
      const views = Math.max(0, Number(post.view_count || 0))
      const likes = Math.max(0, Number(post.like_count || 0))
      const comments = Math.max(0, Number(post.comment_count || 0))
      return {
        id: post.id,
        title: post.content_title || post.content_text?.slice(0, 50) || "Untitled",
        type: post.media_type || "text",
        earnings: 0,
        views,
        engagement_rate: views > 0 ? ((likes + comments) / views) * 100 : 0,
      }
    })

    // Earnings are stored in USD-equivalent amounts by the earnings ledger.
    // The existing creator UI displays Loop Coins, so convert at the ledger's
    // documented 1 coin = $0.01 rate instead of labelling dollars as coins.
    const usdToLoopCoins = (value: unknown) => {
      const amount = Number(value)
      return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0
    }

    return NextResponse.json({
      balance: {
        loop_coins: Number(profile.data?.loop_coins || 0),
        total_earnings: usdToLoopCoins(profile.data?.total_earnings),
        available_earnings: usdToLoopCoins(profile.data?.available_earnings),
        is_verified: Boolean(profile.data?.is_verified),
      },
      revenue_breakdown: {
        gifts: giftsReceived,
        tips: 0,
        creator_fund: 0,
        boosts: 0,
        live_streams: 0,
        subscriptions: 0,
      },
      activity: { promotion_coins_spent: promotionCoinsSpent },
      monthly_trend: monthlyTrend,
      top_earning_content: topContent,
      pending_withdrawals: withdrawals.data?.length || 0,
      next_payout_date: null,
      accounting_note: "Creator earnings balances are shown in Loop Coins at the ledger conversion of 1 coin = $0.01. Gift activity is reported as received coins. Promotion spend is a cost, not revenue. Creator-fund, subscription and live-stream earnings are not shown until backed by a verified payout ledger.",
      range_label: range === "all" ? "All time" : range === "7d" ? "Last 7 days" : "Last 30 days",
    })
  } catch (error) {
    console.error("Creator revenue API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
