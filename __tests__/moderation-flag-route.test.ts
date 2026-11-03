import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const state = vi.hoisted(() => ({
  requireModerator: vi.fn(),
  createServerClient: vi.fn(),
  lookup: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  requireModerator: (...args: unknown[]) => state.requireModerator(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createServerClient: (...args: unknown[]) => state.createServerClient(...args),
}))

import { PATCH } from "@/app/api/moderation/flags/[id]/route"

const reviewerId = "11111111-1111-4111-8111-111111111111"
const reportId = "22222222-2222-4222-8222-222222222222"
const profileId = "33333333-3333-4333-8333-333333333333"
const context = { params: Promise.resolve({ id: reportId }) }

function request(body: unknown) {
  return new NextRequest(`https://loopapp.me/api/moderation/flags/${reportId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.requireModerator.mockReset()
  state.createServerClient.mockReset()
  state.lookup.mockReset()
  state.rpc.mockReset()
  state.requireModerator.mockResolvedValue({
    user: { id: reviewerId },
    profile: { is_moderator: true },
    response: null,
  })
  state.lookup.mockResolvedValue({
    data: { id: reportId, content_type: "profile", content_id: profileId, status: "pending" },
    error: null,
  })
  state.rpc.mockResolvedValue({ data: { id: reportId, status: "resolved" }, error: null })
  state.createServerClient.mockImplementation(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: state.lookup,
        }),
      }),
    }),
    rpc: state.rpc,
  }))
})

describe("moderation flag review route", () => {
  it("uses the atomic database review for a reasoned profile suspension", async () => {
    const response = await PATCH(request({
      status: "resolved",
      action_taken: "user_suspended",
      moderator_notes: "Reviewed evidence supports this policy decision.",
    }), context)

    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("review_content_flag", {
      p_flag_id: reportId,
      p_moderator_id: reviewerId,
      p_status: "resolved",
      p_action_taken: "user_suspended",
      p_moderator_notes: "Reviewed evidence supports this policy decision.",
    })
  })

  it("rejects suspension from a non-profile report before calling the RPC", async () => {
    state.lookup.mockResolvedValue({
      data: { id: reportId, content_type: "loop", content_id: profileId, status: "pending" },
      error: null,
    })
    const response = await PATCH(request({
      status: "resolved",
      action_taken: "user_suspended",
      moderator_notes: "Reason",
    }), context)

    expect(response.status).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it("does not process a report twice", async () => {
    state.lookup.mockResolvedValue({
      data: { id: reportId, content_type: "profile", content_id: profileId, status: "resolved" },
      error: null,
    })
    const response = await PATCH(request({ status: "reviewed" }), context)

    expect(response.status).toBe(409)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it("rejects unauthorized moderators before opening the database", async () => {
    state.requireModerator.mockResolvedValue({
      user: null,
      profile: null,
      response: NextResponse.json({ error: "Moderator access required" }, { status: 403 }),
    })
    const response = await PATCH(request({ status: "reviewed" }), context)

    expect(response.status).toBe(403)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })
})
