import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { getStripeServer } from "@/lib/stripe-server"
import { getAppUrl } from "@/lib/app-url"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Sign in to manage billing." }, { status: 401 })

  const stripe = await getStripeServer()
  if (!stripe) return NextResponse.json({ error: "Billing is temporarily unavailable." }, { status: 503 })

  try {
    const supabase = createServerClient()
    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .eq("source", "stripe")
      .not("stripe_customer_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (!subscription?.stripe_customer_id) {
      return NextResponse.json(
        { error: "This Pro pass was not started with a card subscription." },
        { status: 404 },
      )
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${getAppUrl(request)}/premium`,
    })

    return NextResponse.json({ success: true, url: session.url })
  } catch (error) {
    console.error("Premium billing portal error:", error)
    return NextResponse.json({ error: "Could not open billing settings." }, { status: 502 })
  }
}
