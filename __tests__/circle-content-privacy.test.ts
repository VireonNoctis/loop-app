import { describe, expect, it } from "vitest"
import { filterCircleScopedContent } from "@/lib/circle-content-privacy"

function database(fixtures: Record<string, { data: unknown; error: unknown }>) {
  return {
    from(table: string) {
      const query: Record<string, any> = {}
      for (const method of ["select", "in", "eq"]) query[method] = () => query
      query.maybeSingle = async () => fixtures[table] || { data: null, error: null }
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(fixtures[table] || { data: [], error: null }).then(resolve, reject)
      return query
    },
  }
}

const publicLoop = { id: "public-loop", circle_id: null }
const privateCircleLoop = { id: "private-loop", circle_id: "private-circle" }
const proCircleLoop = { id: "pro-loop", circle_id: "pro-circle" }
const publicCircleLoop = { id: "circle-loop", circle_id: "public-circle" }

const circles = [
  { id: "private-circle", owner_id: "owner-1", is_private: true, is_premium_only: false },
  { id: "pro-circle", owner_id: "owner-2", is_private: false, is_premium_only: true },
  { id: "public-circle", owner_id: "owner-3", is_private: false, is_premium_only: false },
]

describe("Circle-scoped content privacy", () => {
  it("excludes private Circle content from anonymous and pending viewers", async () => {
    const anonymousDb = database({
      circles: { data: circles, error: null },
      circle_members: { data: [], error: null },
      profiles: { data: null, error: null },
    })
    const anonymous = await filterCircleScopedContent(
      anonymousDb,
      [publicLoop, privateCircleLoop, publicCircleLoop],
      null,
    )
    expect(anonymous.map((row) => row.id)).toEqual(["public-loop", "circle-loop"])

    const pendingDb = database({
      circles: { data: circles, error: null },
      circle_members: { data: [{ circle_id: "private-circle", status: "pending" }], error: null },
      profiles: { data: { is_premium: false }, error: null },
    })
    const pending = await filterCircleScopedContent(
      pendingDb,
      [publicLoop, privateCircleLoop, publicCircleLoop],
      "applicant",
    )
    expect(pending.map((row) => row.id)).toEqual(["public-loop", "circle-loop"])
  })

  it("allows the Circle owner and active or approved members to view private Circle content", async () => {
    const db = database({
      circles: { data: circles, error: null },
      circle_members: {
        data: [
          { circle_id: "private-circle", status: "active" },
        ],
        error: null,
      },
      profiles: { data: { is_premium: false }, error: null },
    })
    const activeMember = await filterCircleScopedContent(db, [privateCircleLoop], "member-1")
    expect(activeMember).toEqual([privateCircleLoop])

    const ownerDb = database({
      circles: { data: circles, error: null },
      circle_members: { data: [], error: null },
      profiles: { data: { is_premium: false }, error: null },
    })
    const owner = await filterCircleScopedContent(ownerDb, [privateCircleLoop], "owner-1")
    expect(owner).toEqual([privateCircleLoop])
  })

  it("requires a current Pro entitlement for Pro-only Circle content", async () => {
    const freeDb = database({
      circles: { data: circles, error: null },
      circle_members: { data: [], error: null },
      profiles: { data: { is_premium: true, premium_expires_at: "2000-01-01T00:00:00.000Z" }, error: null },
    })
    expect(await filterCircleScopedContent(freeDb, [proCircleLoop], "free-user")).toEqual([])

    const proDb = database({
      circles: { data: circles, error: null },
      circle_members: { data: [], error: null },
      profiles: { data: { is_premium: true, premium_expires_at: "2099-01-01T00:00:00.000Z" }, error: null },
    })
    expect(await filterCircleScopedContent(proDb, [proCircleLoop], "pro-user")).toEqual([proCircleLoop])
  })

  it("hides scoped content when Circle or membership lookups fail", async () => {
    const failedCircleLookup = database({
      circles: { data: null, error: { message: "unavailable" } },
      circle_members: { data: [], error: null },
      profiles: { data: null, error: null },
    })
    expect(await filterCircleScopedContent(
      failedCircleLookup,
      [publicLoop, privateCircleLoop],
      null,
    )).toEqual([publicLoop])

    const failedMembershipLookup = database({
      circles: { data: circles, error: null },
      circle_members: { data: null, error: { message: "unavailable" } },
      profiles: { data: { is_premium: false }, error: null },
    })
    expect(await filterCircleScopedContent(
      failedMembershipLookup,
      [publicLoop, privateCircleLoop],
      "viewer",
    )).toEqual([publicLoop])
  })
})
