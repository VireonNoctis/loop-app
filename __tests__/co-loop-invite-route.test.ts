import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  notifyUser: vi.fn(),
  block: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getUserFromRequest: (...args: unknown[]) => state.getUser(...args),
}))
vi.mock("@/lib/user-blocks", () => ({
  checkBlockStatus: (...args: unknown[]) => state.block(...args),
}))
vi.mock("@/lib/notifications", () => ({
  notifyUser: (...args: unknown[]) => state.notifyUser(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({ rpc: state.rpc, from: state.from }),
}))

import { POST } from "@/app/api/co-loop/invite/route"

const inviterId = "11111111-1111-4111-8111-111111111111"
const inviteeId = "22222222-2222-4222-8222-222222222222"
const sessionId = "co-loop-session-1"

function request(body: unknown = { invitee_id: inviteeId, session_id: sessionId }) {
  return new NextRequest("https://loopapp.me/api/co-loop/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makeBuilder(result: unknown) {
  const builder: Record<string, any> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.is = async () => result
  builder.in = () => builder
  builder.limit = () => builder
  builder.maybeSingle = async () => result
  builder.single = async () => result
  builder.insert = async () => result
  builder.update = () => builder
  builder.then = (resolve: (result: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  state.getUser.mockResolvedValue({ id: inviterId })
  state.block.mockResolvedValue({ blocked: false })
  state.rpc.mockResolvedValue({
    data: { id: "33333333-3333-4333-8333-333333333333", capacity: 4, reserved_count: 2 },
    error: null,
  })
  state.notifyUser.mockResolvedValue({ notificationId: "notification-1" })
  state.from.mockImplementation((table: string) => {
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: inviterId, username: "host", display_name: "Host", avatar_url: null },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === "conversation_participants") {
      return {
        select: () => ({
          eq: () => ({
            is: async () => ({ data: [], error: null }),
          }),
        }),
        insert: async () => ({ error: null }),
      }
    }
    if (table === "conversations") {
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: "conversation-1" }, error: null }),
          }),
        }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }
    }
    if (table === "messages") return { insert: async () => ({ error: null }) }
    if (table === "co_loop_invitations") {
      return { update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }
    }
    return makeBuilder({ data: [], error: null })
  })
})

describe("Co-Loop direct invitations", () => {
  it("reserves a seat through the atomic lifecycle function before delivery", async () => {
    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("create_co_loop_invitation", {
      p_session_id: sessionId,
      p_inviter_id: inviterId,
      p_invitee_id: inviteeId,
    })
    expect(body.invitation_id).toBe("33333333-3333-4333-8333-333333333333")
    expect(body.reserved_count).toBe(2)
    expect(state.notifyUser).toHaveBeenCalledOnce()
  })

  it("rejects a full room without attempting notification or DM delivery", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "co_loop_full" } })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(state.notifyUser).not.toHaveBeenCalled()
  })

  it("does not call the database for malformed invitees or self-invites", async () => {
    const malformed = await POST(request({ invitee_id: "not-a-uuid", session_id: sessionId }))
    const selfInvite = await POST(request({ invitee_id: inviterId, session_id: sessionId }))

    expect(malformed.status).toBe(400)
    expect(selfInvite.status).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it("releases the reserved slot if no delivery surface succeeds", async () => {
    state.notifyUser.mockResolvedValue({ notificationId: null })
    state.from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: inviterId, username: "host", display_name: "Host", avatar_url: null },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === "conversation_participants") {
        return {
          select: () => ({
            eq: () => ({
              is: async () => ({ data: [], error: null }),
            }),
          }),
        }
      }
      if (table === "conversations") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: "offline" } }),
            }),
          }),
        }
      }
      if (table === "co_loop_invitations") {
        return { update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }
      }
      return makeBuilder({ data: [], error: null })
    })

    const response = await POST(request())

    expect(response.status).toBe(502)
    expect(state.from).toHaveBeenCalledWith("co_loop_invitations")
  })

  it("fails closed when a block relationship prevents the invitation", async () => {
    state.block.mockResolvedValue({ blocked: true })

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(state.rpc).not.toHaveBeenCalled()
  })
})
