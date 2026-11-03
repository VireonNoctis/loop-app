import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  getUserFromRequest: vi.fn(),
  createServerClient: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getUserFromRequest: (...args: unknown[]) => state.getUserFromRequest(...args),
}))

vi.mock("@/lib/supabase", () => ({
  createServerClient: (...args: unknown[]) => state.createServerClient(...args),
}))

import { PUT } from "@/app/api/users/profile/route"

const userId = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  vi.clearAllMocks()
  state.getUserFromRequest.mockResolvedValue({ id: userId })
  state.single.mockResolvedValue({
    data: {
      id: userId,
      display_name: "Updated creator",
      avatar_url: "https://cdn.example.test/avatar.webp",
      video_avatar_url: "https://cdn.example.test/avatar.mp4",
    },
    error: null,
  })
  state.select.mockReturnValue({ single: state.single })
  state.eq.mockReturnValue({ select: state.select })
  state.update.mockReturnValue({ eq: state.eq })
  state.createServerClient.mockReturnValue({
    from: (table: string) => {
      expect(table).toBe("profiles")
      return { update: state.update }
    },
  })
})

describe("profile update route", () => {
  it("accepts both avatar fields without allowing clients to grant trusted account flags", async () => {
    const request = new NextRequest("https://loopapp.me/api/users/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "Updated creator",
        avatar_url: "https://cdn.example.test/avatar.webp",
        video_avatar_url: "https://cdn.example.test/avatar.mp4",
        is_verified: true,
        is_admin: true,
      }),
    })

    const response = await PUT(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(state.update).toHaveBeenCalledOnce()
    const updates = state.update.mock.calls[0][0]
    expect(updates).toEqual(expect.objectContaining({
      display_name: "Updated creator",
      avatar_url: "https://cdn.example.test/avatar.webp",
      video_avatar_url: "https://cdn.example.test/avatar.mp4",
    }))
    expect(updates).not.toHaveProperty("is_verified")
    expect(updates).not.toHaveProperty("is_admin")
    expect(body.profile.avatar_url).toBe("https://cdn.example.test/avatar.webp")
  })

  it("rejects signed-out profile updates before opening the database client", async () => {
    state.getUserFromRequest.mockResolvedValue(null)

    const request = new NextRequest("https://loopapp.me/api/users/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: "https://cdn.example.test/avatar.webp" }),
    })
    const response = await PUT(request)

    expect(response.status).toBe(401)
    expect(state.createServerClient).not.toHaveBeenCalled()
  })
})
