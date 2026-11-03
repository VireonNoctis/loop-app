import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createServerClient: vi.fn(),
  rpc: vi.fn(),
  notifyUser: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  requireAdmin: (...args: unknown[]) => state.requireAdmin(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createServerClient: (...args: unknown[]) => state.createServerClient(...args),
}))
vi.mock("@/lib/notifications", () => ({
  notifyUser: (...args: unknown[]) => state.notifyUser(...args),
}))

import { PATCH } from "@/app/api/admin/withdrawals/route"

const adminId = "11111111-1111-4111-8111-111111111111"
const withdrawalId = "wdr_22222222-2222-4222-8222-222222222222"

function patch(body: unknown) {
  return new NextRequest("https://loopapp.me/api/admin/withdrawals", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.requireAdmin.mockResolvedValue({ user: { id: adminId }, response: null })
  state.rpc.mockResolvedValue({
    data: {
      request: {
        id: withdrawalId,
        user_id: "33333333-3333-4333-8333-333333333333",
        coins_amount: 750,
        estimated_usd: 7.5,
        payout_method: "bank",
        status: "rejected",
      },
      already_processed: false,
    },
    error: null,
  })
  state.createServerClient.mockReturnValue({ rpc: state.rpc })
  state.notifyUser.mockResolvedValue(undefined)
})

describe("atomic admin withdrawal review", () => {
  it("delegates the status transition and refund to the locked database function", async () => {
    const response = await PATCH(patch({
      id: withdrawalId,
      status: "rejected",
      admin_note: "Payout details could not be verified.",
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("review_coin_withdrawal", {
      p_admin_id: adminId,
      p_withdrawal_id: withdrawalId,
      p_status: "rejected",
      p_admin_note: "Payout details could not be verified.",
    })
    expect(body.request.status).toBe("rejected")
    expect(state.notifyUser).toHaveBeenCalledOnce()
  })

  it("does not send duplicate notifications when the transition was already processed", async () => {
    state.rpc.mockResolvedValue({
      data: {
        request: { id: withdrawalId, status: "rejected" },
        already_processed: true,
      },
      error: null,
    })
    const response = await PATCH(patch({ id: withdrawalId, status: "rejected" }))

    expect(response.status).toBe(200)
    expect(state.notifyUser).not.toHaveBeenCalled()
  })

  it("rejects unknown target states and oversized notes before calling SQL", async () => {
    const invalidStatus = await PATCH(patch({ id: withdrawalId, status: "pending_review" }))
    const oversizedNote = await PATCH(patch({
      id: withdrawalId,
      status: "approved",
      admin_note: "x".repeat(1001),
    }))

    expect([invalidStatus.status, oversizedNote.status]).toEqual([400, 400])
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it("maps completed or invalid transition conflicts safely", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: { code: "55000", message: "Invalid withdrawal status transition" },
    })
    const response = await PATCH(patch({ id: withdrawalId, status: "rejected" }))
    expect(response.status).toBe(409)
  })

  it("requires administrator authentication", async () => {
    state.requireAdmin.mockResolvedValue({
      user: null,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    })
    const response = await PATCH(patch({ id: withdrawalId, status: "rejected" }))
    expect(response.status).toBe(403)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })
})
