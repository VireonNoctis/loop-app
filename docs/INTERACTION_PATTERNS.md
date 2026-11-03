# LOOP Interaction Patterns

## Tactile controls

The shared Button primitive uses a restrained physical-depth treatment: a defined face, a visible edge and a short press displacement. Use the standard Button for ordinary actions; it receives the shared tactile treatment. Use TactileButton for high-value actions that need stronger haptic feedback. Haptics are best-effort and no-op where vibration is unavailable. Do not vibrate on passive scroll, repeated background events or every feed update.

## Dynamic actions

Use DynamicButton when the control changes between meaningful states (for example Save → Saved, Follow → Following, Send → Sent, or Publish → Published). Keep button width stable through label transitions where practical, use a short content crossfade/vertical shift and respect reduced-motion preferences. Avoid dynamic width changes in dense toolbars or repeated feed actions where layout shifts would make the interface harder to scan.

## Motion icons

Selected animated React icons are vendored from itshover/itshover under Apache-2.0. Their individual animations are triggered by hover and can also be started for touch/keyboard interaction via the shared wrapper. Use one purposeful animation per interaction; do not animate icons continuously or all at once.

## Dqnamo Kitchen references

The interaction direction references dqnamo's Kitchen:
- Tactile Button: shaped face, firm edge and compressible depth.
- Dynamic Button: width adjusts to its label while the label/icon crossfade on state changes.
- Hold to Confirm: deliberate press-and-hold interaction for destructive actions.
- Magnetic Drop Zone: media upload targets can respond gently to an incoming drag.

Reference pages:
- https://www.dqnamo.com/experiments/tactile-button
- https://www.dqnamo.com/experiments/dynamic-button
- https://www.dqnamo.com/kitchen

These are design references. LOOP's implementations are adapted to its own component system, accessibility needs and interaction language.

## Accessibility and healthy interaction

- Every icon-only control needs an accessible name.
- Keyboard focus must be visible.
- Reduced-motion preferences must be respected.
- Keep critical actions discoverable without hover.
- Avoid punitive streaks, artificial urgency and compulsive engagement patterns.
