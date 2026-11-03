export type EventShareVisibility = "public" | "unlisted"

type ShareableEvent = {
  visibility?: unknown
  is_private?: unknown
  allow_type?: unknown
  circle_id?: unknown
}

type ShareableCircle = {
  is_private?: unknown
  is_active?: unknown
  is_premium_only?: unknown
}

/**
 * Metadata is public only when every visitor can open the event. A link being
 * syntactically shareable is not permission to expose the event's details to
 * crawlers or link unfurlers.
 */
export function getEventShareVisibility(
  event: ShareableEvent | null | undefined,
  circle?: ShareableCircle | null,
): EventShareVisibility | null {
  if (!event || event.is_private === true) return null

  const allowType = typeof event.allow_type === "string" ? event.allow_type.trim().toLowerCase() : "everyone"
  if (allowType !== "everyone") return null

  const rawVisibility = typeof event.visibility === "string"
    ? event.visibility.trim().toLowerCase()
    : "public"
  if (rawVisibility !== "public" && rawVisibility !== "unlisted") return null

  if (event.circle_id) {
    // A missing Circle response is not proof that the Circle is public.
    if (!circle || circle.is_private !== false || circle.is_premium_only === true || circle.is_active === false) {
      return null
    }
  }

  return rawVisibility
}
