import { describe, expect, it } from "vitest"
import { canViewCommunitySpace } from "@/lib/community-space-access"

describe("canViewCommunitySpace", () => {
  it("allows guests to view only public spaces", () => {
    expect(canViewCommunitySpace("public", false, false)).toBe(true)
    expect(canViewCommunitySpace("members", false, false)).toBe(false)
    expect(canViewCommunitySpace("mods", false, false)).toBe(false)
  })

  it("allows members to view public and member spaces, but not moderator spaces", () => {
    expect(canViewCommunitySpace("public", true, false)).toBe(true)
    expect(canViewCommunitySpace("members", true, false)).toBe(true)
    expect(canViewCommunitySpace("mods", true, false)).toBe(false)
  })

  it("allows moderators to view all supported spaces and fails closed on unknown values", () => {
    expect(canViewCommunitySpace("public", true, true)).toBe(true)
    expect(canViewCommunitySpace("members", true, true)).toBe(true)
    expect(canViewCommunitySpace("mods", true, true)).toBe(true)
    expect(canViewCommunitySpace("everyone", true, true)).toBe(false)
  })
})
