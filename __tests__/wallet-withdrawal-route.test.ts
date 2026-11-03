import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getUserFromRequest: (...args: unknown[]) => state.getUser(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createClient: (...args: unknown[]) => state.createClient(...args),
}))

import { POST } from "@/app/api/wallet/withdraw/route"

const userId = "11111111-1111-4111-8111-111111111111"
const idempotencyKey = "22222222-2222-4222-8222-222222222222"

function post(body: unknown, key?: string) {
  const headers = new Headers({ "content-type": "application/json" })
  if (key) headers.set("Idempotency-Key", key)
  return new NextRequest("https://loopapp.me/api/wallet/withdraw", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
  state.getUser.mockResolvedValue({ id: userId, email: "creator@example.com" })
  state.rpc.mockResolvedValue({
    data: {
      request: {
        id: `wdr_${idempotencyKey}`,
        user_id: userId,
        coins_amount: 750,
        estimated_usd: 7.5,
        payout_method: "bank",
        payout_details: "private-details",
        status: "pending_review",
        created_at: "2026-11-03T12:00:00.000Z",
      },
      loop_coins: 1250,
      already_processed: false,
    },
    error: null,
  })
  state.createClient.mockReturnValue({ rpc: state.rpc })
})

describe("atomic coin withdrawal route", () => {
  it("reserves the balance and creates the payout request through one idempotent RPC", async () => {
    const response = await POST(post({
      coins_amount: 750,
      payout_method: "bank",
      payout_details: " private-details ",
    }, idempotencyKey))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(state.rpc).toHaveBeenCalledWith("request_coin_withdrawal", {
      p_user_id: userId,
      p_request_id: `wdr_${idempotencyKey}`,
      p_coins_amount: 750,
      p_payout_method: "bank",
      p_payout_details: "private-details",
    })
    expect(body.loop_coins).toBe(1250)
    expect(body.request).not.toHaveProperty("payout_details")
  })

  it("rejects invalid amount, method, details and idempotency keys before creating a client", async () => {
    const invalidAmount = await POST(post({ coins_amount: 499, payout_method: "bank", payout_details: "account" }))
    const invalidMethod = await POST(post({ coins_amount: 500, payout_method: "cash", payout_details: "account" }))
    const missingDetails = await POST(post({ coins_amount: 500, payout_method: "bank", payout_details: " " }))
    const invalidKey = await POST(post({ coins_amount: 500, payout_method: "bank", payout_details: "account" }, "not-a-uuid"))

    expect([invalidAmount.status, invalidMethod.status, missingDetails.status, invalidKey.status]).toEqual([
      400, 400, 400, 400,
    ])
    expect(state.createClient).not.toHaveBeenCalled()
  })

  it("maps the database verification gate to a forbidden response", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "Verified creator status is required" },
    })
    const response = await POST(post({ coins_amount: 500, payout_method: "bank", payout_details: "account" }))
    expect(response.status).toBe(403)
  })

  it("returns the prior request without another debit on an idempotent retry", async () => {
    state.rpc.mockResolvedValue({
      data: {
        request: { id: `wdr_${idempotencyKey}`, coins_amount: 750, estimated_usd: 7.5, payout_method: "bank", status: "pending_review" },
        loop_coins: 1250,
        already_processed: true,
      },
      error: null,
    })
    const response = await POST(post({
      coins_amount: 750,
      payout_method: "bank",
      payout_details: "private-details",
    }, idempotencyKey))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.already_processed).toBe(true)
    expect(state.rpc).toHaveBeenCalledOnce()
  })

  it("rejects signed-out users before the service client is created", async () => {
    state.getUser.mockResolvedValue(null)
    const response = await POST(post({ coins_amount: 500, payout_method: "bank", payout_details: "account" }))
    expect(response.status).toBe(401)
    expect(state.createClient).not.toHaveBeenCalled()
  })
})
