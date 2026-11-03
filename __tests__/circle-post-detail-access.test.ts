import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  user: vi.fn(),
  createServerClient: vi.fn(),
  checkAccess: vi.fn(),
  notifyUser: vi.fn(),
  from: vi.fn(),
}))
vi.mock("@/lib/server-auth", () => ({ getUserFromRequest: state.user }))
vi.mock("@/lib/supabase", () => ({ createServerClient: state.createServerClient }))
vi.mock("@/lib/circle-access", () => ({ checkCirclePrivateAccess: state.checkAccess }))
vi.mock("@/lib/notifications", () => ({ notifyUser: state.notifyUser }))

import { GET, POST } from "@/app/api/circles/[id]/posts/[postId]/route"

const params = { params: Promise.resolve({ id: "circle-1", postId: "post-1" }) }
const url = "https://loopapp.me/api/circles/circle-1/posts/post-1"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
  state.user.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" })
  state.createServerClient.mockImplementation(() => { throw new Error("Should not create an unprivileged fallback client") })
  state.checkAccess.mockResolvedValue({ isPrivate: false, canView: true })
})

describe("Circle post detail permissions", () => {
  it("fails closed for post details when the server role is unavailable", async () => {
    const response = await GET(new NextRequest(url), params)
    expect(response.status).toBe(503)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("authenticates interactions before checking server configuration", async () => {
    state.user.mockResolvedValue(null)
    const response = await POST(new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "like" }),
    }), params)
    expect(response.status).toBe(401)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("fails closed for authenticated interactions when the server role is unavailable", async () => {
    const response = await POST(new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "like" }),
    }), params)
    expect(response.status).toBe(503)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })
})
