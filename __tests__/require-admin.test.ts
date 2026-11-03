import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  getSession: vi.fn(),
  query: vi.fn(),
  createServerClient: vi.fn(),
  profile: null as null | { is_admin?: boolean; is_moderator?: boolean; staff_role?: string | null },
}))

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => state.getSession(...args),
    },
  },
  authDbPool: {
    query: (...args: unknown[]) => state.query(...args),
  },
}))

vi.mock("@/lib/supabase", () => ({
  createServerClient: (...args: unknown[]) => state.createServerClient(...args),
}))

function request() {
  return new NextRequest("https://loopapp.me/api/admin/example")
}

function configureProfile(profile: typeof state.profile) {
  state.profile = profile
  state.createServerClient.mockImplementation(() => {
    let selected = ""
    const builder: Record<string, any> = {}
    builder.from = () => builder
    builder.select = (columns: string) => {
      selected = columns
      return builder
    }
    builder.eq = () => builder
    builder.maybeSingle = async () => {
      if (selected === "username") {
        return { data: { username: "member" }, error: null }
      }
      return { data: state.profile, error: null }
    }
    return builder
  })
}

beforeEach(() => {
  vi.resetModules()
  state.getSession.mockReset()
  state.query.mockReset()
  state.createServerClient.mockReset()
  state.getSession.mockResolvedValue({
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "member-admin@attacker.example",
      name: "Member",
    },
  })
  configureProfile({ is_admin: false, is_moderator: false })
})

describe("requireAdmin", () => {
  it("does not infer administrator privileges from an email address", async () => {
    const { requireAdmin } = await import("@/lib/server-auth")

    const result = await requireAdmin(request())

    expect(result.response?.status).toBe(403)
    expect(await result.response?.json()).toEqual({ error: "Admin access required" })
  })

  it("does not treat a moderator role as an administrator role", async () => {
    configureProfile({ is_admin: false, is_moderator: true })
    const { requireAdmin } = await import("@/lib/server-auth")

    const result = await requireAdmin(request())

    expect(result.response?.status).toBe(403)
  })

  it("allows an explicitly flagged profile administrator", async () => {
    configureProfile({ is_admin: true, is_moderator: false })
    const { requireAdmin } = await import("@/lib/server-auth")

    const result = await requireAdmin(request())

    expect(result.response).toBeNull()
    expect(result.profile?.is_admin).toBe(true)
  })

  it("allows an explicitly assigned Admin role", async () => {
    configureProfile({ is_admin: true, is_moderator: false, staff_role: "admin" })
    const { requireAdmin } = await import("@/lib/server-auth")
    const result = await requireAdmin(request())
    expect(result.response).toBeNull()
    expect(result.profile?.staff_role).toBe("admin")
  })

  it("preserves explicit Developer role resolution", async () => {
    configureProfile({ is_admin: true, is_moderator: false, staff_role: "developer" })
    const { requireAdmin } = await import("@/lib/server-auth")
    const result = await requireAdmin(request())
    expect(result.response).toBeNull()
    expect(result.profile?.staff_role).toBe("developer")
  })

  it("fails closed when no profile role can be loaded", async () => {
    configureProfile(null)
    const { requireAdmin } = await import("@/lib/server-auth")

    const result = await requireAdmin(request())

    expect(result.response?.status).toBe(403)
  })
})
