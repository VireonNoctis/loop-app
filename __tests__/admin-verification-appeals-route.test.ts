import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const state = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  order: vi.fn(),
  notificationInsert: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  requireAdmin: (...args: unknown[]) => state.requireAdmin(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({ rpc: state.rpc, from: state.from }),
}))

import { GET, POST } from "@/app/api/admin/verification/appeals/route"

const adminId = "11111111-1111-4111-8111-111111111111"
const appealId = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  vi.clearAllMocks()
  state.requireAdmin.mockResolvedValue({ user: { id: adminId }, response: null })
  state.rpc.mockResolvedValue({
    data: { appeal: { id: appealId, user_id: "33333333-3333-4333-8333-333333333333", status: "accepted" }, request_status: "pending" },
    error: null,
  })
  state.order.mockResolvedValue({ data: [{ id: appealId, status: "pending" }], error: null })
  state.notificationInsert.mockResolvedValue({ error: null })
  state.from.mockImplementation((table: string) => {
    if (table === "verification_appeals") {
      return { select: () => ({ order: () => ({ limit: state.order }) }) }
    }
    if (table === "notifications") {
      return { insert: state.notificationInsert }
    }
    return {}
  })
})

function post(body: unknown) {
  return new NextRequest("https://loopapp.me/api/admin/verification/appeals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("admin verification appeal route", () => {
  it("requires the admin gate to list appeals", async () => {
    const response = await GET(new NextRequest("https://loopapp.me/api/admin/verification/appeals"))
    expect(response.status).toBe(200)
    expect(state.from).toHaveBeenCalledWith("verification_appeals")
  })

  it("uses the database review RPC and returns the reopened application state", async () => {
    const response = await POST(post({ appealId, action: "accepted" }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("review_verification_appeal", {
      p_appeal_id: appealId,
      p_reviewer_id: adminId,
      p_action: "accepted",
      p_rejection_reason: null,
      p_admin_notes: null,
    })
    expect(body.request_status).toBe("pending")
  })

  it("rejects malformed and unauthorized reviews before the RPC", async () => {
    const invalid = await POST(post({ appealId: "bad", action: "accepted" }))
    expect(invalid.status).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()

    state.requireAdmin.mockResolvedValue({
      user: null,
      response: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    })
    const unauthorized = await POST(post({ appealId, action: "accepted" }))
    expect(unauthorized.status).toBe(403)
    expect(state.rpc).not.toHaveBeenCalled()
  })
})
