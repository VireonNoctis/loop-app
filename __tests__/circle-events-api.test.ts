import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  getUserFromRequest: vi.fn(),
  createServerClient: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getUserFromRequest: mocks.getUserFromRequest,
}))

vi.mock("@/lib/circle-access", () => ({
  checkCirclePrivateAccess: vi.fn(async () => ({ isPrivate: false, canView: true })),
}))

vi.mock("@/lib/supabase", () => ({
  createServerClient: mocks.createServerClient,
}))

beforeEach(() => {
  mocks.getUserFromRequest.mockReset()
  mocks.getUserFromRequest.mockResolvedValue(null)
  mocks.createServerClient.mockReset()
  mocks.createServerClient.mockImplementation(() => {
    throw new Error("Database client must not be created before authentication")
  })
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
})

describe("Circle event write routes", () => {
  it("rejects an unauthenticated event creation before creating a database client", async () => {
    const { POST } = await import("@/app/api/circles/[id]/events/route")
    const response = await POST(
      new NextRequest("https://loopapp.me/api/circles/circle-1/events", {
        method: "POST",
        body: JSON.stringify({ title: "An event" }),
      }),
      { params: Promise.resolve({ id: "circle-1" }) },
    )

    expect(response.status).toBe(401)
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it("rejects an unauthenticated RSVP before creating a database client", async () => {
    const { POST } = await import("@/app/api/circles/[id]/events/[eventId]/participants/route")
    const response = await POST(
      new NextRequest("https://loopapp.me/api/circles/circle-1/events/event-1/participants", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "circle-1", eventId: "event-1" }) },
    )

    expect(response.status).toBe(401)
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated RSVP moderation before creating a database client", async () => {
    const { PATCH } = await import("@/app/api/circles/[id]/events/[eventId]/participants/route")
    const response = await PATCH(
      new NextRequest("https://loopapp.me/api/circles/circle-1/events/event-1/participants", {
        method: "PATCH",
        body: JSON.stringify({ user_id: "user-2", action: "approve" }),
      }),
      { params: Promise.resolve({ id: "circle-1", eventId: "event-1" }) },
    )

    expect(response.status).toBe(401)
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })
})


describe("Circle event RSVP database contract", () => {
  const actorId = "11111111-1111-4111-8111-111111111111"
  const eventId = "22222222-2222-4222-8222-222222222222"

  function configureAuthenticatedMember(options: {
    requiresApproval?: boolean
    member?: boolean
  } = {}) {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: options.requiresApproval ? "pending" : "attending", participant_count: 1 },
      error: null,
    })
    const builder = (result: unknown) => {
      const query: Record<string, any> = {}
      query.select = () => query
      query.eq = () => query
      query.in = () => query
      query.maybeSingle = async () => ({ data: result, error: null })
      return query
    }

    mocks.getUserFromRequest.mockResolvedValue({ id: actorId })
    mocks.createServerClient.mockReturnValue({
      rpc,
      from: (table: string) => {
        if (table === "circle_members") {
          return builder(options.member === false ? null : { id: "membership-1" })
        }
        if (table === "circle_events") {
          return builder({
            id: eventId,
            ends_at: "2099-01-01T00:00:00.000Z",
            requires_approval: options.requiresApproval === true,
          })
        }
        return builder(null)
      },
    })
    return rpc
  }

  it("passes the signed-in member as the actor for a direct attendance RSVP", async () => {
    const rpc = configureAuthenticatedMember()
    const { POST } = await import("@/app/api/circles/[id]/events/[eventId]/participants/route")
    const response = await POST(
      new NextRequest("https://loopapp.me/api/circles/circle-1/events/event-1/participants", { method: "POST" }),
      { params: Promise.resolve({ id: "circle-1", eventId }) },
    )

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("set_circle_event_rsvp_authorized", {
      p_event_id: eventId,
      p_user_id: actorId,
      p_actor_id: actorId,
      p_status: "attending",
    })
  })

  it("sends approval-required RSVPs to the same authorized transaction as pending", async () => {
    const rpc = configureAuthenticatedMember({ requiresApproval: true })
    const { POST } = await import("@/app/api/circles/[id]/events/[eventId]/participants/route")
    const response = await POST(
      new NextRequest("https://loopapp.me/api/circles/circle-1/events/event-1/participants", { method: "POST" }),
      { params: Promise.resolve({ id: "circle-1", eventId }) },
    )

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("set_circle_event_rsvp_authorized", expect.objectContaining({
      p_user_id: actorId,
      p_actor_id: actorId,
      p_status: "pending",
    }))
  })

  it("does not reach the RSVP RPC after Circle membership has been revoked", async () => {
    const rpc = configureAuthenticatedMember({ member: false })
    const { POST } = await import("@/app/api/circles/[id]/events/[eventId]/participants/route")
    const response = await POST(
      new NextRequest("https://loopapp.me/api/circles/circle-1/events/event-1/participants", { method: "POST" }),
      { params: Promise.resolve({ id: "circle-1", eventId }) },
    )

    expect(response.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
})


describe("Circle event RSVP moderation contract", () => {
  const managerId = "33333333-3333-4333-8333-333333333333"
  const targetId = "44444444-4444-4444-8444-444444444444"
  const eventId = "22222222-2222-4222-8222-222222222222"

  it("passes the active event manager as actor when approving a pending RSVP", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "attending", participant_count: 2 },
      error: null,
    })
    mocks.getUserFromRequest.mockResolvedValue({ id: managerId })
    mocks.createServerClient.mockReturnValue({
      rpc,
      from: (table: string) => {
        const query: Record<string, any> = {}
        query.select = () => query
        query.eq = () => query
        query.in = () => query
        query.maybeSingle = async () => {
          if (table === "circle_events") {
            return { data: { id: eventId, organizer_id: "event-organizer" }, error: null }
          }
          if (table === "circle_members") {
            return { data: { role: "moderator", permissions: {} }, error: null }
          }
          if (table === "circle_event_participants") {
            return { data: { id: "pending-rsvp" }, error: null }
          }
          return { data: null, error: null }
        }
        return query
      },
    })

    const { PATCH } = await import("@/app/api/circles/[id]/events/[eventId]/participants/route")
    const response = await PATCH(
      new NextRequest("https://loopapp.me/api/circles/circle-1/events/event-1/participants", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: targetId, action: "approve" }),
      }),
      { params: Promise.resolve({ id: "circle-1", eventId }) },
    )

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("set_circle_event_rsvp_authorized", {
      p_event_id: eventId,
      p_user_id: targetId,
      p_actor_id: managerId,
      p_status: "attending",
    })
  })
})
