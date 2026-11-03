import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { grantStripePremiumCheckout } from "@/lib/stripe-premium-grants"

const input = {
  userId: "11111111-1111-4111-8111-111111111111",
  transactionId: "stripe_cs_test_123abc",
  days: 30,
  amountUsd: 9.99,
  paymentIntentId: "pi_test_123",
  plan: "monthly",
}

function clientWithRpc(result: unknown) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe("atomic Stripe Premium grants", () => {
  it("sends the canonical checkout identity and amount to the SQL transaction", async () => {
    const expiry = "2026-12-03T12:00:00.000Z"
    const { client, rpc } = clientWithRpc({
      data: { premium_expires_at: expiry, already_processed: false },
      error: null,
    })

    await expect(grantStripePremiumCheckout(client, input)).resolves.toEqual({
      premium_expires_at: expiry,
      already_processed: false,
    })
    expect(rpc).toHaveBeenCalledWith("grant_stripe_premium_checkout", {
      p_user_id: input.userId,
      p_transaction_id: input.transactionId,
      p_days: input.days,
      p_amount_usd: input.amountUsd,
      p_payment_intent_id: input.paymentIntentId,
      p_plan: input.plan,
    })
  })

  it("preserves idempotency when Stripe retries the same checkout session", async () => {
    const { client, rpc } = clientWithRpc({
      data: { premium_expires_at: "2026-12-03T12:00:00.000Z", already_processed: true },
      error: null,
    })

    const grant = await grantStripePremiumCheckout(client, input)
    expect(grant.already_processed).toBe(true)
    expect(rpc).toHaveBeenCalledOnce()
  })

  it("propagates database failures instead of acknowledging an uncommitted grant", async () => {
    const failure = { code: "42883", message: "function is unavailable" }
    const { client } = clientWithRpc({ data: null, error: failure })
    await expect(grantStripePremiumCheckout(client, input)).rejects.toEqual(failure)
  })

  it("rejects malformed RPC responses", async () => {
    const { client } = clientWithRpc({ data: { already_processed: false }, error: null })
    await expect(grantStripePremiumCheckout(client, input)).rejects.toThrow(
      "Stripe Premium grant returned an invalid result",
    )
  })
})
