---
name: Lectio Arc workspace
description: An Arc-inspired study workspace with four authored palettes, reusable primitives and one active canvas.
status: implemented baseline
---

# Lectio next: visual contract

## Direction

The `next` frontend is intentionally rebuilt around the supplied Arc Browser reference. It is not a reskin of the legacy UI. The product has two material layers:

1. theme-colored app chrome, containing navigation and native window controls;
2. one quiet document canvas, inset into that chrome.

There is exactly one active workspace. Lectio does not imitate Arc's split view. Product behavior, persistence, and native operations remain behind `LectioClient`; presentation stays in the `next` frontend.

There are exactly four authored presets: blue and orange in both light and dark variants. Previous built-in palettes are removed. Light chrome uses near-black navigation text; dark chrome uses white navigation text. The appearance setting shows a sun or moon beside each choice and saves immediately.

## Tokens

The structural defaults live at the top of `next.css`; `themes.ts` maps the active preset onto them:

- chrome: `--arc-coral`, `--arc-rose`, `--arc-plum`, `--arc-chrome-ink`;
- text: `--arc-ink`, `--arc-muted`, `--arc-subtle`;
- documents: `--arc-paper`, `--arc-raised`, `--arc-soft`;
- structure: `--arc-line`, `--arc-line-strong`;
- action: `--arc-deep`, `--arc-focus`.

The shell maps the shared `ThemePalette` contract onto `--arc-*` and `--palette-*` variables. The Grainient shader remounts on a palette change so its colors update without stale WebGL uniforms.

## Geometry

- expanded sidebar: 272px;
- collapsed rail: 68px;
- canvas inset: 7px on top/right/bottom, without a duplicate sidebar divider;
- canvas radius: 10px;
- control radii: 6–9px;
- overlay radius: 9–10px;
- tree indentation: 16px per level.

Large, soft SaaS cards are not part of this direction. Borders are fine and warm; grouping comes from dividers, alignment, and surface changes.

## Depth

The sidebar is the app background, not a card. The document canvas has no border; a short contact shadow and one restrained ambient shadow provide separation. Selected destinations and tree rows use the same dark translucent chrome surface; menus and dialogs use pale warm surfaces with smaller contact shadows. Avoid stacking card shadows inside the canvas.

## Typography and icons

Geist Variable is the sole interface face, with optical sizing enabled and synthesis disabled. The role scale is intentionally small: 28px display, 22px title, 16px heading, 14px subheading, 13px body/control, 12px metadata, and 11px caption. Intermediate variable weights (440/520/620/680) create hierarchy without making every label bold. Display and title roles use tight tracking; controls use restrained negative tracking; body and transcript copy keep neutral tracking and generous leading. Timestamps, counters, durations, page numbers, and versions use tabular numerals. Supporting prose stays within roughly 45–65 characters where possible. Navigation labels never wrap; long library names truncate.

Lucide outline icons are used consistently. Important destinations may have small colored tile backgrounds; ordinary row actions remain quiet. Icon-only controls require accessible names and tooltips where their meaning is not universal.

## Components

`NextPrimitives.tsx` is the shared component floor:

- `NextButton` and `NextIconButton` for actions;
- `NextSurface` for the few surfaces that need semantic elevation;
- `NextSection` and `NextSettingRow` for settings structure;
- `NextEmptyState` for actionable empty states.

The sidebar, settings, and lecture views compose these primitives. New screens should extend their variants instead of introducing page-specific button or card systems.

### Sidebar

The sidebar integrates native window actions, three primary destinations, the complete course tree, settings, help, and version. The three destination tiles deliberately break the vertical rhythm, as in Arc. Only the active destination is elevated; resting and hover states stay translucent and borderless. Settings and help are evenly spaced icon actions at the bottom. Collapsing keeps icons fixed and hides the tree without wrapping; the library becomes a floating flyout in rail mode.

Course and module branches expand independently, the tree owns its vertical scroll, and the selected node's ancestors open automatically. Dragging supports moving valid children between parents plus inserting before or after compatible siblings. Drop targets, hover expansion, edge scrolling, and domain validation must remain visible and functional in both the expanded tree and rail flyout.

### Settings

Settings is a document, not a grid of cards. A narrow category rail sits beside one scrolling column and becomes a horizontal, scrollable rail on compact canvases. Rows use shared icons, labels, descriptions, dividers, controls, toggles, credential fields, and status chips. Library/data, appearance, recording, transcription, AI/Anki, and Google Drive all use the same row grammar. Values save immediately; secrets use the OS credential store; long-running native setup and connection work shows an explicit busy state.

### Lecture

The lecture view keeps one header, one material workspace, and one audio footer. PDF/slides and transcript/notes are peers. Their boundary is a divider rather than nested cards. On narrow canvases the two panes switch rather than squeeze into unusable columns.

## Motion

Motion clarifies state only:

- the chrome carries one slow theme-colored Grainient shader capped at 15 FPS; it never moves content, pauses while hidden, and becomes static with reduced motion;
- sidebar width and spatial layout: 300ms using `cubic-bezier(0.22, 1, 0.36, 1)`;
- branch and overlay reveal: 200ms;
- hover and control feedback: 160ms;
- active controls may move no more than 1–2px.

Nothing animated may alter document readability. `prefers-reduced-motion` removes spatial animation.

## Rules

- Do preserve a single active canvas and the theme-colored surrounding chrome.
- Do use shared primitives and Arc tokens before adding CSS.
- Do keep PDF, audio, transcript, notes, and Anki actions equally legible in the study flow.
- Do keep native, storage, and media calls behind `LectioClient`.
- Don't introduce grain or gradients inside content; the single capped Grainient layer is the only ambient effect.
- Don't add nested cards to create hierarchy that spacing and dividers can express.
- Don't duplicate buttons or settings in task flows when a saved preference can decide the default.
