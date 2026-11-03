import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getUserFromRequest: (...args: unknown[]) => state.getUser(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({ rpc: state.rpc, from: state.from }),
}))

import { GET, POST } from "@/app/api/verification/request/[id]/appeal/route"

const userId = "22222222-2222-4222-8222-222222222222"
const requestId = "11111111-1111-4111-8111-111111111111"
const context = { params: Promise.resolve({ id: requestId }) }

beforeEach(() => {
  vi.clearAllMocks()
  state.getUser.mockResolvedValue({ id: userId })
  state.rpc.mockResolvedValue({
    data: { id: "appeal-1", request_id: requestId, status: "pending" },
    error: null,
  })
  state.maybeSingle.mockResolvedValue({
    data: {
      id: "appeal-1",
      request_id: requestId,
      status: "pending",
      reason: "Please reconsider the original decision using this additional context.",
    },
    error: null,
  })
  state.select.mockReturnValue({
    eq: () => ({
      eq: () => ({
        maybeSingle: state.maybeSingle,
      }),
    }),
  })
  state.from.mockReturnValue({ select: state.select })
})

function post(body: unknown) {
  return new NextRequest(`https://loopapp.me/api/verification/request/${requestId}/appeal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("verification applicant appeal route", () => {
  it("returns only the signed-in user's public appeal fields", async () => {
    const response = await GET(new NextRequest("https://loopapp.me/api/verification/request"), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(state.from).toHaveBeenCalledWith("verification_appeals")
    expect(state.select).toHaveBeenCalledWith(
      "id, request_id, reason, evidence_url, status, rejection_reason, created_at, reviewed_at",
    )
    expect(body.appeal).not.toHaveProperty("reviewer_notes")
  })

  it("submits appeals through the locked service function", async () => {
    const response = await POST(post({
      reason: "The reviewer may have missed the official page in my original links.",
      evidenceUrl: "https://example.com/official",
    }), context)

    expect(response.status).toBe(201)
    expect(state.rpc).toHaveBeenCalledWith("submit_verification_appeal", {
      p_request_id: requestId,
      p_user_id: userId,
      p_reason: "The reviewer may have missed the official page in my original links.",
      p_evidence_url: "https://example.com/official",
    })
  })

  it("rejects malformed IDs, bad submissions and signed-out callers before the RPC", async () => {
    const invalid = await POST(post({ reason: "too short" }), { params: Promise.resolve({ id: "bad" }) })
    expect(invalid.status).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()

    state.getUser.mockResolvedValue(null)
    const signedOut = await POST(post({
      reason: "The reviewer may have missed the official page in my original links.",
    }), context)
    expect(signedOut.status).toBe(401)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it("maps duplicate or already-decided appeals to a conflict", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "55000" } })
    const response = await POST(post({
      reason: "The reviewer may have missed the official page in my original links.",
    }), context)
    expect(response.status).toBe(409)
  })
})
