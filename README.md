# Flowboard

Flowboard is a standalone browser app for drawing and orchestrating canoe polo tactics. Coaches work with movement steps on a timeline instead of simulating physics.

## Getting started

No installation and no server required:

1. Open `index.html` directly in your browser.
2. Drag boats and the ball on the field.
3. Set ghost positions, then press **Next Step** to save a step.
4. Switch to **Play** to scrub and replay the tactic.
5. Tactics are saved automatically in `localStorage`.

## Capabilities

Flowboard lets you design canoe polo plays as a sequence of steps and play them back as continuous motion.

**Field & setup**

- Full or half canoe polo field, with optional 4 m and 6 m lines
- Configurable boat count and defending / attacking team colours
- Base formations (defence 1-3-1 or 1-2-2; attack on the centre line or in a fan)
- Freely place and rotate boats for a custom start position

**Editing**

- Drag boats to ghost targets, then confirm with **Next Step** to lock in a step
- Rename, delete, and reorder steps; jump back to the start of a step
- Undo / redo for editing mistakes

**Playback**

- Edit mode for building the play; Play mode for review
- Transport bar with play / pause, scrubbing, and adjustable speed
- Timing controls for boat speed, acceleration, rotation, ball speed, and step duration

**Sharing & persistence**

- Automatic save in `localStorage`
- Export and import tactics as JSON
- UI in English, Dutch, German, French, Italian, and Spanish

## Using the field

### Moving players

- Drag a boat to place a **ghost** at the destination. A route line shows the planned path.
- Drag the ghost to fine-tune the finish, or drag the handle on the line to bend the path.
- Clear a draft route with **X** / **Backspace** (with that boat selected), or turn in place with **T**.
- Press **Next Step** to animate all draft routes and save them as the next step.
- In start-position mode, drag to move and click a boat to rotate, then **Lock in**.

### Possession

- The ball sticks to the current **holder**. Possession is tracked per step.
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
## Files

| File | Purpose |
|---|---|
| `index.html` | Main page |
| `style.css` | Styling |
| `app.js` | Editor, playback engine, and storage |
| `i18n.js` | Translations |
