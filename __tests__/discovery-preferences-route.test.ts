import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({ user: vi.fn(), select: vi.fn(), update: vi.fn(), maybeSingle: vi.fn() }))
vi.mock("@/lib/server-auth", () => ({ getUserFromRequest: state.user }))
vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({ from: () => ({ select: state.select, update: state.update }) }),
}))
import { GET, PUT } from "@/app/api/users/discovery-preferences/route"

function queryBuilder() {
  const query: Record<string, any> = {}
  query.eq = () => query
  query.select = () => query
  query.maybeSingle = state.maybeSingle
  return query
}
beforeEach(() => {
  vi.clearAllMocks()
  state.user.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" })
  state.maybeSingle.mockResolvedValue({ data: { discovery_preferences: { preferred_topics: ["stories"], muted_topics: [] } }, error: null })
  state.select.mockReturnValue(queryBuilder())
  state.update.mockReturnValue(queryBuilder())
})
describe("Discover preferences API", () => {
  it("requires authentication", async () => {
    state.user.mockResolvedValue(null)
    const response = await GET(new NextRequest("https://loopapp.me/api/users/discovery-preferences"))
    expect(response.status).toBe(401)
  })
  it("returns only the signed-in member's preferences", async () => {
    const response = await GET(new NextRequest("https://loopapp.me/api/users/discovery-preferences"))
    expect(response.status).toBe(200)
    expect(state.select).toHaveBeenCalledWith("discovery_preferences")
  })
  it("updates only the signed-in member's preferences", async () => {
    state.maybeSingle.mockResolvedValueOnce({ data: { discovery_preferences: { preferred_topics: ["stories"], muted_topics: [] } }, error: null })
      .mockResolvedValueOnce({ data: { discovery_preferences: { personalization_enabled: true, preferred_topics: ["stories"], muted_topics: ["spoilers"] } }, error: null })
    const response = await PUT(new NextRequest("https://loopapp.me/api/users/discovery-preferences", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ muted_topics: ["spoilers"] }),
    }))
    expect(response.status).toBe(200)
    expect(state.update).toHaveBeenCalledWith({ discovery_preferences: { personalization_enabled: true, preferred_topics: ["stories"], muted_topics: ["spoilers"] } })
  })
  it("rejects malformed topics before writing", async () => {
    const response = await PUT(new NextRequest("https://loopapp.me/api/users/discovery-preferences", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ muted_topics: ["not a topic"] }),
    }))
    expect(response.status).toBe(400)
    expect(state.update).not.toHaveBeenCalled()
  })
})
