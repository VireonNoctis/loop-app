export type DiscoveryPreferences = {
  personalization_enabled: boolean
  preferred_topics: string[]
  muted_topics: string[]
}
export const DEFAULT_DISCOVERY_PREFERENCES: DiscoveryPreferences = {
  personalization_enabled: true, preferred_topics: [], muted_topics: [],
}
const MAX_TOPICS = 50
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function normalizeTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const topics = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== "string") continue
    const topic = entry.trim().replace(/^#/, "").toLowerCase()
    if (/^[a-z0-9][a-z0-9_-]{0,39}$/.test(topic)) topics.add(topic)
    if (topics.size >= MAX_TOPICS) break
  }
  return [...topics]
}
export function normalizeDiscoveryPreferences(value: unknown): DiscoveryPreferences {
  const raw = isRecord(value) ? value : {}
  const mutedTopics = normalizeTopics(raw.muted_topics)
  const muted = new Set(mutedTopics)
  return {
    personalization_enabled: typeof raw.personalization_enabled === "boolean" ? raw.personalization_enabled : true,
    preferred_topics: normalizeTopics(raw.preferred_topics).filter((topic) => !muted.has(topic)),
    muted_topics: mutedTopics,
  }
}
export function mergeDiscoveryPreferences(
  current: unknown, patch: unknown,
): { ok: true; value: DiscoveryPreferences } | { ok: false; error: string } {
  if (!isRecord(patch)) return { ok: false, error: "Preferences must be an object." }
  const allowed = new Set(["personalization_enabled", "preferred_topics", "muted_topics"])
  if (Object.keys(patch).some((key) => !allowed.has(key))) return { ok: false, error: "One or more preference fields are not supported." }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Choose at least one preference to update." }
  const previous = normalizeDiscoveryPreferences(current)
  const next: DiscoveryPreferences = { ...previous }
  if ("personalization_enabled" in patch) {
    if (typeof patch.personalization_enabled !== "boolean") return { ok: false, error: "Personalization must be enabled or disabled." }
    next.personalization_enabled = patch.personalization_enabled
  }
  for (const key of ["preferred_topics", "muted_topics"] as const) {
    if (!(key in patch)) continue
    const raw = patch[key]
    if (!Array.isArray(raw) || raw.length > MAX_TOPICS || raw.some((entry) => {
      if (typeof entry !== "string") return true
      return !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(entry.trim().replace(/^#/, "").toLowerCase())
    })) return { ok: false, error: "Topics must be valid tags of up to 40 characters, with at most 50 in each list." }
    next[key] = normalizeTopics(raw)
  }
  const muted = new Set(next.muted_topics)
  next.preferred_topics = next.preferred_topics.filter((topic) => !muted.has(topic))
  return { ok: true, value: next }
}
