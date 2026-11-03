import "server-only"
import webpush from "web-push"
import { createServerClient } from "@/lib/supabase"
import { getPushSuppressionReason, type PushCategory } from "@/lib/notification-preferences"
export type { PushCategory } from "@/lib/notification-preferences"

/** Fallback VAPID pair so push works if env vars are missing (override in production). */
const FALLBACK_PUBLIC =
  "BCgXnCCUy_9jTxtskWgxBZ7xnGPHgl0CNnbiT_r3XrEguBSYzQK06QD-fhJqlqWtjRbnB7y_S-nJWJcZqrAsli4"
const FALLBACK_PRIVATE = "vGZQ7vsLA1RDpsrFin2r3HTTIz3ZH4hffjE5k-f0zWo"

export function getVapidPublicKey() {
  return (
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ||
    process.env.VAPID_PUBLIC_KEY?.trim() ||
    FALLBACK_PUBLIC
  )
}

function getVapidPrivateKey() {
  return process.env.VAPID_PRIVATE_KEY?.trim() || FALLBACK_PRIVATE
}

function getVapidSubject() {
  return process.env.VAPID_SUBJECT?.trim() || "mailto:support@loopapp.me"
}

let configured = false

function ensureWebPush() {
  if (configured) return
  webpush.setVapidDetails(getVapidSubject(), getVapidPublicKey(), getVapidPrivateKey())
  configured = true
}

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
  icon?: string
  badge?: string
  data?: Record<string, unknown>
}



function normalizeSubscription(raw: any): webpush.PushSubscription | null {
  if (!raw) return null
  const sub = raw.subscription || raw
  const endpoint = sub.endpoint || raw.endpoint
  const keys = sub.keys || raw.keys
  if (!endpoint || !keys?.p256dh || !keys?.auth) return null
  // Reject obvious mocks from older clients
  if (
    /push-fallback-service|demo_p256dh|demo_auth/i.test(endpoint) ||
    keys.p256dh === "demo_p256dh_key" ||
    keys.auth === "demo_auth_key"
  ) {
    return null
  }
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }
}

/**
 * Send a real Web Push to all of a user's browser subscriptions.
 * Removes expired/invalid endpoints automatically.
 */
export async function sendWebPushToUser(
  userId: string,
  payload: PushPayload,
  options?: { category?: PushCategory; skipPrefsCheck?: boolean },
): Promise<{ delivered: number; failed: number; skipped?: string }> {
  if (!userId) return { delivered: 0, failed: 0, skipped: "no_user" }

  const supabase = createServerClient()

  if (!options?.skipPrefsCheck) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("notification_settings")
      .eq("id", userId)
      .maybeSingle()

    const settings = (profile as any)?.notification_settings
    const suppression = getPushSuppressionReason(settings, options?.category || "system")
    if (suppression) return { delivered: 0, failed: 0, skipped: suppression }
  }

  const { data: rows, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, subscription")
    .eq("user_id", userId)

  if (error || !rows?.length) {
    return { delivered: 0, failed: 0, skipped: error?.message || "no_subscriptions" }
  }

  ensureWebPush()

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || "/icons/icon-144x144.png",
    badge: payload.badge || "/icons/icon-144x144.png",
    tag: payload.tag || "loop-notification",
    data: {
      url: payload.url || "/",
      ...(payload.data || {}),
    },
    requireInteraction: false,
  })

  let delivered = 0
  let failed = 0
  const staleIds: string[] = []

  await Promise.all(
    rows.map(async (row: any) => {
      const subscription = normalizeSubscription(row)
      if (!subscription) {
        staleIds.push(row.id)
        failed += 1
        return
      }
      try {
        await webpush.sendNotification(subscription, body, {
          TTL: 60 * 60,
          urgency: "normal",
        })
        delivered += 1
      } catch (err: any) {
        failed += 1
        const status = err?.statusCode || err?.status
        if (status === 404 || status === 410) {
          staleIds.push(row.id)
        } else {
          console.warn("web-push send failed:", status || err?.message)
        }
      }
    }),
  )

  if (staleIds.length) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds)
  }

  return { delivered, failed }
}

export async function sendWebPushToUsers(
  userIds: string[],
  payload: PushPayload,
  options?: { category?: PushCategory },
) {
  const unique = [...new Set(userIds.filter(Boolean))]
  const results = await Promise.all(unique.map((id) => sendWebPushToUser(id, payload, options)))
  return results.reduce(
    (acc, r) => ({ delivered: acc.delivered + r.delivered, failed: acc.failed + r.failed }),
    { delivered: 0, failed: 0 },
  )
}
