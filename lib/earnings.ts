import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Coin-funded creator gifts convert to a USD-equivalent creator earning.
 * Balances and the private earnings ledger are committed in one PostgreSQL
 * transaction and deduplicated by the originating gift reference.
 */
export function coinsToEarnings(coins: number) {
  if (!Number.isFinite(coins) || coins <= 0) return 0
  return Math.round(coins * 0.01 * 100) / 100
}

export interface AwardEarningsResult {
  available_earnings: number
  total_earnings: number
  amount: number
  already_processed: boolean
}

export async function awardEarnings(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  meta?: {
    source?: string
    reference_id?: string
    description?: string
  },
): Promise<AwardEarningsResult | null> {
  if (!userId || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return null
  if (!meta?.reference_id) {
    console.error("awardEarnings requires a source reference for idempotency")
    return null
  }

  const { data, error } = await supabase.rpc("award_creator_earnings", {
    p_user_id: userId,
    p_amount: amount,
    p_source_type: meta.source || "gift",
    p_source_id: meta.reference_id,
    p_description: meta.description || null,
  })

  if (error) {
    // Never fall back to a read/modify/write balance update: a missing or
    // failing migration must fail visibly rather than lose concurrent credits.
    console.error("awardEarnings atomic credit failed:", error.message)
    return null
  }

  const result = (Array.isArray(data) ? data[0] : data) as unknown
  if (
    !result
    || typeof result !== "object"
    || typeof (result as Record<string, unknown>).available_earnings !== "number"
    || typeof (result as Record<string, unknown>).total_earnings !== "number"
    || typeof (result as Record<string, unknown>).already_processed !== "boolean"
  ) {
    console.error("awardEarnings returned an invalid database result")
    return null
  }

  const normalized = result as Omit<AwardEarningsResult, "amount">
  return { ...normalized, amount, already_processed: normalized.already_processed }
}
