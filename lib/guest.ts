/** Routes guests may browse without signing in */
export const GUEST_PUBLIC_PREFIXES = [
  "/",
  "/landing",
  "/login",
  "/signup",
  "/terms",
  "/privacy",
  "/reset-password",
  "/verify-email",
  "/email-confirmed",
  "/explore",
  "/trending",
  "/profile",
  "/loop",
  "/hashtag",
  "/search",
  "/trees",
  "/marketplace",
  "/invite",
  "/offline",
  // Public browse & showcase pages
  "/developers",
  "/events",
  "/games",
  "/help",
  "/verification",
  "/co-loop/join",
] as const

/** Interactive / account routes that always require auth */
export const AUTH_REQUIRED_PREFIXES = [
  "/messages",
  "/circles",
  "/shop",
  "/lounge",
  "/settings",
  "/notifications",
  "/create",
  "/onboarding",
  "/legal/consent",
  "/loopadmin",
  "/organization",
  "/bookmarks",
  "/premium",
  "/streams",
  "/inventory",
  // Account / wallet routes
  "/wallet",
  "/earnings",
  "/support",
  "/co-loop/studio",
] as const

export function isGuestPublicPath(pathname: string) {
  if (!pathname) return false
  return GUEST_PUBLIC_PREFIXES.some(
    (route) => pathname === route || (route !== "/" && pathname.startsWith(`${route}/`)) || (route === "/" && pathname === "/"),
  )
}

export function isAuthRequiredPath(pathname: string) {
  return AUTH_REQUIRED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/**
 * True when the request carries a signed-in session cookie.
 *
 * Used both for the server-side route guard and for deciding whether an API
 * request is anonymous traffic (rate limited per IP) or a signed-in caller's
 * request (throttled per account instead). Pure and dependency-free so the
 * edge middleware and unit tests can share it.
 */
export function hasSessionCookie(cookieNames: readonly string[]) {
  return cookieNames.some(
    (name) =>
      name.includes("better-auth") ||
      name.includes("supabase") ||
      name.startsWith("sb-"),
  )
}

export function loginHref(nextPath?: string | null, reason?: string) {
  const params = new URLSearchParams()
  if (nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    params.set("redirect", nextPath)
  }
  if (reason) params.set("reason", reason)
  const qs = params.toString()
  return qs ? `/login?${qs}` : "/login"
}
