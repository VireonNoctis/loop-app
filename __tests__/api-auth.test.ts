import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * Route guards, tested at the route.
 *
 * The suite had no route-level tests: the middleware layer that decides who may
 * call what had zero coverage, which is the layer where a mistake leaks other
 * people's data rather than merely looking wrong.
 *
 * Two things are asserted for every gated route — the status code, and that an
 * unauthorised request never constructs a database client. The second is what
 * catches a guard that still runs, but runs *after* the query.
 */

let dbTouched = false

const getUserFromRequest = vi.fn(async (..._args: unknown[]): Promise<any> => null)

const createServerClient = vi.fn((..._args: unknown[]): any => {
  dbTouched = true
  throw new Error("database reached for an unauthorised request")
})
const checkBlockStatus = vi.fn(async (
  _supabase: unknown,
  _userId: string,
  _otherUserId: string,
): Promise<{ blocked: boolean; direction: "by_me" | "by_them" | null }> => ({
  blocked: false,
  direction: null,
}))

vi.mock("@/lib/server-auth", () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequest(...args),
}))

vi.mock("@/lib/supabase", () => ({
  createServerClient: (...args: unknown[]) => createServerClient(...args),
  createClient: (...args: unknown[]) => createServerClient(...args),
}))
vi.mock("@/lib/user-blocks", () => ({
  checkBlockStatus,
}))

/**
 * Chainable Supabase stub.
 *
 * `maybeSingle`/`single` answer the profile lookups the guards make; awaiting
 * the chain itself answers list queries with the supplied rows.
 */
function supabaseStub(options: { profile?: unknown; rows?: unknown[] } = {}) {
  const builder: Record<string, unknown> = {}
  for (const method of [
    "from", "select", "eq", "neq", "in", "is", "or", "filter",
    "order", "limit", "range", "update", "insert", "delete", "upsert",
  ]) {
    builder[method] = () => builder
  }
  builder.maybeSingle = async () => ({ data: options.profile ?? null, error: null })
  builder.single = async () => ({ data: options.profile ?? null, error: null })
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: options.rows ?? [], error: null, count: 0 }).then(resolve)
  return builder
}

const ADMIN_ROUTES = [
  { name: "audit-log", module: () => import("@/app/api/admin/audit-log/route") },
  { name: "cache", module: () => import("@/app/api/admin/cache/route") },
]

function get(url: string) {
  return new NextRequest(url, { method: "GET" })
}

beforeEach(() => {
  dbTouched = false
  getUserFromRequest.mockReset()
  createServerClient.mockClear()
  checkBlockStatus.mockReset()
  checkBlockStatus.mockResolvedValue({ blocked: false, direction: null })
})

describe("admin routes reject unauthenticated callers", () => {
  for (const route of ADMIN_ROUTES) {
    it(`${route.name}: 401 before touching the database`, async () => {
      getUserFromRequest.mockResolvedValue(null)

      const response = await (await route.module()).GET(get(`https://loopapp.me/api/admin/${route.name}`))

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: "Unauthorized" })
      expect(dbTouched).toBe(false)
    })
  }
})

describe("admin routes reject signed-in non-admins", () => {
  for (const route of ADMIN_ROUTES) {
    it(`${route.name}: 403 for a normal account`, async () => {
      getUserFromRequest.mockResolvedValue({ id: "user-1", email: "someone@example.com" })
      createServerClient.mockImplementation(() => supabaseStub({ profile: { is_admin: false } }) as never)

      const response = await (await route.module()).GET(get(`https://loopapp.me/api/admin/${route.name}`))

      expect(response.status).toBe(403)
      expect((await response.json()).error).toBeTruthy()
    })
  }
})

