export interface CircleActivityInput {
  activity_type: string
  target_type: string | null
  target_id: string | null
  metadata: Record<string, unknown>
}

export type CircleActivityInputResult =
  | { ok: true; value: CircleActivityInput }
  | { ok: false; error: string; status: 400 | 413 }

/** Validate activity payloads before storing user-supplied JSON in Circle history. */
export function normalizeCircleActivityInput(value: unknown): CircleActivityInputResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Invalid activity payload", status: 400 }
  }

  const body = value as Record<string, unknown>
  const activityType = body.activity_type
  const targetType = body.target_type
  const targetId = body.target_id
  const metadata = body.metadata ?? {}

  if (
    typeof activityType !== "string"
    || !/^[a-z][a-z0-9_]{0,39}$/.test(activityType)
  ) {
    return { ok: false, error: "activity_type is invalid", status: 400 }
  }
  if (
    targetType !== undefined && targetType !== null
    && (typeof targetType !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(targetType))
  ) {
    return { ok: false, error: "target_type is invalid", status: 400 }
  }
  if (targetId !== undefined && targetId !== null && (
    typeof targetId !== "string" || !targetId.trim() || targetId.length > 160
  )) {
    return { ok: false, error: "target_id is invalid", status: 400 }
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { ok: false, error: "metadata must be an object", status: 400 }
  }

  let serializedMetadata: string
  try {
    serializedMetadata = JSON.stringify(metadata)
  } catch {
    return { ok: false, error: "metadata must be valid JSON", status: 400 }
  }
  if (new TextEncoder().encode(serializedMetadata).byteLength > 4 * 1024) {
    return { ok: false, error: "Activity metadata exceeds the 4 KiB limit", status: 413 }
  }

  return {
    ok: true,
    value: {
      activity_type: activityType,
      target_type: typeof targetType === "string" ? targetType : null,
      target_id: typeof targetId === "string" ? targetId : null,
      metadata: metadata as Record<string, unknown>,
    },
  }
}

/** Only an owner or an active/approved Circle member may emit activity. */
export function canCreateCircleActivity(
  isOwner: boolean,
  membershipStatus: string | null | undefined,
): boolean {
  if (isOwner) return true
  return membershipStatus === "active" || membershipStatus === "approved"
}
