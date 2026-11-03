import type { Metadata } from "next"
import { buildOgMetadata } from "@/lib/og/metadata"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SharedResourceKind = "chain" | "collection"
export type PublicRustResource = "chains" | "collections"

export interface SharedResourceMetadataInput {
  baseUrl: string
  path: string
  kind: SharedResourceKind
  visibility: string
  title: string
  description?: string | null
  itemCount?: number | null
  creatorName?: string | null
  creatorUsername?: string | null
  creatorAvatarUrl?: string | null
}

function cleanMetaText(value: unknown, limit: number): string {
  if (typeof value !== "string") return ""
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit)
}

function resourceLabel(kind: SharedResourceKind): string {
  return kind === "chain" ? "Chain" : "Collection"
}

/**
 * Build the same canonical/Open Graph/Twitter metadata for public share pages.
 * Unlisted URLs remain shareable but are deliberately excluded from search
 * indexing. Private and Circle-only resources must never pass this builder
 * unless the public API has explicitly returned them as visible to everyone.
 */
export function buildSharedResourceMetadata(input: SharedResourceMetadataInput): Metadata {
  const label = resourceLabel(input.kind)
  const title = cleanMetaText(input.title, 90) || `${label} on LOOP`
  const description =
    cleanMetaText(input.description, 180) ||
    (input.kind === "chain"
      ? "A collaborative Chain on LOOP. Explore the work and add a contribution."
      : "A shared Collection on LOOP. Explore its curated items.")
  const count = Number.isFinite(input.itemCount) ? Math.max(0, Math.floor(input.itemCount || 0)) : undefined
  const publiclyIndexable = input.visibility === "public"

  return buildOgMetadata({
    baseUrl: input.baseUrl,
    path: input.path,
    type: "project",
    title,
    description,
    ogType: "article",
    robots: publiclyIndexable ? undefined : { index: false, follow: false },
    params: {
      name: cleanMetaText(input.creatorName, 40) || `${label} on LOOP`,
      username: cleanMetaText(input.creatorUsername, 30).replace(/^@/, "") || undefined,
      avatar: cleanMetaText(input.creatorAvatarUrl, 2048) || undefined,
      category: label,
      stat: count,
      stat_label: input.kind === "chain" ? "contributions" : "items",
      url: "loopapp.me",
    },
  })
}

/** Generic, noindex fallback for unavailable, private, or not-yet-migrated data. */
export function buildUnavailableSharedResourceMetadata(
  baseUrl: string,
  path: string,
  kind: SharedResourceKind,
): Metadata {
  const label = resourceLabel(kind)
  return buildOgMetadata({
    baseUrl,
    path,
    type: "project",
    title: `${label} — LOOP`,
    description: `Explore public ${label.toLowerCase()}s on LOOP.`,
    ogType: "article",
    robots: { index: false, follow: false },
    params: { category: label },
  })
}

/**
 * Fetch only anonymously readable Rust resources. The API's own visibility
 * query is the authorization boundary: private/Circle-only resources return
 * 404 here and therefore never contribute data to crawler metadata.
 */
export async function fetchPublicRustResource<T>(
  resource: PublicRustResource,
  id: string,
): Promise<T | null> {
  if (!UUID_PATTERN.test(id)) return null

  const configuredOrigin = process.env.RUST_API_ORIGIN?.trim()
  const origin = configuredOrigin ||
    (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8080" : "")
  if (!origin) return null

  try {
    const parsedOrigin = new URL(origin)
    if (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:") return null

    const response = await fetch(
      new URL(`/v1/${resource}/${encodeURIComponent(id)}`, parsedOrigin),
      {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(3500),
      },
    )
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}
