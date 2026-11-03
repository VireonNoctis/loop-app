import { describe, expect, it } from "vitest"
import {
  buildSharedResourceMetadata,
  buildUnavailableSharedResourceMetadata,
} from "@/lib/shared-resource-metadata"

describe("shared resource metadata", () => {
  it("indexes a public Chain and includes its contribution readout", () => {
    const metadata = buildSharedResourceMetadata({
      baseUrl: "https://loopapp.me",
      path: "/chains/11111111-1111-4111-8111-111111111111",
      kind: "chain",
      visibility: "public",
      title: "The shared universe",
      description: "A collaborative world-building project.",
      itemCount: 24,
      creatorName: "A creator",
      creatorUsername: "creator",
      creatorAvatarUrl: "https://cdn.example.test/avatar.webp",
    })

    expect(metadata.robots).toBeUndefined()
    expect(metadata.title).toBe("The shared universe")
    expect(metadata.alternates?.canonical).toBe("https://loopapp.me/chains/11111111-1111-4111-8111-111111111111")
    expect((metadata.openGraph?.images as Array<{ url: string }>)[0].url).toContain("type=project")
    expect((metadata.openGraph?.images as Array<{ url: string }>)[0].url).toContain("stat_label=contributions")
  })

  it("keeps unlisted Collections shareable but out of search indexes", () => {
    const metadata = buildSharedResourceMetadata({
      baseUrl: "https://loopapp.me",
      path: "/collections/22222222-2222-4222-8222-222222222222",
      kind: "collection",
      visibility: "unlisted",
      title: "Research shelf",
      description: "A private link shared with collaborators.",
      itemCount: 8,
    })

    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.openGraph?.title).toBe("Research shelf")
    expect((metadata.openGraph?.images as Array<{ url: string }>)[0].url).toContain("stat_label=items")
  })

  it("uses a generic noindex card when a resource is private or unavailable", () => {
    const metadata = buildUnavailableSharedResourceMetadata(
      "https://loopapp.me",
      "/chains/33333333-3333-4333-8333-333333333333",
      "chain",
    )

    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.title).toBe("Chain — LOOP")
    expect(metadata.description).not.toContain("private resource title")
  })

  it("never includes control characters or unbounded titles in preview metadata", () => {
    const metadata = buildSharedResourceMetadata({
      baseUrl: "https://loopapp.me",
      path: "/collections/44444444-4444-4444-8444-444444444444",
      kind: "collection",
      visibility: "public",
      title: `  Shelf\n\u0000${"x".repeat(120)}  `,
    })

    expect((metadata.title as string).length).toBeLessThanOrEqual(90)
    expect(metadata.title).not.toContain("\u0000")
  })
})
