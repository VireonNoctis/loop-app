import { type NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"

import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { getStripeServer } from "@/lib/stripe-server"
import { syncStripePremiumSubscription } from "@/lib/stripe-premium-subscriptions"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Sign in to view this receipt." }, { status: 401 })

  const sessionId = new URL(request.url).searchParams.get("session_id") || ""
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return NextResponse.json({ error: "A valid checkout reference is required." }, { status: 400 })
  }

  const stripe = await getStripeServer()
  if (!stripe) return NextResponse.json({ error: "Billing is temporarily unavailable." }, { status: 503 })

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] })
    if (
      session.mode !== "subscription" ||
      session.metadata?.kind !== "premium_subscription" ||
      session.metadata?.user_id !== user.id
    ) {
      return NextResponse.json({ error: "This checkout receipt is unavailable." }, { status: 404 })
    }

    const subscriptionValue = session.subscription as string | Stripe.Subscription | null
    if (!subscriptionValue) {
      return NextResponse.json({ state: "processing", receipt: null })
    }

    const subscription = typeof subscriptionValue === "string"
      ? await stripe.subscriptions.retrieve(subscriptionValue)
      : subscriptionValue
    const synced = await syncStripePremiumSubscription(createServerClient(), subscription)
    const paymentConfirmed = ["paid", "no_payment_required"].includes(session.payment_status)
    const completed = paymentConfirmed && synced.active

    return NextResponse.json({
      state: completed ? "complete" : "processing",
      receipt: {
        order_number: `LOOP-${session.id.slice(-8).toUpperCase()}`,
        plan: session.metadata.plan === "annual" ? "Loop Pro · Annual" : "Loop Pro · Monthly",
        amount_total: session.amount_total ?? 0,
        currency: session.currency || "usd",
        created_at: new Date(session.created * 1000).toISOString(),
        current_period_end: synced.currentPeriodEnd,
        subscription_status: synced.status,
      },
    })
  } catch (error) {
    console.error("Premium checkout status error:", error)
    return NextResponse.json({ error: "Could not verify this checkout yet." }, { status: 502 })
  }
}
