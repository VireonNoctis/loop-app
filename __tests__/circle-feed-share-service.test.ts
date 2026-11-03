import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  user: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock("@/lib/server-auth", () => ({ getUserFromRequest: state.user }))
vi.mock("@/lib/supabase", () => ({ createServerClient: state.createServerClient }))
vi.mock("@/lib/community-feed-share", () => ({
  canShareCircle: vi.fn(() => true),
  isShareablePost: vi.fn(() => true),
  sharePostToLoopFeed: vi.fn(),
  unsharePostFromFeed: vi.fn(),
}))

import { POST, DELETE } from "@/app/api/circles/[id]/posts/[postId]/feed-share/route"

const params = { params: Promise.resolve({ id: "circle-1", postId: "post-1" }) }
const url = "https://loopapp.me/api/circles/circle-1/posts/post-1/feed-share"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
  state.user.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" })
  state.createServerClient.mockImplementation(() => { throw new Error("Must not use an anon client") })
})

describe("Circle feed-share service boundary", () => {
  it("authenticates before requiring the privileged client", async () => {
    state.user.mockResolvedValue(null)
    const response = await POST(new NextRequest(url, { method: "POST" }), params)
    expect(response.status).toBe(401)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("fails closed for share and unshare when the service key is absent", async () => {
    const share = await POST(new NextRequest(url, { method: "POST" }), params)
    const unshare = await DELETE(new NextRequest(url, { method: "DELETE" }), params)
    expect([share.status, unshare.status]).toEqual([503, 503])
    expect(state.createServerClient).not.toHaveBeenCalled()
  })
})
