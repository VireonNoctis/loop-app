const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface VerificationAppealSubmission {
  reason: string
  evidenceUrl: string | null
}

export interface VerificationAppealReview {
  appealId: string
  action: "accepted" | "rejected"
  rejectionReason: string | null
  adminNotes: string | null
}

export type VerificationAppealSubmissionResult =
  | { ok: true; value: VerificationAppealSubmission }
  | { ok: false; error: string }

export type VerificationAppealReviewResult =
  | { ok: true; value: VerificationAppealReview }
  | { ok: false; error: string }

function optionalHttpsUrl(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null }
  if (typeof value !== "string") return { ok: false, error: "Evidence link must be text" }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  if (trimmed.length > 2048) return { ok: false, error: "Evidence link must be 2048 characters or fewer" }
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
      return { ok: false, error: "Evidence links must use a valid HTTPS URL" }
    }
    return { ok: true, value: url.toString() }
  } catch {
    return { ok: false, error: "Evidence links must use a valid HTTPS URL" }
  }
}

export function parseVerificationAppeal(input: unknown): VerificationAppealSubmissionResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be an object" }
  }
  const body = input as Record<string, unknown>
  if (typeof body.reason !== "string") {
    return { ok: false, error: "An appeal reason is required" }
  }
  const reason = body.reason.trim()
  if (reason.length < 20) return { ok: false, error: "Explain why the decision should be reconsidered (at least 20 characters)" }
  if (reason.length > 2000) return { ok: false, error: "Appeal reason must be 2000 characters or fewer" }
  const evidence = optionalHttpsUrl(body.evidenceUrl)
  if (!evidence.ok) return evidence
  return { ok: true, value: { reason, evidenceUrl: evidence.value } }
}

function optionalReviewerText(value: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null }
  if (typeof value !== "string") return { ok: false, error: `${label} must be text` }
  const normalized = value.trim()
  if (normalized.length > 2000) return { ok: false, error: `${label} must be 2000 characters or fewer` }
  return { ok: true, value: normalized || null }
}

export function parseVerificationAppealReview(input: unknown): VerificationAppealReviewResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be an object" }
  }
  const body = input as Record<string, unknown>
  if (typeof body.appealId !== "string" || !UUID_PATTERN.test(body.appealId)) {
    return { ok: false, error: "A valid verification appeal ID is required" }
  }
  if (body.action !== "accepted" && body.action !== "rejected") {
    return { ok: false, error: "Action must be accepted or rejected" }
  }
  const notes = optionalReviewerText(body.adminNotes, "Reviewer note")
  if (!notes.ok) return notes
  const rejection = optionalReviewerText(body.rejectionReason, "Rejection reason")
  if (!rejection.ok) return rejection
  if (body.action === "rejected" && (!rejection.value || rejection.value.length < 10)) {
    return { ok: false, error: "A user-facing rejection reason of at least 10 characters is required" }
  }
  return {
    ok: true,
    value: {
      appealId: body.appealId,
      action: body.action,
      rejectionReason: rejection.value,
      adminNotes: notes.value,
    },
  }
}
