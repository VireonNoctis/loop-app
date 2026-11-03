export type CreatorLoopMetric = { id: string; content?: string | null; created_at: string }
export type CreatorLoopStats = { loop_id: string; views_count?: number | null; likes_count?: number | null; comments_count?: number | null }
export type CreatorAnalyticsTotals = { views: number; likes: number; comments: number }

function nonNegative(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function sumCreatorLoopStats(stats: CreatorLoopStats[]): CreatorAnalyticsTotals {
  return stats.reduce((totals, row) => ({
    views: totals.views + nonNegative(row.views_count),
    likes: totals.likes + nonNegative(row.likes_count),
    comments: totals.comments + nonNegative(row.comments_count),
  }), { views: 0, likes: 0, comments: 0 })
}

export function buildWeeklyPostingActivity(loops: CreatorLoopMetric[], now: Date = new Date()): number[] {
  const buckets = new Array<number>(7).fill(0)
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 6 * 86_400_000
  const nextDayStart = dayStart + 7 * 86_400_000
  for (const loop of loops) {
    const timestamp = Date.parse(loop.created_at)
    if (!Number.isFinite(timestamp) || timestamp < dayStart || timestamp >= nextDayStart) continue
    const dayIndex = Math.floor((timestamp - dayStart) / 86_400_000)
    const weekday = new Date(dayStart + dayIndex * 86_400_000).getUTCDay()
    buckets[(weekday + 6) % 7] += 1
  }
  return buckets
}

/** Observed posting hour, not a prediction of the best time to publish. */
export function getMostActivePostingHourUtc(loops: CreatorLoopMetric[]): string | null {
  if (!loops.length) return null
  const counts = new Array<number>(24).fill(0)
  for (const loop of loops) {
    const date = new Date(loop.created_at)
    if (!Number.isNaN(date.getTime())) counts[date.getUTCHours()] += 1
  }
  if (counts.every((count) => count === 0)) return null
  return `${String(counts.indexOf(Math.max(...counts))).padStart(2, "0")}:00 UTC`
}

export function calculateEngagementRate(totals: CreatorAnalyticsTotals): number {
  return totals.views > 0 ? ((totals.likes + totals.comments) / totals.views) * 100 : 0
}
