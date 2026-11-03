import { describe, expect, it } from "vitest"
import { mergeDiscoveryPreferences, normalizeDiscoveryPreferences } from "@/lib/discovery-preferences"

describe("Discover preferences", () => {
  it("normalizes topics and gives muted topics precedence", () => {
    expect(normalizeDiscoveryPreferences({
      preferred_topics: ["#WorldBuilding", "music", "music"], muted_topics: ["#MUSIC"], personalization_enabled: false,
    })).toEqual({ personalization_enabled: false, preferred_topics: ["worldbuilding"], muted_topics: ["music"] })
  })
  it("merges partial updates without losing other preferences", () => {
    expect(mergeDiscoveryPreferences({
      personalization_enabled: true, preferred_topics: ["stories"], muted_topics: ["spoilers"],
    }, { muted_topics: ["spoilers", "sports"] })).toEqual({
      ok: true, value: { personalization_enabled: true, preferred_topics: ["stories"], muted_topics: ["spoilers", "sports"] },
    })
  })
  it("removes a newly muted topic from preferred topics", () => {
    const result = mergeDiscoveryPreferences({ preferred_topics: ["music"], muted_topics: [] }, { muted_topics: ["music"] })
    expect(result.ok && result.value.preferred_topics).toEqual([])
  })
  it("rejects unknown fields, malformed topics and oversized lists", () => {
    expect(mergeDiscoveryPreferences({}, { admin: true }).ok).toBe(false)
    expect(mergeDiscoveryPreferences({}, { preferred_topics: ["not a tag"] }).ok).toBe(false)
    expect(mergeDiscoveryPreferences({}, { muted_topics: Array.from({ length: 51 }, (_, i) => `topic${i}`) }).ok).toBe(false)
  })
  it("requires a boolean switch and a non-empty patch", () => {
    expect(mergeDiscoveryPreferences({}, { personalization_enabled: "false" }).ok).toBe(false)
    expect(mergeDiscoveryPreferences({}, {}).ok).toBe(false)
  })
})
