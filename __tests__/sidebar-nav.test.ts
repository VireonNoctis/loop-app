import { describe, expect, it } from "vitest"
import {
  EMPTY_AUDIENCE,
  primarySidebarNav,
  readSidebarMoreExpanded,
  SIDEBAR_MORE_STORAGE_KEY,
  SIDEBAR_NAV,
  secondarySidebarNav,
  visibleSidebarNav,
  writeSidebarMoreExpanded,
  type SidebarAudience,
} from "@/lib/sidebar-nav"

const FULL_ACCESS: SidebarAudience = {
  isPremium: true,
  isOrganization: true,
  isAdmin: true,
  isTeamMember: true,
}

function stubStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
  }
}

describe("sidebar navigation split", () => {
  it("does not lose a destination when splitting primary from More", () => {
    const reachable = visibleSidebarNav(FULL_ACCESS).map((item) => item.href).sort()

    // Every public and privileged sidebar destination must remain reachable.
    expect(reachable).toEqual(
      [
        "/",
        "/bookmarks",
        "/chains",
        "/create",
        "/co-loop/studio",
        "/collections",
        "/communities",
        "/developers",
        "/drops",
        "/earnings",
        "/events",
        "/explore",
        "/invite",
        "/loopadmin",
        "/messages",
        "/lounge",
        "/organization",
        "/streams",
        "/team",
        "/wallet",
      ].sort(),
    )
  })

  it("lists every destination exactly once", () => {
    const hrefs = SIDEBAR_NAV.map((item) => item.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it("keeps the primary group short enough to read at a glance", () => {
    const primary = primarySidebarNav(EMPTY_AUDIENCE).map((item) => item.href)

    expect(primary.length).toBeLessThanOrEqual(5)
    expect(primary).toEqual(["/", "/explore", "/create", "/communities", "/messages"])
  })

  it("keeps creation and inbox in the primary experience", () => {
    const primary = primarySidebarNav(EMPTY_AUDIENCE).map((item) => item.href)
    expect(primary).toContain("/create")
    expect(primary).toContain("/messages")
  })

  it("splits every visible item into exactly one group", () => {
    const audience: SidebarAudience = { ...EMPTY_AUDIENCE, isPremium: true }
    const primary = primarySidebarNav(audience)
    const secondary = secondarySidebarNav(audience)

    expect(primary.length + secondary.length).toBe(visibleSidebarNav(audience).length)
    expect(secondary.map((item) => item.href)).toContain("/lounge")
  })
})

describe("sidebar navigation audiences", () => {
  it("hides privileged destinations from ordinary accounts", () => {
    const hrefs = visibleSidebarNav(EMPTY_AUDIENCE).map((item) => item.href)

    expect(hrefs).not.toContain("/lounge")
    expect(hrefs).not.toContain("/organization")
    expect(hrefs).not.toContain("/loopadmin")
    expect(hrefs).not.toContain("/team")
  })

  it("gates each destination on its own flag", () => {
    const premium = visibleSidebarNav({ ...EMPTY_AUDIENCE, isPremium: true }).map((i) => i.href)
    expect(premium).toContain("/lounge")
    expect(premium).not.toContain("/loopadmin")

    const org = visibleSidebarNav({ ...EMPTY_AUDIENCE, isOrganization: true }).map((i) => i.href)
    expect(org).toContain("/organization")
    expect(org).not.toContain("/lounge")
  })

  it("treats admins as team members but not the reverse", () => {
    const admin = visibleSidebarNav({ ...EMPTY_AUDIENCE, isAdmin: true }).map((i) => i.href)
    expect(admin).toContain("/team")
    expect(admin).toContain("/loopadmin")

    const teamOnly = visibleSidebarNav({ ...EMPTY_AUDIENCE, isTeamMember: true }).map((i) => i.href)
    expect(teamOnly).toContain("/team")
    expect(teamOnly).not.toContain("/loopadmin")
  })
})

describe("sidebar More disclosure state", () => {
  it("starts collapsed", () => {
    expect(readSidebarMoreExpanded(stubStorage())).toBe(false)
  })

  it("remembers the choice", () => {
    const storage = stubStorage()

    writeSidebarMoreExpanded(true, storage)
    expect(readSidebarMoreExpanded(storage)).toBe(true)

    writeSidebarMoreExpanded(false, storage)
    expect(readSidebarMoreExpanded(storage)).toBe(false)
  })

  it("falls back to collapsed when storage holds junk or is unavailable", () => {
    expect(readSidebarMoreExpanded(stubStorage({ [SIDEBAR_MORE_STORAGE_KEY]: "{{{" }))).toBe(false)
    expect(
      readSidebarMoreExpanded({
        getItem: () => {
          throw new Error("blocked")
        },
        setItem: () => {},
      }),
    ).toBe(false)
  })
})
