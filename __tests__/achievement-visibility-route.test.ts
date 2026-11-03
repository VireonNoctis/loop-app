import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  checkBlockStatus: vi.fn(),
  from: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getUserFromRequest: (...args: unknown[]) => state.getUser(...args),
}))
vi.mock("@/lib/user-blocks", () => ({
  checkBlockStatus: (...args: unknown[]) => state.checkBlockStatus(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => state.from(table),
  })),
}))

import { GET } from "@/app/api/users/achievements/route"

const viewerId = "11111111-1111-4111-8111-111111111111"
const targetId = "22222222-2222-4222-8222-222222222222"

function request() {
  return new NextRequest(`https://loopapp.me/api/users/achievements?userId=${targetId}`)
}

function createBuilder(table: string, fixtures: Record<string, unknown>) {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({
      data: fixtures[table] ?? null,
      error: null,
    })),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: fixtures[table] ?? [], error: null }).then(resolve, reject),
  }
  return builder
}

function configure(fixtures: Record<string, unknown>) {
  state.from.mockImplementation((table: string) => createBuilder(table, fixtures))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test")
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
  state.getUser.mockResolvedValue(null)
  state.checkBlockStatus.mockResolvedValue({ blocked: false, direction: null })
})

describe("achievement profile visibility route", () => {
  it("allows guest reads for active public profiles only", async () => {
    configure({
      profiles: { id: targetId, privacy_settings: { profile_visibility: "public" }, is_banned: false, is_deleted: false },
      user_achievements: [],
      user_stats: { total_xp: 150, level: 2 },
      achievements: [],
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.stats.total_xp).toBe(150)
    expect(state.checkBlockStatus).not.toHaveBeenCalled()
  })

  it("does not reveal a restricted profile to a guest", async () => {
    configure({
      profiles: { id: targetId, privacy_settings: { profile_visibility: "followers" }, is_banned: false, is_deleted: false },
    })

    const response = await GET(request())

    expect(response.status).toBe(404)
    expect(state.from).toHaveBeenCalledWith("profiles")
    expect(state.from).not.toHaveBeenCalledWith("user_achievements")
  })

  it("allows an authenticated approved follower to read restricted achievements", async () => {
    state.getUser.mockResolvedValue({ id: viewerId })
    configure({
      profiles: { id: targetId, privacy_settings: { profile_visibility: "private" }, is_banned: false, is_deleted: false },
      follows: { id: "follow-row" },
      user_achievements: [],
      user_stats: { total_xp: 25, level: 1 },
      achievements: [],
    })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(state.checkBlockStatus).toHaveBeenCalledWith(expect.anything(), viewerId, targetId)
  })

  it("hides achievement records when either account has blocked the other", async () => {
    state.getUser.mockResolvedValue({ id: viewerId })
    state.checkBlockStatus.mockResolvedValue({ blocked: true, direction: "by_them" })
    configure({
      profiles: { id: targetId, privacy_settings: { profile_visibility: "public" }, is_banned: false, is_deleted: false },
    })

    const response = await GET(request())

    expect(response.status).toBe(404)
    expect(state.from).not.toHaveBeenCalledWith("user_achievements")
  })

  it("does not reveal achievements for suspended or deleted profiles", async () => {
    state.getUser.mockResolvedValue({ id: viewerId })
    configure({
      profiles: { id: targetId, privacy_settings: { profile_visibility: "public" }, is_banned: true, is_deleted: false },
    })

    const response = await GET(request())

    expect(response.status).toBe(404)
    expect(state.from).not.toHaveBeenCalledWith("user_achievements")
  })
})
