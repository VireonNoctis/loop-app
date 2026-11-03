import type { SupabaseClient } from "@supabase/supabase-js"

export interface StripePremiumGrantInput {
  userId: string
  transactionId: string
  days: number
  amountUsd: number
  paymentIntentId: string | null
  plan: string | null
}

export interface StripePremiumGrantResult {
  premium_expires_at: string
  already_processed: boolean
}

/**
 * Persist a one-time Stripe Pro entitlement through the row-locked database
 * function. The subscription webhook path uses its own recurring sync logic.
 */
export async function grantStripePremiumCheckout(
  supabase: SupabaseClient,
  input: StripePremiumGrantInput,
): Promise<StripePremiumGrantResult> {
  const { data, error } = await supabase.rpc("grant_stripe_premium_checkout", {
    p_user_id: input.userId,
    p_transaction_id: input.transactionId,
    p_days: input.days,
    p_amount_usd: input.amountUsd,
    p_payment_intent_id: input.paymentIntentId,
    p_plan: input.plan,
  })

  if (error) throw error

  const result = (Array.isArray(data) ? data[0] : data) as unknown
  if (
    !result
    || typeof result !== "object"
    || typeof (result as Record<string, unknown>).premium_expires_at !== "string"
    || typeof (result as Record<string, unknown>).already_processed !== "boolean"
  ) {
    throw new Error("Stripe Premium grant returned an invalid result")
  }

  return result as StripePremiumGrantResult
}
