import { describe, expect, it } from "vitest"
import { canCreateCircleActivity, normalizeCircleActivityInput } from "@/lib/circle-activity"

describe("Circle activity authorization", () => {
  it("allows the Circle owner without requiring a membership row", () => {
    expect(canCreateCircleActivity(true, null)).toBe(true)
  })

  it("requires active or approved membership for other actors", () => {
    expect(canCreateCircleActivity(false, "active")).toBe(true)
    expect(canCreateCircleActivity(false, "approved")).toBe(true)
    for (const status of ["pending", "rejected", "left", "banned", null, undefined]) {
      expect(canCreateCircleActivity(false, status)).toBe(false)
    }
  })
})

describe("Circle activity payload validation", () => {
  it("normalizes an allowed activity payload", () => {
    expect(normalizeCircleActivityInput({
      activity_type: "chain_created",
      target_type: "chain",
      target_id: "chain-1",
      metadata: { title: "Shared world" },
    })).toEqual({
      ok: true,
      value: {
        activity_type: "chain_created",
        target_type: "chain",
        target_id: "chain-1",
        metadata: { title: "Shared world" },
      },
    })
  })

  it("rejects malformed activity identifiers and metadata", () => {
    expect(normalizeCircleActivityInput({ activity_type: "Drop table;--" }).ok).toBe(false)
    expect(normalizeCircleActivityInput({ activity_type: "member_joined", metadata: [] }).ok).toBe(false)
    expect(normalizeCircleActivityInput({ activity_type: "member_joined", target_id: " " }).ok).toBe(false)
  })

  it("caps JSON metadata size", () => {
    const result = normalizeCircleActivityInput({
      activity_type: "member_joined",
      metadata: { details: "x".repeat(5000) },
    })
    expect(result).toEqual({
      ok: false,
      error: "Activity metadata exceeds the 4 KiB limit",
      status: 413,
    })
  })
})
