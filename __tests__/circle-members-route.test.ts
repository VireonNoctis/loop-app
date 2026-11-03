import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  user: vi.fn(),
  createServerClient: vi.fn(),
  checkAccess: vi.fn(),
  rpc: vi.fn(),
  broadcast: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({ getUserFromRequest: state.user }))
vi.mock("@/lib/supabase", () => ({ createServerClient: state.createServerClient }))
vi.mock("@/lib/circle-access", () => ({ checkCirclePrivateAccess: state.checkAccess }))
vi.mock("@/lib/circle-lifecycle", () => ({ syncCircleMemberCount: vi.fn() }))

import { DELETE, GET, PUT } from "@/app/api/circles/[id]/members/route"

const params = { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
  state.user.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" })
  state.createServerClient.mockImplementation(() => {
    throw new Error("A database client must not be created without the service role key")
  })
  state.checkAccess.mockResolvedValue({ isPrivate: false, canView: true })
})

describe("Circle member service boundary", () => {
  it("fails closed for public roster reads when the service key is missing", async () => {
    const response = await GET(new NextRequest("https://loopapp.me/api/circles/circle-1/members"), params)
    expect(response.status).toBe(503)
    expect(state.createServerClient).not.toHaveBeenCalled()
    expect(state.checkAccess).not.toHaveBeenCalled()
  })

  it("authenticates role changes before checking the privileged database client", async () => {
    state.user.mockResolvedValue(null)
    const response = await PUT(new NextRequest("https://loopapp.me/api/circles/circle-1/members", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetUserId: "22222222-2222-4222-8222-222222222222", newRole: "moderator" }),
    }), params)

    expect(response.status).toBe(401)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("fails closed for authenticated role changes when the service key is missing", async () => {
    const response = await PUT(new NextRequest("https://loopapp.me/api/circles/circle-1/members", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetUserId: "22222222-2222-4222-8222-222222222222", newRole: "moderator" }),
    }), params)

    expect(response.status).toBe(503)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("fails closed for member removals and bans when the service key is missing", async () => {
    const response = await DELETE(new NextRequest("https://loopapp.me/api/circles/circle-1/members?userId=22222222-2222-4222-8222-222222222222", {
      method: "DELETE",
    }), params)

    expect(response.status).toBe(503)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("uses the row-locked RPC for role and custom permission updates", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
    const circleId = "22222222-2222-4222-8222-222222222222"
    const targetUserId = "33333333-3333-4333-8333-333333333333"
    const member = {
      id: "member-row",
      circle_id: circleId,
      user_id: targetUserId,
      role: "moderator",
      status: "active",
      permissions: { can_pin_posts: true },
    }
    state.rpc.mockResolvedValue({ data: { member }, error: null })
    state.createServerClient.mockReturnValue({
      rpc: state.rpc,
      channel: vi.fn(() => ({ send: state.broadcast })),
    })

    const response = await PUT(new NextRequest(`https://loopapp.me/api/circles/${circleId}/members`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId,
        newRole: "moderator",
        customTitle: "Guide",
        permissions: { can_pin_posts: true },
      }),
    }), { params: Promise.resolve({ id: circleId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.member).toMatchObject({ user_id: targetUserId, role: "moderator" })
    expect(state.rpc).toHaveBeenCalledWith("update_circle_member", {
      p_circle_id: circleId,
      p_actor_id: "11111111-1111-4111-8111-111111111111",
      p_target_user_id: targetUserId,
      p_new_role: "moderator",
      p_update_custom_title: true,
      p_custom_title: "Guide",
      p_update_permissions: true,
      p_permissions: { can_pin_posts: true },
    })
    expect(state.broadcast).toHaveBeenCalledOnce()
  })

  it("leaves owner-only moderation override authority to the database", async () => {
    const circleId = "22222222-2222-4222-8222-222222222222"
    const targetUserId = "33333333-3333-4333-8333-333333333333"
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Only the Circle owner can grant moderation permission overrides" } })
    state.createServerClient.mockReturnValue({ rpc: state.rpc })
    const response = await PUT(new NextRequest(`https://loopapp.me/api/circles/${circleId}/members`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetUserId, permissions: { can_moderate: true } }),
    }), { params: Promise.resolve({ id: circleId }) })

    expect(response.status).toBe(403)
    expect(state.rpc).toHaveBeenCalledWith("update_circle_member", expect.objectContaining({
      p_permissions: { can_moderate: true },
    }))
  })

  it("rejects unsupported or non-boolean permission overrides", async () => {
    const circleId = "22222222-2222-4222-8222-222222222222"
    const targetUserId = "33333333-3333-4333-8333-333333333333"
    const unsupported = await PUT(new NextRequest(`https://loopapp.me/api/circles/${circleId}/members`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetUserId, permissions: { can_delete_circle: true } }),
    }), { params: Promise.resolve({ id: circleId }) })
    const malformed = await PUT(new NextRequest(`https://loopapp.me/api/circles/${circleId}/members`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetUserId, permissions: { can_pin_posts: "yes" } }),
    }), { params: Promise.resolve({ id: circleId }) })

    expect([unsupported.status, malformed.status]).toEqual([400, 400])
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it("uses the row-locked membership RPC for bans and synchronizes the count atomically", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
    const circleId = "22222222-2222-4222-8222-222222222222"
    const targetUserId = "33333333-3333-4333-8333-333333333333"
    const channel = { send: state.broadcast }
    state.rpc.mockResolvedValue({
      data: { circle_id: circleId, user_id: targetUserId, status: "banned", member_count: 8 },
      error: null,
    })
    state.createServerClient.mockReturnValue({
      rpc: state.rpc,
      channel: vi.fn(() => channel),
    })

    const response = await DELETE(
      new NextRequest(`https://loopapp.me/api/circles/${circleId}/members?userId=${targetUserId}&action=ban`, { method: "DELETE" }),
      { params: Promise.resolve({ id: circleId }) },
    )

    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("manage_circle_member", {
      p_circle_id: circleId,
      p_actor_id: "11111111-1111-4111-8111-111111111111",
      p_target_user_id: targetUserId,
      p_action: "ban",
    })
    expect(state.broadcast).toHaveBeenCalledOnce()
  })

  it("maps an atomic moderation denial without issuing direct membership writes", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
    const circleId = "22222222-2222-4222-8222-222222222222"
    const targetUserId = "33333333-3333-4333-8333-333333333333"
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "role changed" } })
    state.createServerClient.mockReturnValue({ rpc: state.rpc })

    const response = await DELETE(
      new NextRequest(`https://loopapp.me/api/circles/${circleId}/members?userId=${targetUserId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: circleId }) },
    )

    expect(response.status).toBe(403)
    expect(state.rpc).toHaveBeenCalledOnce()
  })

  it("does not expose wallet or account-activity data in public member rosters", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
    let selection = ""
    const query: Record<string, any> = {}
    query.select = (value: string) => { selection = value; return query }
    query.eq = () => query
    query.in = () => query
    query.order = () => query
    query.range = () => query
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject)
    state.createServerClient.mockReturnValue({ from: () => query })
    const response = await GET(new NextRequest("https://loopapp.me/api/circles/circle-1/members"), params)

    expect(response.status).toBe(200)
    expect(selection).toContain("user:profiles(id, username, display_name, avatar_url, video_avatar_url, is_verified)")
    expect(selection).not.toContain("*")
    expect(selection).not.toContain("loop_coins")
    expect(selection).not.toContain("last_active")
    expect(selection).not.toContain("is_premium")
  })
})
