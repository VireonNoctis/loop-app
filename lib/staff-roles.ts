export const STAFF_ROLES = ["developer", "admin", "moderator"] as const

export type StaffRole = (typeof STAFF_ROLES)[number]
export type DashboardRole = StaffRole | "user"

export function resolveStaffRole(profile: {
  staff_role?: unknown
  is_admin?: unknown
  is_moderator?: unknown
} | null | undefined): StaffRole | null {
  if (!profile) return null
  if (profile.staff_role === "developer" || profile.staff_role === "admin" || profile.staff_role === "moderator") {
    return profile.staff_role
  }
  // Legacy administrators remain Developer-level until explicitly reassigned.
  if (profile.is_admin === true) return "developer"
  if (profile.is_moderator === true) return "moderator"
  return null
}

export function canAccessAdminSection(role: StaffRole | null, section: string): boolean {
  if (role === "developer" || role === "admin") return true
  return role === "moderator" && (section === "moderation" || section === "support" || section === "appeals" || section === "team")
}
