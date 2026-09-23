# ARCOQUIZ

A server-directed TV quiz show built on an Arkanoid engine. Up to 10 players
join from their phones, a shared screen (the TV) shows a live grid of
everyone's arena plus a running ticker, and each round is a short arkanoid
level everyone plays at once, each on their own device. There is one mode,
one match at a time, per server.

## Running it

```bash
npm install
npm run dev
```

Play together over the local network (builds the game and starts the room
server):

```bash
npm run lan
```

The server prints an address like `http://192.168.x.x:8080` — open it from
any device on the same Wi-Fi network, nothing to install. If the port is
taken:

```bash
PORT=8081 npm run lan
```

or free it: `lsof -ti tcp:8080 | xargs kill`.

## How to play

1. Sign in as yourself (or create a player: name, avatar, 4-digit PIN) and press «Ready».
2. Every round is a short arkanoid level: mouse or ←/→, Space to launch. Clear it first for a bonus.
3. Points decide your place. Coins (from bricks) are spent in the shop between rounds.
4. Alliances: team up to three, give it a name — buffs go to allies only, debuffs to everyone else.
5. 10 rounds in three acts, two bosses: at the end of act 2 and in the finale. Most points wins.

If you are the only human when a match starts, a bot named «Bot» (🤖) fills
the other seat so a solo player still gets a full show.

## Roles

Every device picks a role when it opens the game (or skips the picker with a
URL query):

- **`?role=tv`** — the shared screen: the lobby roster, a live grid of every
  player's arena during a round, the header (act, round, boss warning,
  countdown), and a ticker of recent events along the bottom. No controls.
- **`?role=player`** — sign in, ready up, and play your own arena on your own
  device (mouse/keyboard) when a round starts.

With no `role` in the URL, the game shows a picker («I'm playing» / «This is
the TV») instead.

## Accounts

Accounts are stored server-side in `server/data/players.json` (gitignored —
local to each install, not shipped in the repo). Registering needs a name
(1–16 characters, unique case-insensitively), an avatar, and a 4-digit PIN;
signing back in just needs the PIN. The PIN itself is never stored — only a
scrypt hash and a random salt per account — and a successful sign-in hands
the browser a session token so reopening the game later resumes the same
account without retyping the PIN.

## Code layout

```
src/core/     pure arkanoid simulation (Arena, physics, bricks, power-ups,
              bosses, the procedural level generator) — no DOM/network
src/render/   canvas drawing: the live arena, and a snapshot mirror that
              interpolates another player's arena from periodic snapshots
src/game/show/   the client-side show store (replays server state/events),
                  the arena runner, and the bot runner (plays the bot's
                  arena on whichever client the server names bot host)
src/game/player/  the player's device: login, lobby, waiting view, arena
src/game/tv/      the TV screen: lobby, live arena grid, ticker, standings
src/ui/       start screen (role picker), the manual, DOM helpers, styles
src/net/      WebSocket client and the show's wire protocol
              (src/net/showProtocol.ts)
server/show/  the show engine: phases, timers, the round schedule, scoring,
              and accounts — the server directs the show; clients simulate
              their own arena and report the result back
server/       the LAN server (Node, no framework) that serves the built
              client and runs the WebSocket relay for the show engine
```

## Tests

```bash
npm test
```

Runs the server-side show engine's test suite (`node --test server/**/*.test.js`).
`npm run typecheck` (also run by `npm run build`) is the other correctness
gate — run both after any non-trivial change.
