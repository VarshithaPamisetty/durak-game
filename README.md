# Durak (Transfer / Perevodnoy) — multiplayer

A real-time, multiplayer **Durak** game your whole team can play from any device.
Everyone opens the same web page on their phone or laptop, enters a name, and joins
with a 4-letter **room code**. One person creates the room and chooses the number of
players and cards per hand.

It's a responsive **web app** (works in any mobile/desktop browser) backed by a small
Node.js + WebSocket server, so no app-store install is needed. The same code can later
be wrapped into a native iOS/Android app with a tool like Capacitor.

## Features

- **Create room** → choose number of players (2–6), cards per player (4–8), and deck (36/52/24).
- **Join room** → enter your name + the 4-letter code from your own device.
- **Lobby** showing who has joined; host presses **Start**.
- Full **transfer (Perevodnoy)** rules: a defender holding the same rank can pass the
  attack to the next player instead of beating it.
- Real-time sync across all devices, attack / defend / throw-in / take / transfer,
  automatic drawing, turn rotation, and Durak (loser) detection.
- **Rematch** from the end screen.
- Polished, game-like UI: card faces, dealing animations, turn glow, avatars, sound
  effects (toggleable), confetti on a win, toast notifications.
- **Reconnect-friendly**: refresh or lose signal and you rejoin the same seat
  automatically (session is remembered for 10 minutes).

## Deploy free — play from anywhere (Render)

The game needs an always-on server that supports **WebSockets**, so static hosts
(Vercel/Netlify/GitHub Pages) won't work. **Render's free web service** does, and gives
you a public `https://…onrender.com` URL anyone can open from any network.

A `render.yaml` blueprint is included, so deployment is mostly clicks:

1. Push this repo to GitHub (already done if you used the helper).
2. Go to <https://dashboard.render.com> → **New** → **Blueprint**.
3. Connect your GitHub and pick the `durak-game` repo. Render reads `render.yaml`,
   creates a free Node web service, runs `npm install`, and starts it.
4. After it deploys, open the service URL and share it with your team. Everyone enters
   a name + room code — no installs.

Notes about the free tier:
- The instance **sleeps after ~15 min** of inactivity; the first visit then takes
  ~30–50s to wake. After that it's instant.
- To reduce cold starts, add a free uptime pinger (e.g. UptimeRobot) hitting
  `https://<your-app>.onrender.com/healthz` every 5 minutes.

Other free options that also work: **Railway**, **Fly.io**, **Glitch** (all support
Node + WebSockets). The app only needs `PORT` from the environment, which they all set.

## Run it locally

You need **Node.js 18+**.

```bash
cd durak-game
./start.sh           # installs deps on first run, then starts the server
```

Or manually:

```bash
npm install
npm start
```

You'll see:

```
  Local:   http://localhost:3000
  Network: http://<your-LAN-ip>:3000
```

> Note: if `node`/`npm` aren't on your PATH (common with nvm), `./start.sh` finds your

You need **Node.js 18+**.

```bash
cd durak-game
./start.sh           # installs deps on first run, then starts the server
```

Or manually:

```bash
npm install
npm start
```

You'll see:

```
  Local:   http://localhost:3000
  Network: http://<your-LAN-ip>:3000
```

> Note: if `node`/`npm` aren't on your PATH (common with nvm), `./start.sh` finds your
> latest installed Node automatically.

## How your team connects

All players must reach the server over the network.

**Same Wi-Fi / LAN (simplest):**
1. Find the host machine's LAN IP:
   - macOS: `ipconfig getifaddr en0`
   - Linux: `hostname -I`
2. Everyone opens `http://<that-ip>:3000` in their browser.
3. Host creates a room and shares the 4-letter code; others choose **Join**, enter
   their name and the code.

**Remote teammates (different networks):**
Expose port 3000 with a tunnel, then share the public URL:
```bash
npx localtunnel --port 3000
# or: ngrok http 3000
```

## How to play (quick rules)

- Goal: **don't be the last player holding cards** — that player is the *Durak* (fool).
- The **attacker** plays one or more cards of the same rank at the **defender**.
- The **defender** either:
  - **Beats** each attacking card (higher card of the same suit, or any trump; a trump
    is only beaten by a higher trump), then presses nothing — attackers may throw in
    more cards of ranks already on the table (up to 6);
  - **Takes** all the cards onto their hand; or
  - **Transfers** the attack to the next player by playing a card of the **same rank**
    (only before any card has been beaten). The transfer can't leave the next defender
    with too few cards to cover it.
- When every attack is beaten, attackers press **Done**; the cards are discarded and the
  defender becomes the next attacker.
- Hands refill to the configured size from the deck (attacker first, defender last).
  Trump is the suit of the card shown under the deck. Last player with cards loses.

## Configuration

- `PORT` env var changes the port: `PORT=8080 npm start`.
- Room options (players / hand size / deck) are chosen on the **Create room** screen.

## Project layout

```
durak-game/
├── server/
│   ├── server.js     # Express static server + WebSocket rooms
│   └── game.js       # Pure Durak engine (transfer variant), fully unit-tested
├── public/
│   ├── index.html    # Home / lobby / game screens
│   ├── styles.css    # Responsive, mobile-first styling
│   └── app.js        # Client logic + WebSocket protocol
├── test/
│   └── game.test.js  # Engine unit tests  (npm test)
├── start.sh
└── package.json
```

## Tests

```bash
npm test
```

## Notes / possible next steps

- State is held **in memory**, so restarting the server clears active rooms.
- Implemented the core transfer rule. Advanced variants from pagat.com
  (post-beat transfer "Kiev" variant, and the "pass card" trump-show transfer) are not
  included but the engine is structured to add them.
- To ship as a true native app, wrap `public/` with Capacitor and point it at a hosted
  server URL.
