# Flowboard

**Version 0.3** — see [CHANGELOG.md](CHANGELOG.md).

Flowboard is a standalone browser app for drawing and orchestrating canoe polo tactics. Coaches work with movement steps on a timeline instead of simulating physics.

## Getting started

No installation and no server required:

1. Open `index.html` directly in your browser.
2. Optionally load a predefined flow (**Select Flow**), or set your own start positions.
3. Drag boats and the ball on the field to plan routes and throws.
4. Press **Save & Next Step** to lock in a step.
5. Switch to **Play** to scrub and replay the tactic as continuous motion.
6. Tactics are saved automatically in `localStorage`. Share via URL, QR code, or export as JSON.

## Capabilities

**Field & setup**

- Full or half canoe polo field, with optional 4 m and 6 m lines
- Configurable boat count; defending / attacking colours with a bow–stern split
- Base formations (defence 1-3-1 or 1-2-2; attack on the centre line or in a fan)
- Freely place and rotate boats for a custom start position
- Predefined base flows to start from (**Waaier**, **Bommetje**)

**Editing**

- Drag boats to ghost targets, then confirm with **Save & Next Step** to lock in a step
- Bend paths with diamond handles; turn in place; clear draft routes from the keyboard
- Rename, delete, and reorder steps; revert boats to the start of a step
- Undo / redo for editing mistakes
- Keyboard shortcuts for almost every action (open **?** for the full list)

**Playback**

- Edit mode for building the play; Play mode for review
- Continuous multi-step motion with play / pause, scrubbing, and adjustable speed
- Timing controls for boat speed, acceleration, rotation, ball speed, and step duration
- Optional sync-arrival so boats finish a step together

**Sharing & persistence**

- Automatic save in `localStorage`
- Share a play via URL or QR code (falls back to export when the link would be too long)
- Export and import tactics as JSON (`.flowboard.json`)
- UI in English, Dutch, German, French, Italian, and Spanish

## Using the field

### Moving players

- Drag a boat to place a **ghost** at the destination. A route line shows the planned path.
- Drag the ghost to fine-tune the finish, or drag the handle on the line to bend the path.
- Clear a draft route with **X** / **Backspace** (with that boat selected), or turn in place with **T**.
- Press **Save & Next Step** to animate all draft routes and save them as the next step.
- In start-position mode, drag to move and click a boat to rotate, then **Lock in**.
- Zoom with pinch (touch) or **Ctrl/Cmd + scroll**; when zoomed, drag empty field to pan. Double-click empty field to reset. Zoom works in Play mode too.

### Possession

- The ball sticks to the current **holder**. Possession is tracked per step.
- On touch/pen, press a player with the ball to choose **Move** (dribble) or **Throw** — slide into the option, or tap after the menu sticks.
- Route a boat onto the free ball (or near it) to **claim** possession on arrival.
- While a holder paddles with the ball, playback shows a **dribble**: short ahead throws along the boat’s path, then the ball is carried again near the end of the drive.
- A free throw into open space releases possession until someone claims the ball again.
- A pass or through ball transfers possession to the receiver when the throw arrives.

### Moving the ball

Drag the ball on the field — where you drop it decides the throw type:

| Action | How | Result |
|---|---|---|
| **Pass** | Drag the ball onto a teammate | Direct throw to that player; possession transfers on arrival |
| **Pass into a route** | Drag the ball onto a teammate’s movement line | Ball meets the receiver mid-route; timing is synced to that point |
| **Throw** | Drag the ball onto empty field | Free throw to a point; possession is released |

Pass routes are colour-coded on the canvas (direct, into-route, into-space, and free) so you can tell throw types apart while editing.

### Sharing

- Open **Share** to copy a URL, show a QR code (when the link fits), or export a `.flowboard.json` file.
- If the encoded link is too long for a QR or for the browser, use **Copy URL** or **Export** instead.
- **Import** (from Select Flow or via shortcut) loads a previously exported play.

## Files

| File | Purpose |
|---|---|
| `index.html` | Main page |
| `style.css` | Styling |
| `app.js` | Editor, playback engine, and storage |
| `i18n.js` | Translations |
| `vendor/qrcode.js` | Offline QR encoder for share links |
| `favicon.svg` | App icon |
| `predefined/catalog.js` | Bundled base flows |
| `CHANGELOG.md` | Release history |
