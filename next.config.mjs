/** @type {import('next').NextConfig} */

// Force blocking metadata into <head> for all UAs (including Googlebot).
// Next 15 streams metadata by default for "dom" bots like Googlebot, which
// leaves the initial HTML without <title>/<meta name="description">.

// NOTE: Content-Security-Policy and X-Frame-Options are deliberately NOT set
// here. They live in lib/security-headers.ts and are applied by middleware,
// because the framing policy differs per route: /preview/{id} is embedded in
// third-party pages, everything else refuses to be framed.
//
// Defining them in both places is what broke that: this file used to send
// `frame-ancestors *` while middleware sent `X-Frame-Options: DENY`, and only
// middleware's copy reached the browser (verified against production), so the
// embed feature was blocked and the permission here was a fiction. One source.
const baselineSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(self), usb=()",
  },
]

const nextConfig = {
  experimental: {
    // How long the client router may reuse an already-fetched route payload
    // before re-requesting it from the server. The default for dynamic routes
    // is 0, which made every revisit (back button, tab switch, re-tapping a
    // nav item) a fresh server round-trip and re-render. A short window keeps
    // navigation instant while still picking up new data quickly.
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
  },
  // NOTE: Do not set `output: "standalone"` here — the deploy targets are
  // Vercel (which ignores it) and Render (whose `next start` start command is
  // incompatible with standalone output). There is no Docker/VPS target that
  // consumes the standalone server bundle.
  // Keep Node-only packages out of the client/Edge bundles.
  serverExternalPackages: ["stripe", "web-push", "https-proxy-agent", "agent-base"],
  // On by default. Set NEXT_BROWSER_SOURCE_MAPS=0 to skip browser source maps
  // when building on a small (≈2GB / 1 vCPU) machine, where generating them for
  // this app is what pushes the build over the memory limit.
  productionBrowserSourceMaps: process.env.NEXT_BROWSER_SOURCE_MAPS !== "0",
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "http", hostname: "localhost" },
      { protocol: "https", hostname: "localhost" },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        tls: false,
        fs: false,
        dns: false,
        child_process: false,
      }
    }
    return config
  },
  async redirects() {
    return [
      { source: "/terms-of-service", destination: "/terms", permanent: true },
      { source: "/terms-of-use", destination: "/terms", permanent: true },
      { source: "/tos", destination: "/terms", permanent: true },
      { source: "/legal/terms", destination: "/terms", permanent: true },
      { source: "/privacy-policy", destination: "/privacy", permanent: true },
      { source: "/legal/privacy", destination: "/privacy", permanent: true },
    ]
  },
  async rewrites() {
    const rustApiOrigin = (process.env.RUST_API_ORIGIN || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8080" : "")).replace(/\/+$/, "")

    return [
      ...(rustApiOrigin
        ? [{
            // Same-origin browser calls are forwarded to the Rust service.
            // Keep this opt-in until a domain is migrated and verified.
            source: "/api/v1/:path*",
            destination: `${rustApiOrigin}/v1/:path*`,
          }]
        : []),
      {
        source: "/api/trees/:path*",
        destination: "/api/reels/:path*",
      },
      // Redirect /co-loop/{sessionId} (missing /join/) to /co-loop/join/{sessionId}
      {
        source: "/co-loop/:session",
        destination: "/co-loop/join/:session",
        has: [
          {
            type: "header",
            key: "accept",
            value: ".*text/html.*",
          },
        ],
      },
    ]
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: baselineSecurityHeaders,
      },
      {
        source: "/manifest.json",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
      {
        source: "/og-image.jpg",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
          { key: "Content-Type", value: "image/jpeg" },
        ],
      },
      {
        source: "/api/download/apk",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
        ],
      },
    ]
  },
}

export default nextConfig
