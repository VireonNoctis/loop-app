import { describe, expect, it } from "vitest"
import { parseVerificationReview } from "@/lib/verification-review"

const requestId = "11111111-1111-4111-8111-111111111111"

describe("parseVerificationReview", () => {
  it("accepts approval without a reviewer note", () => {
    expect(parseVerificationReview({ requestId, action: "approved" })).toEqual({
      ok: true,
      value: { requestId, action: "approved", adminNotes: null },
    })
  })

  it("requires a clear reason for rejection", () => {
    expect(parseVerificationReview({ requestId, action: "rejected" })).toMatchObject({ ok: false })
    expect(parseVerificationReview({ requestId, action: "rejected", adminNotes: "  " })).toMatchObject({ ok: false })
    expect(parseVerificationReview({ requestId, action: "rejected", adminNotes: "Not enough evidence" })).toEqual({
      ok: true,
      value: { requestId, action: "rejected", adminNotes: "Not enough evidence" },
    })
  })

  it("rejects malformed identifiers and unknown states", () => {
    expect(parseVerificationReview({ requestId: "request-1", action: "approved" })).toMatchObject({ ok: false })
    expect(parseVerificationReview({ requestId, action: "pending" })).toMatchObject({ ok: false })
    expect(parseVerificationReview(null)).toMatchObject({ ok: false })
    expect(parseVerificationReview([])).toMatchObject({ ok: false })
  })

  it("bounds reviewer notes and rejects non-text values", () => {
    expect(parseVerificationReview({ requestId, action: "approved", adminNotes: "x".repeat(2001) })).toMatchObject({ ok: false })
    expect(parseVerificationReview({ requestId, action: "approved", adminNotes: 123 })).toMatchObject({ ok: false })
  })
})
