import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * Retired legacy PaymentIntent endpoint. The former client-controlled amount
 * and metadata fields could not safely authorize Premium or inventory grants.
 * Current Premium subscriptions use server-priced Stripe Checkout Sessions;
 * prepaid Pro and Shop purchases use their transactional Coin workflows.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "This legacy payment flow is no longer available. Start a supported purchase from Premium or Shop.",
      code: "LEGACY_PAYMENT_INTENT_DISABLED",
    },
    { status: 410 },
  )
}
