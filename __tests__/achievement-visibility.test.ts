import { describe, expect, it } from "vitest"
import { canViewAchievementStats } from "@/lib/achievement-visibility"

const base = {
  viewerId: "viewer" as string | null,
  targetId: "target",
  profileActive: true,
  blocked: false,
  restricted: false,
  isApprovedFollower: false,
}

describe("achievement stats visibility", () => {
  it("allows users to read their own achievements", () => {
    expect(canViewAchievementStats({ ...base, viewerId: "target", restricted: true })).toBe(true)
  })
  it("allows guests and signed-in viewers to read public profiles", () => {
    expect(canViewAchievementStats(base)).toBe(true)
    expect(canViewAchievementStats({ ...base, viewerId: null })).toBe(true)
  })
  it("allows only approved followers to read restricted profiles", () => {
    expect(canViewAchievementStats({ ...base, restricted: true })).toBe(false)
    expect(canViewAchievementStats({ ...base, viewerId: null, restricted: true, isApprovedFollower: true })).toBe(false)
    expect(canViewAchievementStats({ ...base, restricted: true, isApprovedFollower: true })).toBe(true)
  })
  it("hides inactive or blocked accounts", () => {
    expect(canViewAchievementStats({ ...base, profileActive: false })).toBe(false)
    expect(canViewAchievementStats({ ...base, blocked: true })).toBe(false)
  })
})
