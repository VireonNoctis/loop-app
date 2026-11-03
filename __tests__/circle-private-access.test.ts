import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  from: vi.fn(),
  authQuery: vi.fn(),
  authGetUser: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({ createServerClient: state.createServerClient }))
vi.mock("@/lib/auth", () => ({ authDbPool: { query: state.authQuery } }))

import { checkCirclePrivateAccess } from "@/lib/circle-access"

function resultBuilder(result: { data: unknown; error: unknown }) {
  const query: Record<string, any> = {}
  query.select = () => query
  query.eq = () => query
  query.maybeSingle = async () => result
  return query
}

function configure(results: Array<{ data: unknown; error: unknown }>) {
  state.from.mockImplementation(() => resultBuilder(results.shift() || { data: null, error: null }))
  state.createServerClient.mockReturnValue({
    from: state.from,
    auth: { getUser: state.authGetUser },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
  state.authQuery.mockResolvedValue({ rows: [] })
  state.authGetUser.mockResolvedValue({ data: { user: null }, error: new Error("No legacy session") })
})

describe("private Circle access", () => {
  it("denies access when the privileged service key is missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
    const result = await checkCirclePrivateAccess("circle-1", null)

    expect(result).toEqual({ isPrivate: true, canView: false })
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("fails closed when Circle lookup fails or returns no row", async () => {
    configure([{ data: null, error: new Error("database unavailable") }])
    await expect(checkCirclePrivateAccess("circle-1", null)).resolves.toEqual({ isPrivate: true, canView: false })

    configure([{ data: null, error: null }])
    await expect(checkCirclePrivateAccess("missing-circle", null)).resolves.toEqual({ isPrivate: true, canView: false })
  })

  it("keeps public Circles readable without a member session", async () => {
    configure([{ data: { is_private: false, owner_id: null, creator_id: null }, error: null }])
    await expect(checkCirclePrivateAccess("public-circle", null)).resolves.toEqual({ isPrivate: false, canView: true })
  })

  it("allows the canonical owner or legacy creator of a private Circle", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111"
    state.authQuery.mockResolvedValue({ rows: [{ profile_id: ownerId }] })
    configure([{ data: { is_private: true, owner_id: ownerId, creator_id: null }, error: null }])
    await expect(checkCirclePrivateAccess("private-circle", "Bearer valid-session")).resolves.toEqual({ isPrivate: true, canView: true })

    state.authQuery.mockResolvedValue({ rows: [{ profile_id: ownerId }] })
    configure([{ data: { is_private: true, owner_id: null, creator_id: ownerId }, error: null }])
    await expect(checkCirclePrivateAccess("legacy-private-circle", "Bearer valid-session")).resolves.toEqual({ isPrivate: true, canView: true })
  })

  it("allows active and approved members but denies pending or banned rows", async () => {
    const memberId = "22222222-2222-4222-8222-222222222222"
    state.authQuery.mockResolvedValue({ rows: [{ profile_id: memberId }] })
    configure([
      { data: { is_private: true, owner_id: "owner", creator_id: null }, error: null },
      { data: { status: "active" }, error: null },
    ])
    await expect(checkCirclePrivateAccess("private-circle", "Bearer valid-session")).resolves.toEqual({ isPrivate: true, canView: true })

    state.authQuery.mockResolvedValue({ rows: [{ profile_id: memberId }] })
    configure([
      { data: { is_private: true, owner_id: "owner", creator_id: null }, error: null },
      { data: { status: "approved" }, error: null },
    ])
    await expect(checkCirclePrivateAccess("private-circle", "Bearer valid-session")).resolves.toEqual({ isPrivate: true, canView: true })

    state.authQuery.mockResolvedValue({ rows: [{ profile_id: memberId }] })
    configure([
      { data: { is_private: true, owner_id: "owner", creator_id: null }, error: null },
      { data: { status: "pending" }, error: null },
    ])
    await expect(checkCirclePrivateAccess("private-circle", "Bearer valid-session")).resolves.toEqual({ isPrivate: true, canView: false })
  })
})
