# Changelog

All notable changes to Flowboard are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

During development, each commit+push bumps the **minor** (`.x+1`). **Major** releases are cut manually.

## [Unreleased]

## [0.2.0] — 2026-08-05

### Added

- Zoom and pan the field: pinch on touch, or Ctrl/Cmd + scroll (trackpad pinch); drag empty field to pan when zoomed; double-click empty field to reset
- Zoom also works in Play mode to inspect the play
- On touch/pen (and phone layout), press a player with the ball to choose **Move** or **Throw** — slide into an option, or tap when the menu sticks

### Changed

- Help guide covers zoom/pan and the touch possession choice
- README expanded with sharing, predefined flows, and the files table

## [0.1.0] — 2026-08-05

First public cut of Flowboard: a browser-only canoe polo tactic board with step-based editing and continuous playback.

### Added

- Standalone editor: open `index.html` with no install or server
- Full / half canoe polo field with optional 4 m and 6 m lines
- Boat setup: counts, formations, start positions, bow–stern team colours
- Step-based route editing with ghosts, curved paths, and diamond path handles
- Ball possession, passes, through balls, free throws, claims, and dribble playback
- Edit and Play modes with transport bar, scrubbing, and speed control
- Motion timing (boat speed, acceleration, rotation, ball speed, step duration, sync-arrival)
- Undo / redo, step rename / reorder / delete, and revert to step start
- Predefined base flows: **Waaier** and **Bommetje**
- Share via URL, plus JSON export / import (`.flowboard.json`)
- Automatic persistence in `localStorage`
- Keyboard shortcuts and in-app help (**?**)
- UI in English, Dutch, German, French, Italian, and Spanish
- Mobile-friendly steps sheet and favicon
