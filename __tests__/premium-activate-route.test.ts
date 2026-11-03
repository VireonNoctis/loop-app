import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  createServerClient: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  in: vi.fn(),
  gt: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getUserFromRequest: (...args: unknown[]) => state.getUser(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createServerClient: (...args: unknown[]) => state.createServerClient(...args),
}))
vi.mock("@/lib/stripe-server", () => ({
  getStripeServer: vi.fn(),
}))
vi.mock("@/lib/app-url", () => ({
  getAppUrl: () => "https://loopapp.me",
}))

import { POST } from "@/app/api/premium/activate/route"

const userId = "11111111-1111-4111-8111-111111111111"
const idempotencyKey = "22222222-2222-4222-8222-222222222222"

function post(body: unknown, key?: string) {
  const headers = new Headers({ "content-type": "application/json" })
  if (key) headers.set("Idempotency-Key", key)
  return new NextRequest("https://loopapp.me/api/premium/activate", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.getUser.mockResolvedValue({ id: userId, email: "member@example.com" })
  state.rpc.mockResolvedValue({
    data: {
      loop_coins: 2500,
      premium_expires_at: "2026-12-02T12:00:00.000Z",
      already_processed: false,
    },
    error: null,
  })
  state.maybeSingle.mockResolvedValue({ data: null, error: null })
  state.limit.mockReturnValue({ maybeSingle: state.maybeSingle })
  state.order.mockReturnValue({ limit: state.limit })
  state.gt.mockReturnValue({ order: state.order })
  state.in.mockReturnValue({ gt: state.gt })
  state.eq.mockReturnValue({ in: state.in, order: state.order })
  state.select.mockReturnValue({ eq: state.eq })
  state.from.mockReturnValue({ select: state.select })
  state.createServerClient.mockReturnValue({
    rpc: state.rpc,
    from: state.from,
  })
})

describe("Premium activation route", () => {
  it("uses the atomic idempotent purchase RPC for Coin passes", async () => {
    const response = await POST(post({ plan: "monthly", method: "coins" }, idempotencyKey))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("purchase_premium_with_coins", {
      p_user_id: userId,
      p_plan_type: "monthly",
      p_transaction_id: `premium_coins_${idempotencyKey}`,
    })
    expect(body.loop_coins).toBe(2500)
    expect(body.premium_expires_at).toBe("2026-12-02T12:00:00.000Z")
    expect(state.from).not.toHaveBeenCalled()
  })

  it("rejects invalid plan and invalid idempotency key before the RPC", async () => {
    expect((await POST(post({ plan: "lifetime", method: "coins" }))).status).toBe(400)
    expect((await POST(post({ plan: "monthly", method: "coins" }, "not-a-uuid"))).status).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it("maps insufficient balance to a safe client error", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "Not enough Loop Coins. This plan requires 5000 coins." },
    })
    const response = await POST(post({ plan: "monthly", method: "coins" }))
    expect(response.status).toBe(400)
  })

  it("does not double grant when the same idempotency key is retried", async () => {
    state.rpc.mockResolvedValue({
      data: {
        loop_coins: 2500,
        premium_expires_at: "2026-12-02T12:00:00.000Z",
        already_processed: true,
      },
      error: null,
    })
    const response = await POST(post({ plan: "monthly", method: "coins" }, idempotencyKey))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.already_processed).toBe(true)
    expect(state.rpc).toHaveBeenCalledOnce()
  })

  it("rejects signed-out callers before creating a server client", async () => {
    state.getUser.mockResolvedValue(null)
    const response = await POST(post({ plan: "monthly", method: "coins" }))
    expect(response.status).toBe(401)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })
})
