import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { isProUser } from "@/lib/pro-features"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Sign in to view membership status." }, { status: 401 })

  try {
    const supabase = createServerClient()
    const [{ data: profile, error: profileError }, { data: subscription, error: subscriptionError }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("is_premium, premium_expires_at, premium_source")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("subscriptions")
          .select("plan_type, status, current_period_end, cancel_at_period_end, stripe_customer_id")
          .eq("user_id", user.id)
          .eq("source", "stripe")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

    if (profileError) throw profileError
    if (subscriptionError) throw subscriptionError

    return NextResponse.json({
      success: true,
      is_premium: isProUser(profile || {}),
      premium_expires_at: profile?.premium_expires_at || null,
      premium_source: profile?.premium_source || null,
      subscription: subscription
        ? {
            plan_type: subscription.plan_type,
            status: subscription.status,
            current_period_end: subscription.current_period_end,
            cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
            can_manage: Boolean(subscription.stripe_customer_id),
          }
        : null,
    })
  } catch (error) {
    console.error("Premium status error:", error)
    return NextResponse.json({ error: "Could not load Premium status." }, { status: 500 })
  }
}
