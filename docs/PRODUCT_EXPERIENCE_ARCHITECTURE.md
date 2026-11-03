# LOOP Product Experience Architecture

## Product direction

LOOP is a collaborative social platform. Its centre of gravity is not passive posting; it is the creation of things that become more valuable when other people participate.

The product should feel like one connected environment. Identity, interests, content, people, communities, conversations, collections and collaborative work should reinforce one another rather than behave like unrelated mini-apps.

The design can learn from the consistency and continuity of excellent hardware/software ecosystems without copying another company's interface or visual identity.

## Product principles

1. **Create before consume.** Creation and participation should be obvious, quick and rewarding.
2. **One mental model.** A Loop is a content object; a Branch extends it; a Chain is a contribution structure; Co-Loop is live collaboration; a Circle is a community; a Collection organizes related objects.
3. **Connected by default.** A Loop can belong to a Circle, be added to a Collection, branch from another Loop and open a Co-Loop session. These are connected paths through one product, not separate feature silos.
4. **Progressive disclosure.** Put the five most useful destinations in primary navigation. Put specialist tools in contextual or secondary navigation.
5. **User-controlled discovery.** Make recommendation controls understandable and preserve chronological/following views.
6. **Accessible and calm.** Strong hierarchy, readable type, keyboard support, reduced-motion support, useful empty states and no forced motion.
7. **Healthy retention.** Make LOOP worth returning to through meaningful projects, conversations and community activity. Do not optimize for compulsive usage, anxiety, artificial scarcity, streak loss or notification spam.

## Information architecture

### Primary navigation

- **Home** — For You and Following feeds, a compact composer and meaningful updates from the user's network.
- **Discover** — People, topics, public Loops, Chains, Reels and live activity.
- **Create** — Loop, Branch, Co-Loop, Moment and Live creation flows.
- **Circles** — Find, join and manage interest-based communities.
- **Inbox** — Direct conversations, groups and invitations.

Notifications remain available in the global header and through a dedicated notifications screen. The same five primary destinations should be used on desktop and mobile.

### Secondary destinations

Live, Events, Saved, Creator Studio, Co-Loop Studio, Wallet, Shop, Developer Hub, Loop AI, Settings and administration remain available, but should not compete with the primary social navigation. Administrative destinations must remain permission-gated.

### Content model

- **Loop:** a post or creative object with its own identity, author, visibility, media, discussion and activity.
- **Branch:** a response that explicitly extends or reinterprets a parent Loop. Preserve parent attribution and provide a clear path through the branch graph.
- **Chain:** a structured collaborative activity with a prompt, contribution rules, participants, a timeline and a final/shareable result. Chains should support more than plain text.
- **Co-Loop:** a real-time collaborative session with presence, invitations, co-author attribution, autosave and version history.
- **Circle:** a community with identity, guidelines, membership, roles, discussions, projects, events and shared collections.
- **Drop:** a scheduled community prompt or event. Participation must remain optional; avoid countdown pressure, punishment for missing it or streak-loss mechanics.
- **Collection:** a user- or Circle-owned set of Loops, Chains, people and external references. Collections can be collaborative with explicit permissions.
- **Interest profile:** a user-controlled representation of interests and preferences that improves recommendations and helps people find relevant Circles.

## Core journeys

### New member

1. Create an account and choose a small set of interests.
2. See a curated selection of Circles and people with clear reasons for each suggestion.
3. Join or follow a few relevant destinations.
4. Create a first Loop or contribute to an existing Chain.
5. Land in Home with meaningful content and an obvious next action.

Do not require a long profile form before a user can explore. Profile completion should be progressive.

### Discovery to participation

Discover a Loop or Circle, preview its context, follow or join, then contribute without losing the original context. Returning to the source should be one tap.

### Creation to collaboration

A user starts a Loop or Chain, invites contributors, works together in Co-Loop when live editing is useful, publishes the result and shares a stable public link. Contributors receive attribution and can add the result to their own collections.

### Cross-device continuity

Keep drafts, saved items, unread state, preferences and active collaboration sessions associated with the account. Public share links should render cleanly on the web even when the recipient has not installed the app. Native app deep links can open the same object when installed.

## Ecosystem integration

Build a single account and shared object graph across the product:

- One identity, profile, privacy model and account settings.
- One universal search across people, Loops, Chains, Circles and Collections.
- One notification centre with grouped, adjustable notification preferences.
- One saved/collection system available from feeds, detail pages and communities.
- Consistent share sheets and deep links.
- Drafts that can move between Loop, Branch and Co-Loop creation.
- Contextual actions: add a Loop to a Circle or Collection without re-uploading or duplicating it.
- Shared design components, interaction patterns and accessibility behaviour across every surface.

## Retention and product quality

The product should feel satisfying, not compulsive. Prioritize:
- First meaningful contribution.
- Successful collaboration.
- Useful conversations.
- Circle membership that leads to real participation.
- Returning to an unfinished project by choice.
- Clear controls for notification frequency and feed ranking.
- Quiet hours and digest options.

Do not use paid random rewards, coin wagering, punitive streaks, forced invitations or artificial scarcity. Community Duels, where retained, should be polls or creative comparisons with transparent rules and no stake or wager.

Measure successful creation, useful replies, accepted invitations, collaborative completions, community health and 7/30-day retention. Do not treat time spent or raw notification clicks as the primary success metric.

## Delivery order

1. Navigation and shared application shell.
2. Design tokens and interaction primitives.
3. Home, Discover, Create, Circles and Inbox.
4. Shared content detail, profile and collection experiences.
5. Co-Loop collaboration and cross-device continuity.
6. Reels, Live, Events and creator tools.
7. Ecosystem integrations and public developer surfaces.

Keep existing URLs stable during the redesign. Introduce canonical destinations gradually and redirect old routes only after confirming deep links, share cards, mobile navigation and tests.


## Social graph and notification loop

The social graph is a first-class discovery path. Following a creator should improve the Following feed and surface their public Loops, Chains and Circle activity. Private profiles use a request/approval path; blocked pairs cannot follow one another. Follow counters are reconciled from the relationship table during writes so retries do not double-increment them.

Notifications are the shared activity inbox, not a separate feature silo. A follow, follow request, Branch, Co-Loop invitation, Circle activity or reply should create a recipient-scoped notification with an actor and a deep link to the relevant object. The current Rust slice establishes follow notifications and the recipient-owned inbox API; the next stage will move all notification producers to the same Rust notification/outbox path.


## Drops — one activity layer

Drops is a single discovery surface over activity the platform and its communities already create. It does not introduce a competing event or quest store.

The Rust `GET /v1/drops` endpoint combines:
- Official platform events from `global_events`.
- Member-hosted events from `events`.
- Circle events from `circle_events`, limited to Circles the viewer belongs to.
- Active Circle challenges from `circle_challenges`, with entry counts from `community_challenge_entries`.

Each item is normalized into one feed card with a source, type, time window, participation count, optional reward and a deep link back to its original event or Circle. The existing Events and Quests pages remain authoritative for their respective detail and reward workflows.
