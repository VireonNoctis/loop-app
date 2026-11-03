import { describe, expect, it } from "vitest"
import { canViewProfile, filterPrivateContent, getBlockedProfileIds } from "@/lib/privacy"

function createSupabaseMock(blockRows: Array<{ blocker_id: string; blocked_id: string }>, privateIds: string[] = []) {
  return {
    from(table: string) {
      const equals: Record<string, unknown> = {}
      const included: Record<string, unknown[]> = {}
      const matches = (row: Record<string, unknown>) =>
        Object.entries(equals).every(([key, value]) => row[key] === value)
        && Object.entries(included).every(([key, values]) => values.includes(row[key]))
      const builder: any = {
        select: () => builder,
        eq: (key: string, value: unknown) => { equals[key] = value; return builder },
        in: (key: string, values: unknown[]) => { included[key] = values; return builder },
        maybeSingle: async () => {
          if (table === "profiles") return { data: { privacy_settings: { profile_visibility: privateIds.includes(String(equals.id)) ? "private" : "public" } }, error: null }
          if (table === "user_blocks") {
            const match = blockRows.find(row => matches(row as unknown as Record<string, unknown>))
            return { data: match ? { id: 1 } : null, error: null }
          }
          return { data: null, error: null }
        },
        then: (resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) => {
          const data = table === "profiles"
            ? ((included.id || []) as string[]).map(id => ({ id, privacy_settings: { profile_visibility: privateIds.includes(id) ? "private" : "public" } }))
            : table === "user_blocks"
              ? blockRows.filter(row => matches(row as unknown as Record<string, unknown>))
              : []
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return builder
    },
  }
}

describe("two-way block privacy", () => {
  const viewer = "viewer"
  const blocks = [
    { blocker_id: viewer, blocked_id: "blocked-by-viewer" },
    { blocker_id: "blocked-viewer", blocked_id: viewer },
  ]

  it("removes content from both sides of a block but preserves self and approved private follows", async () => {
    const supabase = createSupabaseMock(blocks, ["private-followed"])
    const rows = ["self", "blocked-by-viewer", "blocked-viewer", "private-followed", "public"]
      .map(author_id => ({ id: author_id, author_id }))
    const result = await filterPrivateContent(supabase, rows, viewer, new Set(["private-followed"]))
    expect(result.map(row => row.id)).toEqual(["self", "private-followed", "public"])
  })

  it("returns both block directions for a bounded author list", async () => {
    const supabase = createSupabaseMock(blocks)
    expect(await getBlockedProfileIds(supabase, viewer, ["blocked-by-viewer", "blocked-viewer", "public"])).toEqual(
      new Set(["blocked-by-viewer", "blocked-viewer"]),
    )
  })

  it("denies profile access when either side has blocked the other", async () => {
    const supabase = createSupabaseMock(blocks)
    expect(await canViewProfile(supabase, viewer, "blocked-by-viewer")).toEqual({ allowed: false, isPrivate: false })
    expect(await canViewProfile(supabase, viewer, "blocked-viewer")).toEqual({ allowed: false, isPrivate: false })
  })

  it("allows a public profile when no block exists", async () => {
    const supabase = createSupabaseMock([])
    expect(await canViewProfile(supabase, viewer, "public")).toEqual({ allowed: true, isPrivate: false })
  })

  it("applies two-way blocks and profile visibility to duel and Co-Loop discovery rows", async () => {
    const supabase = createSupabaseMock([
      { blocker_id: viewer, blocked_id: "blocked-creator" },
    ], ["private-creator"])
    const follows = new Set<string>()

    const duelRows = [
      { id: "duel-private", creator_id: "private-creator" },
      { id: "duel-blocked", creator_id: "blocked-creator" },
      { id: "duel-public", creator_id: "public-creator" },
    ].map((duel) => ({ ...duel, author_id: duel.creator_id }))
    const visibleDuels = await filterPrivateContent(supabase, duelRows, viewer, follows)

    const coLoopRows = [
      { id: "co-loop-private", author_id: "private-creator" },
      { id: "co-loop-blocked", author_id: "blocked-creator" },
      { id: "co-loop-public", author_id: "public-creator" },
    ]
    const visibleCoLoops = await filterPrivateContent(supabase, coLoopRows, viewer, follows)

    expect(visibleDuels.map((row) => row.id)).toEqual(["duel-public"])
    expect(visibleCoLoops.map((row) => row.id)).toEqual(["co-loop-public"])
  })
})
