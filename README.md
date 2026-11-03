# Loop — Social Media Reimagined

A full-stack social platform built with Next.js 15, Supabase, Better Auth, and TypeScript.

## Tech Stack

- **Frontend:** Next.js 15, React 19, Tailwind CSS, shadcn/ui, Framer Motion
- **Backend:** Next.js API routes, Supabase PostgreSQL (162 tables)
- **Auth:** Better Auth (migrated from Supabase Auth)
- **Storage:** Cloudinary (images/video), Supabase Storage (fallback)
- **Payments:** Stripe (subscriptions, USD purchases)
- **Realtime:** Supabase Realtime + Socket.io
- **Live Streaming:** LiveKit / 100ms

## Getting Started

```bash
npm install
cp .env.example .env.local   # fill in your keys
npm run dev
```

## Environment Variables

Required keys — add them in `.env.local` or your hosting dashboard:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret |
| `CRON_SECRET` | Secret for cron endpoints |

See `.env.example` for the full list.

## Project Structure

```
app/
├── api/              # 245+ API routes
│   ├── admin/        # Admin endpoints
│   ├── auth/         # Better Auth routes
│   ├── cron/         # Scheduled tasks
│   └── ...           # Feature routes
├── circles/          # Community pages
├── profile/          # User profiles
├── loop/             # Loop detail pages
└── settings/         # User settings
components/           # React components
lib/                  # Shared utilities
convex/               # Convex backend (if used)
```

## Key Features

- **Loop Trees** — Branching conversations (up to 10 levels deep)
- **Circles** — Discord-like communities with rooms, voice, events
- **Co-Loop** — Real-time collaborative content creation
- **Gifting & Coins** — Virtual economy with shop, gifts, earnings
- **Cosmetics** — Profile themes, frames, auras, badges
- **Duels** — Community voting on creative content
- **Developer Hub** — Code sharing with live previews
- **Premium** — Subscription tiers with Pro features

## Deployment

Built for Render (or any Node.js host):

```bash
npm run build   # produces .next/ output
npm start       # starts production server
```

Pushes to `main` are picked up by the VPS every minute (`loop-autodeploy.timer`,
`/var/loop/deploy-production.sh`): fetch → install → build → `pm2 restart
loop-app` → health check → share-card check.

## Share Cards (OG Images)

Every shareable page points at `/api/og?type=…`, which renders a 1200x630 PNG
with satori. Check any card by opening its URL, or verify all of them at once:

```bash
npm run check:og                        # against https://loopapp.me
npm run check:og -- http://127.0.0.1:3000   # against a local server
```

To inspect what a real page advertises, view its source and look for
`og:image` / `twitter:image`, or paste the page URL into the
[Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) or the
[X Card Validator](https://cards-dev.twitter.com/validator).

Satori is stricter than a browser: a `<div>` with more than one child node must
declare `display: flex | none`, and `background` cannot mix a colour with a
gradient. `__tests__/og-engine.test.ts` walks every template tree and fails if a
card breaks either rule, so these bugs cannot ship silently.

## Rust backend transition

LOOP is moving its server-side application layer to Rust. The Next.js/React application remains the presentation layer; new domain APIs, authentication, persistence, media authorization and background processing belong in the Rust service under backend/.

The Rust API foundation currently provides PostgreSQL readiness, an optional private S3 adapter, a local PostgreSQL + MinIO Compose stack, and a dedicated CI workflow. Existing Next.js API routes and Supabase integrations are still present during the staged migration; this foundation does not claim that the migration is complete.

Local Rust API development:

1. Install stable Rust and Docker Compose.
2. Change into backend/ and copy .env.example to .env.
3. Run docker compose up --build.
4. Check http://localhost:8080/health/live and http://localhost:8080/health/ready.

See docs/PRODUCT_EXPERIENCE_ARCHITECTURE.md, docs/DESIGN_SYSTEM_REVAMP.md and docs/RUST_PLATFORM_MIGRATION.md before adding new product surfaces or backend routes.

## Documentation

Detailed guides are in [`docs/`](./docs/):

- [Implementation Guide](docs/COMPLETE_IMPLEMENTATION_GUIDE.md)
- [Deployment Guide](docs/FINAL_DEPLOYMENT_GUIDE.md)
- [UUID → Snowflake Migration Plan](docs/MIGRATION_PLAN_UUID_TO_SNOWFLAKE.md)
- [Setup & Testing](docs/SETUP_AND_TESTING_GUIDE.md)


## Legal publication readiness

Before enabling account agreement in production, the service operator must complete the verified legal identity, contacts, active production providers, data locations, transfer safeguards, and retention schedule in both the Next.js and Rust API environments. See [Legal Publication Readiness](docs/LEGAL_PUBLICATION.md). The Rust API refuses to record document acceptance while required publication details are missing.
