# LOOP Rust Backend and AWS Platform Migration

## Target architecture

The frontend remains Next.js and React. It owns rendering, routing, local UI state and accessibility. It must not own business logic, database access, authentication decisions, payment rules, media authorization or background jobs.

All server-side application behaviour moves into a Rust service. The target API uses Axum, SQLx and PostgreSQL. Object media lives in private S3 buckets and is accessed through short-lived presigned URLs after authorization.

Initial backend service location: backend/

## Rust service boundaries

The Rust API owns:
- Authentication, sessions, account lifecycle and authorization.
- User profiles, interests, follows and blocks.
- Loops, branches, Chains, reactions and comments.
- Circles, roles, memberships, projects and events.
- Direct/group messaging and realtime presence.
- Notifications and user preferences.
- Media metadata, upload policies and object access.
- Search, recommendations and ranking.
- Creator tools, wallet ledger and billing integration.
- Moderation, reporting, audit logs and safety controls.
- Scheduled jobs, email/push orchestration and webhooks.

Do not add new Next.js route handlers for domain behaviour. Migrate existing app/api routes domain by domain and keep temporary compatibility adapters only while a route is being cut over.

## API and frontend boundary

- The browser calls the Rust API through a same-origin /api/v1 gateway path.
- The Next.js application does not import a server database client or contain service credentials.
- Rust validates every request, authenticates the session and enforces authorization on the server.
- Use typed request/response contracts and generate or maintain a versioned OpenAPI document.
- Keep stable resource IDs and public share URLs while implementations move.
- Add idempotency keys to money-adjacent and retryable mutation endpoints.
- Apply request size limits, timeouts, rate limits, audit events and structured tracing centrally.

The current backend folder starts with health/readiness and PostgreSQL/S3 connectivity primitives. It is not yet a replacement for the existing API surface.

## PostgreSQL migration

The current application uses Supabase-backed PostgreSQL, with Better Auth tables and Supabase-specific APIs around it. PostgreSQL data can be migrated, but Supabase is more than a database: Auth, Realtime, Storage, PostgREST, extensions, policies and helper functions require explicit replacements.

Migration procedure:

1. Inventory all tables, views, functions, triggers, extensions, RLS policies, auth tables, storage references and scheduled jobs.
2. Take an encrypted, verified backup and restore it to an isolated staging PostgreSQL database.
3. Compare row counts, foreign keys, indexes, constraints, sequences and representative application queries.
4. Identify Supabase-specific dependencies such as auth.uid(), storage.objects, realtime publication tables and Supabase helper functions. Reimplement required behaviour in Rust/PostgreSQL instead of assuming RDS supplies it.
5. Introduce versioned SQLx migrations. Never run the existing legacy schema scripts against production as a blind batch.
6. Run the Rust API against a staging clone and exercise every critical user journey.
7. Use a controlled write freeze or a documented dual-write/catch-up procedure for final cutover.
8. Verify counts, checksums, login, feeds, messaging, uploads, notifications and rollback before changing production traffic.
9. Keep the old database available and read-only for the agreed rollback window.

Do not delete the source project or its backups until the cutover is verified and the owner signs off.

## Media and S3

Use private buckets with separate prefixes or buckets for public derivatives, private uploads and quarantine. The Rust API decides who may upload or read an object. It issues short-lived presigned PUT/GET URLs; clients never receive AWS credentials.

Required controls:
- MIME type and size allowlists.
- Generated object keys; never trust a supplied path.
- Upload authorization tied to the user and target resource.
- Quarantine and validation before publication.
- Image/video processing in an isolated worker.
- Explicit deletion and retention policies.
- Lifecycle rules for incomplete multipart uploads and temporary objects.
- Private bucket, block-public-access and least-privilege IAM defaults.
- CDN only after measuring the cost and access patterns.

Local development should use PostgreSQL in Docker and an S3-compatible local object store. Production can use AWS S3 without changing the storage interface.

## AWS cost reality

