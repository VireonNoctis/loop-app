import { describe, expect, it } from "vitest"
import { parseVerificationAppeal, parseVerificationAppealReview } from "@/lib/verification-appeal"

const appealId = "11111111-1111-4111-8111-111111111111"

describe("verification appeal parsing", () => {
  it("normalizes a valid appeal and an optional HTTPS evidence URL", () => {
    expect(parseVerificationAppeal({
      reason: "The original application missed the official page linked here.",
      evidenceUrl: "https://example.com/official-profile",
    })).toEqual({
      ok: true,
      value: {
        reason: "The original application missed the official page linked here.",
        evidenceUrl: "https://example.com/official-profile",
      },
    })
  })

  it("rejects short, oversized and non-text appeal reasons", () => {
    expect(parseVerificationAppeal({ reason: "too short" }).ok).toBe(false)
    expect(parseVerificationAppeal({ reason: "x".repeat(2001) }).ok).toBe(false)
    expect(parseVerificationAppeal({ reason: 123 }).ok).toBe(false)
    expect(parseVerificationAppeal(null).ok).toBe(false)
  })

  it("accepts only safe HTTPS evidence URLs", () => {
    for (const evidenceUrl of [
      "http://example.com",
      "https://user:password@example.com",
      "javascript:alert(1)",
      "not a URL",
    ]) {
      expect(parseVerificationAppeal({
        reason: "Please reconsider the decision with the linked public evidence.",
        evidenceUrl,
      }).ok).toBe(false)
    }
  })

  it("validates appeal review identity, action and user-facing rejection reason", () => {
    expect(parseVerificationAppealReview({ appealId, action: "accepted" })).toMatchObject({ ok: true })
    expect(parseVerificationAppealReview({ appealId, action: "rejected" }).ok).toBe(false)
    expect(parseVerificationAppealReview({ appealId: "bad", action: "accepted" }).ok).toBe(false)
    expect(parseVerificationAppealReview({
      appealId,
      action: "rejected",
      rejectionReason: "The appeal does not change the original outcome.",
    })).toMatchObject({ ok: true })
  })
})
