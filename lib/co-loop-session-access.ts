export interface CoLoopSessionRoster {
  owner_id?: unknown
  co_authors?: unknown
}

export interface CoLoopJoinState extends CoLoopSessionRoster {
  status?: unknown
  locked?: unknown
  deleted_at?: unknown
}

/** True only for the room host or a persisted co-author. */
export function isCoLoopParticipant(session: CoLoopSessionRoster, userId: string): boolean {
  if (!userId) return false
  if (session.owner_id === userId) return true
  if (!Array.isArray(session.co_authors)) return false
  return session.co_authors.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
    return "id" in entry && entry.id === userId
  })
}

export type CoLoopJoinDecision = "allowed" | "deleted" | "inactive" | "locked" | "not_invited"

/** A room can only be entered by its host, an existing participant or a direct invitee. */
export function decideCoLoopJoin(
  session: CoLoopJoinState,
  userId: string,
  hasDirectInvite: boolean,
): CoLoopJoinDecision {
  if (session.deleted_at) return "deleted"
  if (isCoLoopParticipant(session, userId)) return "allowed"
  if (session.status !== undefined && session.status !== null && session.status !== "active") return "inactive"
  if (session.locked === true) return "locked"
  return hasDirectInvite ? "allowed" : "not_invited"
}


/** A declined, revoked or expired invitation is a durable access denial. */
export function isRevokedCoLoopInvitationStatus(status: unknown): boolean {
  return status === "declined" || status === "revoked" || status === "expired"
}

/** Fail closed when the canonical invitation ledger cannot be checked. */
export async function checkCoLoopInvitationRevocation(
  supabase: any,
  sessionId: string,
  userId: string,
): Promise<{ revoked: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from("co_loop_invitations")
    .select("status, expires_at")
    .eq("session_id", sessionId)
    .eq("invitee_id", userId)
    .maybeSingle()

  if (error) return { revoked: false, error: error.message || "Could not verify invitation status" }
  const expiry = typeof data?.expires_at === "string" ? Date.parse(data.expires_at) : Number.NaN
  const pendingExpired = data?.status === "pending" && (!Number.isFinite(expiry) || expiry <= Date.now())
  return {
    revoked: isRevokedCoLoopInvitationStatus(data?.status) || pendingExpired,
    error: null,
  }
}


export type CoLoopInvitationResponseDecision =
  | "allowed"
  | "deleted"
  | "inactive"
  | "locked"
  | "already_accepted"
  | "already_responded"

export interface CoLoopInvitationResponseState extends CoLoopJoinState {}

export function decideCoLoopInvitationResponse(
  session: CoLoopInvitationResponseState,
  invitationStatus: unknown,
  action: "accepted" | "declined",
): CoLoopInvitationResponseDecision {
  if (session.deleted_at) return "deleted"
  if (invitationStatus === "accepted") {
    return action === "accepted" ? "already_accepted" : "already_responded"
  }
  if (invitationStatus !== null && invitationStatus !== undefined && invitationStatus !== "pending") {
    return "already_responded"
  }
  // Declining is still allowed after a room ends or is locked so the recipient
  // can clear their invitation and release a reserved seat.
  if (action === "declined") return "allowed"
  if (session.status !== "active") return "inactive"
  if (session.locked === true) return "locked"
  return "allowed"
}


/** Durable Co-Loop writes stop when the session is completed or deleted. */
export function canWriteCoLoopSession(session: CoLoopJoinState): boolean {
  return !session.deleted_at && session.status === "active"
}