Do not describe AWS RDS or S3 as permanently free. AWS's current new-account offer provides up to USD 200 in credits for a limited period; the Free account plan ends after six months or when credits are exhausted, whichever comes first. AWS says a Free account plan then closes and resources/data are eventually deleted unless the account is upgraded. RDS and S3 usage is billable beyond applicable offers and credits.

Therefore:
- Develop locally with Docker PostgreSQL and a local S3-compatible store.
- Keep the app portable across PostgreSQL and S3-compatible object storage.
- Use a single-AZ, smallest suitable PostgreSQL instance for a temporary AWS proof of concept only.
- Create billing alerts and a budget before provisioning resources.
- Avoid NAT Gateways, always-on load balancers, unnecessary public IPv4 addresses and oversized databases.
- Keep encrypted exports outside the AWS Free account before its expiry.
- Do not upgrade to paid AWS without explicit budget approval from the account owner.

A genuine production social platform cannot be promised at zero cost. Media egress, database uptime, realtime traffic, backups, email, observability and compute all have operating costs.

## Realtime

Replace Supabase Realtime and the current Socket.IO dependency with Rust-managed WebSocket channels, starting with:
- direct and group messages,
- Co-Loop presence and session events,
- notification delivery,
- lightweight Circle activity.

Use PostgreSQL as the durable source of truth. Do not use an in-memory broadcast channel as the only copy of a message or event. Introduce a durable outbox and reconnect/cursor semantics before scaling across multiple service instances.

## Authentication

Move the existing Better Auth service boundary into Rust. Preserve user IDs and verified email status. Add secure, HttpOnly, SameSite cookies; CSRF protection for cookie-authenticated mutations; password hashing with Argon2id; session rotation and revocation; rate limits; email verification; password reset; and OAuth state/PKCE validation.

Do not store access tokens in localStorage. Do not expose service credentials to the browser. Add WebAuthn/passkeys as a later enhancement after core session migration.

## Deployment

The Rust service should be a stateless container with explicit health checks and structured logs. The initial container and compose files support local PostgreSQL development. AWS deployment configuration must be added only after the service, migration plan, IAM permissions, backup plan and cost ceilings are reviewed.

## Migration status

- [x] Rust service workspace and local Postgres/S3 configuration foundation.
- [x] Liveness/readiness endpoint design.
- [ ] Rust authentication and session implementation.
- [ ] SQLx migration baseline from the current production schema.
- [ ] S3 upload/download endpoints with authenticated authorization.
- [ ] Rust domain API migration by bounded feature area.
- [ ] WebSocket replacement for Realtime/Socket.IO.
- [ ] AWS deployment infrastructure and cutover runbook.
- [ ] Supabase and Next.js domain API removal after parity verification.


## Social graph and notification migration

The first Rust social graph vertical slice is now in the service:

- `GET /v1/users/{target_id}/follow-state` returns the authenticated viewer's follow/request state and the target's public follower count.
- `POST /v1/users/{target_id}/follow` creates/removes a relationship or creates a private-profile follow request.
- `DELETE /v1/users/{target_id}/follow-request` withdraws the authenticated requester's pending request.
- Follow relationship, counter updates and in-app notification writes are transactionally committed.
- `GET /v1/notifications`, `PATCH /v1/notifications/read`, `DELETE /v1/notifications` and `DELETE /v1/notifications/{id}` are scoped to the authenticated recipient.
- New migrations add follows, follow_requests, user_blocks and actor-enriched notifications while preserving existing UUID identifiers.

The profile screen and notification dropdown call these Rust endpoints first. A temporary fallback to the legacy Next.js routes remains until the Rust API is deployed in the target environment. Realtime notification delivery still uses the existing Postgres change subscription and polling; the next migration stage will replace that transport with durable Rust-managed WebSocket events and reconnect cursors.

The notification list deliberately returns the authenticated user's records only. The API never accepts a recipient user ID from the client for reads, updates or deletes. Follow and notification writes are performed in the same Postgres transaction where they represent one domain action.
