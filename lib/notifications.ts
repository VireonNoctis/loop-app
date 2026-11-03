import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { sendWebPushToUser, sendWebPushToUsers, type PushCategory, type PushPayload } from "@/lib/web-push"
import { sendFcmToUser } from "@/lib/fcm"
import { isSystemNotificationType, maskAdminCopy } from "@/lib/notification-copy"
import { getPushSuppressionReason } from "@/lib/notification-preferences"

export type NotifyInput = {
  userId: string
  type: string
  title: string
  message: string
  data?: Record<string, unknown>
  actionUrl?: string
  actorId?: string | null
  /** Maps to profile.notification_settings push prefs */
  pushCategory?: PushCategory
  /** Skip inserting in-app row (push only) */
  pushOnly?: boolean
  /** Skip web push (in-app only) */
  inAppOnly?: boolean
  /** Priority: "high" pushes immediately, "low" batches (default: "high") */
  priority?: "high" | "low"
}

/**
 * Create an in-app notification and deliver a real browser Web Push.
 * Safe to call from any API route — never throws to callers.
 */
export async function notifyUser(
  supabase: SupabaseClient,
  input: NotifyInput,
): Promise<{ notificationId?: string; pushDelivered: number }> {
  let notificationId: string | undefined
  let pushDelivered = 0

  // Platform-originated notifications must never reveal that a human admin
  // acted — they read as coming from Loop itself ("You received 100 coins").
  const platformOriginated = isSystemNotificationType(input.type) || input.pushCategory === "system"
  const title = platformOriginated ? maskAdminCopy(input.title) : input.title
  const message = platformOriginated ? maskAdminCopy(input.message) : input.message

  try {
    if (!input.pushOnly) {
      const row: Record<string, unknown> = {
        user_id: input.userId,
        type: input.type,
        title,
        message,
        data: {
          ...(input.data || {}),
          ...(input.actionUrl ? { url: input.actionUrl, action_url: input.actionUrl } : {}),
        },
        is_read: false,
      }
      if (input.actorId) row.actor_id = input.actorId
      if (input.actionUrl) row.action_url = input.actionUrl

      const { data, error } = await supabase.from("notifications").insert(row).select("id").maybeSingle()
      if (error) {
        // Retry without optional columns that may not exist on older schemas
        const { data: fallback, error: fallbackError } = await supabase
          .from("notifications")
          .insert({
            user_id: input.userId,
            type: input.type,
            title,
            message,
            data: row.data,
          })
          .select("id")
          .maybeSingle()
        if (fallbackError) {
          console.warn("notifyUser insert failed:", fallbackError.message)
        } else {
          notificationId = fallback?.id
        }
      } else {
        notificationId = data?.id
      }
    }

    // Priority-based push delivery:
    // High (default): always push immediately — mentions, replies, DMs, duels, coloop invites
    // Low: skip push, in-app only — generic likes, follows, boosts
    if (!input.inAppOnly && input.priority !== "low") {
      const payload: PushPayload = {
        title,
        body: message,
        url: input.actionUrl || "/",
        tag: `${input.type}-${input.userId}`,
        data: {
          ...input.data,
          priority: input.priority || "high",
          // Add action buttons for interactive notifications
          ...(input.type === "comment" || input.type === "reply" || input.type === "message" ? {
            actions: [
              { action: "reply", title: "Reply", type: "text" },
              { action: "open", title: "Open" },
            ],
            reply_placeholder: input.type === "message" ? "Type a message…" : "Type a reply…",
          } : {}),
          ...(input.type === "like" ? {
            actions: [
              { action: "like_back", title: "❤️ Like back" },
            ],
          } : {}),
        },
      }
      const category = input.pushCategory || "system"
      // Resolve preferences once before either transport. If this lookup fails,
      // keep the in-app notification but do not bypass a user's push controls.
      const { data: preferenceProfile, error: preferenceError } = await supabase
        .from("profiles")
        .select("notification_settings")
        .eq("id", input.userId)
        .maybeSingle()

      if (preferenceError || !preferenceProfile) {
        console.warn("Push delivery skipped because notification preferences could not be loaded:", preferenceError?.message || "profile missing")
      } else if (!getPushSuppressionReason(preferenceProfile.notification_settings, category)) {
        const result = await sendWebPushToUser(input.userId, payload, {
          category,
          skipPrefsCheck: true,
        })
        pushDelivered = result.delivered
        // A missing browser subscription is not a preference opt-out: native
        // devices may still be registered and should receive the same alert.
        await sendFcmToUser(supabase, input.userId, {
          title,
          body: message,
          url: input.actionUrl || "/",
          icon: payload.icon,
          data: input.data,
        })
      }
    }
  } catch (err) {
    console.warn("notifyUser error:", err)
  }

  return { notificationId, pushDelivered }
}

export async function notifyUsers(
  supabase: SupabaseClient,
  userIds: string[],
  shared: Omit<NotifyInput, "userId">,
) {
  const unique = [...new Set(userIds.filter(Boolean))]
  await Promise.all(unique.map((userId) => notifyUser(supabase, { ...shared, userId })))
}

export async function pushOnlyToUsers(
  userIds: string[],
  payload: PushPayload,
  category: PushCategory = "system",
) {
  return sendWebPushToUsers(userIds, payload, { category })
}
