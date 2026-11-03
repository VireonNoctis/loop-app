import { describe, expect, it } from "vitest"
import { parseVerificationSubmission } from "@/lib/verification-submission"

const validSubmission = {
  realName: "  Example Creator ",
  socialLinks: "https://example.com/about",
  reason: "I represent this creator account and have public work to reference.",
  verificationType: "creator",
  documents: "https://example.com/press",
}

describe("parseVerificationSubmission", () => {
  it("normalizes text and accepts supported verification categories", () => {
    const result = parseVerificationSubmission(validSubmission)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      realName: "Example Creator",
      socialLinks: "https://example.com/about",
      reason: "I represent this creator account and have public work to reference.",
      verificationType: "creator",
      documentsUrl: "https://example.com/press",
    })
  })

  it("rejects malformed bodies and unknown categories", () => {
    expect(parseVerificationSubmission(null).ok).toBe(false)
    expect(parseVerificationSubmission([]).ok).toBe(false)
    expect(parseVerificationSubmission({ ...validSubmission, verificationType: "premium" })).toMatchObject({
      ok: false,
    })
  })

  it("rejects non-HTTPS, credential-bearing and malformed evidence links", () => {
    for (const documents of [
      "http://example.com",
      "javascript:alert(1)",
      "https://user:password@example.com",
      "not a url",
    ]) {
      expect(parseVerificationSubmission({ ...validSubmission, documents }).ok).toBe(false)
    }
  })

  it("rejects oversized personal information and evidence fields", () => {
    expect(parseVerificationSubmission({ ...validSubmission, realName: "x".repeat(161) }).ok).toBe(false)
    expect(parseVerificationSubmission({ ...validSubmission, reason: "x".repeat(2001) }).ok).toBe(false)
    expect(parseVerificationSubmission({ ...validSubmission, socialLinks: "x".repeat(2001) }).ok).toBe(false)
    expect(parseVerificationSubmission({ ...validSubmission, documents: `https://example.com/${"x".repeat(2048)}` }).ok).toBe(false)
  })

  it("does not treat a user-supplied username as part of the submission", () => {
    const result = parseVerificationSubmission({ ...validSubmission, username: "someone-else" })
    expect(result.ok).toBe(true)
    if (result.ok) expect("username" in result.value).toBe(false)
  })
})
