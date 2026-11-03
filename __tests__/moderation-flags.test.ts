import { describe, expect, it } from "vitest"
import { parseContentFlagReview, parseContentFlagSubmission } from "@/lib/moderation-flags"

const id = "11111111-1111-4111-8111-111111111111"

describe("parseContentFlagSubmission", () => {
  it("normalizes a supported report", () => {
    expect(parseContentFlagSubmission({
      content_type: "profile", content_id: id, flag_type: "harassment", description: "  Review this. ",
    })).toEqual({
      ok: true,
      value: { contentType: "profile", contentId: id, flagType: "harassment", description: "Review this." },
    })
  })
  it("rejects unknown types, reasons, malformed identifiers and non-object bodies", () => {
    expect(parseContentFlagSubmission({ content_type: "table", content_id: id, flag_type: "spam" })).toMatchObject({ ok: false })
    expect(parseContentFlagSubmission({ content_type: "profile", content_id: "not-an-id", flag_type: "spam" })).toMatchObject({ ok: false })
    expect(parseContentFlagSubmission({ content_type: "profile", content_id: id, flag_type: "make-admin" })).toMatchObject({ ok: false })
    expect(parseContentFlagSubmission(null)).toMatchObject({ ok: false })
  })
  it("bounds details and rejects non-text", () => {
    expect(parseContentFlagSubmission({ content_type: "comment", content_id: id, flag_type: "spam", description: "x".repeat(1001) })).toMatchObject({ ok: false })
    expect(parseContentFlagSubmission({ content_type: "comment", content_id: id, flag_type: "spam", description: 42 })).toMatchObject({ ok: false })
  })
})

describe("parseContentFlagReview", () => {
  it("supports an ordinary review or dismissal without a false warning action", () => {
    expect(parseContentFlagReview({ status: "reviewed" }, "comment")).toMatchObject({ ok: true, value: { status: "reviewed", actionTaken: "none", moderatorNotes: null } })
    expect(parseContentFlagReview({ status: "dismissed", action_taken: "none" }, "comment").ok).toBe(true)
  })
  it("restricts account suspension to profile reports with a reason", () => {
    expect(parseContentFlagReview({ status: "resolved", action_taken: "user_suspended", moderator_notes: "Reason" }, "loop")).toMatchObject({ ok: false })
    expect(parseContentFlagReview({ status: "resolved", action_taken: "user_suspended" }, "profile")).toMatchObject({ ok: false })
    expect(parseContentFlagReview({ status: "resolved", action_taken: "user_suspended", moderator_notes: "Policy reason" }, "profile").ok).toBe(true)
  })
  it("rejects unsupported states and oversized notes", () => {
    expect(parseContentFlagReview({ status: "resolved" }, "profile")).toMatchObject({ ok: false })
    expect(parseContentFlagReview({ status: "dismissed", action_taken: "warning" }, "profile")).toMatchObject({ ok: false })
    expect(parseContentFlagReview({ status: "reviewed", moderator_notes: "x".repeat(1001) }, "comment")).toMatchObject({ ok: false })
  })
})
