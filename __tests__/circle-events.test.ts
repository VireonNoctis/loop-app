import { describe, expect, it } from "vitest"
import { normalizeCircleEventInput } from "@/lib/circle-events"

const now = Date.parse("2026-11-02T10:00:00.000Z")

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Community co-working",
    description: "Bring a small project and work alongside the Circle.",
    event_type: "discussion",
    starts_at: "2026-11-02T12:00:00.000Z",
    ends_at: "2026-11-02T13:00:00.000Z",
    max_participants: 24,
    location: "Online",
    event_link: "https://meet.example.com/room",
    tags: ["community", "community", "co-working"],
    requires_approval: true,
    ...overrides,
  }
}

describe("normalizeCircleEventInput", () => {
  it("normalizes valid event details and deduplicates tags", () => {
    const result = normalizeCircleEventInput(validInput(), now)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.title).toBe("Community co-working")
    expect(result.value.tags).toEqual(["community", "co-working"])
    expect(result.value.requires_approval).toBe(true)
    expect(result.value.max_participants).toBe(24)
  })

  it("rejects events that start in the past", () => {
    const result = normalizeCircleEventInput(
      validInput({ starts_at: "2026-11-02T09:59:59.000Z" }),
      now,
    )
    expect(result).toMatchObject({ ok: false, error: "An event cannot start in the past" })
  })

  it("rejects end times that are not after the start", () => {
    const result = normalizeCircleEventInput(
      validInput({ ends_at: "2026-11-02T12:00:00.000Z" }),
      now,
    )
    expect(result).toMatchObject({ ok: false, error: "End time must be after the start time" })
  })

  it("rejects non-HTTPS event links", () => {
    const result = normalizeCircleEventInput(validInput({ event_link: "http://example.com" }), now)
    expect(result).toMatchObject({ ok: false, error: "Event links must be valid HTTPS URLs" })
  })

  it("supports an unlimited attendee capacity", () => {
    const result = normalizeCircleEventInput(validInput({ max_participants: 0 }), now)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.max_participants).toBeNull()
  })

  it("rejects malformed input without throwing", () => {
    expect(normalizeCircleEventInput(null, now)).toMatchObject({ ok: false })
    expect(normalizeCircleEventInput(validInput({ title: "" }), now)).toMatchObject({ ok: false })
  })
})
