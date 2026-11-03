import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  user: vi.fn(),
  createServerClient: vi.fn(),
  checkAccess: vi.fn(),
  notifyUser: vi.fn(),
  hardDeleteCircle: vi.fn(),
  setCircleActive: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({ getUserFromRequest: state.user }))
vi.mock("@/lib/supabase", () => ({ createServerClient: state.createServerClient }))
vi.mock("@/lib/circle-access", () => ({ checkCirclePrivateAccess: state.checkAccess }))
vi.mock("@/lib/notifications", () => ({ notifyUser: state.notifyUser }))
vi.mock("@/lib/circle-lifecycle", () => ({
  hardDeleteCircle: state.hardDeleteCircle,
  setCircleActive: state.setCircleActive,
}))
vi.mock("@/lib/pro-features", () => ({ isProUser: vi.fn(() => false) }))

import {
  GET as getCircle,
  PUT as updateCircle,
  PATCH as patchCircle,
  DELETE as deleteCircle,
} from "@/app/api/circles/[id]/route"
import {
  GET as getComments,
  POST as createComment,
} from "@/app/api/circles/[id]/posts/[postId]/comments/route"
import { POST as votePoll } from "@/app/api/circles/[id]/posts/[postId]/poll/vote/route"

const circleParams = { params: Promise.resolve({ id: "circle-1" }) }
const postParams = { params: Promise.resolve({ id: "circle-1", postId: "post-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
  state.user.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" })
  state.createServerClient.mockImplementation(() => {
    throw new Error("A privileged client must not be created without the server key")
  })
  state.checkAccess.mockResolvedValue({ isPrivate: false, canView: true })
})

function getRequest(path: string) {
  return new NextRequest("https://loopapp.me" + path)
}
function postRequest(path: string, method = "POST", body: unknown = {}) {
  return new NextRequest("https://loopapp.me" + path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("Circle service-role route boundaries", () => {
  it("fails closed for Circle details when the server key is missing", async () => {
    const response = await getCircle(getRequest("/api/circles/circle-1"), circleParams)
    expect(response.status).toBe(503)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("fails closed for every Circle mutation when the server key is missing", async () => {
    const put = await updateCircle(postRequest("/api/circles/circle-1", "PUT", {}), circleParams)
    const patch = await patchCircle(postRequest("/api/circles/circle-1", "PATCH", {}), circleParams)
    const remove = await deleteCircle(postRequest("/api/circles/circle-1", "DELETE"), circleParams)

    expect([put.status, patch.status, remove.status]).toEqual([503, 503, 503])
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("fails closed for Circle comment reads and writes when the server key is missing", async () => {
    const read = await getComments(getRequest("/api/circles/circle-1/posts/post-1/comments"), postParams)
    const write = await createComment(postRequest("/api/circles/circle-1/posts/post-1/comments"), postParams)

    expect([read.status, write.status]).toEqual([503, 503])
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated poll voters before creating a server client", async () => {
    state.user.mockResolvedValue(null)
    const response = await votePoll(postRequest("/api/circles/circle-1/posts/post-1/poll/vote"), postParams)

    expect(response.status).toBe(401)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("fails closed for poll voting when the server key is missing", async () => {
    const response = await votePoll(postRequest("/api/circles/circle-1/posts/post-1/poll/vote", "POST", { optionIndex: 0 }), postParams)

    expect(response.status).toBe(503)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })
})
