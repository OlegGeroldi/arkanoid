# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ARCOQUIZ: a server-directed TV quiz show built on an Arkanoid engine. Up to 10 players join from their own devices, a shared TV screen shows a live grid of every player's arena plus a running ticker, and each round is a short arkanoid level everyone plays at once, each on their own screen. One mode, one match at a time, per server — accounts with a 4-digit PIN, solo play against a bot, 10 rounds across three acts and a finale, drawn from 10 random arenas with two random bosses. No UI framework: a single `<canvas>` driven by hand-rolled TypeScript, built with Vite, with a plain Node WebSocket server for LAN play. Full player-facing rules live in `README.md` (English) — this file is dev-workflow and architecture only.

This repo started as a much larger multi-mode Arkanoid game (campaign, coop, 1v1 duel/split-screen, a standalone pinball table, a level editor, a hot-seat board-game "race" mode, then a team-vs-team Jeopardy-style party mode). All of that was stripped out to leave only this show mode — if you're looking for those modes, they're in git history, not in the working tree.

## Commands

```bash
npm install
npm run dev          # Vite dev server, http://localhost:5173
npm run typecheck    # tsc --noEmit — an automated correctness gate
npm run build        # tsc --noEmit && vite build -> dist/
npm run preview      # serve the production build locally
npm run serve        # node server/index.js — LAN room server, serves dist/ + WebSocket
npm run lan          # npm run build && npm run serve — the real "play over LAN" command
npm test             # node --test server/**/*.test.js — the show engine's test suite
```

`npm run typecheck` (which `npm run build` also runs) and `npm test` are the gates for any change — run both after every non-trivial edit. There is no linter configured.

To test over a network, `npm run lan` then open the printed LAN URL in **multiple separate browser windows** for the different roles (`?role=tv`, `?role=player` per player), not just tabs — a backgrounded tab throttles its render/simulation loop, which reads as fake lag or a frozen arena.

`PORT=8081 npm run lan` picks a different port if 8080 is already taken; the server refuses to start with a clear message instead of silently binding a stale build.

A push to `main` auto-deploys `dist/` to GitHub Pages (`.github/workflows/pages.yml`, `npm ci && npm run build`) — pushing to `main` publishes the game, not just this repo.

## Architecture

### Scene model, no framework

