# Flowboard

Flowboard is a standalone browser app for drawing and orchestrating canoe polo tactics. Coaches work with movement segments and interaction blocks on a timeline instead of simulating physics.

## Starten

Geen installatie en geen server nodig:

1. Open `index.html` direct in je browser.
2. Sleep boten en de bal op het veld.
3. Gebruik de timeline om segmenten en interacties te bekijken.
4. Tactieken worden automatisch opgeslagen in `localStorage`.

## Bestanden

| Bestand | Doel |
|---|---|
| `index.html` | Hoofdpagina |
| `style.css` | Styling |
| `app.js` | Editor, playback engine en opslag |

## Functies

- Kanopoloveld met boten en bal (5 tegen 5)
- Startopstelling: verdediging in 1-3-1, aanval op de middenlijn
- Timeline met segmenten en interacties
- Contact-flow met bounce, hold, drive en foul
- Interacties: contact, screen, pickup, pass, shot, block
- Playback en scrubbing
- Undo/redo
- JSON export/import
- Automatische opslag in `localStorage`
