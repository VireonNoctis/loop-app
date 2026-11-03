import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  user: vi.fn(),
  createServerClient: vi.fn(),
  checkAccess: vi.fn(),
}))
vi.mock("@/lib/server-auth", () => ({ getUserFromRequest: state.user }))
vi.mock("@/lib/supabase", () => ({ createServerClient: state.createServerClient }))
vi.mock("@/lib/circle-access", () => ({ checkCirclePrivateAccess: state.checkAccess }))
vi.mock("@/lib/xp", () => ({ awardXp: vi.fn() }))
vi.mock("@/lib/community-permissions", () => ({ can: vi.fn(() => true) }))
vi.mock("@google/genai", () => ({ GoogleGenAI: vi.fn() }))

import { GET as getBookmarks } from "@/app/api/circles/[id]/bookmarks/route"
import { GET as getCheckin, POST as createCheckin } from "@/app/api/circles/[id]/checkin/route"
import { GET as getTags, POST as createTag, DELETE as deleteTag } from "@/app/api/circles/[id]/tags/route"
import { POST as triggerBot } from "@/app/api/circles/[id]/bots/trigger/route"
import { GET as getChallenges, POST as createChallenge } from "@/app/api/circles/[id]/challenges/route"
import { GET as getBadges, POST as createBadge } from "@/app/api/circles/[id]/badges/route"

const circleParams = { params: Promise.resolve({ id: "circle-1" }) }
const tagParams = { params: Promise.resolve({ id: "circle-1", tagId: "tag-1" }) }
const baseUrl = "https://loopapp.me/api/circles/circle-1"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
  state.user.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" })
  state.createServerClient.mockImplementation(() => { throw new Error("Privileged client must not be created without service key") })
  state.checkAccess.mockResolvedValue({ isPrivate: false, canView: true })
})

function request(path: string, method = "GET", body?: unknown) {
  return new NextRequest(baseUrl + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  })
}

describe("Circle auxiliary route boundaries", () => {
  it("requires the service role for bookmarks and tags", async () => {
    const bookmarks = await getBookmarks(request("/bookmarks"), circleParams)
    const tags = await getTags(request("/tags"), circleParams)

    expect([bookmarks.status, tags.status]).toEqual([503, 503])
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("requires the service role for check-in reads and writes", async () => {
    const read = await getCheckin(request("/checkin"), circleParams)
    const write = await createCheckin(request("/checkin", "POST"), circleParams)

    expect([read.status, write.status]).toEqual([503, 503])
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("authenticates Circle tags and bot triggers before privileged access", async () => {
    state.user.mockResolvedValue(null)
    const tag = await createTag(request("/tags", "POST", { name: "builds" }), circleParams)
    const bot = await triggerBot(request("/bots/trigger", "POST", { trigger_type: "chat" }), circleParams)

    expect([tag.status, bot.status]).toEqual([401, 401])
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("fails closed for bot triggers when server credentials are missing", async () => {
    const bot = await triggerBot(request("/bots/trigger", "POST", { trigger_type: "chat" }), circleParams)
    expect(bot.status).toBe(503)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })

  it("requires the service role for Circle badge and challenge reads and writes", async () => {
    const [badges, badge, challenges, challenge] = await Promise.all([
      getBadges(request("/badges"), circleParams),
      createBadge(request("/badges", "POST", { name: "Helpful", requirement_type: "contributions" }), circleParams),
      getChallenges(request("/challenges"), circleParams),
      createChallenge(request("/challenges", "POST", { title: "Community prompt" }), circleParams),
    ])

    expect([badges.status, badge.status, challenges.status, challenge.status]).toEqual([503, 503, 503, 503])
    expect(state.createServerClient).not.toHaveBeenCalled()
  })
})
