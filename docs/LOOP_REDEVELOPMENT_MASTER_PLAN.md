# LOOP — Product Vision & Redevelopment Roadmap

> Product brief: Create together. Discover everything. Connect through shared interests.

This document is the canonical product brief for the major LOOP redevelopment. It preserves the product direction established in the original concept: LOOP is not a collage of Instagram, TikTok, Pinterest and Discord. It is a collaborative social platform where people make things together, discover communities and interests, and build experiences that become more valuable through participation.

## 1. Product philosophy

LOOP should reward meaningful creation, participation, collaboration and connection—not passive consumption, follower competition or compulsive engagement.

The product should make it easy to:
- Start something worth contributing to.
- Find people and Circles that share an interest.
- Add a meaningful contribution to something already in motion.
- Collaborate live or asynchronously.
- Preserve, organize and share the things a community creates.
- Explore public work on the web before deciding to join.

The product must remain accessible, calm, privacy-conscious, mobile-first and fast. Chronological and interest-based discovery must remain available alongside recommendations. Recommendation controls should be understandable. Quiet hours, notification controls, reduced-motion support and progressive disclosure are core product requirements.

## 2. The core product model

### Chains — the defining LOOP experience

A Chain is a collaborative object started by one person and developed by many. It is not the same thing as an ordinary post or a Branch in a post's reply tree.

A Chain has:
- A stable identity, title, description, cover and opening prompt.
- A format/template that defines the kind of contributions it accepts.
- A creator, contributors, optional collaborators and a visible contribution history.
- An evolving collection of contributions, with attribution and discussion.
- Visibility and contribution policies controlled by its creator.
- A shareable public web page and a clear path back to its Circle or source.

Initial formats should include collaborative stories, fictional universes/worldbuilding, rankings, playlists, galleries/photo prompts, recommendation lists, community projects and open-ended collections. The data model must support text, image, video, audio, links and structured payloads rather than making text the only contribution type.

A Chain should eventually support branching contribution paths, forks/remixes, revisions, moderation, role-based collaboration, templates, exports and final/shareable outcomes. Contribution history should preserve attribution. Deleted or moderated material must not silently rewrite the history of other contributors.

### Circles — the community layer

A Circle is a living interest-based community, not just a group chat. It has its own identity, members, custom roles, permissions, guidelines, moderation, discussions, Chains, Collections, Drops, events, projects and activity.

Circle work must preserve:
- Public, unlisted and private discovery/access boundaries.
- Join requests, approvals, leaving and bans as distinct membership states.
- Custom roles and permission checks enforced by the server.
- Owner/admin/moderator/member separation and safe ownership transfer.
- Community identity, categories, tags, artwork and customizable spaces.
- Member privacy, reporting, blocking and transparent moderation actions.

Subcommunities/spaces should let large Circles organize around topics without fragmenting their identity or social graph.

### Drops — temporary activities

Drops are an activity layer over optional creative prompts, daily/weekly themes, predictions, polls, guessing games, seasonal activities, competitions and community-created events. Participation must stay optional: no punitive streak loss, artificial scarcity, wagering or pressure notifications.

### Discover — the interest graph

Discover should help people find Chains, Circles, creators, conversations, collections, projects and emerging interests. Ranking can use declared interests, followed Circles, contribution history and user-controlled interactions, but the interface must explain why something is recommended and provide chronological, community, interest and personalized modes.

### Living profiles

Profiles are evolving personal spaces that showcase interests, created Chains, contributions, Collections, Circles, achievements and creative projects. Layouts, themes, widgets and cosmetics should be customizable without turning profile customization into a pay-to-be-authentic system. Privacy settings apply to each profile surface and object.

### Collections

Collections let people organize and share Loops, Chains, Circles, media and external references. They can be private, unlisted or public, and optionally collaborative with explicit editor/member permissions.

### Connect

Messaging, group conversations, friend lists, voice messages, media sharing, group activities and shared Collections support the wider product. Conversations should link back to the Chain, Circle or project they belong to rather than become a disconnected destination.

### Progression and recognition

Reward meaningful contributions, creative milestones, useful community participation and collaborative accomplishments. Avoid engagement bait, time-spent rewards, paid random rewards, coin wagering, punitive streaks and artificial scarcity. Cosmetics can celebrate participation without selling verification or moderator trust.

### Sharing and viral distribution

Public Chains and Collections need durable shareable links and excellent web previews. A visitor should be able to understand and explore public content without installing the app. Joining, contributing and continuing in the app should be a natural next step. Sharing must not depend on forced invitations or spam.

## 3. Product foundations and technical boundaries

- One account, identity and permission model across the application.
- One canonical object graph connecting Loops, Branches, Chains, Circles, Collections, Drops and conversations.
- Server-authoritative authorization, membership and entitlements.
- Rust is the target backend for new domain APIs and durable workflows; legacy Next.js/Supabase routes remain during gradual, tested migration.
- PostgreSQL is the canonical relational store for new platform domains; object storage is for media.
- Public resources use stable IDs and web routes; private resources must never leak through search, metadata, previews or recommendation APIs.
- Every important write is validated, rate-limited where appropriate, and covered by tests.
- Migrations are additive, reversible where practical, and compatible with the existing production data. Do not claim a cutover before it is verified.
- Mobile is the primary interaction target; desktop/web remains a first-class public discovery, creation and community-management experience.
- Reuse the tactile button/animated icon system consistently, but respect reduced motion, touch ergonomics and keyboard/screen-reader access.

