import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  user: vi.fn(),
  createServerClient: vi.fn(),
  checkAccess: vi.fn(),
  getMediaLimit: vi.fn(),
  canShareCircle: vi.fn(),
  isShareablePost: vi.fn(),
  sharePostToLoopFeed: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({ getUserFromRequest: state.user }))
vi.mock("@/lib/supabase", () => ({ createServerClient: state.createServerClient }))
vi.mock("@/lib/circle-access", () => ({ checkCirclePrivateAccess: state.checkAccess }))
vi.mock("@/lib/circle-limits", () => ({ getMediaLimit: state.getMediaLimit }))
vi.mock("@/lib/community-feed-share", () => ({
  canShareCircle: state.canShareCircle,
  isShareablePost: state.isShareablePost,
  sharePostToLoopFeed: state.sharePostToLoopFeed,
}))

import {
  GET as listCirclePosts,
  POST as createCirclePost,
  PUT as updateCirclePost,
  DELETE as deleteCirclePost,
} from "@/app/api/circles/[id]/posts/route"

const params = { params: Promise.resolve({ id: "circle-1" }) }
const url = "https://loopapp.me/api/circles/circle-1/posts"

function request(method = "GET") {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify({ content: "A post" }) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
  state.user.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" })
  state.createServerClient.mockImplementation(() => {
    throw new Error("A privileged client must not be created without the server key")
  })
  state.checkAccess.mockResolvedValue({ isPrivate: false, canView: true })
})

describe("Circle post service boundary", () => {
  it("fails closed for post feeds when the server key is missing", async () => {
    const response = await listCirclePosts(request(), params)
    expect(response.status).toBe(503)
    expect(state.createServerClient).not.toHaveBeenCalled()
    expect(state.checkAccess).not.toHaveBeenCalled()
  })

  it("authenticates post creation before opening the database client", async () => {
    state.user.mockResolvedValue(null)
    const response = await createCirclePost(request("POST"), params)
    expect(response.status).toBe(401)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("fails closed for authenticated post creation, editing and deletion", async () => {
    const create = await createCirclePost(request("POST"), params)
    const update = await updateCirclePost(request("PUT"), params)
    const removeRequest = new NextRequest(url + "?postId=post-1", { method: "DELETE" })
    const remove = await deleteCirclePost(removeRequest, params)

    expect([create.status, update.status, remove.status]).toEqual([503, 503, 503])
    expect(state.createServerClient).not.toHaveBeenCalled()
  })
})
