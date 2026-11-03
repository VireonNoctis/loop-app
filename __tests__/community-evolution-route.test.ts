import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  user: vi.fn(),
  communityClient: vi.fn(),
  membership: { data: null as any, error: null as any },
}))

vi.mock("@/lib/server-auth", () => ({ getUserFromRequest: state.user }))
vi.mock("@/lib/community-engine", () => ({
  communityClient: state.communityClient,
  canAdmin: (role?: string) => role === "owner" || role === "admin",
  logCommunityActivity: vi.fn(),
}))

import { POST } from "@/app/api/communities/[id]/evolution/route"

const params = { params: Promise.resolve({ id: "circle-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  state.user.mockResolvedValue({ id: "user-1" })
  state.membership = { data: { role: "admin", status: "active" }, error: null }
  const query: Record<string, any> = {}
  query.select = () => query
  query.eq = () => query
  query.maybeSingle = async () => state.membership
  state.communityClient.mockReturnValue({ from: () => query })
})

function request(body: unknown) {
  return new NextRequest("https://loopapp.me/api/communities/circle-1/evolution", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("community evolution membership gate", () => {
  it("rejects a previously privileged member after they leave", async () => {
    state.membership = { data: { role: "admin", status: "left" }, error: null }
    const response = await POST(request({ action: "apply", recommendation: { payload: {} } }), params)
    expect(response.status).toBe(403)
  })

  it("rejects banned or pending admins", async () => {
    for (const status of ["banned", "pending"]) {
      state.membership = { data: { role: "admin", status }, error: null }
      const response = await POST(request({ action: "apply", recommendation: { payload: {} } }), params)
      expect(response.status).toBe(403)
    }
  })

  it("fails closed when membership cannot be verified", async () => {
    state.membership = { data: null, error: new Error("database unavailable") }
    const response = await POST(request({ action: "apply", recommendation: { payload: {} } }), params)
    expect(response.status).toBe(503)
  })

  it("validates the evolution action before applying a payload", async () => {
    const response = await POST(request({ action: "unexpected", recommendation: { payload: {} } }), params)
    expect(response.status).toBe(400)
  })
})