describe("the public settings read stays public but stops over-sharing", () => {
  const ROWS = [
    { setting_key: "maintenance_mode", setting_value: { enabled: true } },
    { setting_key: "app_logo", setting_value: { logo_url: "/icons/icon.svg" } },
    // Not in DEFAULTS — this is the class of row that used to leak.
    { setting_key: "economy", setting_value: { coin_value: 0.0042, payout_key: "internal" } },
  ]

  it("serves guests the maintenance and branding keys", async () => {
    getUserFromRequest.mockResolvedValue(null)
    createServerClient.mockImplementation(() => supabaseStub({ rows: ROWS }) as never)

    const response = await (await import("@/app/api/admin/settings/route")).GET(
      get("https://loopapp.me/api/admin/settings"),
    )

    // The maintenance gate, the logo and the shop banner all read this before
    // anyone signs in, so it must stay reachable without a session.
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.settings.maintenance_mode.enabled).toBe(true)
    expect(body.settings.app_logo.logo_url).toBe("/icons/icon.svg")
  })

  it("does not leak non-public settings rows to guests", async () => {
    getUserFromRequest.mockResolvedValue(null)
    createServerClient.mockImplementation(() => supabaseStub({ rows: ROWS }) as never)

    const response = await (await import("@/app/api/admin/settings/route")).GET(
      get("https://loopapp.me/api/admin/settings"),
    )

    const body = await response.json()
    expect(body.settings.economy).toBeUndefined()
    expect(body.data.economy).toBeUndefined()
  })

  it("still gives an admin the full read", async () => {
    getUserFromRequest.mockResolvedValue({ id: "admin-1" })
    createServerClient.mockImplementation(
      () => supabaseStub({ profile: { is_admin: true }, rows: ROWS }) as never,
    )

    const response = await (await import("@/app/api/admin/settings/route")).GET(
      get("https://loopapp.me/api/admin/settings"),
    )

    const body = await response.json()
    expect(body.settings.economy).toBeDefined()
  })
})

describe("message routes that must never be anonymous", () => {
  it("marking a conversation read requires a session", async () => {
    getUserFromRequest.mockResolvedValue(null)
    const { POST } = await import("@/app/api/messages/unread-count/route")

    const response = await POST(
      new NextRequest("https://loopapp.me/api/messages/unread-count", {
        method: "POST",
        body: JSON.stringify({ conversation_id: "conv-1" }),
      }),
    )

    expect(response.status).toBe(401)
    expect(dbTouched).toBe(false)
  })
})


function conversationAccessStub() {
  let currentTable = ""
  const writes: string[] = []
  const builder: Record<string, any> = {}
  builder.from = (table: string) => {
    currentTable = table
    return builder
  }
  for (const method of [
    "select", "eq", "neq", "in", "is", "or", "filter",
    "order", "limit", "range",
  ]) {
    builder[method] = () => builder
  }
  builder.update = () => {
    writes.push(currentTable)
    return builder
  }
  builder.insert = () => {
    writes.push(currentTable)
    return builder
  }
  builder.upsert = () => {
    writes.push(currentTable)
    return builder
  }
  builder.delete = () => {
    writes.push(currentTable)
    return builder
  }
  builder.maybeSingle = async () => ({
    data: currentTable === "messages"
      ? { id: "message-1", conversation_id: "conversation-1", reactions: [] }
      : null,
    error: null,
  })
  builder.single = builder.maybeSingle
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(resolve)
  return { client: builder, writes }
}

describe("message routes require active conversation membership", () => {
  beforeEach(() => {
    getUserFromRequest.mockResolvedValue({ id: "user-1", email: "member@example.com" })
  })

  it("does not reveal reactions to someone outside the conversation", async () => {
    const stub = conversationAccessStub()
    createServerClient.mockImplementation(() => stub.client as never)
    const { GET } = await import("@/app/api/messages/reactions/route")

    const response = await GET(get("https://loopapp.me/api/messages/reactions?message_id=message-1"))

    expect(response.status).toBe(403)
    expect(stub.writes).toEqual([])
  })

  it("does not let a non-member add or remove reactions", async () => {
    const stub = conversationAccessStub()
    createServerClient.mockImplementation(() => stub.client as never)
    const { POST } = await import("@/app/api/messages/reactions/route")

    const response = await POST(
      new NextRequest("https://loopapp.me/api/messages/reactions", {
        method: "POST",
        body: JSON.stringify({ message_id: "message-1", emoji: "👍" }),
      }),
    )

    expect(response.status).toBe(403)
    expect(stub.writes).toEqual([])
  })

  it("does not mark a conversation read for a non-member", async () => {
    const stub = conversationAccessStub()
    createServerClient.mockImplementation(() => stub.client as never)
    const { POST } = await import("@/app/api/messages/unread-count/route")

    const response = await POST(
      new NextRequest("https://loopapp.me/api/messages/unread-count", {
        method: "POST",
        body: JSON.stringify({ conversation_id: "conversation-1" }),
      }),
    )

    expect(response.status).toBe(403)
    expect(stub.writes).toEqual([])
  })
})


