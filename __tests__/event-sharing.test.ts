import { describe, expect, it } from "vitest"
import { getEventShareVisibility } from "@/lib/event-sharing"

describe("event share visibility", () => {
  it("allows universally accessible public events", () => {
    expect(getEventShareVisibility({ visibility: "public", allow_type: "everyone" })).toBe("public")
  })

  it("allows unlisted events to be shared without indexing them", () => {
    expect(getEventShareVisibility({ visibility: "unlisted", allow_type: "everyone" })).toBe("unlisted")
  })

  it.each(["pro", "verified", "organization", "members"])("hides %s-restricted events", (allowType) => {
    expect(getEventShareVisibility({ visibility: "public", allow_type: allowType })).toBeNull()
  })

  it.each(["private", "followers", "circle"])("hides %s visibility events", (visibility) => {
    expect(getEventShareVisibility({ visibility, allow_type: "everyone" })).toBeNull()
  })

  it("hides explicitly private events", () => {
    expect(getEventShareVisibility({ visibility: "public", is_private: true })).toBeNull()
  })

  it("requires a verified public, active and non-Pro Circle before sharing a Circle event", () => {
    const event = { visibility: "public", allow_type: "everyone", circle_id: "circle-1" }
    expect(getEventShareVisibility(event)).toBeNull()
    expect(getEventShareVisibility(event, { is_private: true, is_active: true })).toBeNull()
    expect(getEventShareVisibility(event, { is_private: false, is_active: true, is_premium_only: true })).toBeNull()
    expect(getEventShareVisibility(event, { is_private: false, is_active: false })).toBeNull()
    expect(getEventShareVisibility(event, { is_private: false, is_active: true, is_premium_only: false })).toBe("public")
  })
})