`src/main.ts` boots a single `App` (`src/app.ts`) and calls `app.start()` (a plain `requestAnimationFrame` loop). `App` holds exactly one active `Scene` (`{ update(dt), draw(ctx, w, h), dispose() }`) at a time; `app.setScene(factory)` disposes the current one and replaces it wholesale — there is no scene stack or router. Every screen is a `SceneFactory = (app: App) => Scene` living under `src/game/show/`, `src/game/player/`, `src/game/tv/` (the show's client-side layer and its two role scenes) or `src/ui/start.ts` (the role picker shown with no `?role=` in the URL). DOM-heavy screens render into `app.overlay`, a plain DOM node layered over the canvas, via the small `el`/`button` helpers in `src/ui/dom.ts` — not React/JSX.

### Directory roles

- `src/core/` — pure simulation and rules, no DOM/canvas/network access: `Arena` (`arena.ts`, physics/bricks/power-ups/balls/XP/supers/skills), the procedural level generator (`levelGen.ts`, `campaignLevels.ts` — `RACE_LEVELS` is the 100-level pool rounds draw from), and `bosses.ts` (`bossForLevel`, the boss ids and which levels they guard). `shop.ts`/`cardEffects.ts` are the boost-catalog groundwork for the shop stage that hasn't landed yet.
- `src/render/` — canvas drawing only: `renderer.ts`'s `drawArena`/`drawHud` paint a live `Arena`; `snapshotMirror.ts` interpolates another screen's field from periodic snapshots (used by the TV to show every player's arena live, and by the bot runner's host to mirror the bot's).
- `src/game/show/` — the client-side layer every scene builds on: `store.ts`'s `ShowStore` replays server-sent `state`/`event`/`snapshot` messages (see `showProtocol.ts` below) into local fields scenes read and re-render from; `arenaRunner.ts`'s `ArenaRun` steps one arena on a fixed tick and settles into an `ArenaResult`; `botRunner.ts` runs the bot's `ArenaRun` on whichever client the server named `botHost` (the TV if one is connected, else the first human player) and reports its result with `for: 'bot'`.
- `src/game/player/` / `src/game/tv/` — the two role scenes. `player/` is login → lobby → wait-for-round → arena, one `ShowStore` per device. `tv/` is lobby roster → live arena grid (`arenaGrid.ts`, one `SnapshotMirror` per racer) with a header/ticker (`ticker.ts`) drawn every frame → standings (`standings.ts`) at round end and finale. Neither role scene computes gameplay facts locally beyond running its own/the bot's arena sim — score, phase, and the schedule all come from the server.
- `src/audio/` — sound effects are synthesized in WebAudio at runtime (`sfx.ts`, no audio files shipped); `music.ts` plays user-supplied tracks described by `public/music/manifest.json` (absent by default — music is opt-in per install).
- `src/ui/` — `start.ts` (the role picker shown with no `?role=` in the URL), `manual.ts` (`MANUAL_POINTS`, the 5-point how-to-play list shown in the lobby and copied verbatim into `README.md`), DOM helpers (`dom.ts`), and styles (`styles.css` plus `show.css` for the show-specific screens).
- `src/net/` — the WebSocket client (`client.ts`, a thin `{type:'show', msg}` envelope plus reconnect/backoff) and the show's wire protocol (`showProtocol.ts`: `ShowUp`/`ShowDown` unions, `ShowState`, `ShowEvent`, `ACT_TITLES`, `ARENA_GRACE`); `protocol.ts` still carries the arena `ArenaSnapshot` wire type both the player's outgoing snapshots and the TV's mirrors use.
- `server/` — a plain Node ESM LAN server (`server/index.js`, no Express/framework), started by `npm run serve`. Serves the built `dist/` over HTTP, runs a `ws` `WebSocketServer`, and delegates every `{type:'show', msg}` to `server/show/engine.js`'s `createShowEngine` (see below). `server/show/accounts.js` is validated, atomically-written CRUD over `server/data/players.json` (gitignored: accounts are local per install, not shipped in the repo) — PINs are never stored, only a scrypt hash plus a per-account salt.

### Determinism is load-bearing

The simulation steps at a fixed 1/120s tick (`TICK` in `core/constants.ts`) via `FixedStepper`, decoupled from render framerate, and every random draw goes through a seeded PRNG (`core/rng.ts`, mulberry32 — `new Rng(seed)`, `.int()`, `.pick()`, `.chance()`, `.shuffled()`). Same seed plus same inputs always reproduces the same run. This is the entire foundation the networked show mode is built on (next section).

### The show engine: the server directs, clients simulate

`server/show/engine.js`'s `createShowEngine` is the whole show: it owns the phase machine (`lobby → intro → arena → roundEnd → …` per round, `over` at the end), every timer/deadline, the round schedule (`schedule.js`'s `buildSchedule` — 10 arenas: regular levels from `RACE_LEVELS` with no repeats, plus two distinct random bosses at the end of act 2 and in the finale), scoring (`scoring.js`), the roster, and accounts (via the injected `accounts` store from `accounts.js`). It never touches sockets — `server/index.js` calls `show.handle(peerId, msg)`/`show.tick()` and drains `show.drain()` onto the right WebSockets (`to: '*'` broadcasts, a peer id targets one client) every 250 ms plus after every message.

Clients hold no gameplay authority: each player's device simulates its own arena (`ArenaRun` in `game/show/arenaRunner.ts`) against the level/boss/duration the server's `state` message named, and reports one `ArenaResult` back with a `result` message when it clears, dies, or times out — the server is the one that scores it, advances `clearOrder`, and decides when the round ends (every in-match player has a `result`) or times a straggler out itself (`DUR.grace` past the nominal length). Solo play works the same way: the server adds a `Bot` player, and whichever client it names `botHost` (the TV if one is connected, else the first human player — see `botHost()` in `engine.js`) runs the bot's arena locally via `botRunner.ts` and reports its result tagged `for: 'bot'`.

The protocol is `src/net/showProtocol.ts` (TypeScript) mirrored by `server/show/*.js` (plain Node, no build step) — change one side, change the other by hand. Two constants are duplicated this way on purpose: `constants.js`'s `LEVEL_COUNT`/`BOSS_LEVELS` must track `core/campaignLevels.ts`'s `CAMPAIGN_SIZE` and `core/bosses.ts`'s `bossForLevel`, and `constants.js`'s `DUR.grace` must track `showProtocol.ts`'s `ARENA_GRACE`.

Concretely, wiring a new show feature through the stack looks like: add a handler (plus a test) in `server/show/engine.js`, add its message to `showProtocol.ts`'s `ShowUp`/`ShowDown` unions, add a case in `game/show/store.ts`'s `ShowStore` that applies it to local state, then read the store from whichever scene(s) need it (`game/player/`, `game/tv/`).

### TypeScript config notes

`tsconfig.json` has `strict`, `noUnusedLocals`, `noUnusedParameters`, and — most likely to surprise — `verbatimModuleSyntax: true`: an import used only as a type must be written `import type { X }` (or `import { type X }`), and conversely anything imported with `import type` cannot be used as a value (e.g. `new X()`) — a type-only import of a class you then instantiate needs a regular `import`.