## 4. Delivery sequence

### Phase 0 — Stable foundation
- Complete the shared navigation, design primitives and verified Rust/PostgreSQL/API foundation.
- Preserve legacy routes and deep links.
- Establish shared authorization, request validation, error shapes, logging and migration conventions.

### Phase 1 — Chains, the signature feature
- Create the canonical Chain entity and contribution model in Rust/PostgreSQL.
- Build format-aware Chain creation and contribution flows.
- Add contribution attribution, ordering, history, visibility and contribution policies.
- Build public shareable Chain detail pages.
- Integrate Chains into Discover, Circles, Collections and profiles.
- Add moderation/reporting and rate limits before broad release.

### Phase 2 — Circles as the community home
- Unify membership state transitions, join approval, roles and permissions.
- Improve Circle identity, spaces, discussions, member profiles and community feeds.
- Make Chains, Collections, Drops, projects and events first-class Circle surfaces.
- Build subcommunity/space navigation without duplicating membership or identity systems.

### Phase 3 — Discover and Drops
- Build universal search and transparent, user-controlled discovery across people, Loops, Chains, Circles and Collections.
- Add interest/category/community/chronological modes and relevance explanations.
- Unify optional creative prompts, events, challenges and voting through Drops.

### Phase 4 — Living profiles and Collections
- Make profiles a customizable, privacy-aware showcase of a user's creative identity.
- Connect contributions, Chains, Circles, Collections, projects and achievements.
- Add collaborative Collections and rich public web previews.

### Phase 5 — Connect and collaboration
- Improve DMs, groups, media/voice messages and invitations.
- Connect conversations to their originating Chain, Circle or project.
- Build robust asynchronous co-authoring and real-time Co-Loop collaboration with autosave, presence, attribution and version history.

### Phase 6 — Progression, creator tools and ecosystem
- Add meaningful achievements, seasonal participation, community accomplishments and profile cosmetics.
- Add creator analytics, public showcases, advanced Chain templates, remix/fork tools and export.
- Add marketplace capabilities only with safe ownership, moderation, licensing and refund rules.
- Add stable APIs/integrations and community-built interactive experiences after the core object model is mature.

### Phase 7 — Premium and verification
- Introduce subscription tiers with server-authoritative entitlements, lifecycle handling, billing history, cancellation and receipts.
- Use the Dqnamo Kitchen Receipt Printer experiment as a visual interaction reference for payment processing/receipt presentation; it is not a payment processor. Build an original implementation unless reuse rights are confirmed.
- Explore a blue identity verification mark with published criteria and review/appeal mechanisms. Verification is independent from Premium and can never be purchased as a subscription perk.

### Final phase — Admin Dashboard
The full Admin Dashboard is deliberately last. Build it only after the user-facing systems, data model, permission rules, moderation workflows, audit events and operational metrics are stable. It must be a secure control plane, not a shortcut around product authorization.

## 5. Release gates

A phase is not complete because a page exists. It is complete when:
- Main journeys work end-to-end on mobile and web.
- Server-side access control is tested for owners, members, guests and unauthorized users.
- Privacy boundaries are tested, including search and share previews.
- Migrations work against both a clean local database and a representative existing schema.
- Loading, empty, error, offline and permission-denied states are designed.
- Accessibility and reduced-motion behaviour are verified.
- Performance, pagination and abuse/rate-limit behaviour are tested.
- CI is green on the exact commit being proposed.

## 6. Success measures

Measure successful contributions, returning contributors, Chain completion/remix activity, Circle member participation, useful replies, accepted collaboration invitations, Collection saves/shares, event attendance and 7/30-day retention. Do not use raw time spent, notifications sent or follower counts as the primary measure of product health.

## 7. Scope discipline

Build progressively. Do not duplicate existing systems, rename Branch trees into Chains, rewrite working application areas without need, introduce speculative abstractions, or claim a migration/integration is complete before it is deployed and tested. Keep each slice independently reviewable and preserve working routes.


## 8. Current implementation snapshot

The first Chains vertical slice is in development on \`redevelopment/circle-core-experience\`:
- Additive PostgreSQL tables for Chains, contributors and typed contributions.
- Rust API endpoints for discovery/listing, creation, public/private/Circle-scoped detail access and contribution writes.
- Initial web discovery and detail experiences, including public Chain creation and optional creation inside a Circle.
- Circle membership is checked server-side for Circle-scoped access and contribution.
- Existing Loop Branch trees remain separate and unchanged.

This is an initial vertical slice, not the completed Chains system. Editing/revisions, invitations, moderation queues, reactions/discussions, rich media upload, forking/remixing, templates, exports, and pagination beyond the first 100 detail contributions remain follow-on work. CI and deployment verification are required before calling the slice complete.
