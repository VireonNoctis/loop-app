import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createClient: state.createClient }))

import { communityClient } from "@/lib/community-engine"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://loop.example.supabase.co")
  vi.stubEnv("SUPABASE_URL", "")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key")
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
})

describe("community server client", () => {
  it("never falls back to the public anon key for privileged community operations", () => {
    expect(() => communityClient()).toThrow("SUPABASE_SERVICE_ROLE_KEY")
    expect(state.createClient).not.toHaveBeenCalled()
  })

  it("uses only the configured service role key", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    communityClient()
    expect(state.createClient).toHaveBeenCalledWith(
      "https://loop.example.supabase.co",
      "service-role-key",
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
  })
})
