export const VERIFICATION_TYPES = ["creator", "business", "public_figure", "nonprofit"] as const

export type VerificationType = (typeof VERIFICATION_TYPES)[number]

export interface VerificationSubmission {
  realName: string
  socialLinks: string | null
  reason: string
  verificationType: VerificationType
  documentsUrl: string | null
}

export type VerificationSubmissionResult =
  | { ok: true; value: VerificationSubmission }
  | { ok: false; error: string }

function optionalText(
  value: unknown,
  label: string,
  maxLength: number,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null }
  }
  if (typeof value !== "string") {
    return { ok: false, error: `${label} must be text` }
  }
  const normalized = value.trim()
  if (!normalized) return { ok: true, value: null }
  if (normalized.length > maxLength) {
    return { ok: false, error: `${label} must be ${maxLength} characters or fewer` }
  }
  return { ok: true, value: normalized }
}

export function parseVerificationSubmission(input: unknown): VerificationSubmissionResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be an object" }
  }

  const body = input as Record<string, unknown>
  const realName = optionalText(body.realName, "Real name", 160)
  if (!realName.ok || !realName.value) {
    return { ok: false, error: realName.ok ? "Real name is required" : realName.error }
  }

  const reason = optionalText(body.reason, "Reason", 2000)
  if (!reason.ok || !reason.value) {
    return { ok: false, error: reason.ok ? "A reason is required" : reason.error }
  }

  if (
    typeof body.verificationType !== "string" ||
    !VERIFICATION_TYPES.includes(body.verificationType as VerificationType)
  ) {
    return { ok: false, error: "Choose a valid verification type" }
  }

  const socialLinks = optionalText(body.socialLinks, "Social links", 2000)
  if (!socialLinks.ok) return socialLinks

  const documents = optionalText(body.documents, "Supporting link", 2048)
  if (!documents.ok) return documents
  let documentsUrl: string | null = null
  if (documents.value) {
    try {
      const url = new URL(documents.value)
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
        return { ok: false, error: "Supporting links must use a valid HTTPS URL" }
      }
      documentsUrl = url.toString()
    } catch {
      return { ok: false, error: "Supporting links must use a valid HTTPS URL" }
    }
  }

  return {
    ok: true,
    value: {
      realName: realName.value,
      socialLinks: socialLinks.value,
      reason: reason.value,
      verificationType: body.verificationType as VerificationType,
      documentsUrl,
    },
  }
}