describe("one-to-one conversations reject group management routes", () => {
  beforeEach(() => {
    getUserFromRequest.mockResolvedValue({ id: "owner-1", email: "owner@example.com" })
    createServerClient.mockImplementation(
      () => supabaseStub({ profile: { role: "owner", is_group: false } }) as never,
    )
  })

  it("does not apply group settings to a direct conversation", async () => {
    const { PATCH } = await import("@/app/api/conversations/[id]/group/route")
    const response = await PATCH(
      new NextRequest("https://loopapp.me/api/conversations/dm-1/group", {
        method: "PATCH",
        body: JSON.stringify({ name: "Unexpected group rename" }),
      }),
      { params: Promise.resolve({ id: "dm-1" }) },
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("Not a group")
  })

  it("does not allow direct-message members to promote other participants", async () => {
    const { PATCH } = await import("@/app/api/conversations/[id]/group/members/route")
    const response = await PATCH(
      new NextRequest("https://loopapp.me/api/conversations/dm-1/group/members", {
        method: "PATCH",
        body: JSON.stringify({ user_id: "other-1", role: "admin" }),
      }),
      { params: Promise.resolve({ id: "dm-1" }) },
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("Not a group")
  })

  it("does not allow direct-message members to remove or leave through group management", async () => {
    const { DELETE } = await import("@/app/api/conversations/[id]/group/members/route")
    const response = await DELETE(
      new NextRequest("https://loopapp.me/api/conversations/dm-1/group/members", {
        method: "DELETE",
        body: JSON.stringify({ user_id: "other-1" }),
      }),
      { params: Promise.resolve({ id: "dm-1" }) },
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("Not a group")
  })

  it("keeps member-addition scoped to actual groups", async () => {
    const { POST } = await import("@/app/api/conversations/[id]/group/members/route")
    const response = await POST(
      new NextRequest("https://loopapp.me/api/conversations/dm-1/group/members", {
        method: "POST",
        body: JSON.stringify({ user_ids: ["third-1"] }),
      }),
      { params: Promise.resolve({ id: "dm-1" }) },
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("Not a group")
  })
})
function followRequestActionStub() {
  let currentTable = ""
  const writes: string[] = []
  const builder: Record<string, any> = {}
  builder.from = (table: string) => {
    currentTable = table
    return builder
  }
  for (const method of ["select", "eq", "neq", "in", "is", "or", "order", "limit"]) {
    builder[method] = () => builder
  }
  for (const method of ["insert", "update", "delete", "upsert"]) {
    builder[method] = () => {
      writes.push(method + ":" + currentTable)
      return builder
    }
  }
  builder.maybeSingle = async () => ({
    data: currentTable === "follow_requests"
      ? {
          id: "request-1",
          requester_id: "requester-1",
          target_id: "target-1",
          status: "pending",
        }
      : null,
    error: null,
  })
  builder.single = builder.maybeSingle
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(resolve)
  return { client: builder, writes }
}

describe("follow request privacy and lifecycle", () => {
  it("does not approve a request when either account has blocked the other", async () => {
    getUserFromRequest.mockResolvedValue({ id: "target-1", email: "target@example.com" })
    checkBlockStatus.mockResolvedValue({ blocked: true, direction: "by_them" })
    const stub = followRequestActionStub()
    createServerClient.mockImplementation(() => stub.client as never)
    const { POST } = await import("@/app/api/users/follow-requests/route")

    const response = await POST(
      new NextRequest("https://loopapp.me/api/users/follow-requests", {
        method: "POST",
        body: JSON.stringify({ request_id: "request-1", action: "accept" }),
      }),
    )

    expect(response.status).toBe(403)
    expect(stub.writes).toEqual([])
  })

  it("lets a requester withdraw only their own pending request", async () => {
    getUserFromRequest.mockResolvedValue({ id: "requester-1", email: "requester@example.com" })
    const stub = followRequestActionStub()
    createServerClient.mockImplementation(() => stub.client as never)
    const { POST } = await import("@/app/api/users/follow-requests/route")

    const response = await POST(
      new NextRequest("https://loopapp.me/api/users/follow-requests", {
        method: "POST",
        body: JSON.stringify({ request_id: "request-1", action: "withdraw" }),
      }),
    )

    expect(response.status).toBe(200)
    expect(stub.writes).toEqual(["delete:follow_requests"])
  })
})
