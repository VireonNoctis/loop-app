import { describe, expect, it } from "vitest"
import { buildWeeklyPostingActivity, calculateEngagementRate, getMostActivePostingHourUtc, sumCreatorLoopStats } from "@/lib/creator-analytics"

describe("creator analytics calculations", () => {
  it("sums finite non-negative lifetime counters", () => {
    expect(sumCreatorLoopStats([
      { loop_id: "a", views_count: 100, likes_count: 5, comments_count: 2 },
      { loop_id: "b", views_count: 50, likes_count: -1, comments_count: Number.NaN },
    ])).toEqual({ views: 150, likes: 5, comments: 2 })
  })
  it("calculates engagement only from measured views", () => {
    expect(calculateEngagementRate({ views: 0, likes: 10, comments: 2 })).toBe(0)
    expect(calculateEngagementRate({ views: 200, likes: 20, comments: 10 })).toBe(15)
  })
  it("returns the observed UTC posting hour", () => {
    expect(getMostActivePostingHourUtc([
      { id: "a", created_at: "2026-11-02T09:15:00Z" },
      { id: "b", created_at: "2026-11-02T09:50:00Z" },
      { id: "c", created_at: "2026-11-02T17:00:00Z" },
    ])).toBe("09:00 UTC")
    expect(getMostActivePostingHourUtc([])).toBeNull()
  })
  it("builds Monday-first buckets for the last seven UTC days", () => {
    expect(buildWeeklyPostingActivity([
      { id: "a", created_at: "2026-10-27T18:00:00Z" },
      { id: "b", created_at: "2026-11-02T02:00:00Z" },
      { id: "c", created_at: "2026-10-26T23:59:00Z" },
    ], new Date("2026-11-02T12:00:00Z"))).toEqual([1, 1, 0, 0, 0, 0, 0])
  })
})
