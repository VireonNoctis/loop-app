import { describe, expect, it } from "vitest"

function sumCoins(rows: Array<{ cost?: number | string | null }>): number {
  return rows.reduce((sum, row) => {
    const cost = Number(row.cost)
    return Number.isFinite(cost) && cost > 0 ? sum + cost : sum
  }, 0)
}

function buildMonthlyGiftActivity(rows: Array<{ cost?: number | string | null; created_at?: string | null }>, now: Date) {
  const months = new Map<string, { month: string; earnings: number; gifts: number; engagement: number }>()
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
    months.set(key, { month: date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), earnings: 0, gifts: 0, engagement: 0 })
  }
  for (const row of rows) {
    const date = new Date(String(row.created_at || ""))
    const cost = Number(row.cost)
    if (Number.isNaN(date.getTime()) || !Number.isFinite(cost) || cost <= 0) continue
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
    const month = months.get(key)
    if (!month) continue
    month.earnings += cost
    month.gifts += 1
  }
  return [...months.values()]
}

describe("creator revenue activity", () => {
  it("sums only positive finite received coin values", () => {
    expect(sumCoins([{ cost: 10 }, { cost: 20 }, { cost: -3 }, { cost: Number.NaN }])).toBe(30)
  })
  it("groups actual gift coin totals by six UTC calendar months", () => {
    expect(buildMonthlyGiftActivity([
      { cost: 10, created_at: "2026-10-10T12:00:00Z" },
      { cost: 15, created_at: "2026-10-18T12:00:00Z" },
      { cost: 50, created_at: "2026-10-20T12:00:00Z" },
    ], new Date("2026-11-02T12:00:00Z"))).toEqual([
      { month: "Jun", earnings: 0, gifts: 0, engagement: 0 },
      { month: "Jul", earnings: 0, gifts: 0, engagement: 0 },
      { month: "Aug", earnings: 0, gifts: 0, engagement: 0 },
      { month: "Sep", earnings: 0, gifts: 0, engagement: 0 },
      { month: "Oct", earnings: 75, gifts: 3, engagement: 0 },
      { month: "Nov", earnings: 0, gifts: 0, engagement: 0 },
    ])
  })
})
