export class RustApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "RustApiError"
    this.status = status
    this.code = code
  }
}

type RustErrorPayload = {
  error?: unknown
  message?: unknown
  code?: unknown
}

/**
 * Same-origin client for the Rust API.
 *
 * Next.js forwards /api/v1/* to RUST_API_ORIGIN when configured. Keeping the
 * browser on the application origin avoids exposing internal service hosts
 * and keeps cookie-based sessions same-site.
 */
export async function rustApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const normalizedPath = path.trim().replace(/^\/+/, "")
  if (!normalizedPath || normalizedPath.split("/").some((part) => part === "..")) {
    throw new TypeError("A safe Rust API path is required")
  }

  const response = await fetch(`/api/v1/${normalizedPath}`, {
    ...init,
    credentials: "same-origin",
    cache: init.cache ?? "no-store",
  })

  if (response.status === 204) return undefined as T

  const contentType = response.headers.get("content-type") || ""
  let payload: unknown
  if (contentType.includes("application/json")) {
    payload = await response.json().catch(() => null)
  } else {
    payload = await response.text().catch(() => "")
  }

  if (!response.ok) {
    const errorPayload = payload && typeof payload === "object"
      ? payload as RustErrorPayload
      : undefined
    const message =
      (typeof errorPayload?.message === "string" && errorPayload.message) ||
      (typeof errorPayload?.error === "string" && errorPayload.error) ||
      (typeof payload === "string" && payload) ||
      `Rust API request failed (${response.status})`
    const code = typeof errorPayload?.code === "string"
      ? errorPayload.code
      : typeof errorPayload?.error === "string"
        ? errorPayload.error
        : undefined
    throw new RustApiError(message, response.status, code)
  }

  return payload as T
}


/**
 * Whether it is safe to try the legacy Next.js route during the staged rollout.
 * Domain errors from a reachable Rust API (401/403/404-with-code/422/500) must
 * be surfaced as-is rather than silently executing the old implementation.
 */
export function isRustApiUnavailable(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (!(error instanceof RustApiError)) return false

  if ([502, 503, 504].includes(error.status)) return true
  return error.status === 404 && !error.code
}
