# Pandemic: On the Brink — Online

A multiplayer browser version of Pandemic (2nd edition rules) with the **On the Brink** roles and events.
2–5 players, real-time, one shared board.

## Play online (GitHub Pages)

The site is fully static: the browser of whoever **creates the room is the host**. It runs the rules
engine and relays the game to everyone else over WebRTC (peer-to-peer via [PeerJS](https://peerjs.com)).

1. Open the site, enter your name, **Create a new room**.
2. Send the invite link (`…/?room=CODE`) to your friends.
3. Everyone picks a role (or Random); the host picks the board and difficulty, then starts.

- **Hotseat:** in the lobby, anyone can **Add player on this device** to control more than one role from a single screen. You can mix this with online players, or play solo with 2–5 roles and no one else. The screen switches to whichever of your players has to act. You can also switch by hand (buttons next to your hand, or click one of your players in the side panel), for example to play an event from another hand.
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
To test multiplayer locally, add hotseat players in the lobby, or open two browser windows (one normal, one incognito).

## Bedtime lock

Play locks automatically from **11 p.m. to 7 a.m.** using your device’s local time.
Use **Bedtime settings** to change the schedule outside quiet hours. The schedule is saved
in this browser, and a warning appears 15 minutes before bedtime. Settings cannot be
changed during quiet hours; there is no snooze or override button.

At bedtime, new rooms, new joins, and local game actions are blocked, including in tabs
that were already open. The screen unlocks automatically in the morning. Existing connections
and host saves continue, including after a refresh: keep the host tab open for other players.
The game may wait for the locked player’s turn or a required discard/event response.
This is a browser-local habit aid; clearing site storage or changing the device clock can bypass it.

## How to play
- **Move**: click a highlighted city on the map. If there's more than one way to get there, you'll be asked which. Hover a city for details; scroll or use +/− to zoom, and drag to pan.
- **Other actions**: buttons at the bottom (build, treat, share, cure, role abilities, pass, end actions).
- **Events**: click a ★ card in your hand. Events can be played at any time, even on someone else's turn.
- **Restart turn** undoes everything you did this turn (locked once Forecast reveals hidden cards). Your turn only moves on when you press **End turn**.
- **End turn** draws your 2 player cards straight away. Then comes the epidemic pause for Resilient Population, if one was drawn, then **Infect**. Infect stays a separate click so anyone can play an event (e.g. One Quiet Night) first.
- Infections play back one city at a time: a card with a photo of the city appears bottom-left, and the city flashes with its new cubes.
- Hover any role name (or the role badge by your hand) to see what it does.
- If you go over the hand limit, click cards to discard them before play continues.

## What's included
- Full base game with a twist: 15 of the 48 cities are swapped for others nearby (e.g. **Austin** replaces Atlanta as the start city, **Boston** replaces New York). Same colors and connections. Outbreak chains, epidemics, eradication, 6-station limit, 7-card hand limit, every win/loss condition.
- **Three boards** (host picks in the lobby):
  - **World cities**: the classic world map.
  - **Universities**: 48 research universities on a US + Canada map. It is the cities board's exact graph (every school takes one city's slot: same color, same connections), so it plays identically, but each color is one region: blue = West Coast, black = Mountain/Midwest (plus UBC), red = South (plus UMaryland and JHU), yellow = Northeast (plus UToronto and McGill). California is drawn extra large, using room the near-empty Mountain West doesn't need. **Texas A&M** is the start (Atlanta's slot). The dashed links that leave the map edge are coast-to-coast flights, like the Pacific links on the world board. To change schools, edit `tools/plan-universities.py`, rerun it, and paste its output into `data.js`.
  - **China, Japan & Korea**: 48 cities on an East Asia map, on the same graph again. Colors are regions: blue = North (Beijing, Tianjin, Shandong, the Northeast, Xi'an), yellow = East (Shanghai, the Yangtze delta, Wuhan, Fujian, Wenzhou), black = South & West (Guangzhou, Shenzhen, Hong Kong, Sichuan, Yunnan, Tibet, Xinjiang), red = Japan & Korea. **Zhengzhou** is the start. Infection cards and hover tips show each city's simplified Chinese name and province. To change cities or provinces, edit `tools/plan-board.py eastasia`, rerun it and paste its output into `data.js`.
- 13 roles: 7 base (2nd ed.) + 6 On the Brink (Archivist, Containment Specialist, Epidemiologist, Field Operative, Generalist, Troubleshooter).
- 13 events: 5 base + 8 On the Brink. Event count is configurable (default 2 per player, as OtB suggests).
- Difficulty from Introductory (4 epidemics) up to Legendary (7).
- **Challenges** (toggle in the lobby, can be combined):
  - **Virulent Strain**: the 8 Virulent Strain epidemic cards (Chronic Effect, Complex Molecular Structure, Government Interference, Rate Effect, Slippery Slope, Hidden Pocket, Unacceptable Loss, Uncounted Populations).
  - **Mutation**: a purple 5th disease (12 cubes), 2 Mutation infection cards and 3 Mutation event cards.
- **Custom events** (lobby toggle, on by default, adds 2 cards to the deck):
  - **New Route**: connect 2 cities of the same color. Pawns can Drive/Ferry along it, but outbreaks do not spread along it.
  - **Border Closure**: remove up to 2 connections. No driving across them, and outbreaks stop there.
  Both last for the rest of the game and show on the map (dashed gold = new route, red ✕ = closed).
- **Random roles**: the host can exclude roles that Random may hand out. Players can still pick excluded roles themselves.
- Up to 5 players, game log, team chat, reconnect.

## Known simplifications
- **Bio-Terrorist challenge is not available.** Its secret moves can't stay hidden when the host's browser holds the whole game.
- No consent prompts. The current player can Share Knowledge, Dispatcher-move, or Epidemiologist-take without the other player confirming.
- Mobile Hospital removes the color with the most cubes automatically (no choice).
- If one draw contains two Mutation events, they resolve in the order drawn (the rules let the player choose).
- The starting player is random (the official rule is highest city population).
- Card and challenge texts follow the 2nd-edition On the Brink rulebook (`public/shared/data.js`).

## Layout
```
public/                 the whole site (served by GitHub Pages)
  shared/data.js        boards (cities, connections), roles, events
  shared/engine.js      rules engine: pure state -> state, validates every action
  shared/room.js        lobby/room logic (runs in the host's browser)
  net.js                PeerJS transport: HostNet (authoritative) / GuestNet
  app.js, style.css     UI (vanilla JS + SVG map, no build step)
  shared/worldmap.js    generated world-map background (do not edit)
  shared/usmap.js       generated US + Canada background for the universities board (do not edit)
  shared/asiamap.js     generated East Asia background for the China/Japan/Korea board (do not edit)
  shared/photos.js      city photo credits (images in img/cities/)
server.js               local static dev server only
tools/build-worldmap.js regenerates worldmap.js, or usmap.js with `universities` (Natural Earth coastlines bent to the board with a thin-plate spline)
tools/plan-universities.py picks school positions and city slots for the universities board (Python + numpy)
tools/plan-board.py    same for the East Asia board (and a newer, general version of the universities planner)
test/                   rules.js, room.js, sim.js
```

Map data: Natural Earth (public domain) via world-atlas.
City photos: Wikimedia Commons, freely licensed (CC0 / public domain / CC BY / CC BY-SA / Free Art License); per-photo credits are in the in-game Help and `public/shared/photos.js`.

Fan-made for private play. Pandemic is © Z-Man Games; please don't host this publicly.
