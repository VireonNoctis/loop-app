import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  getUserFromRequest: vi.fn(),
  createServerClient: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getUserFromRequest: (...args: unknown[]) => state.getUserFromRequest(...args),
}))

vi.mock("@/lib/supabase", () => ({
  createServerClient: (...args: unknown[]) => state.createServerClient(...args),
}))

import { GET } from "@/app/api/verification/request/route"

const userId = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  vi.clearAllMocks()
  state.getUserFromRequest.mockResolvedValue({ id: userId })
  state.order.mockResolvedValue({
    data: [{
      id: "request-1",
      verification_type: "creator",
      status: "rejected",
      rejection_reason: "Please provide a public portfolio link.",
      created_at: "2026-11-01T12:00:00.000Z",
      reviewed_at: "2026-11-02T12:00:00.000Z",
    }],
    error: null,
  })
  state.eq.mockReturnValue({ order: state.order })
  state.select.mockReturnValue({ eq: state.eq })
  state.createServerClient.mockReturnValue({
    from: (table: string) => {
      expect(table).toBe("verification_requests")
      return { select: state.select }
    },
  })
})

describe("verification applicant history route", () => {
  it("returns safe reviewer feedback without selecting internal reviewer notes", async () => {
    const request = new NextRequest("https://loopapp.me/api/verification/request")
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(state.select).toHaveBeenCalledWith(
      "id, verification_type, status, rejection_reason, created_at, reviewed_at",
    )
    expect(body.requests[0].rejection_reason).toBe("Please provide a public portfolio link.")
    expect(body.requests[0]).not.toHaveProperty("admin_notes")
  })

  it("rejects signed-out history requests before querying application data", async () => {
    state.getUserFromRequest.mockResolvedValue(null)

    const response = await GET(new NextRequest("https://loopapp.me/api/verification/request"))

    expect(response.status).toBe(401)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })
})
