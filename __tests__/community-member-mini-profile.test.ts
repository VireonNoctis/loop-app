import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  user: vi.fn(),
  communityClient: vi.fn(),
  rows: {} as Record<string, any>,
  errors: {} as Record<string, any>,
}))

vi.mock("@/lib/server-auth", () => ({ getUserFromRequest: state.user }))
vi.mock("@/lib/community-engine", () => ({ communityClient: state.communityClient }))
vi.mock("@/lib/user-blocks", () => ({ checkBlockStatus: vi.fn(async () => ({ blocked: false, direction: null })) }))
vi.mock("@/lib/profile-privacy", () => ({
  isRestrictedProfileVisibility: (settings: any) => settings?.profile_visibility === "private" || settings?.profile_visibility === "followers",
  buildRestrictedProfileView: (profile: any) => ({ id: profile.id, username: profile.username, display_name: profile.display_name, can_view_full: false }),
}))

import { GET } from "@/app/api/communities/[id]/members/[userId]/profile/route"

const params = { params: Promise.resolve({ id: "circle-1", userId: "target" }) }
const url = "https://loopapp.me/api/communities/circle-1/members/target/profile"

function makeQuery(table: string) {
  const query: Record<string, any> = {}
  for (const method of ["select", "eq", "in", "or", "is", "limit"]) query[method] = () => query
  query.maybeSingle = async () => ({ data: state.rows[table] ?? null, error: state.errors[table] ?? null })
  query.then = (resolve: any, reject: any) => Promise.resolve({
    data: state.rows[table] ?? [],
    count: state.rows[table]?.count ?? 0,
    error: state.errors[table] ?? null,
  }).then(resolve, reject)
  return query
}

function resetRows() {
  state.rows = {
    circles: { id: "circle-1", is_private: true, owner_id: "owner", creator_id: "owner" },
    circle_members: { role: "member", status: "active", contribution_score: 4, joined_at: "2026-01-01" },
    profiles: { id: "target", username: "target", display_name: "Target", privacy_settings: {} },
    community_member_roles: [],
    circle_posts: { count: 2 },
    circle_post_comments: { count: 3 },
    follows: null,
  }
  state.errors = {}
}

beforeEach(() => {
  vi.clearAllMocks()
  resetRows()
  state.user.mockResolvedValue(null)
  state.communityClient.mockReturnValue({ from: (table: string) => makeQuery(table) })
})

function request() { return new NextRequest(url) }

describe("community member mini-profile privacy", () => {
  it("denies anonymous visitors to private Circles", async () => {
    const response = await GET(request(), params)
    expect(response.status).toBe(403)
  })

  it("denies pending members access to a private Circle", async () => {
    state.user.mockResolvedValue({ id: "pending-viewer" })
    state.rows.circles.is_private = true
    state.rows.circle_members = { role: "member", status: "pending" }
    const response = await GET(request(), params)
    expect(response.status).toBe(403)
  })

  it("does not return pending target members", async () => {
    state.user.mockResolvedValue({ id: "owner" })
    state.rows.circle_members = { role: "member", status: "pending" }
    const response = await GET(request(), params)
    expect(response.status).toBe(404)
  })

  it("returns a restricted profile for a non-follower", async () => {
    state.user.mockResolvedValue({ id: "owner" })
    state.rows.profiles.privacy_settings = { profile_visibility: "private" }
    const response = await GET(request(), params)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.profile.can_view_full).toBe(false)
    expect(body.membership).toBeNull()
    expect(body.post_count).toBe(0)
    expect(body.powers).toEqual([])
  })

  it("returns only the deliberate public identity DTO for readable profiles", async () => {
    state.user.mockResolvedValue({ id: "owner" })
    const response = await GET(request(), params)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.profile).toMatchObject({
      id: "target",
      username: "target",
      display_name: "Target",
    })
    expect(body.profile).not.toHaveProperty("privacy_settings")
    expect(body.profile).not.toHaveProperty("email")
  })

  it("does not grant moderation controls to a left moderator", async () => {
    // Exercise the role boundary independently of the private-Circle gate.
    state.rows.circles.is_private = false
    state.user.mockResolvedValue({ id: "left-moderator" })
    state.rows.circle_members = { role: "member", status: "active", contribution_score: 4 }
    // The viewer membership is returned for the second Circle-member lookup.
    const original = state.communityClient.getMockImplementation()
    const sb = original!()
    let memberQueries = 0
    state.communityClient.mockReturnValue({
      from: (table: string) => {
        if (table === "circle_members") memberQueries += 1
        const q = makeQuery(table)
        if (table === "circle_members" && memberQueries === 1) {
          q.maybeSingle = async () => ({ data: { role: "moderator", status: "left" }, error: null })
        }
        return q
      },
    })
    const response = await GET(request(), params)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.can_moderate).toBe(false)
  })
})
