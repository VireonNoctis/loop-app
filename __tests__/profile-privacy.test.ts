import { describe, expect, it } from "vitest"
import { buildPublicProfileIdentity, buildRestrictedProfileView, isRestrictedProfileVisibility } from "@/lib/profile-privacy"
import { checkBlockStatus } from "@/lib/user-blocks"

describe("isRestrictedProfileVisibility", () => {
  it("keeps legacy profiles without a setting public", () => {
    expect(isRestrictedProfileVisibility(null)).toBe(false)
    expect(isRestrictedProfileVisibility(undefined)).toBe(false)
    expect(isRestrictedProfileVisibility({})).toBe(false)
    expect(isRestrictedProfileVisibility({ profile_visibility: "public" })).toBe(false)
  })

  it("allows unlisted profile previews but not restricted visibility modes", () => {
    expect(isRestrictedProfileVisibility({ profile_visibility: "unlisted" })).toBe(false)
    expect(isRestrictedProfileVisibility({ profile_visibility: "private" })).toBe(true)
    expect(isRestrictedProfileVisibility({ profile_visibility: "followers" })).toBe(true)
  })

  it("fails closed for malformed or unknown configured values", () => {
    expect(isRestrictedProfileVisibility("private")).toBe(true)
    expect(isRestrictedProfileVisibility([])).toBe(true)
    expect(isRestrictedProfileVisibility({ profile_visibility: "team-only" })).toBe(true)
  })
})


describe("restricted profile response", () => {
  it("exposes only basic identity and hides social, activity and account details", () => {
    const view = buildRestrictedProfileView({
      id: "profile-1",
      username: "creator",
      display_name: "Creator",
      avatar_url: "https://cdn.example.test/avatar.png",
      banner_url: "https://cdn.example.test/banner.png",
      bio: "A short public-facing introduction",
      location: "Private location",
      website: "https://private.example.test",
      is_verified: true,
      is_premium: true,
      followers_count: 1200,
    } as any, {
      isPrivate: true,
      hasPendingRequest: true,
      isBlocked: false,
      blockDirection: null,
    })

    expect(view.username).toBe("creator")
    expect(view.is_verified).toBe(true)
    expect(view.has_pending_follow_request).toBe(true)
    expect(view.followers_count).toBe(0)
    expect((view as any).location).toBeUndefined()
    expect((view as any).website).toBeUndefined()
    expect((view as any).is_premium).toBeUndefined()
  })

  it("does not reveal pending follow state when the viewer is blocked", () => {
    const view = buildRestrictedProfileView({
      id: "profile-2",
      username: "creator",
      display_name: "Creator",
    }, {
      isPrivate: false,
      hasPendingRequest: true,
      isBlocked: true,
      blockDirection: "by_them",
    })

    expect(view.is_blocked).toBe(true)
    expect(view.has_pending_follow_request).toBe(false)
    expect(view.recent_loops).toEqual([])
  })
})


describe("public profile identity boundary", () => {
  const databaseProfile = {
    id: "profile-1",
    username: "creator",
    display_name: "Creator",
    email: "creator@example.test",
    phone_number: "+353000000000",
    password_hash: "never-return-this",
    is_verified: true,
    is_premium: true,
    is_admin: true,
    loop_coins: 9000,
    available_earnings: 123.45,
    total_earnings: 678.90,
    organization_config: {
      coin_rate_multiplier: 2,
      custom_boost_discount: 90,
      circle_perk_price: 1,
      private_billing_reference: "internal",
    },
  }

  it("does not expose contact, credentials, admin flags or earnings to visitors", () => {
    const profile = buildPublicProfileIdentity(databaseProfile, false)

    expect(profile).toMatchObject({
      id: "profile-1",
      username: "creator",
      is_verified: true,
      is_premium: true,
      organization_config: { coin_rate_multiplier: 2 },
    })
    expect(profile).not.toHaveProperty("email")
    expect(profile).not.toHaveProperty("phone_number")
    expect(profile).not.toHaveProperty("password_hash")
    expect(profile).not.toHaveProperty("is_admin")
    expect(profile).not.toHaveProperty("loop_coins")
    expect(profile).not.toHaveProperty("available_earnings")
    expect(profile).not.toHaveProperty("total_earnings")
    expect(profile.organization_config).not.toHaveProperty("private_billing_reference")
    expect(profile.organization_config).not.toHaveProperty("custom_boost_discount")
  })

  it("includes owner-only account and earnings fields only for the profile owner", () => {
    const profile = buildPublicProfileIdentity(databaseProfile, true)

    expect(profile).toMatchObject({
      is_admin: true,
      loop_coins: 9000,
      available_earnings: 123.45,
      total_earnings: 678.9,
    })
    expect(profile).not.toHaveProperty("email")
    expect(profile).not.toHaveProperty("password_hash")
  })
})

describe("profile block-check failures", () => {
  it("fails closed when the block relationship cannot be verified", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          or: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: null, error: new Error("database unavailable") }),
            }),
          }),
        }),
      }),
    }

    await expect(checkBlockStatus(supabase as any, "viewer", "creator")).rejects.toThrow(
      "Could not verify profile block status",
    )
  })
})
