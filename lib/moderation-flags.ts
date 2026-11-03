export const REPORTABLE_CONTENT_TYPES = ["loop", "comment", "message", "profile", "circle_post", "reel", "reels", "moment"] as const
export const CONTENT_FLAG_REASONS = ["spam", "harassment", "inappropriate", "misinformation", "copyright", "other", "hate_speech", "violence", "nudity", "self_harm"] as const

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }
export type ReportableContentType = (typeof REPORTABLE_CONTENT_TYPES)[number]
export type ContentFlagReason = (typeof CONTENT_FLAG_REASONS)[number]

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

export function parseContentFlagSubmission(input: unknown): ParseResult<{
  contentType: ReportableContentType
  contentId: string
  flagType: ContentFlagReason
  description: string
}> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be an object" }
  }
  const body = input as Record<string, unknown>
  if (typeof body.content_type !== "string" || !REPORTABLE_CONTENT_TYPES.includes(body.content_type as ReportableContentType)) {
    return { ok: false, error: "Choose a supported content type" }
  }
  if (!isUuid(body.content_id)) return { ok: false, error: "A valid content ID is required" }
  if (typeof body.flag_type !== "string" || !CONTENT_FLAG_REASONS.includes(body.flag_type as ContentFlagReason)) {
    return { ok: false, error: "Choose a valid report reason" }
  }

  let description = ""
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== "string") return { ok: false, error: "Report details must be text" }
    description = body.description.trim()
    if (description.length > 1000) return { ok: false, error: "Report details must be 1000 characters or fewer" }
  }

  return {
    ok: true,
    value: {
      contentType: body.content_type as ReportableContentType,
      contentId: body.content_id,
      flagType: body.flag_type as ContentFlagReason,
      description,
    },
  }
}

export function parseContentFlagReview(
  input: unknown,
  contentType: string,
): ParseResult<{
  status: "reviewed" | "resolved" | "dismissed"
  actionTaken: "none" | "user_suspended"
  moderatorNotes: string | null
}> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Request body must be an object" }
  const body = input as Record<string, unknown>
  const status = body.status
  const actionTaken = body.action_taken ?? "none"
  if (status !== "reviewed" && status !== "resolved" && status !== "dismissed") {
    return { ok: false, error: "Choose a valid review status" }
  }
  if (actionTaken !== "none" && actionTaken !== "user_suspended") {
    return { ok: false, error: "Choose a supported moderation action" }
  }
  if (actionTaken === "user_suspended" && (contentType !== "profile" || status !== "resolved")) {
    return { ok: false, error: "Only a profile report can resolve with an account suspension" }
  }
  if (actionTaken === "none" && status === "resolved") {
    return { ok: false, error: "Resolved reports must record the moderation action taken" }
  }

  let moderatorNotes: string | null = null
  if (body.moderator_notes !== undefined && body.moderator_notes !== null) {
    if (typeof body.moderator_notes !== "string") return { ok: false, error: "Moderator notes must be text" }
    moderatorNotes = body.moderator_notes.trim() || null
    if (moderatorNotes && moderatorNotes.length > 1000) return { ok: false, error: "Moderator notes must be 1000 characters or fewer" }
  }
  if (actionTaken === "user_suspended" && !moderatorNotes) return { ok: false, error: "A suspension reason is required" }

  return { ok: true, value: { status, actionTaken, moderatorNotes } }
}
