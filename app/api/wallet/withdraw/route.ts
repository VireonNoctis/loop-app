import { randomUUID } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PAYOUT_METHODS = new Set(["bank", "paypal", "crypto"])

function createServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase configuration")
  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function publicWithdrawal(request: Record<string, unknown>) {
  return {
    id: request.id,
    coins_amount: request.coins_amount,
    estimated_usd: request.estimated_usd,
    payout_method: request.payout_method,
    status: request.status,
    created_at: request.created_at,
    reviewed_at: request.reviewed_at,
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = createServerClient()
    const { data: requests, error } = await supabase
      .from("withdrawal_requests")
      .select("id, coins_amount, estimated_usd, payout_method, status, created_at, reviewed_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) {
      console.error("Could not load withdrawal requests:", error)
      return NextResponse.json({ error: "Could not load withdrawal requests." }, { status: 503 })
    }

    return NextResponse.json({ success: true, requests: requests || [] })
  } catch (error) {
    console.error("GET /api/wallet/withdraw error:", error)
    return NextResponse.json({ error: "Could not load withdrawal requests." }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "A valid withdrawal request is required." }, { status: 400 })
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "A valid withdrawal request is required." }, { status: 400 })
    }

    const input = body as Record<string, unknown>
    const coinsAmount = Number(input.coins_amount)
    const payoutMethod = typeof input.payout_method === "string" ? input.payout_method : "bank"
    const payoutDetails = typeof input.payout_details === "string" ? input.payout_details.trim() : ""

    if (!Number.isSafeInteger(coinsAmount) || coinsAmount < 500 || coinsAmount > 2_000_000_000) {
      return NextResponse.json({ error: "Withdrawals require at least 500 Loop Coins." }, { status: 400 })
    }
    if (!PAYOUT_METHODS.has(payoutMethod)) {
      return NextResponse.json({ error: "Choose a supported payout method." }, { status: 400 })
    }
    if (!payoutDetails || payoutDetails.length > 1000) {
      return NextResponse.json({ error: "Valid payout details are required (maximum 1,000 characters)." }, { status: 400 })
    }

    const suppliedKey = request.headers.get("idempotency-key")
    if (suppliedKey && !UUID_PATTERN.test(suppliedKey)) {
      return NextResponse.json({ error: "Idempotency-Key must be a UUID." }, { status: 400 })
    }
    const requestId = `wdr_${suppliedKey || randomUUID()}`

    const supabase = createServerClient()
    const { data, error } = await supabase.rpc("request_coin_withdrawal", {
      p_user_id: user.id,
      p_request_id: requestId,
      p_coins_amount: coinsAmount,
      p_payout_method: payoutMethod,
      p_payout_details: payoutDetails,
    })

    if (error) {
      console.error("Atomic coin withdrawal request failed:", error)
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Your account profile could not be found." }, { status: 404 })
      }
      if (error.code === "42501") {
        return NextResponse.json({ error: error.message || "Verified creator status is required." }, { status: 403 })
      }
      if (error.code === "22023") {
        return NextResponse.json({ error: error.message || "The withdrawal request is invalid." }, { status: 400 })
      }
      if (error.code === "23505") {
        return NextResponse.json({ error: "This withdrawal reference has already been used." }, { status: 409 })
      }
      if (["42883", "42P01", "42703"].includes(error.code || "")) {
        return NextResponse.json({ error: "Secure withdrawals are unavailable until the wallet migration has been applied." }, { status: 503 })
      }
      return NextResponse.json({ error: "Could not submit your withdrawal request." }, { status: 500 })
    }

    const result = (Array.isArray(data) ? data[0] : data) as {
      request?: Record<string, unknown>
      loop_coins?: number
      already_processed?: boolean
    } | null
    if (!result?.request || typeof result.loop_coins !== "number") {
      console.error("Withdrawal RPC returned an invalid result")
      return NextResponse.json({ error: "Withdrawal confirmation returned an invalid result." }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      request: publicWithdrawal(result.request),
      loop_coins: result.loop_coins,
      already_processed: Boolean(result.already_processed),
      message: result.already_processed
        ? "This withdrawal request was already submitted."
        : "Payout request submitted. The balance has been reserved for manual review.",
    }, { status: result.already_processed ? 200 : 201 })
  } catch (error) {
    console.error("POST /api/wallet/withdraw error:", error)
    return NextResponse.json({ error: "Could not submit your withdrawal request." }, { status: 500 })
  }
}
