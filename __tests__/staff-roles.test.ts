import { describe, expect, it } from "vitest"
import { canAccessAdminSection, resolveStaffRole } from "@/lib/staff-roles"

describe("staff role resolution", () => {
  it("prefers an explicit staff role over legacy boolean flags", () => {
    expect(resolveStaffRole({ staff_role: "moderator", is_admin: true })).toBe("moderator")
  })
  it("preserves legacy administrator access as Developer during migration", () => {
    expect(resolveStaffRole({ is_admin: true })).toBe("developer")
  })
  it("maps legacy moderators to the Moderator role", () => {
    expect(resolveStaffRole({ is_moderator: true })).toBe("moderator")
  })
  it("fails closed for a regular user profile", () => {
    expect(resolveStaffRole({ is_admin: false, is_moderator: false })).toBeNull()
  })
})

describe("role-scoped dashboard navigation", () => {
  it("limits Moderators to moderation and access controls", () => {
    expect(canAccessAdminSection("moderator", "moderation")).toBe(true)
    expect(canAccessAdminSection("moderator", "team")).toBe(true)
    expect(canAccessAdminSection("moderator", "support")).toBe(true)
    expect(canAccessAdminSection("moderator", "appeals")).toBe(true)
    expect(canAccessAdminSection("moderator", "monetization")).toBe(false)
  })
  it("allows Developer and Admin to access every section", () => {
    expect(canAccessAdminSection("developer", "health")).toBe(true)
    expect(canAccessAdminSection("admin", "users")).toBe(true)
  })
})
