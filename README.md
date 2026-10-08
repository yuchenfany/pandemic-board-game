# Pandemic: On the Brink — Online

A multiplayer browser version of Pandemic (2nd edition rules) with the **On the Brink** roles and events.
2–5 players, real-time, one shared board.

## Run it

```bash
npm install
npm start            # http://localhost:3000  (PORT=xxxx to change)
npm test             # rule tests + 300 random simulated games
```

1. Open the site, enter your name, **Create a new room**.
2. Send the invite link (`/?room=CODE`) to your friends.
3. Everyone picks a role (or leaves it random); the host picks the difficulty and starts.

Friends need to reach your server: same Wi-Fi → share `http://<your-LAN-IP>:3000`; remote → use a tunnel
(e.g. `cloudflared tunnel --url http://localhost:3000`) or deploy to any Node host (Render, Fly.io, Railway…).
Games live in memory, so restarting the server ends them. Refreshing or reconnecting is fine: your seat is kept.

## How to play
- **Move**: click a highlighted city on the map. If there's more than one way to get there, you'll be asked which.
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
shared/data.js     cities, connections, roles, events (used by server + browser)
shared/engine.js   rules engine: pure state → state, validates every action
server.js          Express + Socket.IO rooms; server is authoritative, hides deck order
public/            UI (vanilla JS + SVG map, no build step)
test/              rules.js (scenarios), sim.js (random games + invariants), e2e.js (socket smoke test)
```

Fan-made for private play. Pandemic is © Z-Man Games; please don't host this publicly.
