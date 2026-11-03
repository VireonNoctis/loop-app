import { describe, expect, it } from "vitest"
import nextConfig from "../next.config.mjs"

describe("canonical legal document redirects", () => {
  it("redirects legacy Terms URLs to /terms", async () => {
    const redirects = await nextConfig.redirects()
    const bySource = new Map(redirects.map((item) => [item.source, item]))

    for (const source of ["/terms-of-service", "/terms-of-use", "/tos", "/legal/terms"]) {
      expect(bySource.get(source)).toMatchObject({
        destination: "/terms",
        permanent: true,
      })
    }
  })

  it("redirects legacy Privacy URLs to /privacy", async () => {
    const redirects = await nextConfig.redirects()
    const bySource = new Map(redirects.map((item) => [item.source, item]))

    for (const source of ["/privacy-policy", "/legal/privacy"]) {
      expect(bySource.get(source)).toMatchObject({
        destination: "/privacy",
        permanent: true,
      })
    }
  })
})
