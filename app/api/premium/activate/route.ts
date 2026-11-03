import { randomUUID } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { PRO_PRICING, type ProPlanId } from "@/lib/pro-features"
import { getStripeServer } from "@/lib/stripe-server"
import { getAppUrl } from "@/lib/app-url"
import { getUserFromRequest } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function invalidBody() {
  return NextResponse.json({ error: "A valid Premium purchase request is required." }, { status: 400 })
}

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return invalidBody()
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalidBody()

  const input = body as Record<string, unknown>
  if (input.plan !== "monthly" && input.plan !== "annual") {
    return NextResponse.json({ error: "Choose a valid Pro plan." }, { status: 400 })
  }
  const planId = input.plan as ProPlanId
  const method = input.method === undefined ? "coins" : input.method
  if (method !== "coins" && method !== "stripe" && method !== "request") {
    return NextResponse.json({ error: "Choose a supported payment method." }, { status: 400 })
  }
  const plan = PRO_PRICING[planId]
  const supabase = createServerClient()

  try {
    if (method === "stripe") {
      const { data: activeSubscription, error: activeSubscriptionError } = await supabase
        .from("subscriptions")
        .select("id")
        .eq("user_id", user.id)
        .eq("source", "stripe")
        .in("status", ["active", "trialing"])
        .gt("current_period_end", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (activeSubscriptionError) {
        console.error("Could not check existing Pro subscription:", activeSubscriptionError)
        return NextResponse.json({ error: "Could not check your current membership." }, { status: 500 })
      }
      if (activeSubscription) {
        return NextResponse.json(
          { error: "You already have an active card subscription. Use Manage subscription to change or cancel it." },
          { status: 409 },
        )
      }

      const stripe = await getStripeServer()
      if (!stripe) {
        return NextResponse.json(
          { error: "Card payments are temporarily unavailable. Please try again later." },
          { status: 503 },
        )
      }

      const appUrl = getAppUrl(request)
      const subscriptionMetadata = {
        kind: "premium_subscription",
        user_id: user.id,
        plan: planId,
      }
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: user.email || undefined,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(plan.priceUsd * 100),
            recurring: { interval: planId === "annual" ? "year" : "month" },
            product_data: {
              name: `Loop Pro ${plan.name}`,
              description: plan.description,
            },
          },
        }],
        metadata: subscriptionMetadata,
        subscription_data: { metadata: subscriptionMetadata },
        success_url: `${appUrl}/premium?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/premium?checkout=cancelled`,
      })

      if (!session.url) {
        return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 })
      }
      return NextResponse.json({ success: true, method: "stripe", checkout_url: session.url })
    }

    if (method === "request") {
      const { data: existing, error: existingError } = await supabase
        .from("premium_requests")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle()
      if (existingError) {
        console.error("Could not check existing Premium request:", existingError)
        return NextResponse.json({ error: "Could not check existing Pro requests." }, { status: 500 })
      }
      if (existing) {
        return NextResponse.json({ error: "You already have a pending Pro request." }, { status: 409 })
      }

      const { data: premiumRequest, error } = await supabase
        .from("premium_requests")
        .insert({
          user_id: user.id,
          plan_type: planId,
          status: "pending",
          admin_notes: `Launch Pro ${planId} request`,
        })
        .select("id, plan_type, status, created_at")
        .single()
      if (error) {
        if (error.code === "23505") {
          return NextResponse.json({ error: "You already have a pending Pro request." }, { status: 409 })
        }
        console.error("Could not submit Premium request:", error)
        return NextResponse.json({ error: "Could not submit your Pro request." }, { status: 500 })
      }
      return NextResponse.json({
        success: true,
        method: "request",
        request: premiumRequest,
        message: "Pro request submitted. We'll notify you when it has been reviewed.",
      }, { status: 201 })
    }

    const suppliedKey = request.headers.get("idempotency-key")
    if (suppliedKey && !UUID_PATTERN.test(suppliedKey)) {
      return NextResponse.json({ error: "Idempotency-Key must be a UUID." }, { status: 400 })
    }
    const transactionId = `premium_coins_${suppliedKey || randomUUID()}`
    const { data, error } = await supabase.rpc("purchase_premium_with_coins", {
      p_user_id: user.id,
      p_plan_type: planId,
      p_transaction_id: transactionId,
    })

    if (error) {
      console.error("Atomic Premium Coin purchase failed:", error)
      if (error.code === "P0002") return NextResponse.json({ error: "Profile not found." }, { status: 404 })
      if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 400 })
      if (error.code === "55000") return NextResponse.json({ error: error.message }, { status: 409 })
      if (error.code === "23505") return NextResponse.json({ error: "This purchase reference has already been used." }, { status: 409 })
      if (["42883", "42P01", "42703"].includes(error.code || "")) {
        return NextResponse.json({ error: "Coin purchases are unavailable until the wallet and Premium migration has been applied." }, { status: 503 })
      }
      return NextResponse.json({ error: "Could not complete this Pro purchase." }, { status: 500 })
    }

    const result = (Array.isArray(data) ? data[0] : data) as {
      loop_coins?: number
      premium_expires_at?: string
      already_processed?: boolean
    } | null
    if (!result || typeof result.loop_coins !== "number" || !result.premium_expires_at) {
      console.error("Premium Coin purchase RPC returned an invalid result")
      return NextResponse.json({ error: "Purchase confirmation returned an invalid result." }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      method: "coins",
      plan: planId,
      coins_spent: plan.coins,
      loop_coins: result.loop_coins,
      is_premium: true,
      premium_expires_at: result.premium_expires_at,
      already_processed: Boolean(result.already_processed),
      message: result.already_processed
        ? "Your Pro purchase was already completed."
        : `Welcome to Loop Pro! Active until ${new Date(result.premium_expires_at).toLocaleDateString()}.`,
    })
  } catch (error) {
    console.error("Premium activate error:", error)
    return NextResponse.json({ error: "Could not complete this Pro purchase." }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    pricing: PRO_PRICING,
    currency: "USD + Loop Coins",
  })
}
