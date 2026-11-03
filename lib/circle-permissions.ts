/** Centralized Circle role permission helpers */

export type CircleRole = "owner" | "admin" | "moderator" | "member" | "guest"

const rank: Record<CircleRole, number> = {
  owner: 4,
  admin: 3,
  moderator: 2,
  member: 1,
  guest: 0,
}

export function normalizeRole(role?: string | null): CircleRole {
  if (role === "owner" || role === "admin" || role === "moderator" || role === "member") return role
  return "guest"
}

export function canManageCircle(role?: string | null) {
  const r = normalizeRole(role)
  return r === "owner" || r === "admin" || r === "moderator"
}

export function canModerateMembers(role?: string | null) {
  return canManageCircle(role)
}

export function canPromoteMembers(role?: string | null) {
  const r = normalizeRole(role)
  return r === "owner" || r === "admin"
}

export function canEditStudio(role?: string | null) {
  return canPromoteMembers(role)
}

export function canDeleteCircle(role?: string | null) {
  return normalizeRole(role) === "owner"
}

export function canManageRooms(role?: string | null) {
  return canManageCircle(role)
}

export function roleAtLeast(role: string | null | undefined, minimum: CircleRole) {
  return rank[normalizeRole(role)] >= rank[minimum]
}

export const ROLE_PERMISSIONS = [
  { role: "owner", label: "Owner", abilities: ["Everything", "Delete circle", "Transfer ownership", "Ban anyone"] },
  { role: "admin", label: "Admin", abilities: ["Manage rooms", "Approve members", "Promote/demote", "Studio settings"] },
  { role: "moderator", label: "Moderator", abilities: ["Approve joins", "Kick members", "Pin posts", "Moderate chat"] },
  { role: "member", label: "Member", abilities: ["Post", "Comment", "Join rooms", "React"] },
] as const

/** A role hierarchy gate for changing an existing member's base role. */
export function canAssignCircleRole(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined,
  requestedRole: string | null | undefined,
): boolean {
  const actor = normalizeRole(actorRole)
  const target = normalizeRole(targetRole)
  if (!["member", "moderator", "admin"].includes(requestedRole || "")) return false
  if (target === "owner") return false

  if (actor === "owner") return true
  if (actor === "admin") return target === "member" || target === "moderator"
    ? requestedRole === "member" || requestedRole === "moderator"
    : false
  return false
}

/** Moderators may approve members; elevated roles require an admin or owner. */
export function canApproveCircleRole(
  actorRole: string | null | undefined,
  requestedRole: string | null | undefined,
): boolean {
  const actor = normalizeRole(actorRole)
  if (requestedRole === "member") return actor === "owner" || actor === "admin" || actor === "moderator"
  if (requestedRole === "moderator") return actor === "owner" || actor === "admin"
  if (requestedRole === "admin") return actor === "owner"
  return false
}

/** Staff can only remove or ban users below them; Circle ownership is transferred separately. */
export function canRemoveCircleMember(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined,
): boolean {
  const actor = normalizeRole(actorRole)
  const target = normalizeRole(targetRole)
  if (target === "owner") return false
  if (actor === "owner") return target !== "guest"
  if (actor === "admin") return target === "member" || target === "moderator"
  if (actor === "moderator") return target === "member"
  return false
}

/** Owner/admin may maintain member profile labels and explicit permission overrides. */
export function canManageMemberSettings(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined,
): boolean {
  const actor = normalizeRole(actorRole)
  const target = normalizeRole(targetRole)
  if (target === "owner") return false
  return actor === "owner" || (actor === "admin" && (target === "member" || target === "moderator"))
}


/**
 * Circle Studio changes require a current owner/admin membership.
 * Historical roles on pending, rejected, left or banned rows confer no access.
 * The canonical Circle owner remains authorized even without a member row.
 */
export function canEditCircleStudio(
  role: string | null | undefined,
  status: string | null | undefined,
  isOwner = false,
): boolean {
  if (isOwner) return true
  const normalizedStatus = String(status || "").trim().toLowerCase()
  return (normalizedStatus === "active" || normalizedStatus === "approved") && canEditStudio(role)
}
