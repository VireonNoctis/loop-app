import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  sessionLookup: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getUserFromRequest: (...args: unknown[]) => state.getUser(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({
    rpc: state.rpc,
    from: state.from,
  }),
}))

import { POST } from "@/app/api/co-loop/room-control/route"

const ownerId = "11111111-1111-4111-8111-111111111111"
const targetId = "22222222-2222-4222-8222-222222222222"
const sessionId = "studio-1"

function request(action: string) {
  return new NextRequest("https://loopapp.me/api/co-loop/room-control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, action, target_user_id: targetId }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.getUser.mockResolvedValue({ id: ownerId, user_metadata: { username: "host" } })
  state.sessionLookup.mockResolvedValue({
    data: {
      session_id: sessionId,
      owner_id: ownerId,
      locked: false,
      deleted_at: null,
      status: "active",
      co_authors: [{ id: targetId }],
      feed_post_id: null,
      max_collaborators: 4,
      open_invite_topic: "Build together",
    },
    error: null,
  })
  state.from.mockImplementation((table: string) => {
    if (table === "co_loop_sessions") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: state.sessionLookup,
          }),
        }),
      }
    }
    if (table === "notifications" || table === "messages") {
      const query: Record<string, any> = {}
      query.delete = () => query
      query.eq = () => query
      query.filter = () => query
      query.like = () => query
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve, reject)
      return query
    }
    return {}
  })
  state.rpc.mockResolvedValue({
    data: { target_user_id: targetId, removed_entry: { id: targetId, username: "writer" } },
    error: null,
  })
})

describe("Co-Loop host removal", () => {
  it("delegates the ledger, participant and roster removal to one row-locked RPC", async () => {
    const response = await POST(request("kick"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith("kick_co_loop_participant", {
      p_session_id: sessionId,
      p_owner_id: ownerId,
      p_target_user_id: targetId,
    })
    expect(body.kicked).toBe(true)
  })

  it("maps a missing participant and preserves the database failure", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "co_loop_participant_not_found" } })

    const response = await POST(request("kick"))

    expect(response.status).toBe(404)
  })

  it("rejects a malformed or self target before calling the RPC", async () => {
    const malformed = await POST(new NextRequest("https://loopapp.me/api/co-loop/room-control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, action: "kick", target_user_id: "bad" }),
    }))
    const self = await POST(new NextRequest("https://loopapp.me/api/co-loop/room-control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, action: "kick", target_user_id: ownerId }),
    }))

    expect(malformed.status).toBe(400)
    expect(self.status).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()
  })
})
