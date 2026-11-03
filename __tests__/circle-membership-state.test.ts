import { describe, expect, it } from "vitest"
import { filterCirclesForViewer, isCirclePubliclyDiscoverable, isPrivateCircleDiscoverable, resolveCircleMembershipAction } from "@/lib/circle-membership-state"

describe("resolveCircleMembershipAction", () => {
  it("enters active and legacy approved memberships", () => {
    expect(resolveCircleMembershipAction("active", false).kind).toBe("enter")
    expect(resolveCircleMembershipAction("approved", false).kind).toBe("enter")
  })
  it("lets applicants cancel a pending private Circle request", () => {
    expect(resolveCircleMembershipAction("pending", true).kind).toBe("cancel-request")
  })
  it("distinguishes public joining from private requests", () => {
    expect(resolveCircleMembershipAction(null, false).kind).toBe("join")
    expect(resolveCircleMembershipAction(null, true).kind).toBe("request-join")
  })
  it("does not let banned members retry", () => {
    expect(resolveCircleMembershipAction("banned", false).kind).toBe("unavailable")
  })
})

describe("isPrivateCircleDiscoverable", () => {
  it("hides private Circles from guests and banned accounts", () => {
    expect(isPrivateCircleDiscoverable({ isPrivate: true, viewerId: null })).toBe(false)
    expect(isPrivateCircleDiscoverable({ isPrivate: true, viewerId: "banned", membershipStatus: "banned" })).toBe(false)
  })
  it("allows owners, members and pending applicants to see private Circles", () => {
    expect(isPrivateCircleDiscoverable({ isPrivate: true, viewerId: "owner", ownerId: "owner" })).toBe(true)
    expect(isPrivateCircleDiscoverable({ isPrivate: true, viewerId: "member", membershipStatus: "active" })).toBe(true)
    expect(isPrivateCircleDiscoverable({ isPrivate: true, viewerId: "applicant", membershipStatus: "pending" })).toBe(true)
  })
  it("keeps public Circles visible to guests", () => {
    expect(isPrivateCircleDiscoverable({ isPrivate: false, viewerId: null })).toBe(true)
  })
})


describe("Circle listing visibility", () => {
  const circles = [
    { id: "public", is_private: false, is_premium_only: false, owner_id: "owner" },
    { id: "private", is_private: true, is_premium_only: false, owner_id: "owner" },
    { id: "pro", is_private: false, is_premium_only: true, owner_id: "owner" },
  ]

  it("keeps public Circles visible while withholding private and Pro-only listings from guests", () => {
    expect(filterCirclesForViewer(circles, { viewerId: null, viewerIsPro: false }).map((circle) => circle.id))
      .toEqual(["public"])
  })

  it("allows a pending applicant to see the private Circle shell but not banned members", () => {
    const pending = new Map([["private", { status: "pending" }]])
    const banned = new Map([["private", { status: "banned" }]])
    expect(filterCirclesForViewer(circles, { viewerId: "applicant", viewerIsPro: false, memberships: pending }).map((circle) => circle.id))
      .toEqual(["public", "private"])
    expect(filterCirclesForViewer(circles, { viewerId: "banned", viewerIsPro: false, memberships: banned }).map((circle) => circle.id))
      .toEqual(["public"])
  })

  it("permits the canonical owner and active members to see private Circle listings", () => {
    expect(filterCirclesForViewer(circles, { viewerId: "owner", viewerIsPro: false }).map((circle) => circle.id))
      .toEqual(["public", "private"])
    const active = new Map([["private", { status: "active" }]])
    expect(filterCirclesForViewer(circles, { viewerId: "member", viewerIsPro: false, memberships: active }).map((circle) => circle.id))
      .toEqual(["public", "private"])
  })

  it("allows Pro-only listing only for a current Pro viewer, not merely a user with another Circle membership", () => {
    expect(filterCirclesForViewer(circles, { viewerId: "member", viewerIsPro: false }).map((circle) => circle.id))
      .toEqual(["public"])
    expect(filterCirclesForViewer(circles, { viewerId: "member", viewerIsPro: true }).map((circle) => circle.id))
      .toEqual(["public", "pro"])
  })

  it("keeps private and Pro-only Circles out of public participation discovery", () => {
    expect(isCirclePubliclyDiscoverable({ isPrivate: false, isPremiumOnly: false })).toBe(true)
    expect(isCirclePubliclyDiscoverable({ isPrivate: true, isPremiumOnly: false })).toBe(false)
    expect(isCirclePubliclyDiscoverable({ isPrivate: false, isPremiumOnly: true })).toBe(false)
  })
})
