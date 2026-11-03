# LOOP Rust API

This is the Rust backend foundation for LOOP. The Next.js application remains the frontend; new server-side domain behaviour belongs here.

## Local development

Requirements: stable Rust, Docker and Docker Compose.

1. Copy .env.example to .env.
2. Start PostgreSQL and SeaweedFS with docker compose up -d postgres seaweedfs.
3. Run cargo run from this directory.
4. Check http://localhost:8080/health/live and /health/ready.

The Compose stack applies embedded additive SQLx migrations to its local database by default. Standalone API runs default to RUN_MIGRATIONS=false. Never enable automatic migrations against production without a reviewed change window and verified backup.

Or run the full local stack with docker compose up --build. PostgreSQL is exposed only on 127.0.0.1:54329 and the S3-compatible SeaweedFS endpoint only on 127.0.0.1:8333. Local object-store credentials are development-only; never reuse them on a public server.

## Endpoints

- GET /health/live — process liveness.
- GET /health/ready — PostgreSQL readiness.
- GET /v1/system/capabilities — service version and configured infrastructure capabilities.
- GET /v1/me — authenticated current user resolved through the existing Better Auth session and profiles rows.
- GET /v1/drops — a unified activity feed across official events, hosted events, Circle events and active Circle challenges.
- GET /v1/collections — public, owned and collaborated collections.
- GET /v1/users/{target_id}/follow-state — authenticated follow and follow-request state.
- GET /v1/users/{target_id}/followers and /following — public or authorized social lists, with block filtering and viewer follow state.
- GET /v1/follow-requests — incoming and outgoing private-profile follow requests.
- POST /v1/follow-requests/{request_id} — accept or decline an incoming follow request.
- POST /v1/users/{target_id}/follow — follow, unfollow or request private-profile access.
- DELETE /v1/users/{target_id}/follow-request — withdraw a pending request.
- GET /v1/notifications — recipient-scoped, actor-enriched notification inbox.
- PATCH /v1/notifications/read — mark specific notifications or all notifications as read.
- DELETE /v1/notifications and DELETE /v1/notifications/{id} — clear recipient-owned notifications.
- POST /v1/collections — create a collection.
- GET /v1/collections/{collection_id} — view a visible collection and its items.
- POST /v1/collections/{collection_id}/items — add an accessible Loop, Circle or HTTPS link.
- DELETE /v1/collections/{collection_id}/items/{item_id} — remove an item with owner/editor permission.

When deploying the Next.js frontend outside local development, set RUST_API_ORIGIN to the private or reverse-proxied base URL of this API (for example, https://api.example.com). Next.js forwards same-origin /api/v1/* calls to this origin. This is required for the legal consent gate and other migrated Rust API features. Keep the origin server-side; never expose it as a NEXT_PUBLIC variable.

The S3 storage adapter is intentionally private to the backend. Local development uses SeaweedFS, an Apache-2.0 S3-compatible object store, at http://127.0.0.1:8333 with the private loop-dev bucket. The same Rust AWS S3 SDK adapter can use a self-hosted SeaweedFS endpoint or a compatible S3 provider without changing application code. Upload signing is not exposed until authenticated session and resource-authorization middleware is in place. Do not add an unauthenticated presign endpoint.

## Environment

See .env.example. The checked-in values are local-only SeaweedFS credentials. For a self-hosted deployment, generate unique secrets and restrict them to the LOOP bucket. For an AWS deployment, use an attached workload identity/role instead of hard-coding long-lived credentials. Never put storage credentials in frontend environment variables.

## Storage and hosting choices

The default self-hostable stack is PostgreSQL + SeaweedFS + the Rust API, run with Docker Compose. PostgreSQL replaces the managed relational database role; SeaweedFS replaces the S3 object-store role. These projects have no software licence fee, but production still needs hardware or a server, power/network, monitoring, backups, off-site recovery and maintenance. No self-hosted software can make those infrastructure costs disappear.

Coolify is an optional open-source deployment control plane for deploying the Next.js app, Rust API, PostgreSQL and other Docker services to a server you provide. It is not hosting by itself, and it does not remove server, bandwidth or backup costs.

## Migration rule

Do not point this service at production until a verified backup, staging restore, schema inventory and rollback plan exist. The first stage shares no production writes and does not change the existing app API.
