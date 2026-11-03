const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface VerificationReview {
  requestId: string
  action: "approved" | "rejected"
  adminNotes: string | null
}

export type VerificationReviewResult =
  | { ok: true; value: VerificationReview }
  | { ok: false; error: string }

export function parseVerificationReview(input: unknown): VerificationReviewResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be an object" }
  }

  const body = input as Record<string, unknown>
  if (typeof body.requestId !== "string" || !UUID_PATTERN.test(body.requestId)) {
    return { ok: false, error: "A valid verification request ID is required" }
  }
  if (body.action !== "approved" && body.action !== "rejected") {
    return { ok: false, error: "Action must be approved or rejected" }
  }

  let adminNotes: string | null = null
  if (body.adminNotes !== undefined && body.adminNotes !== null) {
    if (typeof body.adminNotes !== "string") {
      return { ok: false, error: "Reviewer note must be text" }
    }
    adminNotes = body.adminNotes.trim() || null
    if (adminNotes && adminNotes.length > 2000) {
      return { ok: false, error: "Reviewer note must be 2000 characters or fewer" }
    }
  }
  if (body.action === "rejected" && !adminNotes) {
    return { ok: false, error: "A rejection reason is required" }
  }

  return {
    ok: true,
    value: {
      requestId: body.requestId,
      action: body.action,
      adminNotes,
    },
  }
}
