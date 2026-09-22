# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A team-vs-team party game built on an Arkanoid engine. Each round, every team's "pilot" (rotating member) plays a short level simultaneously against the other teams' pilots, while the rest of each team plays a "Своя игра" (Jeopardy-style) board and spends earned credits on a live shop that buffs their own pilot (or sabotages a rival's) mid-round. No UI framework: a single `<canvas>` driven by hand-rolled TypeScript, built with Vite, with a plain Node WebSocket server for LAN play. Full player-facing rules live in `README.md` (Russian) — this file is dev-workflow and architecture only.

This repo started as a much larger multi-mode Arkanoid game (campaign, coop, 1v1 duel/split-screen, a standalone pinball table, a level editor, a hot-seat board-game "race" mode). All of that was stripped out to leave only this team-quiz game — if you're looking for those modes, they're in git history, not in the working tree.

## Commands

```bash
npm install
npm run dev          # Vite dev server, http://localhost:5173
npm run typecheck    # tsc --noEmit — the only automated correctness gate
npm run build        # tsc --noEmit && vite build -> dist/
npm run preview      # serve the production build locally
npm run serve        # node server/index.js — LAN room server, serves dist/ + WebSocket
npm run lan          # npm run build && npm run serve — the real "play over LAN" command
```

There is no test suite and no linter configured. `npm run typecheck` (which `npm run build` also runs) is the bar for any change — run it after every non-trivial edit.

To test over a network, `npm run lan` then open the printed LAN URL in **multiple separate browser windows** for the different roles (admin/pilot/team), not just tabs — a backgrounded tab throttles its render/simulation loop, which reads as fake lag or a frozen pilot.

`PORT=8081 npm run lan` picks a different port if 8080 is already taken; the server refuses to start with a clear message instead of silently binding a stale build.

A push to `main` auto-deploys `dist/` to GitHub Pages (`.github/workflows/pages.yml`, `npm ci && npm run build`) — pushing to `main` publishes the game, not just this repo.

## Architecture

### Scene model, no framework

`src/main.ts` boots a single `App` (`src/app.ts`) and calls `app.start()` (a plain `requestAnimationFrame` loop). `App` holds exactly one active `Scene` (`{ update(dt), draw(ctx, w, h), dispose() }`) at a time; `app.setScene(factory)` disposes the current one and replaces it wholesale — there is no scene stack or router. Every screen is a `SceneFactory = (app: App) => Scene` living under `src/game/` (the three team-quiz roles) or `src/ui/menu.ts` (the landing menu / role picker). DOM-heavy screens render into `app.overlay`, a plain DOM node layered over the canvas, via the small `el`/`button` helpers in `src/ui/dom.ts` — not React/JSX.

### Directory roles

