import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { awardEarnings, coinsToEarnings } from "@/lib/earnings"

const userId = "11111111-1111-4111-8111-111111111111"
const giftId = "22222222-2222-4222-8222-222222222222"

function clientWithRpc(result: unknown) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe("creator earnings grants", () => {
  it("converts coins to cents-safe USD values", () => {
    expect(coinsToEarnings(100)).toBe(1)
    expect(coinsToEarnings(125)).toBe(1.25)
    expect(coinsToEarnings(-10)).toBe(0)
    expect(coinsToEarnings(Number.NaN)).toBe(0)
  })

  it("records the gift and credits the account through one idempotent RPC", async () => {
    const { client, rpc } = clientWithRpc({
      data: {
        available_earnings: 7.25,
        total_earnings: 21.5,
        already_processed: false,
      },
      error: null,
    })

    await expect(awardEarnings(client, userId, 1.25, {
      source: "gift",
      reference_id: giftId,
      description: "Earnings from a gift",
    })).resolves.toEqual({
      available_earnings: 7.25,
      total_earnings: 21.5,
      amount: 1.25,
      already_processed: false,
    })

    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith("award_creator_earnings", {
      p_user_id: userId,
      p_amount: 1.25,
      p_source_type: "gift",
      p_source_id: giftId,
      p_description: "Earnings from a gift",
    })
  })

  it("preserves database idempotency for a repeated gift reference", async () => {
    const { client, rpc } = clientWithRpc({
      data: {
        available_earnings: 7.25,
        total_earnings: 21.5,
        already_processed: true,
      },
      error: null,
    })

    const result = await awardEarnings(client, userId, 1.25, {
      source: "gift",
      reference_id: giftId,
    })

    expect(result?.already_processed).toBe(true)
    expect(rpc).toHaveBeenCalledOnce()
  })

  it("never falls back to an unsafe profile read/write if the RPC is missing", async () => {
    const { client, rpc } = clientWithRpc({
      data: null,
      error: { code: "42883", message: "function is unavailable" },
    })

    await expect(awardEarnings(client, userId, 1.25, {
      source: "gift",
      reference_id: giftId,
    })).resolves.toBeNull()

    expect(rpc).toHaveBeenCalledOnce()
  })

  it("requires a reference key before contacting the database", async () => {
    const { client, rpc } = clientWithRpc({ data: null, error: null })
    await expect(awardEarnings(client, userId, 1.25)).resolves.toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })
})
