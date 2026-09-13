# Lectio Design System

## Design intent

Lectio is a calm, local-first desktop workspace for students. It must make the
next useful study action obvious without forcing the student to understand AI,
providers, transcript engines, sync protocols, or library internals.

The UI operates as a focused tool, not a decorative dashboard. Familiar,
accessible shadcn/Radix interaction patterns are preferred over novelty.

## Product mode and visual character

- **Mode:** Operate.
- **Character:** quiet, precise, modern desktop software.
- **Density:** compact where users scan lists or transcripts; generous where
  users read, write, review, or choose an action.
- **Anti-goals:** card-in-card layouts, decorative gradients, several competing
  primary actions, technical jargon in normal flows, and controls that differ
  only because they were built in separate features.

## Core information model

Lectio has four task modes:

1. **Library** — organize courses, modules, topics and lectures.
2. **Capture and prepare** — import or record audio, add slides, transcribe.
3. **Study workspace** — understand a lecture using audio, slides, transcript,
   notes and markers.
4. **Review and deliver** — generate, review and sync Anki cards.

The interface must present the next sensible action from the material that is
actually available. It must not punish a lecture that has slides but no audio.

### Equal source principle

Audio, slides/PDF, transcript, notes and markers are first-class study sources.
Transcript is useful but is never the sole canonical source. Card generation
uses all available sources by default and explains availability in plain
language. Slides-only, audio-only and mixed-material lectures are normal
workflows, not error states.

## App topology

- The **app shell** provides title bar, concise global navigation, library
  navigation, persistent job feedback and bottom-placed settings/help actions.
- The **workspace** is the visual center. It is not nested inside decorative
  cards and may hide the sidebar when full width improves the task.
- The **detail layer** holds infrequent metadata, inherited context, advanced
  settings and destructive actions. It is revealed on demand through a panel,
  menu or dialog; it does not permanently compete with the primary task.
- The **progress layer** is non-blocking. Jobs remain visible in a compact
  lower-right surface, reserved above the persistent audio footer so the two
  layers never overlap. It can expand for details, errors, cancellation or
  resume without blocking the workspace.

### Shipped #142 surface contract

- The lecture header's adaptive next action is the workspace's sole primary
  action.
- A compact source summary directly below the header shows which lecture
  material is available.
- Recording is available without competing with the lecture's adaptive primary
  action: the idle **Spela in** control uses the outline treatment. Only an
  active recording escalates stop and live-status feedback to urgent styling.
- Global navigation collapses to an icon rail below 1100 px.
- Settings remain a searchable destination so configuration can be found
  without expanding the primary workspace controls.

## Component architecture

Use a three-layer system:

1. **Radix primitives** own keyboard behavior, focus management, menus,
   dialogs, popovers and accessibility semantics.
2. **Shared UI primitives** in `src/components/ui/` own Lectio's variants for
   buttons, inputs, selects, tabs, dialogs, tooltips and form states.
3. **Lectio patterns** own recurring product structures: page headers, action
   bars, tree rows, source summaries, settings sections, empty states, status
   badges, job rows and detail panels.

Product views compose these patterns. They do not create isolated button,
dropdown, card, form or status styles.

## Hierarchy and layout

- A screen has one primary user goal and at most one visually primary action.
- Persistent bottom controls reserve the lower-right corner for job feedback;
  floating progress surfaces must sit above that footer, never cover it.
- Use spacing, typography and alignment before adding another border or card.
- Cards represent an independent object or task. Do not use cards merely to
  make a section look separated.
- The sidebar is a map, not a control surface: few top-level destinations,
  library hierarchy beneath it, settings at the bottom.
- Settings are centralized and searchable. Contextual flows show only setup
  necessary to proceed, with advanced configuration linked from there.
- Secondary actions live in an overflow menu, contextual command menu, detail
  panel or shortcut — never as a row of equal-weight buttons.

## Color and themes

- Preserve `ThemePalette`, built-in palettes and user-created palettes.
- Do not settle or redesign preset palettes during the structural rework.
- All visible color must come from semantic theme tokens. No component may add
  a hard-coded UI color.
- Every palette must define and visibly distinguish background, surfaces,
  text hierarchy, borders, primary/action states and semantic status states.
- Primary color is reserved for the current selection, primary action and
  meaningful status indicators; it is not background decoration.

## Typography and copy

- Use the existing interface family consistently; no display font for product
  controls.
- Keep a compact, fixed type scale with clear label, body, section, page and
  numeric/status levels.
- Prefer a useful heading or action label over a heading plus explanatory
  subheading. Help text appears only when it changes a decision.
- Swedish copy is direct and task-oriented: explain what happened, whether
  data is safe, and the next action.

## State vocabulary

Every interactive component and workflow state supports a deliberate default,
hover, focus-visible, active, selected, disabled, loading, success and error
appearance where applicable. Empty states teach the next action. Errors say
what failed, what remained safe, and what to do next.

## Motion

- Motion explains navigation, reveal, progress and state change; it is never
  decorative page choreography.
- Standard micro-interactions: 120–180 ms. Panels, dialogs and sidebars:
  180–240 ms.
- Prefer `transform` and `opacity`; avoid animating layout dimensions that
  cause wrapping, PDF jitter or reflow.
- When the sidebar collapses, labels fade before width changes and icons keep
  their vertical position.
- Respect `prefers-reduced-motion`.

## Accessibility and resilience

- Keyboard navigation, visible focus, semantic labels and sensible shortcuts
  are part of the design, not follow-up work.
- Dialogs and menus use portal-backed Radix primitives so they cannot be
  clipped by workspace panels.
- Every key view is checked in a light palette, dark palette, narrower desktop
  width, expanded sidebar and collapsed sidebar.
- Loading, failure and unavailable-source states must preserve the surrounding
  workspace rather than replace it with a blank screen.

## Design review gate

Each completed surface is reviewed with real app screenshots before it is
accepted. The review covers hierarchy, source parity, empty/loading/error
states, light/dark palette behavior, narrow desktop behavior, keyboard focus
and motion. A small, stable set of critical surfaces is protected by visual
Playwright baselines; visual changes are intentional changes to the baseline,
not accidental drift.
