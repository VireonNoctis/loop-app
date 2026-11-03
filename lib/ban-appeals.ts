const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface BanAppealReview {
  appealId: string
  decision: "approve" | "deny"
  adminNotes: string | null
}

export type BanAppealReviewResult =
  | { ok: true; value: BanAppealReview }
  | { ok: false; error: string }

export function parseBanAppealReview(input: unknown): BanAppealReviewResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be an object" }
  }

  const body = input as Record<string, unknown>
  if (typeof body.appeal_id !== "string" || !UUID_PATTERN.test(body.appeal_id)) {
    return { ok: false, error: "A valid appeal ID is required" }
  }
  if (body.decision !== "approve" && body.decision !== "deny") {
    return { ok: false, error: "Decision must be approve or deny" }
  }

  let adminNotes: string | null = null
  if (body.admin_notes !== undefined && body.admin_notes !== null) {
    if (typeof body.admin_notes !== "string") return { ok: false, error: "Reviewer note must be text" }
    adminNotes = body.admin_notes.trim() || null
    if (adminNotes && adminNotes.length > 2000) {
      return { ok: false, error: "Reviewer note must be 2000 characters or fewer" }
    }
  }
  if (body.decision === "deny" && !adminNotes) {
    return { ok: false, error: "A reason is required when denying an appeal" }
  }

  return {
    ok: true,
    value: {
      appealId: body.appeal_id,
      decision: body.decision,
      adminNotes,
    },
  }
}

export type BanAppealSubmissionResult =
  | { ok: true; value: { reason: string } }
  | { ok: false; error: string }

export function parseBanAppealSubmission(input: unknown): BanAppealSubmissionResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be an object" }
  }
  const reason = (input as Record<string, unknown>).reason
  if (typeof reason !== "string") return { ok: false, error: "Appeal reason must be text" }
  const normalized = reason.trim()
  if (!normalized) return { ok: false, error: "Appeal reason is required" }
  if (normalized.length > 2000) return { ok: false, error: "Appeal reason must be 2000 characters or fewer" }
  return { ok: true, value: { reason: normalized } }
}
