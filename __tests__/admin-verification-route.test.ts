import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const state = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createServerClient: vi.fn(),
  rpc: vi.fn(),
  notificationInsert: vi.fn(),
  requestLookup: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  requireAdmin: (...args: unknown[]) => state.requireAdmin(...args),
}))

vi.mock("@/lib/supabase", () => ({
  createServerClient: (...args: unknown[]) => state.createServerClient(...args),
}))

import { POST } from "@/app/api/admin/verification/route"

const adminId = "11111111-1111-4111-8111-111111111111"
const requestId = "22222222-2222-4222-8222-222222222222"

function post(body: unknown) {
  return new NextRequest("https://loopapp.me/api/admin/verification", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function configureDatabase() {
  state.rpc.mockResolvedValue({
    data: {
      id: requestId,
      user_id: "33333333-3333-4333-8333-333333333333",
      status: "approved",
      verification_type: "creator",
    },
    error: null,
  })
  state.notificationInsert.mockResolvedValue({ error: null })
  state.requestLookup.mockResolvedValue({
    data: {
      id: requestId,
      status: "approved",
      user: { username: "creator", is_verified: true },
    },
    error: null,
  })
  state.createServerClient.mockImplementation(() => ({
    rpc: state.rpc,
    from: (table: string) => ({
      insert: table === "notifications" ? state.notificationInsert : vi.fn(),
      select: () => ({
        eq: () => ({
          maybeSingle: state.requestLookup,
        }),
      }),
    }),
  }))
}

beforeEach(() => {
  state.requireAdmin.mockReset()
  state.createServerClient.mockReset()
  state.rpc.mockReset()
  state.notificationInsert.mockReset()
  state.requestLookup.mockReset()
  state.requireAdmin.mockResolvedValue({
    user: { id: adminId, email: "reviewer@example.com" },
    profile: { is_admin: true },
    response: null,
  })
  configureDatabase()
})

describe("verification admin review route", () => {
  it("uses one atomic database review operation for an approval", async () => {
    const response = await POST(post({ requestId, action: "approved" }))

    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledOnce()
    expect(state.rpc).toHaveBeenCalledWith("review_verification_request", {
      p_request_id: requestId,
      p_reviewer_id: adminId,
      p_action: "approved",
      p_admin_notes: null,
    })
    expect(state.notificationInsert).toHaveBeenCalledOnce()
    expect((await response.json()).request.user.is_verified).toBe(true)
  })

  it("does not notify or repeat a decision when the request was already reviewed", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: { code: "55000", message: "Verification request is no longer pending" },
    })

    const response = await POST(post({ requestId, action: "approved" }))

    expect(response.status).toBe(409)
    expect(state.notificationInsert).not.toHaveBeenCalled()
    expect(state.requestLookup).not.toHaveBeenCalled()
  })

  it("rejects malformed request identifiers before opening a database connection", async () => {
    const response = await POST(post({ requestId: "not-a-uuid", action: "approved" }))

    expect(response.status).toBe(400)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("rejects unauthorised reviewers before opening a database connection", async () => {
    state.requireAdmin.mockResolvedValue({
      user: null,
      profile: null,
      response: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    })

    const response = await POST(post({ requestId, action: "approved" }))

    expect(response.status).toBe(403)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })
})
