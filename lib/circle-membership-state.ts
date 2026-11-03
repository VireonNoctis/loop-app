export type CircleMembershipStatus =
  | "active" | "approved" | "pending" | "banned" | "rejected" | "left"
  | string | null | undefined

export type CircleMembershipAction =
  | { kind: "enter" | "join" | "request-join" | "cancel-request" | "unavailable"; label: string }

export function resolveCircleMembershipAction(
  status: CircleMembershipStatus, isPrivate: boolean, isMember = false,
): CircleMembershipAction {
  if (status === "active" || status === "approved" || isMember) return { kind: "enter", label: "Enter Circle" }
  if (status === "pending") return { kind: "cancel-request", label: "Request pending · Cancel" }
  if (status === "banned") return { kind: "unavailable", label: "Unavailable" }
  return isPrivate
    ? { kind: "request-join", label: "Request to join" }
    : { kind: "join", label: "Join Circle" }
}

export function isPrivateCircleDiscoverable(input: {
  isPrivate: boolean; viewerId: string | null; ownerId?: string | null; membershipStatus?: CircleMembershipStatus
}): boolean {
  if (!input.isPrivate) return true
  if (!input.viewerId) return false
  if (input.viewerId === input.ownerId) return true
  return input.membershipStatus === "active"
    || input.membershipStatus === "approved"
    || input.membershipStatus === "pending"
}


export interface CircleVisibilityFields {
  id: string
  is_private?: boolean | null
  is_premium_only?: boolean | null
  owner_id?: string | null
}

export function isCirclePubliclyDiscoverable(input: {
  isPrivate?: boolean | null
  isPremiumOnly?: boolean | null
}): boolean {
  return input.isPrivate !== true && input.isPremiumOnly !== true
}

/**
 * Apply the same visibility decision after a Circle query as a final
 * server-side safety gate. Pending applicants may see the Circle shell and
 * request status, but not its posts/rooms/member content.
 */
export function filterCirclesForViewer<T extends CircleVisibilityFields>(
  circles: T[] | null | undefined,
  input: {
    viewerId: string | null
    viewerIsPro: boolean
    memberships?: Map<string, { status?: string | null } | undefined>
  },
): T[] {
  return (circles || []).filter((circle) => {
    if (circle.is_premium_only && !input.viewerIsPro) return false
    const membershipStatus = input.memberships?.get(circle.id)?.status
    return isPrivateCircleDiscoverable({
      isPrivate: circle.is_private === true,
      viewerId: input.viewerId,
      ownerId: circle.owner_id,
      membershipStatus,
    })
  })
}
