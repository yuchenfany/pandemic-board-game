# Pandemic: On the Brink — Online

A multiplayer browser version of Pandemic (2nd edition rules) with the **On the Brink** roles and events.
2–5 players, real-time, one shared board.

## Play online (GitHub Pages)

The site is fully static: the browser of whoever **creates the room is the host**. It runs the rules
engine and relays the game to everyone else over WebRTC (peer-to-peer via [PeerJS](https://peerjs.com)).

1. Open the site, enter your name, **Create a new room**.
2. Send the invite link (`…/?room=CODE`) to your friends.
3. Everyone picks a role (or Random); the host picks the difficulty and starts.

- The host must keep their tab open. Refreshing is safe because the game is saved in the host's browser and everyone reconnects automatically.
- Guests can refresh or drop out and rejoin from the same browser.
- Very strict networks (some corporate or school firewalls) can block peer-to-peer connections.

Deploys automatically: pushing to `main` runs the tests and publishes `public/` via `.github/workflows/pages.yml`
(repo Settings → Pages → Source: **GitHub Actions**).

## Develop locally

```bash
npm install
npm start            # http://localhost:3000 (static dev server)
npm test             # rule scenarios + room tests + 300 random simulated games
```
Open two browser windows (one normal, one incognito) to play against yourself.

## How to play
- **Move**: click a highlighted city on the map. If there's more than one way to get there, you'll be asked which. Hover a city for details; scroll or use +/− to zoom, and drag to pan.
- **Other actions**: buttons at the bottom (build, treat, share, cure, role abilities, pass, end actions).
- **Events**: click a ★ card in your hand. Events can be played at any time, even on someone else's turn.
- After actions: **Draw** → (epidemic pause for Resilient Population) → **Infect**.
- If you go over the hand limit, click cards to discard them before play continues.

## What's included
- Full base game: 48 cities, outbreak chains, epidemics, eradication, 6-station limit, 7-card hand limit, every win/loss condition.
- 13 roles: 7 base (2nd ed.) + 6 On the Brink (Archivist, Containment Specialist, Epidemiologist, Field Operative, Generalist, Troubleshooter).
- 13 events: 5 base + 8 On the Brink. Event count is configurable (default 2 per player, as OtB suggests).
- Difficulty from Introductory (4 epidemics) up to Legendary (7).
- Up to 5 players, game log, team chat, reconnect.

## Known simplifications / not yet implemented
- **Challenges are not implemented**: Virulent Strain, Mutation (purple disease), Bio-Terrorist.
- No consent prompts. The current player can Share Knowledge, Dispatcher-move, or Epidemiologist-take without the other player confirming.
- Mobile Hospital removes the color with the most cubes automatically (no choice).
- Some On the Brink card wording (Special Orders, Re-examined Research, Mobile Hospital) is paraphrased from memory. Check it against your physical cards. Text is in `shared/data.js`; logic is in `shared/engine.js` → `playEvent`.
- The starting player is random (the official rule is highest city population).

## Layout
```
public/                 the whole site (served by GitHub Pages)
  shared/data.js        cities, connections, roles, events
  shared/engine.js      rules engine: pure state -> state, validates every action
  shared/room.js        lobby/room logic (runs in the host's browser)
  net.js                PeerJS transport: HostNet (authoritative) / GuestNet
  app.js, style.css     UI (vanilla JS + SVG map, no build step)
server.js               local static dev server only
test/                   rules.js, room.js, sim.js
```

Fan-made for private play. Pandemic is © Z-Man Games; please don't host this publicly.
