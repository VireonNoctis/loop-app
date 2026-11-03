/**
 * Keeps recommendation feeds useful across a small community by avoiding
 * multiple consecutive slots from one creator when other eligible creators
 * are available. The second pass fills the requested page from the ranked
 * tail if the diversity cap would otherwise leave it sparse.
 */
export function diversifyByAuthor<T extends { id: string; author_id?: string | null }>(
  rankedItems: T[],
  limit: number,
  maxPerAuthor = 2,
): T[] {
  if (limit <= 0 || maxPerAuthor <= 0 || rankedItems.length === 0) return []

  const selected: T[] = []
  const selectedIds = new Set<string>()
  const authorCounts = new Map<string, number>()

  for (const item of rankedItems) {
    if (selectedIds.has(item.id)) continue
    const authorId = item.author_id || `unknown:${item.id}`
    const count = authorCounts.get(authorId) || 0
    if (count >= maxPerAuthor) continue

    selected.push(item)
    selectedIds.add(item.id)
    authorCounts.set(authorId, count + 1)
    if (selected.length >= limit) return selected
  }

  if (selected.length < limit) {
    for (const item of rankedItems) {
      if (selectedIds.has(item.id)) continue
      selected.push(item)
      if (selected.length >= limit) break
    }
  }

  return selected
}
