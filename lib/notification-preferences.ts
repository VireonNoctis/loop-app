export type PushCategory =
  | "liveStreams"
  | "directMessages"
  | "giftRewards"
  | "circleInvites"
  | "social"
  | "system"

export type PushSuppressionReason = "prefs_disabled" | "quiet_hours"

type QuietHours = {
  enabled?: unknown
  start?: unknown
  end?: unknown
  time_zone?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseClockMinutes(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null
  const [hours, minutes] = value.split(":").map(Number)
  return hours * 60 + minutes
}

function localMinuteOfDay(date: Date, timeZone: string): number | null {
  if (!Number.isFinite(date.getTime())) return null
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date)
    const hour = Number(parts.find((part) => part.type === "hour")?.value)
    const minute = Number(parts.find((part) => part.type === "minute")?.value)
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
    return hour * 60 + minute
  } catch {
    return null
  }
}

/** Shared server-side push preference gate for browser and native transports. */
export function getPushSuppressionReason(
  rawSettings: unknown,
  category: PushCategory,
  now: Date = new Date(),
): PushSuppressionReason | null {
  if (!isRecord(rawSettings)) return null
  const settings = rawSettings
  if (settings.push === false || settings.push_notifications === false) return "prefs_disabled"

  const categoryAllowed = (() => {
    switch (category) {
      case "liveStreams":
        return settings.liveStreams !== false && settings.live_streams !== false
      case "directMessages":
        return settings.directMessages !== false && settings.direct_messages !== false && settings.messages !== false
      case "giftRewards":
        return settings.giftRewards !== false && settings.gifts !== false
      case "circleInvites":
        return settings.circleInvites !== false && settings.circles !== false
      case "social":
        return settings.social !== false && settings.likes !== false
      default:
        return true
    }
  })()
  if (!categoryAllowed) return "prefs_disabled"

  const quietHours = settings.quiet_hours as QuietHours | undefined
  if (!quietHours || quietHours.enabled !== true) return null

  const start = parseClockMinutes(quietHours.start)
  const end = parseClockMinutes(quietHours.end)
  const timeZone = typeof quietHours.time_zone === "string" ? quietHours.time_zone.trim() : ""
  if (start === null || end === null || !timeZone) return "quiet_hours"

  const current = localMinuteOfDay(now, timeZone)
  if (current === null || start === end) return "quiet_hours"
  const insideWindow = start < end
    ? current >= start && current < end
    : current >= start || current < end
  return insideWindow ? "quiet_hours" : null
}
