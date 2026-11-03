export const CIRCLE_EVENT_TYPES = ["discussion", "voice_chat", "screen_share", "game"] as const

export type CircleEventType = (typeof CIRCLE_EVENT_TYPES)[number]

export interface NormalizedCircleEventInput {
  title: string
  description: string
  event_type: CircleEventType
  starts_at: string
  ends_at: string | null
  max_participants: number | null
  location: string | null
  event_link: string | null
  tags: string[]
  requires_approval: boolean
}

export type CircleEventInputResult =
  | { ok: true; value: NormalizedCircleEventInput }
  | { ok: false; error: string }

/**
 * Validate and normalize untrusted event-creation input before it reaches the
 * database. A null capacity means the Circle has not set an attendee limit.
 */
export function normalizeCircleEventInput(
  input: unknown,
  now = Date.now(),
): CircleEventInputResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Event details are required" }
  }

  const body = input as Record<string, unknown>
  const title = typeof body.title === "string" ? body.title.trim() : ""
  const description = typeof body.description === "string" ? body.description.trim() : ""
  const eventType = typeof body.event_type === "string" ? body.event_type : ""
  const startsAt = typeof body.starts_at === "string" ? new Date(body.starts_at) : new Date(Number.NaN)
  const endsAt = typeof body.ends_at === "string" && body.ends_at.trim()
    ? new Date(body.ends_at)
    : null

  if (!title || title.length > 120) {
    return { ok: false, error: "Event title must be between 1 and 120 characters" }
  }
  if (description.length > 2000) {
    return { ok: false, error: "Event description cannot exceed 2,000 characters" }
  }
  if (!CIRCLE_EVENT_TYPES.includes(eventType as CircleEventType)) {
    return { ok: false, error: "Choose a supported event type" }
  }
  if (!Number.isFinite(startsAt.getTime())) {
    return { ok: false, error: "Choose a valid start time" }
  }
  if (startsAt.getTime() < now) {
    return { ok: false, error: "An event cannot start in the past" }
  }
  if (endsAt && !Number.isFinite(endsAt.getTime())) {
    return { ok: false, error: "Choose a valid end time" }
  }
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, error: "End time must be after the start time" }
  }

  let maxParticipants: number | null = 50
  if (body.max_participants === null || body.max_participants === "" || body.max_participants === 0) {
    maxParticipants = null
  } else if (body.max_participants !== undefined) {
    const parsed = Number(body.max_participants)
    if (!Number.isInteger(parsed) || parsed < 2 || parsed > 5000) {
      return { ok: false, error: "Attendee limits must be between 2 and 5,000, or unlimited" }
    }
    maxParticipants = parsed
  }

  const location = typeof body.location === "string" ? body.location.trim() : ""
  if (location.length > 200) {
    return { ok: false, error: "Location cannot exceed 200 characters" }
  }

  const rawLink = typeof body.event_link === "string" ? body.event_link.trim() : ""
  let eventLink: string | null = null
  if (rawLink) {
    try {
      const parsed = new URL(rawLink)
      if (parsed.protocol !== "https:") throw new Error("https required")
      eventLink = parsed.toString()
    } catch {
      return { ok: false, error: "Event links must be valid HTTPS URLs" }
    }
  }

  const rawTags = Array.isArray(body.tags) ? body.tags : []
  const tags = Array.from(new Set(
    rawTags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim().slice(0, 30))
      .filter(Boolean),
  )).slice(0, 10)

  return {
    ok: true,
    value: {
      title,
      description,
      event_type: eventType as CircleEventType,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt ? endsAt.toISOString() : null,
      max_participants: maxParticipants,
      location: location || null,
      event_link: eventLink,
      tags,
      requires_approval: body.requires_approval === true,
    },
  }
}
