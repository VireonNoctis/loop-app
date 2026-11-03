import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const state = vi.hoisted(() => ({
  requireModerator: vi.fn(),
  createServerClient: vi.fn(),
  rpc: vi.fn(),
  notificationInsert: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  requireModerator: (...args: unknown[]) => state.requireModerator(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createServerClient: (...args: unknown[]) => state.createServerClient(...args),
}))

import { POST } from "@/app/api/admin/ban-appeals/route"

const reviewerId = "11111111-1111-4111-8111-111111111111"
const appealId = "22222222-2222-4222-8222-222222222222"
const targetId = "33333333-3333-4333-8333-333333333333"

function request(body: unknown) {
  return new NextRequest("https://loopapp.me/api/admin/ban-appeals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.requireModerator.mockReset()
  state.createServerClient.mockReset()
  state.rpc.mockReset()
  state.notificationInsert.mockReset()
  state.requireModerator.mockResolvedValue({
    user: { id: reviewerId },
    profile: { is_moderator: true },
    response: null,
  })
  state.rpc.mockResolvedValue({
    data: { id: appealId, user_id: targetId, status: "approved" },
    error: null,
  })
  state.notificationInsert.mockResolvedValue({ error: null })
  state.createServerClient.mockImplementation(() => ({
    rpc: state.rpc,
    from: () => ({ insert: state.notificationInsert }),
  }))
})

describe("ban appeal review route", () => {
  it("calls the atomic review function and notifies after approval", async () => {
    const response = await POST(request({ appeal_id: appealId, decision: "approve" }))

    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("review_ban_appeal", {
      p_appeal_id: appealId,
      p_reviewer_id: reviewerId,
      p_decision: "approve",
      p_admin_notes: null,
    })
    expect(state.notificationInsert).toHaveBeenCalledOnce()
  })

  it("requires a clear reason before denying an appeal", async () => {
    const response = await POST(request({ appeal_id: appealId, decision: "deny" }))

    expect(response.status).toBe(400)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("does not notify when an appeal is stale or already reviewed", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "Already reviewed" } })
    const response = await POST(request({
      appeal_id: appealId,
      decision: "deny",
      admin_notes: "The suspension remains supported by the reviewed evidence.",
    }))

    expect(response.status).toBe(409)
    expect(state.notificationInsert).not.toHaveBeenCalled()
  })

  it("rejects unauthorized reviewers before database access", async () => {
    state.requireModerator.mockResolvedValue({
      user: null,
      profile: null,
      response: NextResponse.json({ error: "Moderator access required" }, { status: 403 }),
    })
    const response = await POST(request({ appeal_id: appealId, decision: "approve" }))

    expect(response.status).toBe(403)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })
})
