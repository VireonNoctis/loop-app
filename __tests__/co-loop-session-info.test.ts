import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  user: vi.fn(),
  createServerClient: vi.fn(),
  patch: vi.fn(),
  readResult: vi.fn(),
  writeResult: vi.fn(),
  readQuery: {} as Record<string, any>,
  writeQuery: {} as Record<string, any>,
}))

vi.mock("@/lib/server-auth", () => ({ getUserFromRequest: state.user }))
vi.mock("@/lib/supabase", () => ({ createServerClient: state.createServerClient }))

import { PATCH } from "@/app/api/co-loop/session-info/route"

const actorId = "11111111-1111-4111-8111-111111111111"
const hostId = "22222222-2222-4222-8222-222222222222"

function request(body: unknown) {
  return new NextRequest("https://loopapp.me/api/co-loop/session-info", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function configureDatabase(session: Record<string, unknown>, updated: boolean) {
  state.readQuery = {
    select: vi.fn(() => state.readQuery),
    eq: vi.fn(() => state.readQuery),
    maybeSingle: vi.fn(async () => ({ data: session, error: null })),
  }
  state.writeQuery = {
    eq: vi.fn(() => state.writeQuery),
    is: vi.fn(() => state.writeQuery),
    select: vi.fn(() => state.writeQuery),
    maybeSingle: vi.fn(async () => ({ data: updated ? { session_id: "session-1" } : null, error: null })),
  }
  state.createServerClient.mockReturnValue({
    from: vi.fn(() => ({
      select: () => state.readQuery,
      update: (patch: Record<string, unknown>) => {
        state.patch(patch)
        return state.writeQuery
      },
    })),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user.mockResolvedValue({ id: actorId })
  state.patch.mockReset()
})

describe("Co-Loop durable draft writes", () => {
  it("rejects host draft writes after a session has ended", async () => {
    configureDatabase({
      owner_id: actorId,
      co_authors: [],
      locked: false,
      deleted_at: null,
      status: "ended",
    }, true)

    const response = await PATCH(request({ session_id: "session-1", draft_content: "late edit" }))

    expect(response.status).toBe(409)
    expect(state.patch).not.toHaveBeenCalled()
  })

  it("conditions non-host autosaves on the active unlocked roster observed during authorization", async () => {
    const roster = [{ id: actorId, username: "writer" }]
    configureDatabase({
      owner_id: hostId,
      co_authors: roster,
      locked: false,
      deleted_at: null,
      status: "active",
    }, true)

    const response = await PATCH(request({ session_id: "session-1", draft_content: "shared draft" }))

    expect(response.status).toBe(200)
    expect(state.patch).toHaveBeenCalledWith(expect.objectContaining({
      draft_content: "shared draft",
    }))
    expect(state.writeQuery.eq).toHaveBeenCalledWith("status", "active")
    expect(state.writeQuery.is).toHaveBeenCalledWith("deleted_at", null)
    expect(state.writeQuery.eq).toHaveBeenCalledWith("locked", false)
    expect(state.writeQuery.eq).toHaveBeenCalledWith("co_authors", roster)
  })

  it("does not report success when the conditional write loses a race", async () => {
    configureDatabase({
      owner_id: hostId,
      co_authors: [{ id: actorId }],
      locked: false,
      deleted_at: null,
      status: "active",
    }, false)

    const response = await PATCH(request({ session_id: "session-1", draft_title: "Changed" }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: "This room changed while you were editing. Refresh before trying again.",
    })
  })
})