- `src/core/` — pure simulation and rules, no DOM/canvas/network access: `Arena` (`arena.ts`, physics/bricks/power-ups/balls/XP/supers/skills), the procedural level generator (`levelGen.ts`, `campaignLevels.ts` — `RACE_LEVELS` is the 100-level pool pilots draw from), and the team-quiz rules (`teamRace.ts` — teams, pilot rotation, the track and its cells; `shop.ts` — the boost catalog; `jeopardy.ts` — the board's category/card model and validation). `race.ts` is a leftover name for a module `teamRace.ts` still imports from (`CellKind`/`CELL_TYPES`, `CardEffect`, dice scoring) — it's load-bearing, not dead code, despite there being no more solo "race" mode.
- `src/render/` — canvas drawing only: `renderer.ts`'s `drawArena`/`drawHud` paint a live `Arena`; `snapshotMirror.ts` interpolates another screen's field from periodic snapshots (used by the team screen to show its own pilot's live game).
- `src/game/` — the three role scenes (`teamQuizAdmin.ts`, `teamQuizPilot.ts`, `teamQuizBoard.ts`) plus the shared per-client state layer they all build on: `teamQuizStore.ts` replays server-broadcast events into a local `TeamRacer[]` (see below), `teamQuizNet.ts` is the typed wire wrapper. Also mode-agnostic bits: `input.ts` (key bindings) and `stepper.ts` (`FixedStepper` + `edgeOnce`, the fixed-timestep driver the pilot scene's `update` calls into).
- `src/audio/` — sound effects are synthesized in WebAudio at runtime (`sfx.ts`, no audio files shipped); `music.ts` plays user-supplied tracks described by `public/music/manifest.json` (absent by default — music is opt-in per install).
- `src/ui/` — the landing menu (role picker, profile switcher, loadout/audio/help screens), DOM helpers, global styles.
- `src/net/` — the WebSocket client (`client.ts`), the team-quiz protocol (`teamQuizProtocol.ts`) and its wire-format snapshot type (`raceProtocol.ts`/`protocol.ts` — same "race" leftover naming as `core/race.ts`, still the live type both the pilot's outgoing snapshots and the team screen's mirror use), and a thin fetch wrapper for the jeopardy content API (`jeopardyClient.ts`).
- `server/` — a plain Node ESM LAN server (`server/index.js`, no Express/framework), started by `npm run serve`. Serves the built `dist/` over HTTP, runs a `ws` `WebSocketServer` for rooms, and delegates to `teamQuiz.js` (the match referee) and `jeopardyStore.js` (validated, atomically-written CRUD behind `GET/PUT /api/jeopardy`). `jeopardyStore.js`'s `validateJeopardyData` duplicates `src/core/jeopardy.ts`'s validator by hand (this server runs plain Node, no TS build step) — change one, change both. Its data file, `server/data/jeopardy.json`, is gitignored: quiz content is local per install, not shipped in the repo.

### Determinism is load-bearing

The simulation steps at a fixed 1/120s tick (`TICK` in `core/constants.ts`) via `FixedStepper`, decoupled from render framerate, and every random draw goes through a seeded PRNG (`core/rng.ts`, mulberry32 — `new Rng(seed)`, `.int()`, `.pick()`, `.chance()`, `.shuffled()`). Same seed plus same inputs always reproduces the same run. This is the entire foundation the networked team-quiz mode is built on (next section).

### The team-quiz mode: "referee, not simulation"

`server/teamQuiz.js` owns only facts it has to arbitrate — which teams/members exist, the pilot rotation, the match seed, the round number/phase, which jeopardy cards are used. It holds **no gameplay numbers** (track position, lives, credits, score). Every connected screen — admin, each pilot, each team board — builds its own `TeamRacer[]` from `src/game/teamQuizStore.ts` and replays the same broadcast events (`roll`, `jeopardyAwarded`, `purchase`) through pure functions in `core/teamRace.ts` (`walkRoll`, `teamRoundRng`, `resolveTeamCell`), so every screen reaches identical numbers without the server ever computing or sending them. The `+1/−1` round bonus is decided client-side too, from the `order` the server attaches to each `roll` (arrival order of `pilot:result` messages) plus whether that team's result was `cleared`.

Concretely, wiring a new team-quiz feature through the stack looks like: add the fact to `core/teamRace.ts` (pure, no imports outside `core/`), add a message to `net/teamQuizProtocol.ts`'s `TeamQuizUp`/`TeamQuizDown` unions, add a thin case to `server/teamQuiz.js` that just sequences/relays it (resist the urge to compute anything game-rule-shaped there), add a handler in `teamQuizStore.ts` that applies it to the local `TeamRacer[]`, then read the store from whichever scene(s) need it. Shop items apply to a live `Arena` via `core/cardEffects.ts`'s `applyCardEffectToArena` — a `clock`/`dice` effect is the *caller's* job (it adjusts the round countdown or next roll, not the arena), everything else (`powerup`/`debuff`/`ball`/`super`/`lives`/`breakShield`) goes through that shared function.

### TypeScript config notes

`tsconfig.json` has `strict`, `noUnusedLocals`, `noUnusedParameters`, and — most likely to surprise — `verbatimModuleSyntax: true`: an import used only as a type must be written `import type { X }` (or `import { type X }`), and conversely anything imported with `import type` cannot be used as a value (e.g. `new X()`) — a type-only import of a class you then instantiate needs a regular `import`.
