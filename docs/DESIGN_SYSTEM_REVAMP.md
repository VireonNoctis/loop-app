# LOOP Design System Revamp

## Direction

LOOP should feel like a premium, editorial social product: confident typography, carefully controlled surfaces, strong content presentation and tactile interactions. Avoid a generic neon dashboard, excessive gradients, ornamental glass panels and a different visual language on every route.

This is a system, not a single theme. Components should remain recognizable across Home, Discover, Circles, profiles, creation tools and collaboration.

## Principles

- Content and people receive more visual weight than controls.
- Use one accent colour for primary actions; reserve semantic colours for status.
- Prefer surface contrast, typography and spacing over nested borders and shadows.
- Use gradients only when they communicate identity or state.
- Keep motion purposeful and short. Respect prefers-reduced-motion.
- Use the same interaction response for the same action everywhere.
- Never make important information dependent on colour, animation or hover.
- Maintain readable touch targets and visible keyboard focus.

## Tokens

Use the semantic variables in app/globals.css as the source of truth. Consolidate duplicate theme values and remove broad CSS overrides that change semantic tokens outside the theme layer.

Required token families:

- Background, surface, elevated surface and inverse surface.
- Primary, secondary and muted text.
- Border, focus ring and disabled states.
- Brand accent and semantic success, warning, danger and information colours.
- Four-point spacing scale.
- Type scale for display, page title, section title, body, supporting text and metadata.
- Radius scale for controls, cards, sheets and media.
- Elevation scale with restrained shadows.
- Motion durations and easing curves.
- Content widths, navigation widths and mobile safe-area values.

Do not introduce new arbitrary hex values in feature components when a semantic token exists.

## Components

Build and standardize the following before redesigning every page:

- AppShell, DesktopSidebar, MobileNavigation and GlobalHeader.
- PageHeader, SectionHeader and ContextualToolbar.
- PrimaryButton, SecondaryButton, IconButton and TactileButton.
- SearchField, FilterChip, Tabs and SegmentedControl.
- LoopCard, ChainCard, CircleCard, CollectionCard and ProfileCard.
- Avatar, PresenceIndicator, VerificationMark and RoleBadge.
- Composer, MediaPreview, ContributionRow and ActivityItem.
- Dialog, Drawer, BottomSheet, Tooltip and ContextMenu.
- EmptyState, LoadingSkeleton, ErrorState and InlineNotice.

Keep behaviour and visual treatment in reusable components. Do not duplicate one-off copies of the same interaction on different routes.

## Motion and tactile interaction

Use the project's existing Framer Motion dependency for transitions that benefit from layout awareness. Use CSS for simple hover, focus and press states. Use the existing haptics utility only for deliberate user actions and only where the device/browser supports vibration.

Suggested defaults:
- Button press: subtle scale to 0.975 with a short spring.
- Hoverable card: 1–2px lift on pointer devices only.
- Tab change: short opacity/position transition.
- Sheet and dialog: spring-based entrance with a stable exit.
- List insertion: brief layout animation; avoid animating every feed item on scroll.
- Haptics: light selection for navigation and medium feedback for an explicit completed action. Never vibrate continuously or on passive scrolling.

Respect reduced motion and data-saver preferences. Animation should never delay a response, obscure status or create an interaction that cannot be completed without motion.

## 3D and immersive effects

Use React Three Fiber and Drei only for experiences that genuinely benefit from a spatial model, such as an optional Chain graph or a collaborative canvas. Keep standard navigation, feed cards, forms, menus and settings in normal accessible DOM. Provide a static fallback and lazy-load 3D scenes.

## Responsive behaviour

Design mobile first, then expand:
- 360px: compact navigation and single-column content.
- 390px: baseline phone layout.
- 768px: tablet composition with clear touch targets.
- 1024px: compact desktop shell.
- 1440px: full content plus contextual side panel.

Avoid horizontal page overflow, tiny metadata, hidden essential actions and desktop-only hover affordances.

## Quality gates

Every redesigned component must have:
- Loading, empty, error, disabled and success states where applicable.
- Keyboard and screen-reader behaviour.
- Focus-visible state.
- Reduced-motion behaviour.
- Mobile touch target and safe-area verification.
- Dark and light theme verification.
- Interaction tests for its primary action.
