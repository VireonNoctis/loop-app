import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  user: vi.fn(),
  createServerClient: vi.fn(),
  rpc: vi.fn(),
  send: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({ getUserFromRequest: state.user }))
vi.mock("@/lib/supabase", () => ({ createServerClient: state.createServerClient }))

import { GET, POST } from "@/app/api/circles/[id]/ownership/route"

const actorId = "11111111-1111-4111-8111-111111111111"
const newOwnerId = "22222222-2222-4222-8222-222222222222"
const circleId = "33333333-3333-4333-8333-333333333333"
const params = { params: Promise.resolve({ id: circleId }) }

function request(method = "POST", body?: unknown) {
  return new NextRequest(`https://loopapp.me/api/circles/${circleId}/ownership`, {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
  state.user.mockResolvedValue({ id: actorId })
  state.rpc.mockResolvedValue({
    data: {
      circle_id: circleId,
      previous_owner_id: actorId,
      owner_id: newOwnerId,
      member_count: 4,
    },
    error: null,
  })
  state.send.mockResolvedValue({ error: null })
  state.createServerClient.mockReturnValue({
    rpc: state.rpc,
    channel: vi.fn(() => ({ send: state.send })),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: { id: circleId, owner_id: actorId },
            error: null,
          })),
        })),
      })),
    })),
  })
})

describe("Circle ownership transfer boundary", () => {
  it("requires authentication before creating the privileged database client", async () => {
    state.user.mockResolvedValue(null)
    const response = await POST(request("POST", { new_owner_id: newOwnerId }), params)

    expect(response.status).toBe(401)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("fails closed when the server database key is unavailable", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
    const response = await POST(request("POST", { new_owner_id: newOwnerId }), params)

    expect(response.status).toBe(503)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("validates the recipient before calling the ownership RPC", async () => {
    const response = await POST(request("POST", { new_owner_id: "not-a-uuid" }), params)

    expect(response.status).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it("uses the authenticated actor and broadcasts a successful database transfer", async () => {
    const response = await POST(request("POST", { new_owner_id: newOwnerId, actor_id: newOwnerId }), params)

    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("transfer_circle_ownership", {
      p_circle_id: circleId,
      p_actor_id: actorId,
      p_new_owner_id: newOwnerId,
    })
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({
      event: "ownership_transferred",
      payload: { circleId, previousOwnerId: actorId, newOwnerId },
    }))
  })

  it("maps a database permission denial without disclosing internal details", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "actor is not owner" } })
    const response = await POST(request("POST", { new_owner_id: newOwnerId }), params)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: "Only the current owner can transfer ownership to an active, eligible Circle member",
    })
  })

  it("exposes transfer capability only for the canonical owner", async () => {
    const response = await GET(request("GET"), params)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ circle_id: circleId, owner_id: actorId, can_transfer: true })
  })
})
