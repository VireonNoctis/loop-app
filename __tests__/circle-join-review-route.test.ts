import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  notify: vi.fn(),
  circleName: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getUserFromRequest: (...args: unknown[]) => state.getUser(...args),
}))
vi.mock("@/lib/notifications", () => ({
  notifyUser: (...args: unknown[]) => state.notify(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({
    rpc: state.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: state.circleName,
        }),
      }),
    }),
  }),
}))

import { POST } from "@/app/api/circles/[id]/members/pending/route"

const actorId = "11111111-1111-4111-8111-111111111111"
const circleId = "22222222-2222-4222-8222-222222222222"
const memberId = "33333333-3333-4333-8333-333333333333"
const context = { params: Promise.resolve({ id: circleId }) }

function request(body: unknown) {
  return new NextRequest("https://loopapp.me/api/circles/example/members/pending", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  // These routes intentionally fail closed without the service-role key.
  // The mocked Supabase client is safe to use with an explicit test value.
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
  state.getUser.mockReset()
  state.rpc.mockReset()
  state.notify.mockReset()
  state.circleName.mockReset()
  state.getUser.mockResolvedValue({ id: actorId })
  state.rpc.mockResolvedValue({ data: { status: "active", user_id: memberId, role: "member" }, error: null })
  state.circleName.mockResolvedValue({ data: { name: "Example Circle" }, error: null })
})

describe("Circle join request review", () => {
  it("uses the transactional review function for approval", async () => {
    const response = await POST(request({ memberId, action: "approve", role: "member" }), context)
    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("review_circle_join_request", {
      p_circle_id: circleId,
      p_member_id: memberId,
      p_actor_id: actorId,
      p_action: "approve",
      p_role: "member",
    })
    expect(state.notify).toHaveBeenCalledOnce()
  })

  it("preserves a rejected request as a distinct decision state", async () => {
    state.rpc.mockResolvedValue({ data: { status: "rejected", user_id: memberId, role: "member" }, error: null })
    const response = await POST(request({ memberId, action: "reject" }), context)
    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("review_circle_join_request", expect.objectContaining({
      p_action: "reject",
      p_role: "member",
    }))
  })

  it("maps full-Circle approval to a conflict", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "This Circle has reached its member limit" } })
    const response = await POST(request({ memberId, action: "approve", role: "member" }), context)
    expect(response.status).toBe(409)
  })

  it("rejects invalid roles before calling the database", async () => {
    const response = await POST(request({ memberId, action: "approve", role: "owner" }), context)
    expect(response.status).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()
  })
})
