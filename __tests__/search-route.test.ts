import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  user: vi.fn(),
  from: vi.fn(),
  blocked: vi.fn(),
  filterCircles: vi.fn(),
  queries: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
  fixtures: {} as Record<string, { data: unknown; error: unknown }>,
}))

vi.mock("@/lib/server-auth", () => ({ getUserFromRequest: state.user }))
vi.mock("@/lib/supabase", () => ({
  createServerClient: () => ({ from: (table: string) => {
    const calls: Array<[string, unknown[]]> = []
    state.queries.push({ table, calls })
    const builder: Record<string, any> = {}
    for (const method of ["select", "eq", "is", "in", "or", "order", "range", "limit", "ilike", "contains", "not", "filter"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push([method, args])
        return builder
      }
    }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(state.fixtures[table] || { data: [], error: null }).then(resolve, reject)
    return builder
  } }),
}))
vi.mock("@/lib/privacy", () => ({ getBlockedProfileIds: state.blocked }))
vi.mock("@/lib/circle-content-privacy", () => ({
  filterCircleScopedContent: (...args: unknown[]) => state.filterCircles(...args),
}))
vi.mock("@/lib/normalize-loop", () => ({ normalizeLoops: (rows: unknown[]) => rows }))
vi.mock("@/lib/enrich-loops", () => ({ enrichLoopsWithPollsAndDuels: async (_supabase: unknown, rows: unknown[]) => rows }))
vi.mock("@/lib/loop-stats", () => ({ applyRealCommentCounts: async (_supabase: unknown, rows: unknown[]) => rows }))

import { GET } from "@/app/api/search/route"

const creatorId = "11111111-1111-4111-8111-111111111111"

function request(type: "loops" | "chains" | "collections") {
  return new NextRequest(`https://loopapp.me/api/search?q=worldbuilding&type=${type}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  state.queries = []
  state.fixtures = {}
  state.user.mockResolvedValue(null)
  state.blocked.mockResolvedValue(new Set<string>())
  state.filterCircles.mockImplementation(async (_supabase: unknown, rows: any[]) =>
    rows.filter((row) => row.circle_id !== "private-circle"),
  )
})

describe("universal collaborative-object search", () => {
  it("filters private Circle Loops before returning universal Search results", async () => {
    state.fixtures.loops = {
      data: [
        {
          id: "private-circle-loop",
          author_id: creatorId,
          circle_id: "private-circle",
          visibility: "public",
          content: "worldbuilding",
          created_at: "2026-11-02T10:00:00Z",
        },
        {
          id: "public-loop",
          author_id: creatorId,
          circle_id: null,
          visibility: "public",
          content: "worldbuilding",
          created_at: "2026-11-02T09:00:00Z",
        },
      ],
      error: null,
    }
    state.fixtures.profiles = {
      data: [{ id: creatorId, privacy_settings: { profile_visibility: "public" } }],
      error: null,
    }

    const response = await GET(request("loops"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.loops.map((loop: any) => loop.id)).toEqual(["public-loop"])
    expect(state.filterCircles).toHaveBeenCalledOnce()
  })

  it("returns public, unscoped, active Chains and excludes Circle-scoped or inactive records", async () => {
    state.fixtures.chains = {
      data: [{
        id: "chain-public",
        creator_id: creatorId,
        circle_id: null,
        title: "Worldbuilding",
        description: "Build a shared setting",
        visibility: "public",
        status: "active",
        creator: { id: creatorId, username: "creator", display_name: "Creator" },
      }],
      error: null,
    }
    state.fixtures.profiles = {
      data: [{ id: creatorId, privacy_settings: { profile_visibility: "public" } }],
      error: null,
    }

    const response = await GET(request("chains"))
    const body = await response.json()
    const chainQuery = state.queries.find((query) => query.table === "chains")

    expect(response.status).toBe(200)
    expect(body.chains.map((chain: any) => chain.id)).toEqual(["chain-public"])
    expect(body.results.total).toBe(1)
    expect(chainQuery?.calls).toContainEqual(["eq", ["visibility", "public"]])
    expect(chainQuery?.calls).toContainEqual(["is", ["circle_id", null]])
    expect(chainQuery?.calls).toContainEqual(["in", ["status", ["active", "completed"]]])
  })

  it("does not surface Chains created by private profiles", async () => {
    state.fixtures.chains = {
      data: [{
        id: "private-owner-chain",
        creator_id: creatorId,
        circle_id: null,
        title: "Worldbuilding",
        description: "Restricted creator",
        visibility: "public",
        status: "active",
      }],
      error: null,
    }
    state.fixtures.profiles = {
      data: [{ id: creatorId, privacy_settings: { profile_visibility: "private" } }],
      error: null,
    }

    const response = await GET(request("chains"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.chains).toEqual([])
  })


  it("does not surface public Chains owned by a profile blocked by the viewer", async () => {
    state.user.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222" })
    state.blocked.mockResolvedValue(new Set([creatorId]))
    state.fixtures.chains = {
      data: [{
        id: "blocked-owner-chain",
        creator_id: creatorId,
        circle_id: null,
        title: "Worldbuilding",
        visibility: "public",
        status: "active",
      }],
      error: null,
    }
    state.fixtures.profiles = {
      data: [{ id: creatorId, privacy_settings: { profile_visibility: "public" } }],
      error: null,
    }

    const response = await GET(request("chains"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.chains).toEqual([])
  })

  it("fails closed for malformed configured profile visibility", async () => {
    state.fixtures.chains = {
      data: [{
        id: "malformed-owner-chain",
        creator_id: creatorId,
        circle_id: null,
        title: "Worldbuilding",
        visibility: "public",
        status: "active",
      }],
      error: null,
    }
    state.fixtures.profiles = {
      data: [{ id: creatorId, privacy_settings: "not-an-object" }],
      error: null,
    }

    const response = await GET(request("chains"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.chains).toEqual([])
  })

  it("returns public Collections and excludes objects owned by restricted profiles", async () => {
    state.fixtures.collections = {
      data: [{
        id: "collection-public",
        owner_id: creatorId,
        title: "Worldbuilding references",
        description: "Useful worldbuilding resources",
        visibility: "public",
        is_collaborative: true,
        owner: { id: creatorId, username: "creator", display_name: "Creator" },
      }],
      error: null,
    }
    state.fixtures.profiles = {
      data: [{ id: creatorId, privacy_settings: { profile_visibility: "public" } }],
      error: null,
    }

    const response = await GET(request("collections"))
    const body = await response.json()
    const collectionQuery = state.queries.find((query) => query.table === "collections")

    expect(response.status).toBe(200)
    expect(body.collections.map((collection: any) => collection.id)).toEqual(["collection-public"])
    expect(collectionQuery?.calls).toContainEqual(["eq", ["visibility", "public"]])
  })

  it("fails closed when a creator privacy lookup fails", async () => {
    state.fixtures.chains = {
      data: [{
        id: "unknown-owner-chain",
        creator_id: creatorId,
        circle_id: null,
        title: "Worldbuilding",
        visibility: "public",
        status: "active",
      }],
      error: null,
    }
    state.fixtures.profiles = { data: null, error: new Error("profile lookup unavailable") }

    const response = await GET(request("chains"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.chains).toEqual([])
  })
})
