import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { awardXp } from "@/lib/xp"
import { getUserFromRequest } from "@/lib/server-auth";

function getCircleCheckinClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServerClient()
}

const REWARD_COINS = 30
const STREAK_BONUS_COINS = 10


function utcDayKey(d: Date) {
  return d.toISOString().slice(0, 10)
}

/** Consecutive check-in days ending today (or yesterday, grace day). */
function computeStreak(days: Set<string>) {
  let streak = 0
  const now = new Date()
  // Allow today OR yesterday as the streak anchor so a missed day hasn't
  // wiped the run before the user checks in again.
  const anchor = days.has(utcDayKey(now)) ? 0 : 1
  for (let i = anchor; i < 60; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    if (days.has(utcDayKey(d))) streak += 1
    else break
  }
  return streak
}

async function checkinState(supabase: ReturnType<typeof createServerClient>, circleId: string, userId: string) {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
  const { data: rows, error } = await supabase
    .from("pro_lounge_checkins")
    .select("checkin_date")
    .eq("circle_id", circleId)
    .eq("user_id", userId)
    .gte("created_at", since)

  if (error) throw new Error("Could not load Circle check-in history")

  const days = new Set((rows || []).map((r) => String(r.checkin_date).slice(0, 10)))
  const today = utcDayKey(new Date())
  const streak = computeStreak(days)
  const bonus = streak >= 7 ? STREAK_BONUS_COINS : 0
  return { days, today, streak, bonus, claimedToday: days.has(today) }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    const supabase = getCircleCheckinClient()
    if (!supabase) return NextResponse.json({ error: "Circle check-ins are unavailable" }, { status: 503 })

    const { id: circleId } = await params
    const { data: member, error: memberError } = await supabase
      .from("circle_members")
      .select("id")
      .eq("circle_id", circleId)
      .eq("user_id", user.id)
      .in("status", ["active", "approved"])
      .maybeSingle()
    if (memberError) return NextResponse.json({ error: "Could not verify Circle membership" }, { status: 503 })
    if (!member) return NextResponse.json({ error: "You must be an active Circle member" }, { status: 403 })

    const state = await checkinState(supabase, circleId, user.id)

    return NextResponse.json({
      success: true,
      claimed: state.claimedToday,
      streak: state.streak,
      bonus: state.bonus,
      reward: REWARD_COINS + state.bonus,
      base_reward: REWARD_COINS,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    const supabase = getCircleCheckinClient()
    if (!supabase) return NextResponse.json({ error: "Circle check-ins are unavailable" }, { status: 503 })

    const { id: circleId } = await params

    // Only members of this circle can check in (the workspace itself is
    // already Pro-gated by the client, but enforce it server-side too).
    const { data: member, error: memberError } = await supabase
      .from("circle_members")
      .select("id")
      .eq("circle_id", circleId)
      .eq("user_id", user.id)
      .in("status", ["active", "approved"])
      .maybeSingle()
    if (memberError) return NextResponse.json({ error: "Could not verify Circle membership" }, { status: 503 })
    if (!member) return NextResponse.json({ error: "You must be a member to check in" }, { status: 403 })

    const state = await checkinState(supabase, circleId, user.id)
    if (state.claimedToday) {
      return NextResponse.json(
        { error: "You already checked in today — come back tomorrow for your next streak day.", claimed: true, streak: state.streak },
        { status: 400 },
      )
    }

    const { error: insertErr } = await supabase.from("pro_lounge_checkins").insert({
      circle_id: circleId,
      user_id: user.id,
      checkin_date: state.today,
    })
    if (insertErr) {
      const msg = String(insertErr.message || "")
      if (/duplicate key/i.test(msg)) {
        return NextResponse.json({ error: "You already checked in today", claimed: true }, { status: 400 })
      }
      return NextResponse.json({ error: insertErr.message || "Failed to record check-in" }, { status: 500 })
    }

    const newStreak = state.streak + 1
    const bonus = newStreak >= 7 ? STREAK_BONUS_COINS : 0
    const amount = REWARD_COINS + bonus

    const { data: profile } = await supabase
      .from("profiles")
      .select("loop_coins")
      .eq("id", user.id)
      .maybeSingle()
    const nextCoins = Number(profile?.loop_coins || 0) + amount
    await supabase
      .from("profiles")
      .update({ loop_coins: nextCoins, updated_at: new Date().toISOString() })
      .eq("id", user.id)

    try {
      await supabase.from("coin_transactions").insert({
        user_id: user.id,
        amount,
        transaction_type: "pro_lounge_checkin",
        description: bonus
          ? `Pro Lounge check-in (${newStreak}-day streak, +${bonus} bonus)`
          : `Pro Lounge check-in (${newStreak}-day streak)`,
      })
    } catch (txErr) {
      console.error("Pro check-in ledger error:", txErr)
    }

    const xp = await awardXp(supabase, user.id, 25, "Pro Lounge check-in")

    return NextResponse.json({
      success: true,
      claimed: true,
      amount,
      bonus,
      streak: newStreak,
      coins: nextCoins,
      xp_gained: xp?.xp_gained || 0,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
