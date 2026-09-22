# Arcoquiz Show — Stages 1–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin/pilot/team/broadcast team-quiz with a single server-driven show. It covers server accounts (name + emoji + 4-digit PIN), a lobby on the TV and on players' devices, a solo bot, and a working match loop of 10 random arkanoid arenas, two of them random distinct bosses. Everything is shown on a TV screen.

**Architecture:** A new plain-JS show engine in `server/show/` owns the phases, timers, roster, schedule and scoring. It uses a pure, injectable clock so it can be tested with `node --test`. Clients still simulate the arena themselves and report an `ArenaResult`. The TV (or the first player when there is no TV) also runs headless arenas for bots. The server broadcasts the full public `ShowState` on every change, plus typed `ShowEvent`s for the ticker. The old "server is only a referee" rule is dropped on purpose: the spec moves phase control and scoring to the server.

**Tech Stack:**
- TypeScript 5 + Vite 5 client with canvas + DOM overlay (`el`/`button` from `src/ui/dom.ts`);
- Node ESM server with `ws`;
- `node:test` + `node:assert/strict` for server tests;
- no new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-arcoquiz-show-design.md`

## Global Constraints

- Max 10 players in a match; 10 distinct colors.
- Solo: if exactly one human is in the match at start, a bot named «Бот» (avatar 🤖) is added.
- Match = Act 1 (3 rounds), Act 2 (3 rounds, the arena of its last round is BOSS #1), Act 3 (3 rounds), Finale (1 round, BOSS #2) = 10 arenas.
- Regular arenas: a random level from `RACE_LEVELS` (100 levels, indices 0–99) that is not a boss level (`(i+1) % 10 !== 0`), with no repeats within a match.
- Bosses: two distinct boss ids picked at random from `sentinel | weaver | core | doh`. For each, a random `RACE_LEVELS` index guarded by that boss (from `bossForLevel`: sentinel → 9, 19, 29; weaver → 39, 49, 59, 69; core → 79, 89; doh → 99).
- Accounts are stored in `server/data/players.json` (the dir is gitignored). The PIN must match `/^\d{4}$/` and is stored only as a scrypt hash + salt. Names are 1–16 chars, unique case-insensitively.
- All UI copy is in Russian.
- `tsconfig`: `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` (type-only imports use `import type`).
- Gates after every task: `npm run typecheck` and `npm test` (added in Task 1).
- One show per server (LAN). Players join at the printed URL; there is no room code in stages 1–2 (QR comes in stage 5).
- Do NOT push to `main`: a push deploys GitHub Pages.

## Pre-flight (before Task 1)

The branch `feat/race-mode` has uncommitted work (README, index.html, package.json, server/index.js, src/app.ts, sfx.ts, debuffs.ts, progression.ts, race.ts, a staged delete of `src/core/hall.ts`). **Ask the user** whether to commit it on `feat/race-mode` or stash it. Then create the worktree (superpowers:using-git-worktrees) on a new branch `feat/show-mode` from that commit.

## File Structure

**Server (new)**
- `server/show/constants.js`: durations, `MAX_PLAYERS`, `COLORS`, `AVATARS`, the act layout, level/boss tables.
- `server/show/rng.js`: `mulberry32`, the same algorithm as `src/core/rng.ts`.
- `server/show/schedule.js`: `buildSchedule(seed) → Round[]`.
- `server/show/scoring.js`: `scoreArena(result, clearOrder) → { points, coins }`.
- `server/show/accounts.js`: `createAccountStore(dir)`, with register/login/list/recordMatch and atomic writes.
- `server/show/engine.js`: `createShowEngine({ now, accounts, rng })`, a pure state machine plus an outbox.
- `server/show/*.test.js`: tests.

**Server (modify)**
- `server/index.js`: route the `show` channel to the engine, drop teamQuiz/jeopardy wiring, tick every 250 ms.

**Server (delete)**
- `server/teamQuiz.js`, `server/jeopardyStore.js`.

**Client (new)**
- `src/core/effects.ts`: the `CardEffect` type, moved out of `race.ts`.
- `src/net/showProtocol.ts`: `ShowUp`, `ShowDown`, `ShowState`, `PlayerPublic`, `RoundPublic`, `ArenaResult`, `ShowEvent`, `ArenaSnapshot`.
- `src/game/show/store.ts`: `ShowStore`, which mirrors the server state, collects ticker events and routes snapshots.
- `src/game/show/arenaRunner.ts`: `ArenaRun`, which builds, steps and reports one arena. It is shared by the player scene and the bot runner.
- `src/game/show/botRunner.ts`: headless bot arenas on the bot-host client.
- `src/game/player/login.ts`, `src/game/player/lobby.ts`, `src/game/player/arena.ts`, `src/game/player/wait.ts`, `src/game/player/index.ts`: the player scenes plus a router scene that picks the sub-view from store state.
- `src/game/tv/index.ts`, `src/game/tv/lobby.ts`, `src/game/tv/arenaGrid.ts`, `src/game/tv/ticker.ts`, `src/game/tv/standings.ts`: the TV.
- `src/ui/start.ts`: the landing screen («Я играю» / «Это экран-ТВ»).
- `src/ui/manual.ts`: a 5-point manual element.
- `src/ui/show.css`: styles for the new screens, imported from `main.ts`.

**Client (delete)**
- `src/game/teamQuiz*.ts` (Admin, Device, Broadcast, Store, Net, Editor);
- `src/net/teamQuizProtocol.ts`, `src/net/raceProtocol.ts`, `src/net/jeopardyClient.ts`;
- `src/core/teamRace.ts`, `src/core/jeopardy.ts`, `src/core/race.ts`;
- `src/ui/menu.ts`.

`pinball.ts`/`basement.ts` stay: `arena.ts` imports `Basement`. Removing them is out of scope.

---

### Task 1: Clear out the team quiz and add a test runner

**Files:**
- Create: `src/core/effects.ts`, `src/ui/start.ts` (placeholder), `server/show/smoke.test.js`
- Modify: `src/core/shop.ts`, `src/core/cardEffects.ts`, `src/net/protocol.ts`, `src/main.ts`, `package.json`, `server/index.js`
- Delete: the files listed under "(delete)" above

**Interfaces:**
- Produces: `import type { CardEffect } from '../core/effects'`; the `npm test` script.

- [ ] **Step 1: Create `src/core/effects.ts`**

```ts
import type { PowerupId } from './powerups';
import type { DebuffId } from './debuffs';
import type { BallTypeId } from './balls';

/** What a shop item does to a live arena. Applied by `applyCardEffectToArena`. */
export type CardEffect =
  | { t: 'powerup'; id: PowerupId }
  | { t: 'debuff'; id: DebuffId }
  | { t: 'ball'; id: BallTypeId }
  /** Charges the super and fires it there and then. */
  | { t: 'super' }
  | { t: 'lives'; delta: number }
  /** Blows the energy nodes holding a boss's shield. */
  | { t: 'breakShield' };
```

Check the three import paths: `grep -n "export type PowerupId\|export type DebuffId\|export type BallTypeId" src/core/*.ts`. Adjust a path if a type lives elsewhere, and keep whatever `race.ts` imported them from.

- [ ] **Step 2: Point `shop.ts` and `cardEffects.ts` at it and drop track items**

In `src/core/shop.ts`:
- replace `import type { CardEffect } from './race';` with `import type { CardEffect } from './effects';`;
- remove `'diceBoost'` and `'teleportBack'` from `ShopItemId`, and delete both entries from `SHOP_ITEMS`;
- replace the long header comment with: `/** The show's shop: coins buy a buff for yourself or an ally, or a debuff for a non-ally. Bought items land at the start of the next arena. */`.

In `src/core/cardEffects.ts`:
- switch the import to `./effects`;
- delete the `case 'clock': case 'dice': case 'cell': break;` arm and the doc sentence about them.

- [ ] **Step 3: Delete the old team-quiz code**

```bash
git rm src/game/teamQuizAdmin.ts src/game/teamQuizDevice.ts src/game/teamQuizBroadcast.ts \
  src/game/teamQuizStore.ts src/game/teamQuizNet.ts src/game/teamQuizEditor.ts \
  src/net/teamQuizProtocol.ts src/net/raceProtocol.ts src/net/jeopardyClient.ts \
  src/core/teamRace.ts src/core/jeopardy.ts src/core/race.ts src/ui/menu.ts \
  server/teamQuiz.js server/jeopardyStore.js
```

- [ ] **Step 4: Add the snapshot type to `src/net/protocol.ts`**

Remove `MatchMessage` and `SNAPSHOT_INTERVAL` (both now unused), keep `FieldSnapshot`, then append:

```ts
/** A live field for the TV. `cells` only travels when the wall changed. */
export interface ArenaSnapshot extends Omit<FieldSnapshot, 'cells'> {
  cells?: string;
  /** Rises by one per snapshot; older ones are dropped. */
  n: number;
  /** Seconds left on the arena clock. */
  clock: number;
}

/** Ten a second: ten fields on one TV, so half the old race rate. */
export const SNAPSHOT_INTERVAL = 0.1;
/** Safety re-send of the brick wall for a TV that joined mid-arena. */
export const CELLS_INTERVAL = 1.5;
```

Then, in `src/render/snapshotMirror.ts`, replace `RaceSnapshot` with `ArenaSnapshot` (import from `../net/protocol`).

- [ ] **Step 5: Placeholder start screen and `main.ts`**

`src/ui/start.ts`:

```ts
import type { Scene, SceneFactory } from '../app';
import { el } from './dom';

/** Landing screen. Real choices arrive in Task 11. */
export const startScene: SceneFactory = (app): Scene => {
  app.overlay.classList.add('interactive');
  app.overlay.replaceChildren(el('div', { class: 'start' }, el('h1', {}, 'ARCOQUIZ'), el('p', {}, 'Шоу собирается…')));
  return {
    update() {},
    draw(ctx, w, h) {
      ctx.fillStyle = '#071a20';
      ctx.fillRect(0, 0, w, h);
    },
    dispose() {
      app.overlay.replaceChildren();
    },
  };
};
```

In `src/main.ts`, replace all role routing with:

```ts
import { App } from './app';
import { startScene } from './ui/start';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const overlay = document.getElementById('overlay');
if (!canvas || !overlay) throw new Error('index.html is missing #stage or #overlay');

const app = new App(canvas, overlay);
app.setScene(startScene);
app.start();

declare global {
  interface Window {
    neonoid?: App;
  }
}
window.neonoid = app;
```

- [ ] **Step 6: Strip the server down to static files + ws rooms**

In `server/index.js`:
- delete the `teamQuiz`/`jeopardy` imports, `createTeamQuiz`, its `setInterval`, `jeopardyStore`, `readBody`, `handleJeopardyApi`, and the `/api/jeopardy` branch;
- in the `connection` handler, drop the `case 'teamquiz'` and the `teamQuiz.cleanup` call;
- change `features: ['teamquiz']` to `features: ['show']`;
- change the banner line to `'  ARCOQUIZ — сервер локальной сети'`.

In `src/net/client.ts`:
- rename `teamQuizListeners`/`sendTeamQuiz`/`onTeamQuiz` to `showListeners`/`sendShow`/`onShow`;
- change the message type they carry from `'teamquiz'` to `'show'`.

- [ ] **Step 7: Add the test script and a smoke test**

In `package.json` `"scripts"`, add `"test": "node --test server/"`.

`server/show/smoke.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test runner is wired', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck`. Expected: exit 0. Any remaining error names a file importing a deleted module: remove that import, or delete the file if it only served the team quiz (`grep -rn "race'\|teamRace\|jeopardy\|teamQuiz" src`).

Run: `npm test`. Expected: `# pass 1`.

Run: `npm run build`. Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add -A src server package.json
git commit -m "Clear the team quiz out to make room for the show

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Constants, RNG and the random schedule with two bosses

**Files:**
- Create: `server/show/constants.js`, `server/show/rng.js`, `server/show/schedule.js`, `server/show/schedule.test.js`

**Interfaces:**
- Produces:
  - `buildSchedule(seed:number) → Round[]`, where `Round = { index, act: 1|2|3|4, actRound: 1..3, levelIndex: number, boss: null|'sentinel'|'weaver'|'core'|'doh' }`;
  - `mulberry32(seed) → () => number` in [0,1);
  - `pickInt(rand, n)`;
  - `shuffle(rand, arr)` (returns a new array).

- [ ] **Step 1: Write the failing test** `server/show/schedule.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule } from './schedule.js';
import { BOSS_LEVELS } from './constants.js';

test('ten rounds laid out as 3+3+3+finale', () => {
  const s = buildSchedule(42);
  assert.equal(s.length, 10);
  assert.deepEqual(s.map((r) => r.act), [1, 1, 1, 2, 2, 2, 3, 3, 3, 4]);
  assert.deepEqual(s.map((r) => r.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('bosses sit at the end of act 2 and the finale, and differ', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const s = buildSchedule(seed);
    const bosses = s.filter((r) => r.boss);
    assert.deepEqual(bosses.map((r) => r.index), [5, 9], `seed ${seed}`);
    assert.notEqual(bosses[0].boss, bosses[1].boss, `seed ${seed}`);
    for (const r of bosses) assert.ok(BOSS_LEVELS[r.boss].includes(r.levelIndex), `seed ${seed}`);
  }
});

test('regular rounds use distinct non-boss levels', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const regular = buildSchedule(seed).filter((r) => !r.boss).map((r) => r.levelIndex);
    assert.equal(new Set(regular).size, regular.length);
    for (const i of regular) {
      assert.ok(i >= 0 && i < 100);
      assert.notEqual((i + 1) % 10, 0);
    }
  }
});

test('same seed, same schedule; different seeds vary', () => {
  assert.deepEqual(buildSchedule(7), buildSchedule(7));
  const firsts = new Set(Array.from({ length: 30 }, (_, k) => buildSchedule(k + 1)[0].levelIndex));
  assert.ok(firsts.size > 5);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`. Expected: FAIL with `Cannot find module .../schedule.js`.

- [ ] **Step 3: Implement**

`server/show/rng.js`:

```js
/** mulberry32: the same generator as src/core/rng.ts. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pickInt = (rand, n) => Math.floor(rand() * n);

export function shuffle(rand, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = pickInt(rand, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

`server/show/constants.js`:

```js
/** Mirrors src/core/campaignLevels.ts (CAMPAIGN_SIZE) and src/core/bosses.ts
 *  (bossForLevel). This server runs plain Node with no TS build, so change
 *  both sides together. */
export const LEVEL_COUNT = 100;
export const BOSS_LEVELS = {
  sentinel: [9, 19, 29],
  weaver: [39, 49, 59, 69],
  core: [79, 89],
  doh: [99],
};
export const BOSS_IDS = Object.keys(BOSS_LEVELS);

/** Rounds per act; act 4 is the finale. */
export const ACTS = [3, 3, 3, 1];
/** Round indices whose arena is a boss: end of act 2, and the finale. */
export const BOSS_ROUNDS = [5, 9];

export const MAX_PLAYERS = 10;
export const COLORS = [
  '#4de2ff', '#ff5fa2', '#ffd24d', '#3ddc84', '#b06bff',
  '#ff8c42', '#7cf5c4', '#ff4d6d', '#8fa8ff', '#e8f2ff',
];
export const AVATARS = ['🦊', '🐸', '🐙', '🦉', '🐼', '🦄', '🐯', '🐨', '🦖', '🐝', '🐧', '🦁', '🐻', '🐳', '🦩', '🌵'];
export const BOT = { id: 'bot', name: 'Бот', avatar: '🤖' };

/** Seconds. */
export const DUR = {
  countdown: 10,
  intro: 6,
  arena: 75,
  bossArena: 120,
  /** Extra time a client gets to report before the server calls time. */
  grace: 8,
  roundEnd: 7,
};
```

`server/show/schedule.js`:

```js
import { ACTS, BOSS_IDS, BOSS_LEVELS, BOSS_ROUNDS, LEVEL_COUNT } from './constants.js';
import { mulberry32, pickInt, shuffle } from './rng.js';

/** Every arena of one match: random non-repeating regular levels, and two
 *  different random bosses at the end of act 2 and in the finale. */
export function buildSchedule(seed) {
  const rand = mulberry32(seed);
  const regularPool = [];
  for (let i = 0; i < LEVEL_COUNT; i++) if ((i + 1) % 10 !== 0) regularPool.push(i);
  const regular = shuffle(rand, regularPool);
  const bosses = shuffle(rand, BOSS_IDS).slice(0, BOSS_ROUNDS.length);

  const rounds = [];
  let index = 0;
  ACTS.forEach((count, a) => {
    for (let k = 0; k < count; k++, index++) {
      const bossSlot = BOSS_ROUNDS.indexOf(index);
      if (bossSlot >= 0) {
        const boss = bosses[bossSlot];
        const levels = BOSS_LEVELS[boss];
        rounds.push({ index, act: a + 1, actRound: k + 1, levelIndex: levels[pickInt(rand, levels.length)], boss });
      } else {
        rounds.push({ index, act: a + 1, actRound: k + 1, levelIndex: regular.pop(), boss: null });
      }
    }
  });
  return rounds;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`. Expected: all schedule tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/show
git commit -m "Deal each match ten random arenas and two different bosses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Arena scoring

**Files:**
- Create: `server/show/scoring.js`, `server/show/scoring.test.js`

**Interfaces:**
- Consumes: `ArenaResult = { cleared: boolean, died: boolean, timeLeft: number, bricks: number, livesLost: number }`.
- Produces: `scoreArena(result, clearOrder) → { points, coins }`. `clearOrder` is the 0-based order among players who cleared, or `null` if the player did not clear. `FIRST_CLEAR_BONUS = 50`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreArena, FIRST_CLEAR_BONUS } from './scoring.js';

const r = (o) => ({ cleared: false, died: false, timeLeft: 0, bricks: 0, livesLost: 0, ...o });

test('clearing pays 100 plus a second per point of time left', () => {
  assert.deepEqual(scoreArena(r({ cleared: true, timeLeft: 30.6, bricks: 40 }), 1), { points: 131, coins: 40 });
});

test('first clear gets the bonus', () => {
  assert.equal(scoreArena(r({ cleared: true, timeLeft: 10, bricks: 5 }), 0).points, 110 + FIRST_CLEAR_BONUS);
});

test('not clearing pays two per brick, capped at 60', () => {
  assert.equal(scoreArena(r({ bricks: 12 }), null).points, 24);
  assert.equal(scoreArena(r({ bricks: 80 }), null).points, 60);
});

test('coins equal bricks, clamped to non-negative integers', () => {
  assert.equal(scoreArena(r({ bricks: -3 }), null).coins, 0);
  assert.equal(scoreArena(r({ bricks: 7.9 }), null).coins, 7);
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `npm test`. Expected: module not found.

- [ ] **Step 3: Implement**

```js
export const FIRST_CLEAR_BONUS = 50;
const CLEAR_POINTS = 100;
const BRICK_POINTS = 2;
const BRICK_POINTS_CAP = 60;

/** Points rank the match; coins go to the shop. */
export function scoreArena(result, clearOrder) {
  const bricks = Math.max(0, Math.floor(result.bricks || 0));
  const coins = bricks;
  if (result.cleared) {
    const bonus = clearOrder === 0 ? FIRST_CLEAR_BONUS : 0;
    return { points: CLEAR_POINTS + Math.round(Math.max(0, result.timeLeft)) + bonus, coins };
  }
  return { points: Math.min(BRICK_POINTS_CAP, bricks * BRICK_POINTS), coins };
}
```

Note: `Math.round(30.6) = 31`, so the first test expects 131.

- [ ] **Step 4: Run it and confirm it passes.** Run: `npm test`.

- [ ] **Step 5: Commit** with the message `Score an arena: clears, speed, and bricks for the rest`, plus the Co-Authored-By trailer.

---

### Task 4: Server accounts

**Files:**
- Create: `server/show/accounts.js`, `server/show/accounts.test.js`

**Interfaces:**
- Produces: `createAccountStore(dir) → Promise<AccountStore>` with:
  - `list() → AccountPublic[]`, where `AccountPublic = { id, name, avatar, stats: { matches, wins, best } }`;
  - `register({ name, avatar, pin }) → Promise<AccountPublic>`, which throws `AccountError`;
  - `verify(id, pin) → AccountPublic | null`;
  - `recordMatch(id, { won, score }) → Promise<void>`.
- Exported: `class AccountError extends Error`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountStore, AccountError } from './accounts.js';

const fresh = async () => createAccountStore(await mkdtemp(join(tmpdir(), 'acc-')));

test('register then verify with the right PIN only', async () => {
  const s = await fresh();
  const a = await s.register({ name: 'Катя', avatar: '🦊', pin: '1234' });
  assert.equal(a.name, 'Катя');
  assert.deepEqual(a.stats, { matches: 0, wins: 0, best: 0 });
  assert.equal(s.verify(a.id, '1234')?.id, a.id);
  assert.equal(s.verify(a.id, '9999'), null);
  assert.equal(s.verify('nope', '1234'), null);
});

test('rejects bad names, bad pins, duplicate names', async () => {
  const s = await fresh();
  await s.register({ name: 'Олег', avatar: '🐸', pin: '0000' });
  await assert.rejects(s.register({ name: 'олег', avatar: '🐸', pin: '1111' }), AccountError);
  await assert.rejects(s.register({ name: '', avatar: '🐸', pin: '1111' }), AccountError);
  await assert.rejects(s.register({ name: 'x'.repeat(17), avatar: '🐸', pin: '1111' }), AccountError);
  await assert.rejects(s.register({ name: 'Аня', avatar: '🐸', pin: '12a4' }), AccountError);
  await assert.rejects(s.register({ name: 'Бот', avatar: '🐸', pin: '1234' }), AccountError);
});

test('persists across reloads and never stores the PIN', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acc-'));
  const s1 = await createAccountStore(dir);
  const a = await s1.register({ name: 'Аня', avatar: '🦉', pin: '4321' });
  await s1.recordMatch(a.id, { won: true, score: 900 });
  const raw = await readFile(join(dir, 'players.json'), 'utf8');
  assert.ok(!raw.includes('4321'));
  const s2 = await createAccountStore(dir);
  assert.deepEqual(s2.list()[0].stats, { matches: 1, wins: 1, best: 900 });
  assert.ok(s2.verify(a.id, '4321'));
});
```

- [ ] **Step 2: Run it and confirm it fails.**

- [ ] **Step 3: Implement**

```js
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { AVATARS, BOT } from './constants.js';

export class AccountError extends Error {}

const hashPin = (pin, salt) => scryptSync(pin, salt, 32).toString('hex');
const pub = (a) => ({ id: a.id, name: a.name, avatar: a.avatar, stats: { ...a.stats } });

export async function createAccountStore(dir) {
  const file = join(dir, 'players.json');
  let accounts = [];
  try {
    accounts = JSON.parse(await readFile(file, 'utf8')).accounts ?? [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  async function save() {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify({ accounts }, null, 2), 'utf8');
    await rename(tmp, file);
  }

  return {
    list: () => accounts.map(pub),

    async register({ name, avatar, pin }) {
      const clean = String(name ?? '').trim();
      if (clean.length < 1 || clean.length > 16) throw new AccountError('Имя — от 1 до 16 символов.');
      if (clean.toLowerCase() === BOT.name.toLowerCase()) throw new AccountError('Это имя занято ботом.');
      if (accounts.some((a) => a.name.toLowerCase() === clean.toLowerCase())) throw new AccountError('Такое имя уже есть.');
      if (!/^\d{4}$/.test(String(pin ?? ''))) throw new AccountError('PIN — ровно 4 цифры.');
      const salt = randomBytes(16).toString('hex');
      const acc = {
        id: `u${randomBytes(6).toString('hex')}`,
        name: clean,
        avatar: AVATARS.includes(avatar) ? avatar : AVATARS[0],
        salt,
        hash: hashPin(String(pin), salt),
        stats: { matches: 0, wins: 0, best: 0 },
        createdAt: Date.now(),
      };
      accounts.push(acc);
      await save();
      return pub(acc);
    },

    verify(id, pin) {
      const acc = accounts.find((a) => a.id === id);
      if (!acc || !/^\d{4}$/.test(String(pin ?? ''))) return null;
      const ok = timingSafeEqual(Buffer.from(hashPin(String(pin), acc.salt), 'hex'), Buffer.from(acc.hash, 'hex'));
      return ok ? pub(acc) : null;
    },

    async recordMatch(id, { won, score }) {
      const acc = accounts.find((a) => a.id === id);
      if (!acc) return;
      acc.stats.matches += 1;
      if (won) acc.stats.wins += 1;
      acc.stats.best = Math.max(acc.stats.best, score);
      await save();
    },
  };
}
```

- [ ] **Step 4: Run it and confirm it passes.** Run: `npm test`.

- [ ] **Step 5: Commit** with the message `Keep player accounts on the LAN server behind a PIN`, plus the trailer.

---

### Task 5: Show engine, part 1 — connections, auth, lobby, start, solo bot

**Files:**
- Create: `server/show/engine.js`, `server/show/engine.test.js`

**Interfaces:**
- Consumes: `buildSchedule`, `scoreArena`, the constants, and the `AccountStore` interface (`list`, `verify`, `register`, `recordMatch`).
- Produces: `createShowEngine({ now: () => ms, accounts, seed?: () => number }) → Engine`, where:
  - `connect(peerId)` / `disconnect(peerId)`;
  - `handle(peerId, msg)` takes an async-free `ShowUp` object (`register` returns a promise, so `handle` returns `Promise<void>`);
  - `tick()`;
  - `drain() → Array<{ to: peerId | '*', msg: ShowDown }>`;
  - `state() → ShowState` (the public state).
- Wire messages (`k` field), client → server:
  - `{k:'hello', role:'tv'|'player'}`
  - `{k:'accounts'}`
  - `{k:'register', name, avatar, pin}`
  - `{k:'login', id, pin}`
  - `{k:'resume', token}`
  - `{k:'ready', ready}`
  - `{k:'result', result, for?}`
  - `{k:'snapshot', snap, for?}`
  - `{k:'restart'}`
- Wire messages, server → client:
  - `{k:'accounts', list}`
  - `{k:'auth', ok:true, player:PlayerPublic, token} | {k:'auth', ok:false, error}`
  - `{k:'state', show:ShowState}`
  - `{k:'event', ev:ShowEvent}`
  - `{k:'snapshot', playerId, snap}`
- `ShowState = { phase:'lobby'|'intro'|'arena'|'roundEnd'|'over', now:number, players:PlayerPublic[], round:RoundPublic|null, rounds:number, deadline:number|null, countdownEnd:number|null, botHost:string|null, tvCount:number }`.
- `PlayerPublic = { id, name, avatar, color, isBot, connected, ready, inMatch, score, coins, result: ArenaResult|null, lastPoints:number }`.
- `RoundPublic = { index, act, actRound, levelIndex, boss, seconds }`.
- `ShowEvent = { kind: 'joined'|'left'|'ready'|'matchStart'|'roundStart'|'cleared'|'died'|'timeout'|'roundEnd'|'matchOver', playerId?: string, place?: number, points?: number, at: number }`.

- [ ] **Step 1: Write the failing tests** `server/show/engine.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShowEngine } from './engine.js';
import { DUR } from './constants.js';

function fakeAccounts() {
  const list = [
    { id: 'u1', name: 'Аня', avatar: '🦊', stats: { matches: 0, wins: 0, best: 0 } },
    { id: 'u2', name: 'Олег', avatar: '🐸', stats: { matches: 0, wins: 0, best: 0 } },
  ];
  const recorded = [];
  return {
    recorded,
    list: () => list,
    verify: (id, pin) => (pin === '1111' ? list.find((a) => a.id === id) ?? null : null),
    register: async () => { throw new Error('unused'); },
    recordMatch: async (id, r) => { recorded.push({ id, ...r }); },
  };
}

function setup() {
  let t = 1_000_000;
  const accounts = fakeAccounts();
  const eng = createShowEngine({ now: () => t, accounts, seed: () => 42 });
  return { eng, accounts, advance: (s) => { t += s * 1000; eng.tick(); }, now: () => t };
}

const login = async (eng, peer, id) => {
  eng.connect(peer);
  await eng.handle(peer, { k: 'hello', role: 'player' });
  await eng.handle(peer, { k: 'login', id, pin: '1111' });
};

test('login with a wrong PIN is refused', async () => {
  const { eng } = setup();
  eng.connect('p1');
  await eng.handle('p1', { k: 'hello', role: 'player' });
  eng.drain();
  await eng.handle('p1', { k: 'login', id: 'u1', pin: '0000' });
  const out = eng.drain();
  assert.ok(out.some((o) => o.to === 'p1' && o.msg.k === 'auth' && o.msg.ok === false));
  assert.equal(eng.state().players.length, 0);
});

test('first ready starts a countdown; everyone ready starts at once', async () => {
  const { eng } = setup();
  await login(eng, 'p1', 'u1');
  await login(eng, 'p2', 'u2');
  await eng.handle('p1', { k: 'ready', ready: true });
  assert.ok(eng.state().countdownEnd);
  assert.equal(eng.state().phase, 'lobby');
  await eng.handle('p2', { k: 'ready', ready: true });
  assert.equal(eng.state().phase, 'intro');
  assert.equal(eng.state().players.filter((p) => p.inMatch).length, 2);
  assert.ok(!eng.state().players.some((p) => p.isBot));
});

test('a solo player gets the bot when the countdown runs out', async () => {
  const { eng, advance } = setup();
  await login(eng, 'p1', 'u1');
  eng.connect('tv');
  await eng.handle('tv', { k: 'hello', role: 'tv' });
  await eng.handle('p1', { k: 'ready', ready: true });
  assert.equal(eng.state().phase, 'intro'); // the only player is ready → start now
  const bot = eng.state().players.find((p) => p.isBot);
  assert.ok(bot && bot.inMatch);
  assert.equal(eng.state().botHost, 'tv');
});

test('countdown expiry starts with only the ready players', async () => {
  const { eng, advance } = setup();
  await login(eng, 'p1', 'u1');
  await login(eng, 'p2', 'u2');
  await eng.handle('p1', { k: 'ready', ready: true });
  advance(DUR.countdown + 0.1);
  const st = eng.state();
  assert.equal(st.phase, 'intro');
  assert.deepEqual(st.players.filter((p) => p.inMatch).map((p) => p.id).sort(), ['bot', 'u1']);
});

test('resume with a token re-binds the account to a new peer', async () => {
  const { eng } = setup();
  await login(eng, 'p1', 'u1');
  const auth = eng.drain().find((o) => o.msg.k === 'auth' && o.msg.ok);
  eng.disconnect('p1');
  assert.equal(eng.state().players.find((p) => p.id === 'u1').connected, false);
  eng.connect('p9');
  await eng.handle('p9', { k: 'resume', token: auth.msg.token });
  assert.equal(eng.state().players.find((p) => p.id === 'u1').connected, true);
});

test('no more than 10 players', async () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ id: `x${i}`, name: `N${i}`, avatar: '🦊', stats: {} }));
  const accounts = { ...fakeAccounts(), list: () => many, verify: (id) => many.find((a) => a.id === id) };
  const e2 = createShowEngine({ now: () => 0, accounts, seed: () => 1 });
  for (let i = 0; i < 11; i++) await login(e2, `p${i}`, `x${i}`);
  assert.equal(e2.state().players.length, 10);
  const refused = e2.drain().filter((o) => o.to === 'p10' && o.msg.k === 'auth' && !o.msg.ok);
  assert.equal(refused.length, 1);
});
```

- [ ] **Step 2: Run it and confirm it fails.**

- [ ] **Step 3: Implement the lobby half of `engine.js`**

```js
import { randomBytes } from 'node:crypto';
import { BOT, COLORS, DUR, MAX_PLAYERS } from './constants.js';
import { buildSchedule } from './schedule.js';
import { scoreArena } from './scoring.js';

/** The show's referee and director: phases, timers, roster, schedule, score.
 *  It never touches sockets; index.js drains `outbox` onto them. */
export function createShowEngine({ now, accounts, seed = () => (Math.random() * 2 ** 32) >>> 0 }) {
  /** peerId -> { role, accountId|null } */
  const peers = new Map();
  /** token -> accountId */
  const tokens = new Map();
  /** accountId|'bot' -> player record */
  const players = new Map();
  let outbox = [];

  let phase = 'lobby';
  let schedule = [];
  let roundIdx = -1;
  let deadline = null;
  let countdownEnd = null;
  let clearOrder = [];

  const out = (to, msg) => outbox.push({ to, msg });
  const event = (kind, extra = {}) => out('*', { k: 'event', ev: { kind, at: now(), ...extra } });

  const tvPeers = () => [...peers].filter(([, p]) => p.role === 'tv').map(([id]) => id);
  const playerPeer = (accountId) => [...peers].find(([, p]) => p.accountId === accountId)?.[0] ?? null;
  const inMatch = () => [...players.values()].filter((p) => p.inMatch);

  function botHost() {
    const tv = tvPeers()[0];
    if (tv) return tv;
    const humans = inMatch().filter((p) => !p.isBot && playerPeer(p.id));
    return humans.length ? playerPeer(humans[0].id) : null;
  }

  function publicPlayer(p) {
    return {
      id: p.id, name: p.name, avatar: p.avatar, color: p.color, isBot: p.isBot,
      connected: p.isBot || playerPeer(p.id) !== null,
      ready: p.ready, inMatch: p.inMatch, score: p.score, coins: p.coins,
      result: p.result, lastPoints: p.lastPoints,
    };
  }

  function state() {
    const r = schedule[roundIdx];
    return {
      phase,
      now: now(),
      players: [...players.values()].map(publicPlayer),
      round: r ? { ...r, seconds: r.boss ? DUR.bossArena : DUR.arena } : null,
      rounds: schedule.length,
      deadline,
      countdownEnd,
      botHost: botHost(),
      tvCount: tvPeers().length,
    };
  }

  const pushState = () => out('*', { k: 'state', show: state() });

  function freeColor() {
    const used = new Set([...players.values()].map((p) => p.color));
    return COLORS.find((c) => !used.has(c)) ?? COLORS[0];
  }

  function addPlayer(acc, isBot = false) {
    const p = {
      id: acc.id, name: acc.name, avatar: acc.avatar, color: freeColor(), isBot,
      ready: isBot, inMatch: false, score: 0, coins: 0, result: null, lastPoints: 0,
    };
    players.set(p.id, p);
    return p;
  }

  function bind(peerId, acc) {
    // A second device logging into the same account takes it over.
    for (const [pid, p] of peers) if (p.accountId === acc.id && pid !== peerId) p.accountId = null;
    peers.get(peerId).accountId = acc.id;
    if (!players.has(acc.id)) {
      if (players.size >= MAX_PLAYERS) {
        peers.get(peerId).accountId = null;
        out(peerId, { k: 'auth', ok: false, error: 'Все 10 мест заняты.' });
        return;
      }
      addPlayer(acc);
      event('joined', { playerId: acc.id });
    }
    const token = randomBytes(12).toString('hex');
    tokens.set(token, acc.id);
    out(peerId, { k: 'auth', ok: true, player: publicPlayer(players.get(acc.id)), token });
    pushState();
  }

  function startMatch() {
    countdownEnd = null;
    for (const p of players.values()) {
      p.inMatch = p.ready && (p.isBot || playerPeer(p.id) !== null);
      p.score = 0; p.coins = 0; p.result = null; p.lastPoints = 0;
    }
    if (inMatch().length === 1 && !players.has(BOT.id)) {
      const b = addPlayer(BOT, true);
      b.inMatch = true;
    }
    schedule = buildSchedule(seed());
    roundIdx = -1;
    phase = 'intro';
    deadline = now() + DUR.intro * 1000;
    event('matchStart');
    pushState();
  }

  function maybeStart() {
    const connected = [...players.values()].filter((p) => !p.isBot && playerPeer(p.id));
    if (!connected.length) return;
    if (connected.every((p) => p.ready)) startMatch();
    else if (connected.some((p) => p.ready) && countdownEnd === null) countdownEnd = now() + DUR.countdown * 1000;
  }

  async function handle(peerId, msg) {
    const peer = peers.get(peerId);
    if (!peer || !msg || typeof msg.k !== 'string') return;
    switch (msg.k) {
      case 'hello':
        peer.role = msg.role === 'tv' ? 'tv' : 'player';
        out(peerId, { k: 'state', show: state() });
        if (peer.role === 'tv') pushState();
        break;
      case 'accounts':
        out(peerId, { k: 'accounts', list: accounts.list() });
        break;
      case 'register':
        try {
          const acc = await accounts.register(msg);
          bind(peerId, acc);
        } catch (err) {
          out(peerId, { k: 'auth', ok: false, error: err.message });
        }
        break;
      case 'login': {
        const acc = accounts.verify(msg.id, msg.pin);
        if (!acc) out(peerId, { k: 'auth', ok: false, error: 'Неверный PIN.' });
        else bind(peerId, acc);
        break;
      }
      case 'resume': {
        const id = tokens.get(msg.token);
        const acc = id && accounts.list().find((a) => a.id === id);
        if (!acc) out(peerId, { k: 'auth', ok: false, error: 'Сессия устарела — войдите заново.' });
        else bind(peerId, acc);
        break;
      }
      case 'ready': {
        const p = peer.accountId && players.get(peer.accountId);
        if (!p || phase !== 'lobby') break;
        p.ready = Boolean(msg.ready);
        event('ready', { playerId: p.id });
        maybeStart();
        pushState();
        break;
      }
      default:
        handleMatch(peerId, peer, msg); // Task 6
    }
  }

  function handleMatch() {}

  function tick() {
    if (phase === 'lobby' && countdownEnd !== null && now() >= countdownEnd) startMatch();
    tickMatch(); // Task 6
  }

  function tickMatch() {}

  return {
    connect(peerId) { peers.set(peerId, { role: 'player', accountId: null }); },
    disconnect(peerId) {
      const accId = peers.get(peerId)?.accountId;
      peers.delete(peerId);
      if (accId) event('left', { playerId: accId });
      pushState();
    },
    handle,
    tick,
    state,
    drain() { const o = outbox; outbox = []; return o; },
  };
}
```

Note on the solo test: with one connected player, `maybeStart` sees everyone ready and starts at once. That is the intended behavior («соло» doesn't make you wait 10 s).

- [ ] **Step 4: Run it and confirm it passes.** Run: `npm test`. All engine tests pass. Remove `server/show/smoke.test.js`.

- [ ] **Step 5: Commit** with the message `Run the show's lobby on the server: logins, ready-up, a bot for the lonely`, plus the trailer.

---

### Task 6: Show engine, part 2 — the match loop

**Files:**
- Modify: `server/show/engine.js` (fill in `handleMatch` and `tickMatch`)
- Test: `server/show/engine.test.js` (append)

**Interfaces:**
- Consumes: the `ShowUp` messages `result`, `snapshot`, `restart` from Task 5.
- Produces:
  - phase flow `intro → arena → roundEnd → arena … → over`;
  - `round.seconds` = `DUR.arena` or `DUR.bossArena`;
  - `deadline` = arena end + `DUR.grace` in arena, and the phase end otherwise;
  - `recordMatch` is called for every human in the match at `over`; the winner is the highest `score`.

- [ ] **Step 1: Append failing tests**

```js
const res = (o) => ({ cleared: false, died: false, timeLeft: 0, bricks: 0, livesLost: 0, ...o });

async function startedDuo() {
  const s = setup();
  await login(s.eng, 'p1', 'u1');
  await login(s.eng, 'p2', 'u2');
  await s.eng.handle('p1', { k: 'ready', ready: true });
  await s.eng.handle('p2', { k: 'ready', ready: true });
  s.advance(DUR.intro + 0.1);
  return s;
}

test('intro leads into the first arena', async () => {
  const { eng } = await startedDuo();
  const st = eng.state();
  assert.equal(st.phase, 'arena');
  assert.equal(st.round.index, 0);
  assert.equal(st.round.seconds, DUR.arena);
});

test('round ends when everyone reported; first clear scores the bonus', async () => {
  const { eng } = await startedDuo();
  await eng.handle('p2', { k: 'result', result: res({ cleared: true, timeLeft: 20, bricks: 30 }) });
  await eng.handle('p1', { k: 'result', result: res({ cleared: true, timeLeft: 10, bricks: 30 }) });
  const st = eng.state();
  assert.equal(st.phase, 'roundEnd');
  const byId = Object.fromEntries(st.players.map((p) => [p.id, p]));
  assert.equal(byId.u2.score, 170);
  assert.equal(byId.u1.score, 110);
  assert.equal(byId.u1.coins, 30);
  const kinds = eng.drain().filter((o) => o.msg.k === 'event').map((o) => o.msg.ev.kind);
  assert.ok(kinds.includes('cleared') && kinds.includes('roundEnd'));
});

test('a result is accepted once per player per round', async () => {
  const { eng } = await startedDuo();
  await eng.handle('p1', { k: 'result', result: res({ cleared: true, timeLeft: 10 }) });
  await eng.handle('p1', { k: 'result', result: res({ cleared: true, timeLeft: 70 }) });
  assert.equal(eng.state().players.find((p) => p.id === 'u1').score, 160);
});

test('silent players time out after the arena clock plus grace', async () => {
  const { eng, advance } = await startedDuo();
  await eng.handle('p1', { k: 'result', result: res({ bricks: 5 }) });
  advance(DUR.arena + DUR.grace + 0.1);
  assert.equal(eng.state().phase, 'roundEnd');
  assert.equal(eng.state().players.find((p) => p.id === 'u2').result.cleared, false);
});

test('ten rounds then over; stats recorded for humans only', async () => {
  const s = setup();
  await login(s.eng, 'p1', 'u1');
  s.eng.connect('tv');
  await s.eng.handle('tv', { k: 'hello', role: 'tv' });
  await s.eng.handle('p1', { k: 'ready', ready: true });
  s.advance(DUR.intro + 0.1);
  for (let i = 0; i < 10; i++) {
    assert.equal(s.eng.state().round.index, i);
    await s.eng.handle('p1', { k: 'result', result: res({ cleared: true, timeLeft: 5 }) });
    await s.eng.handle('tv', { k: 'result', for: 'bot', result: res({ bricks: 3 }) });
    s.advance(DUR.roundEnd + 0.1);
  }
  assert.equal(s.eng.state().phase, 'over');
  assert.deepEqual(s.accounts.recorded, [{ id: 'u1', won: true, score: 10 * 155 }]);
});

test('only the bot host may report for the bot', async () => {
  const s = setup();
  await login(s.eng, 'p1', 'u1');
  s.eng.connect('tv');
  await s.eng.handle('tv', { k: 'hello', role: 'tv' });
  await s.eng.handle('p1', { k: 'ready', ready: true });
  s.advance(DUR.intro + 0.1);
  await s.eng.handle('p1', { k: 'result', for: 'bot', result: res({ cleared: true, timeLeft: 70 }) });
  assert.equal(s.eng.state().players.find((p) => p.isBot).result, null);
});

test('restart from over returns everyone to the lobby, unready', async () => {
  const s = await startedDuo();
  // Force the end: every arena times out. Each big step crosses at most one
  // arena and the following phase change, so allow plenty of steps.
  for (let i = 0; i < 40 && s.eng.state().phase !== 'over'; i++) s.advance(DUR.bossArena + DUR.grace + 1);
  assert.equal(s.eng.state().phase, 'over');
  await s.eng.handle('p1', { k: 'restart' });
  const st = s.eng.state();
  assert.equal(st.phase, 'lobby');
  assert.ok(st.players.every((p) => !p.ready || p.isBot));
});
```

Timing note: `tickMatch` loops `while (deadline !== null && now() >= deadline) advancePhase()`. Each new deadline is relative to the current `now()`, so one big step crosses at most one timed-out phase plus the transition after it. That is why the restart test allows up to 40 steps.

- [ ] **Step 2: Run the tests and confirm they fail.**

- [ ] **Step 3: Implement.** Replace the `handleMatch`/`tickMatch` stubs with:

```js
  function beginArena() {
    roundIdx += 1;
    const r = schedule[roundIdx];
    clearOrder = [];
    for (const p of inMatch()) { p.result = null; p.lastPoints = 0; }
    phase = 'arena';
    deadline = now() + ((r.boss ? DUR.bossArena : DUR.arena) + DUR.grace) * 1000;
    event('roundStart');
    pushState();
  }

  function applyResult(p, result) {
    if (p.result) return;
    const clean = {
      cleared: Boolean(result?.cleared),
      died: Boolean(result?.died),
      timeLeft: Math.max(0, Number(result?.timeLeft) || 0),
      bricks: Math.max(0, Math.floor(Number(result?.bricks) || 0)),
      livesLost: Math.max(0, Math.floor(Number(result?.livesLost) || 0)),
    };
    p.result = clean;
    let place = null;
    if (clean.cleared) { place = clearOrder.length; clearOrder.push(p.id); }
    const { points, coins } = scoreArena(clean, place);
    p.score += points; p.coins += coins; p.lastPoints = points;
    event(clean.cleared ? 'cleared' : clean.died ? 'died' : 'timeout', { playerId: p.id, place: place ?? undefined, points });
    if (inMatch().every((q) => q.result)) endRound();
    else pushState();
  }

  function endRound() {
    phase = 'roundEnd';
    deadline = now() + DUR.roundEnd * 1000;
    event('roundEnd');
    pushState();
  }

  async function endMatch() {
    phase = 'over';
    deadline = null;
    const ranked = inMatch().sort((a, b) => b.score - a.score);
    event('matchOver', { playerId: ranked[0]?.id });
    pushState();
    for (const p of ranked) {
      if (!p.isBot) await accounts.recordMatch(p.id, { won: p === ranked[0], score: p.score });
    }
  }

  function advancePhase() {
    if (phase === 'intro') beginArena();
    else if (phase === 'arena') {
      for (const p of inMatch()) if (!p.result) applyResult(p, { cleared: false, bricks: 0 });
    } else if (phase === 'roundEnd') {
      if (roundIdx + 1 < schedule.length) beginArena();
      else void endMatch();
    }
  }

  function handleMatch(peerId, peer, msg) {
    const fromBotHost = msg.for === BOT.id && peerId === botHost();
    const who = fromBotHost ? players.get(BOT.id) : peer.accountId ? players.get(peer.accountId) : null;
    switch (msg.k) {
      case 'result':
        if (phase === 'arena' && who?.inMatch && (msg.for === undefined || fromBotHost)) applyResult(who, msg.result);
        break;
      case 'snapshot':
        if (phase === 'arena' && who?.inMatch && (msg.for === undefined || fromBotHost)) {
          out('*', { k: 'snapshot', playerId: who.id, snap: msg.snap });
        }
        break;
      case 'restart':
        if (phase !== 'over') break;
        phase = 'lobby'; deadline = null; roundIdx = -1; schedule = [];
        players.delete(BOT.id);
        for (const p of players.values()) { p.ready = false; p.inMatch = false; p.result = null; }
        pushState();
        break;
    }
  }

  function tickMatch() {
    let guard = 0;
    while (deadline !== null && now() >= deadline && guard++ < 50) advancePhase();
  }
```

`advancePhase` for `arena` calls `applyResult` for everyone missing a result, and the last one triggers `endRound`, which sets a new deadline. The `while` loop then continues correctly.

- [ ] **Step 4: Run the tests and confirm they pass.** Run: `npm test`. All pass. If the 10-round score test fails on arithmetic: every round, `u1` clears first with 5 s left, which is 100 + 5 + 50 = 155, so the total is 1550.

- [ ] **Step 5: Commit** with the message `Drive the match on the server: ten arenas, scores, timeouts, the end`, plus the trailer.

---

### Task 7: Wire the engine into the LAN server

**Files:**
- Modify: `server/index.js`

**Interfaces:**
- Consumes: `createShowEngine`, `createAccountStore`.
- Produces: a ws envelope `{type:'show', msg}` in both directions.

- [ ] **Step 1: Implement.** In `server/index.js`, drop the rooms map for show traffic (keep `join`, which is harmless), then add:

```js
import { createShowEngine } from './show/engine.js';
import { createAccountStore } from './show/accounts.js';

const accounts = await createAccountStore(DATA_DIR);
const show = createShowEngine({ now: Date.now, accounts });
/** peerId -> ws */
const sockets = new Map();

function flush() {
  for (const { to, msg } of show.drain()) {
    const payload = { type: 'show', msg };
    if (to === '*') for (const ws of sockets.values()) send(ws, payload);
    else if (sockets.has(to)) send(sockets.get(to), payload);
  }
}

setInterval(() => { show.tick(); flush(); }, 250).unref?.();
```

In the `connection` handler:
- after `ws.peerId` is set, add `sockets.set(ws.peerId, ws); show.connect(ws.peerId);`;
- add a switch arm `case 'show': void show.handle(ws.peerId, msg.msg).then(flush); break;`;
- in `close`, add `sockets.delete(ws.peerId); show.disconnect(ws.peerId); flush();`.

Snapshot fan-out goes to every socket, including the sender. That is fine: the client ignores its own id.

- [ ] **Step 2: Verify manually**

```bash
npm run build && PORT=8090 node server/index.js &
node -e "
const WS=require('ws');const w=new WS('ws://localhost:8090');
w.on('open',()=>{w.send(JSON.stringify({type:'show',msg:{k:'hello',role:'tv'}}));});
w.on('message',m=>{const d=JSON.parse(m);if(d.type==='show'){console.log(d.msg.k,d.msg.show?.phase);process.exit(0)}});"
kill %1
```

Expected: prints `state lobby`. `ws` is a devDependency, so `require('ws')` works from the repo root.

- [ ] **Step 3: Commit** with the message `Put the show engine behind the LAN server's websocket`, plus the trailer.

---

### Task 8: Client protocol and store

**Files:**
- Create: `src/net/showProtocol.ts`, `src/game/show/store.ts`

**Interfaces:**
- Produces:
  - the types `ShowUp`, `ShowDown`, `ShowState`, `PlayerPublic`, `RoundPublic`, `ArenaResult`, `ShowEvent`, `AccountPublic`, `ShowPhase`;
  - `class ShowStore` with `state: ShowState | null`, `me: PlayerPublic | null`, `accounts: AccountPublic[]`, `authError: string`, `events: ShowEvent[]` (last 30), `onChange(fn) → unsubscribe`, `onSnapshot(fn:(playerId, snap)=>void) → unsubscribe`, `send(msg: ShowUp)`, `get myId(): string | null`, `dispose()`;
  - the module constants `TOKEN_KEY = 'arcoquiz.token'` and `ROLE_KEY = 'arcoquiz.role'`.

- [ ] **Step 1: Write `src/net/showProtocol.ts`.** Mirror the JS shapes from Tasks 5 and 6 exactly:

```ts
import type { ArenaSnapshot } from './protocol';
import type { BossId } from '../core/bosses';

export type ShowPhase = 'lobby' | 'intro' | 'arena' | 'roundEnd' | 'over';

export interface ArenaResult {
  cleared: boolean;
  died: boolean;
  timeLeft: number;
  bricks: number;
  livesLost: number;
}

export interface AccountPublic {
  id: string;
  name: string;
  avatar: string;
  stats: { matches: number; wins: number; best: number };
}

export interface PlayerPublic {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
  inMatch: boolean;
  score: number;
  coins: number;
  result: ArenaResult | null;
  lastPoints: number;
}

export interface RoundPublic {
  index: number;
  act: 1 | 2 | 3 | 4;
  actRound: number;
  levelIndex: number;
  boss: BossId | null;
  seconds: number;
}

export interface ShowState {
  phase: ShowPhase;
  /** Server clock when this state was sent, for skew correction. */
  now: number;
  players: PlayerPublic[];
  round: RoundPublic | null;
  rounds: number;
  /** Epoch ms, server clock. */
  deadline: number | null;
  countdownEnd: number | null;
  botHost: string | null;
  tvCount: number;
}

export type ShowEventKind =
  | 'joined' | 'left' | 'ready' | 'matchStart' | 'roundStart'
  | 'cleared' | 'died' | 'timeout' | 'roundEnd' | 'matchOver';

export interface ShowEvent {
  kind: ShowEventKind;
  at: number;
  playerId?: string;
  place?: number;
  points?: number;
}

export type ShowUp =
  | { k: 'hello'; role: 'tv' | 'player' }
  | { k: 'accounts' }
  | { k: 'register'; name: string; avatar: string; pin: string }
  | { k: 'login'; id: string; pin: string }
  | { k: 'resume'; token: string }
  | { k: 'ready'; ready: boolean }
  | { k: 'result'; result: ArenaResult; for?: string }
  | { k: 'snapshot'; snap: ArenaSnapshot; for?: string }
  | { k: 'restart' };

export type ShowDown =
  | { k: 'accounts'; list: AccountPublic[] }
  | { k: 'auth'; ok: true; player: PlayerPublic; token: string }
  | { k: 'auth'; ok: false; error: string }
  | { k: 'state'; show: ShowState }
  | { k: 'event'; ev: ShowEvent }
  | { k: 'snapshot'; playerId: string; snap: ArenaSnapshot };

export const ACT_TITLES: Record<number, string> = { 1: 'АКТ 1 · РАЗМИНКА', 2: 'АКТ 2 · СТАВКИ', 3: 'АКТ 3 · БЕЗ ПОЩАДЫ', 4: 'ФИНАЛ · БОСС' };
```

`deadline` is server-clock time. The store records `skew = Date.now() - state.now` on each `state` (`engine.js` `state()` includes `now: now()` since Task 5).

- [ ] **Step 2: Write `src/game/show/store.ts`**

```ts
import { net } from '../../net/client';
import type { ArenaSnapshot } from '../../net/protocol';
import type { AccountPublic, PlayerPublic, ShowDown, ShowEvent, ShowState, ShowUp } from '../../net/showProtocol';

export const TOKEN_KEY = 'arcoquiz.token';
export const ROLE_KEY = 'arcoquiz.role';

const safeGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string | null): void => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ }
};

/** One client's mirror of the show: the server's public state plus the event
 *  feed, and a way to talk back. Scenes read it and re-render on change. */
export class ShowStore {
  state: ShowState | null = null;
  me: PlayerPublic | null = null;
  accounts: AccountPublic[] = [];
  authError = '';
  events: ShowEvent[] = [];
  /** Local ms minus server ms, from the last state. */
  skew = 0;

  private changeFns = new Set<() => void>();
  private snapFns = new Set<(playerId: string, snap: ArenaSnapshot) => void>();
  private off: Array<() => void> = [];

  constructor(readonly role: 'tv' | 'player') {
    safeSet(ROLE_KEY, role);
    this.off.push(net.onShow((raw) => this.receive(raw as ShowDown)));
    this.off.push(net.subscribe(() => { if (net.status === 'online' && !this.greeted) this.greet(); }));
    net.connect(role === 'tv' ? 'TV' : 'player', 'show');
    if (net.status === 'online') this.greet();
  }

  private greeted = false;
  private greet(): void {
    this.greeted = true;
    this.send({ k: 'hello', role: this.role });
    if (this.role === 'player') {
      const token = safeGet(TOKEN_KEY);
      if (token) this.send({ k: 'resume', token });
      this.send({ k: 'accounts' });
    }
  }

  get myId(): string | null { return this.me?.id ?? null; }

  /** Seconds until a server-clock deadline, never negative. */
  secondsUntil(serverMs: number | null): number {
    if (serverMs === null) return 0;
    return Math.max(0, (serverMs + this.skew - Date.now()) / 1000);
  }

  send(msg: ShowUp): void { net.sendShow(msg); }

  logout(): void { safeSet(TOKEN_KEY, null); this.me = null; this.emit(); }

  private receive(msg: ShowDown): void {
    switch (msg.k) {
      case 'accounts': this.accounts = msg.list; break;
      case 'auth':
        if (msg.ok) { this.me = msg.player; this.authError = ''; safeSet(TOKEN_KEY, msg.token); }
        else { this.authError = msg.error; if (msg.error.startsWith('Сессия')) safeSet(TOKEN_KEY, null); }
        break;
      case 'state':
        this.state = msg.show;
        this.skew = Date.now() - msg.show.now;
        if (this.me) this.me = msg.show.players.find((p) => p.id === this.me!.id) ?? this.me;
        break;
      case 'event':
        this.events = [...this.events.slice(-29), msg.ev];
        break;
      case 'snapshot':
        for (const fn of this.snapFns) fn(msg.playerId, msg.snap);
        return;
    }
    this.emit();
  }

  onChange(fn: () => void): () => void { this.changeFns.add(fn); return () => this.changeFns.delete(fn); }
  onSnapshot(fn: (id: string, s: ArenaSnapshot) => void): () => void { this.snapFns.add(fn); return () => this.snapFns.delete(fn); }
  private emit(): void { for (const fn of this.changeFns) fn(); }

  dispose(): void { for (const f of this.off) f(); this.changeFns.clear(); this.snapFns.clear(); }
}
```

Reconnection: `greeted` must reset when the socket drops. In the `net.subscribe` callback, set `if (net.status !== 'online') this.greeted = false;` before the check.

- [ ] **Step 3: Verify.** Run: `npm run typecheck`. Expected: 0 errors.

- [ ] **Step 4: Commit** with the message `Mirror the show's state on every client`, plus the trailer.

---

### Task 9: One shared arena runner, the player arena scene, and the bot runner

**Files:**
- Create: `src/game/show/arenaRunner.ts`, `src/game/player/arena.ts`, `src/game/show/botRunner.ts`

**Interfaces:**
- Consumes: `Arena`, `noInput`, `ArenaInput` (`src/core/arena.ts`); `Bot` (`src/core/bot.ts`); `RACE_LEVELS` (`src/core/campaignLevels.ts`); `FixedStepper`, `edgeOnce` (`src/game/stepper.ts`); `SNAPSHOT_INTERVAL`, `CELLS_INTERVAL`, `ArenaSnapshot` (`src/net/protocol.ts`); `ShowStore`.
- Produces:
  - `class ArenaRun { arena: Arena; clock: number; done: ArenaResult | null; constructor(levelIndex: number, seconds: number, superId?: SuperId); step(dt: number, input: ArenaInput): void; snapshot(): ArenaSnapshot | null }`. `snapshot()` returns a snapshot when one is due and `null` otherwise; call it after `step`.
  - `playerArenaScene(app, store): Scene`.
  - `startBotRunner(store): () => void` (stop fn).

- [ ] **Step 1: `src/game/show/arenaRunner.ts`**

```ts
import { Arena, type ArenaInput } from '../../core/arena';
import { RACE_LEVELS } from '../../core/campaignLevels';
import type { SuperId } from '../../core/supers';
import { CELLS_INTERVAL, SNAPSHOT_INTERVAL, type ArenaSnapshot } from '../../net/protocol';
import type { ArenaResult } from '../../net/showProtocol';
import { edgeOnce, FixedStepper } from '../stepper';

/** One arena of one round, for a human or a bot: steps the sim on a fixed
 *  tick, runs the clock, and settles into a result exactly once. */
export class ArenaRun {
  readonly arena: Arena;
  clock: number;
  done: ArenaResult | null = null;
  private readonly livesAtStart: number;
  private stepper = new FixedStepper();
  private snapTimer = 0;
  private cellsTimer = CELLS_INTERVAL;
  private lastCells = '';
  private seq = -1;

  constructor(levelIndex: number, seconds: number, superId?: SuperId) {
    const level = RACE_LEVELS[levelIndex] ?? RACE_LEVELS[0];
    this.arena = new Arena({ level, superId, mode: 'race', lives: 3 });
    this.livesAtStart = this.arena.lives;
    this.clock = seconds;
  }

  step(dt: number, input: ArenaInput): void {
    if (this.done) return;
    this.stepper.step(dt, (sdt, first) => this.arena.update(sdt, edgeOnce(input, first)));
    this.clock = Math.max(0, this.clock - dt);
    this.snapTimer += dt;
    this.cellsTimer += dt;
    const a = this.arena;
    if (a.state === 'cleared' || a.state === 'dead' || this.clock <= 0) {
      this.done = {
        cleared: a.state === 'cleared',
        died: a.state === 'dead',
        timeLeft: this.clock,
        bricks: a.bricksBroken,
        livesLost: Math.max(0, this.livesAtStart - a.lives),
      };
    }
  }

  snapshot(): ArenaSnapshot | null {
    if (this.snapTimer < SNAPSHOT_INTERVAL) return null;
    this.snapTimer = 0;
    const a = this.arena;
    let cells: string | undefined;
    if (this.cellsTimer >= CELLS_INTERVAL) {
      this.cellsTimer = 0;
      let s = '';
      for (let i = 0; i < a.grid.length; i++) { const b = a.grid[i]; s += b && b.alive ? b.kind.code : '0'; }
      if (s !== this.lastCells || this.lastCells === '') { this.lastCells = s; cells = s; }
    }
    return {
      cells, cols: a.cols, paddleX: Math.round(a.paddleX), paddleW: Math.round(a.paddleW),
      balls: a.balls.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) })),
      score: a.score, lives: a.lives, xpLevel: a.xpLevel, combo: a.combo,
      energy: Math.round(a.energy), n: ++this.seq, clock: Math.round(this.clock),
    };
  }
}
```

This deliberately differs from the old code: cells are re-checked every `CELLS_INTERVAL` rather than every snapshot, and are always sent on that cadence if changed. Brick changes therefore appear with up to 1.5 s delay. That is acceptable for TV thumbnails. If it looks laggy in Task 12 testing, set `CELLS_INTERVAL` to 0.3.

- [ ] **Step 2: `src/game/player/arena.ts`.** Port the drawing and input from the deleted `teamQuizDevice.ts` (`git show HEAD~8:src/game/teamQuizDevice.ts | sed -n 1395,1430p` for reference):

```ts
import { fitBox, type App, type Scene } from '../../app';
import { ARENA_H, ARENA_W } from '../../core/constants';
import { noInput } from '../../core/arena';
import { ArenaFx } from '../../render/fx';
import { drawArena, drawHud } from '../../render/renderer';
import { sfx } from '../../audio/sfx';
import { music } from '../../audio/music';
import { SOLO_KEYS } from '../input';
import { ArenaRun } from '../show/arenaRunner';
import type { ShowStore } from '../show/store';
import { ACT_TITLES } from '../../net/showProtocol';

const HUD_W = 260;
const GAP = 16;
const SCENE_W = ARENA_W + GAP + HUD_W;
const SCENE_H = ARENA_H;

/** The human's own arena for the current round. Reports once, then waits. */
export function playerArenaScene(app: App, store: ShowStore): Scene {
  const round = store.state!.round!;
  const run = new ArenaRun(round.levelIndex, round.seconds, app.profile.favouriteSuper);
  run.arena.equipSkills(app.profile.skills);
  const fx = new ArenaFx();
  let t = 0;
  let layout = { scale: 1, ox: 0, oy: 0 };
  let reported = false;

  app.overlay.replaceChildren();
  app.overlay.classList.remove('interactive');
  app.capturePointer();
  music.setScene('versus');

  return {
    update(dt) {
      t += dt;
      fx.update(dt);
      if (run.done) {
        if (!reported) { reported = true; store.send({ k: 'result', result: run.done }); }
        return;
      }
      const p = app.pointer;
      const x = p && layout.scale > 0 ? (p.x - layout.ox) / layout.scale : null;
      const input = run.arena.state === 'cleared' ? noInput() : app.input.read(SOLO_KEYS, x === null ? null : Math.max(0, Math.min(ARENA_W, x)));
      run.step(dt, input);
      const events = run.arena.drainEvents();
      fx.consume(events);
      sfx.consume(events, run.arena.combo);
      const snap = run.snapshot();
      if (snap) store.send({ k: 'snapshot', snap });
    },
    draw(ctx, w, h) {
      ctx.save();
      layout = fitBox(ctx, w, h, SCENE_W, SCENE_H);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, ARENA_W, ARENA_H); ctx.clip();
      drawArena(ctx, run.arena, fx, t, !app.input.locked);
      ctx.restore();
      const me = store.me;
      drawHud(ctx, run.arena, ARENA_W + GAP, 0, HUD_W, SCENE_H, {
        title: me ? `${me.avatar} ${me.name}` : 'ИГРОК',
        accent: me?.color ?? '#4de2ff',
        subtitle: `${ACT_TITLES[round.act]} · раунд ${round.index + 1}/${store.state?.rounds ?? 10}${round.boss ? ' · БОСС' : ''}`,
        fps: app.fps,
        countdown: { label: 'осталось', seconds: Math.ceil(run.clock) },
      });
      ctx.restore();
    },
    dispose() {
      if (!reported && run.done) store.send({ k: 'result', result: run.done });
      music.setScene('menu');
    },
  };
}
```

Check `app.input.read`'s second parameter type (`grep -n "read(" src/game/input.ts`) and adapt the pointer clamp to match. The deleted code used a `clampPointer(arenaX)` helper. Also check that `ArenaFx.update`, `fx.consume` and `sfx.consume` exist with those names; they are used in the deleted `teamQuizDevice.ts` lines 1331–1333.

- [ ] **Step 3: `src/game/show/botRunner.ts`**

```ts
import { Bot } from '../../core/bot';
import { net } from '../../net/client';
import { ArenaRun } from './arenaRunner';
import type { ShowStore } from './store';

const STEP = 1 / 60;

/** Plays the bot's arenas on whichever client the server named bot host.
 *  Runs on setInterval, not rAF, so a backgrounded TV tab keeps playing. */
export function startBotRunner(store: ShowStore): () => void {
  const bot = new Bot();
  let run: ArenaRun | null = null;
  let roundKey = '';
  let reported = false;
  let last = performance.now();

  const timer = window.setInterval(() => {
    const now = performance.now();
    let dt = Math.min(1, (now - last) / 1000);
    last = now;
    const st = store.state;
    const botPlayer = st?.players.find((p) => p.isBot && p.inMatch);
    if (!st || !botPlayer || st.botHost !== net.selfId || st.phase !== 'arena' || !st.round) { run = null; return; }
    const key = `${st.round.index}`;
    if (key !== roundKey) { roundKey = key; run = new ArenaRun(st.round.levelIndex, st.round.seconds); reported = false; }
    if (!run || reported) return;
    while (dt > 0 && !run.done) {
      const d = Math.min(STEP, dt);
      dt -= d;
      run.step(d, bot.think(run.arena, d));
      run.arena.drainEvents();
    }
    const snap = run.snapshot();
    if (snap) store.send({ k: 'snapshot', snap, for: 'bot' });
    if (run.done) { reported = true; store.send({ k: 'result', result: run.done, for: 'bot' }); }
  }, 50);

  return () => clearInterval(timer);
}
```

The server's `botHost` is a peer id and `net.selfId` is the id from `welcome`, so they match.

- [ ] **Step 4: Verify.** Run: `npm run typecheck`. Expected: 0 errors.

- [ ] **Step 5: Commit** with the message `Share one arena runner between players and the bot`, plus the trailer.

---

### Task 10: Player screens — login/register, lobby, waiting, router

**Files:**
- Create: `src/game/player/login.ts`, `src/game/player/lobby.ts`, `src/game/player/wait.ts`, `src/game/player/index.ts`, `src/ui/manual.ts`, `src/ui/show.css`
- Modify: `src/main.ts` (import `./ui/show.css`)

**Interfaces:**
- Consumes: `ShowStore`, `playerArenaScene`, `startBotRunner`, `el`/`button`.
- Produces:
  - `playerShowScene(app): Scene`, the router: it owns one `ShowStore` and swaps an inner "view";
  - `renderLogin(root, store)`, `renderLobby(root, store)`, `renderWait(root, store)`, each `(root: HTMLElement, store: ShowStore) => void`;
  - `manualEl(): HTMLElement`.

- [ ] **Step 1: `src/ui/manual.ts`**

```ts
import { el } from './dom';

export const MANUAL_POINTS = [
  'Войдите под своим именем (или создайте игрока: имя, аватар, PIN из 4 цифр) и нажмите «Готов».',
  'Каждый раунд — короткий уровень арканоида: мышь или ←/→, Пробел — запуск. Прошёл первым — бонус.',
  'Очки решают место. Монеты (за кирпичи) тратятся в магазине между раундами.',
  'Союзы: объединяйтесь до трёх человек, придумайте название — баффы только своим, дебаффы только чужим.',
  '10 раундов в трёх актах, два босса: в конце второго акта и в финале. Побеждает больше очков.',
];

export const manualEl = (): HTMLElement =>
  el('div', { class: 'manual' }, el('h3', {}, 'Как играть'), el('ol', {}, ...MANUAL_POINTS.map((p) => el('li', {}, p))));
```

Points 3–4 describe stage 3–4 features. That is fine: the manual describes the finished game, and stage 2 is internal.

- [ ] **Step 2: `src/game/player/login.ts`**

```ts
import { button, el } from '../../ui/dom';
import type { ShowStore } from '../show/store';

const AVATARS = ['🦊', '🐸', '🐙', '🦉', '🐼', '🦄', '🐯', '🐨', '🦖', '🐝', '🐧', '🦁', '🐻', '🐳', '🦩', '🌵'];

/** Pick yourself from the list and type your PIN, or make a new player. */
export function renderLogin(root: HTMLElement, store: ShowStore, ui: { picked: string | null; creating: boolean }, rerender: () => void): void {
  const error = store.authError ? el('p', { class: 'error' }, store.authError) : null;

  if (ui.creating) {
    let avatar = AVATARS[0];
    const name = el('input', { class: 'field', placeholder: 'Имя', maxlength: 16 });
    const pin = el('input', { class: 'field', placeholder: 'PIN (4 цифры)', inputmode: 'numeric', maxlength: 4, type: 'password' });
    const grid = el('div', { class: 'avatar-grid' });
    const paint = (): void => {
      grid.replaceChildren(...AVATARS.map((a) => button(a, () => { avatar = a; paint(); }, a === avatar ? 'avatar picked' : 'avatar')));
    };
    paint();
    root.replaceChildren(el('div', { class: 'show-panel' },
      el('h2', {}, 'Новый игрок'), name, grid, pin, error,
      el('div', { class: 'row' },
        button('Назад', () => { ui.creating = false; store.authError = ''; rerender(); }, 'btn ghost'),
        button('Создать', () => store.send({ k: 'register', name: name.value, avatar, pin: pin.value }), 'btn primary large')),
    ));
    name.focus();
    return;
  }

  if (ui.picked) {
    const acc = store.accounts.find((a) => a.id === ui.picked);
    const pin = el('input', { class: 'field pin', placeholder: '••••', inputmode: 'numeric', maxlength: 4, type: 'password' });
    const go = (): void => store.send({ k: 'login', id: ui.picked!, pin: pin.value });
    pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    root.replaceChildren(el('div', { class: 'show-panel' },
      el('h2', {}, `${acc?.avatar ?? ''} ${acc?.name ?? ''}`), el('p', { class: 'hint' }, 'Введите PIN'), pin, error,
      el('div', { class: 'row' },
        button('Назад', () => { ui.picked = null; store.authError = ''; rerender(); }, 'btn ghost'),
        button('Войти', go, 'btn primary large')),
    ));
    pin.focus();
    return;
  }

  root.replaceChildren(el('div', { class: 'show-panel' },
    el('h2', {}, 'Кто играет?'),
    el('div', { class: 'account-grid' },
      ...store.accounts.map((a) => button(`${a.avatar} ${a.name}`, () => { ui.picked = a.id; rerender(); }, 'account')),
      button('＋ Новый игрок', () => { ui.creating = true; rerender(); }, 'account new')),
    error,
  ));
}
```

The signature adds `ui` and `rerender` compared with the Interfaces line. Use this signature and update the Interfaces note while implementing.

- [ ] **Step 3: `src/game/player/lobby.ts` and `wait.ts`**

```ts
// lobby.ts
import { button, el } from '../../ui/dom';
import { manualEl } from '../../ui/manual';
import type { ShowStore } from '../show/store';

export function renderLobby(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const me = store.me!;
  const secs = Math.ceil(store.secondsUntil(st.countdownEnd));
  root.replaceChildren(el('div', { class: 'show-panel' },
    el('h2', {}, `${me.avatar} ${me.name}`),
    el('div', { class: 'roster' }, ...st.players.map((p) =>
      el('div', { class: `chip${p.ready ? ' ready' : ''}`, style: `--c:${p.color}` }, `${p.avatar} ${p.name}${p.ready ? ' ✓' : ''}`))),
    st.countdownEnd ? el('p', { class: 'countdown' }, `Старт через ${secs}`) : el('p', { class: 'hint' }, 'Ждём, пока все нажмут «Готов»'),
    button(me.ready ? 'Не готов' : 'Готов!', () => store.send({ k: 'ready', ready: !me.ready }), me.ready ? 'btn ghost large' : 'btn primary large'),
    manualEl(),
    button('Сменить игрока', () => store.logout(), 'btn ghost small'),
  ));
}
```

```ts
// wait.ts
import { button, el } from '../../ui/dom';
import { ACT_TITLES } from '../../net/showProtocol';
import type { ShowStore } from '../show/store';

/** Everything that is not your own arena: intro, round results, waiting for
 *  others, and the final table. */
export function renderWait(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const me = store.me;
  const ranked = [...st.players].filter((p) => p.inMatch).sort((a, b) => b.score - a.score);
  const title =
    st.phase === 'intro' ? 'Шоу начинается!'
    : st.phase === 'over' ? `Победитель: ${ranked[0]?.avatar ?? ''} ${ranked[0]?.name ?? ''}`
    : st.phase === 'arena' ? 'Ждём остальных…'
    : `Итоги раунда ${(st.round?.index ?? 0) + 1}`;
  const waitingFor = st.phase === 'arena' ? ranked.filter((p) => !p.result).map((p) => p.name).join(', ') : '';
  root.replaceChildren(el('div', { class: 'show-panel' },
    st.round ? el('p', { class: 'act' }, ACT_TITLES[st.round.act]) : null,
    el('h2', {}, title),
    waitingFor ? el('p', { class: 'hint' }, `Ждём: ${waitingFor}`) : null,
    el('ol', { class: 'standings' }, ...ranked.map((p) =>
      el('li', { class: p.id === me?.id ? 'me' : '', style: `--c:${p.color}` },
        `${p.avatar} ${p.name}`, el('span', {}, `${p.score}${p.lastPoints ? ` (+${p.lastPoints})` : ''}`)))),
    st.phase === 'over' ? button('Ещё раз', () => store.send({ k: 'restart' }), 'btn primary large') : null,
  ));
}
```

- [ ] **Step 4: `src/game/player/index.ts`, the router**

```ts
import type { App, Scene } from '../../app';
import { ShowStore } from '../show/store';
import { startBotRunner } from '../show/botRunner';
import { playerArenaScene } from './arena';
import { renderLogin } from './login';
import { renderLobby } from './lobby';
import { renderWait } from './wait';

/** The player's device. One store; the view follows the show's phase. An
 *  inner arena scene takes over the canvas while this player's arena runs. */
export function playerShowScene(app: App): Scene {
  const store = new ShowStore('player');
  const stopBots = startBotRunner(store);
  const loginUi = { picked: null as string | null, creating: false };
  let arena: Scene | null = null;
  let arenaRound = -1;
  let lastKey = '';

  function render(): void {
    const st = store.state;
    const me = store.me;
    const myArena = st?.phase === 'arena' && me?.inMatch && !me.result && st.round;
    if (myArena && st.round!.index !== arenaRound) {
      arenaRound = st.round!.index;
      arena?.dispose();
      arena = playerArenaScene(app, store);
      return;
    }
    if (arena && !(st?.phase === 'arena' && me && !me.result)) { arena.dispose(); arena = null; }
    if (arena) return;

    // Rebuilding DOM on every change kills focus while typing a PIN: only
    // re-render the login view when what it shows actually changed.
    const key = !me ? `login:${store.accounts.length}:${store.authError}:${loginUi.picked}:${loginUi.creating}` : '';
    if (key && key === lastKey) return;
    lastKey = key;

    app.overlay.classList.add('interactive');
    const root = app.overlay;
    if (!st || !me) renderLogin(root, store, loginUi, () => { lastKey = ''; render(); });
    else if (st.phase === 'lobby') renderLobby(root, store);
    else renderWait(root, store);
  }

  const off = store.onChange(render);
  const countdownTimer = window.setInterval(() => { if (store.state?.countdownEnd && store.state.phase === 'lobby' && store.me) render(); }, 500);
  render();

  return {
    update(dt) { arena?.update(dt); },
    draw(ctx, w, h) {
      if (arena) arena.draw(ctx, w, h);
      else { ctx.fillStyle = '#071a20'; ctx.fillRect(0, 0, w, h); }
    },
    dispose() { off(); clearInterval(countdownTimer); stopBots(); arena?.dispose(); store.dispose(); app.overlay.replaceChildren(); },
  };
}
```

When login succeeds, the new `auth` arrives, `me` is set, `key` becomes `''`, and the lobby renders. The lobby and wait views re-render on every change; they have no inputs, so that is fine.

- [ ] **Step 5: `src/ui/show.css`**

Import it at the top of `src/main.ts`: `import './ui/show.css';`. Check how `styles.css` is currently loaded (`grep -rn "styles.css" index.html src`) and follow the same pattern.

```css
.show-panel { max-width: 560px; margin: 6vh auto; padding: 28px; background: var(--panel); border: 1px solid var(--line); border-radius: 18px; display: flex; flex-direction: column; gap: 14px; }
.show-panel h2 { margin: 0; font-size: 26px; }
.show-panel .row { display: flex; gap: 10px; justify-content: space-between; }
.field { font: inherit; font-size: 20px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: rgba(0,0,0,.3); color: var(--text); }
.field.pin { font-size: 34px; letter-spacing: 12px; text-align: center; }
.account-grid, .avatar-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.avatar-grid { grid-template-columns: repeat(8, 1fr); }
.account, .avatar { font: inherit; font-size: 18px; padding: 14px; border-radius: 14px; border: 1px solid var(--line); background: rgba(23,182,189,.08); color: var(--text); cursor: pointer; }
.avatar { font-size: 24px; padding: 8px; }
.avatar.picked, .account:hover { border-color: var(--amber); background: rgba(255,210,77,.14); }
.account.new { border-style: dashed; }
.error { color: var(--red); margin: 0; }
.roster { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 6px 12px; border-radius: 999px; border: 2px solid var(--c); opacity: .6; }
.chip.ready { opacity: 1; background: color-mix(in srgb, var(--c) 20%, transparent); }
.countdown { font-size: 28px; font-weight: 800; color: var(--amber); margin: 0; }
.act { color: var(--violet); font-weight: 800; letter-spacing: 2px; margin: 0; }
.standings { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 6px; }
.standings li { display: flex; justify-content: space-between; border-left: 4px solid var(--c); padding: 6px 10px; background: rgba(255,255,255,.03); border-radius: 8px; }
.standings li.me { background: rgba(255,210,77,.12); }
.manual { font-size: 14px; color: var(--muted); }
.manual h3 { margin: 0 0 6px; color: var(--text); }
.manual ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
.start { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; }
.start h1 { font-size: clamp(48px, 9vw, 110px); margin: 0; letter-spacing: 6px; }
```

- [ ] **Step 6: Verify.** Run: `npm run typecheck`. Expected: 0 errors.

- [ ] **Step 7: Commit** with the message `Let players sign in, ready up and play their arena`, plus the trailer.

---

### Task 11: TV screen and start screen

**Files:**
- Create: `src/game/tv/index.ts`, `src/game/tv/lobby.ts`, `src/game/tv/arenaGrid.ts`, `src/game/tv/ticker.ts`, `src/game/tv/standings.ts`
- Modify: `src/ui/start.ts`, `src/main.ts`, `src/ui/show.css`

**Interfaces:**
- Consumes: `ShowStore`, `SnapshotMirror`/`drawSnapshotMirror`, `startBotRunner`, `manualEl`, `ACT_TITLES`, `net.shareUrl`.
- Produces:
  - `tvShowScene(app): Scene`;
  - `drawArenaGrid(ctx, w, h, players, mirrors)`;
  - `tickerLine(ev, players) → string`;
  - `renderTvLobby(root, store)`;
  - `renderStandings(root, store)`.

- [ ] **Step 1: `src/game/tv/ticker.ts`**

```ts
import type { PlayerPublic, ShowEvent } from '../../net/showProtocol';

/** One human sentence per event, for the TV's running feed. */
export function tickerLine(ev: ShowEvent, players: PlayerPublic[]): string {
  const p = players.find((x) => x.id === ev.playerId);
  const who = p ? `${p.avatar} ${p.name}` : 'Кто-то';
  switch (ev.kind) {
    case 'joined': return `${who} в студии!`;
    case 'left': return `${who} отключился`;
    case 'ready': return p?.ready ? `${who} готов` : `${who} передумал`;
    case 'matchStart': return '🎬 Шоу начинается!';
    case 'roundStart': return '▶ Новый раунд — все на арену!';
    case 'cleared': return ev.place === 0 ? `🏁 ${who} прошёл уровень ПЕРВЫМ! +${ev.points}` : `✅ ${who} прошёл уровень (+${ev.points})`;
    case 'died': return `💥 ${who} потерял все жизни (+${ev.points ?? 0})`;
    case 'timeout': return `⏱ ${who} не успел (+${ev.points ?? 0})`;
    case 'roundEnd': return '📊 Раунд окончен';
    case 'matchOver': return `🏆 Победитель — ${who}!`;
  }
}
```

- [ ] **Step 2: `src/game/tv/arenaGrid.ts`**

```ts
import { ARENA_H, ARENA_W } from '../../core/constants';
import type { PlayerPublic } from '../../net/showProtocol';
import { drawSnapshotMirror, type SnapshotMirror } from '../../render/snapshotMirror';

/** Up to ten live fields tiled into the given box, each captioned. */
export function drawArenaGrid(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, players: PlayerPublic[], mirrors: Map<string, SnapshotMirror>): void {
  const n = players.length;
  if (!n) return;
  const cols = n <= 2 ? n : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5;
  const rows = Math.ceil(n / cols);
  const cw = w / cols;
  const ch = h / rows;
  const caption = 28;
  players.forEach((p, i) => {
    const cx = x + (i % cols) * cw;
    const cy = y + Math.floor(i / cols) * ch;
    const scale = Math.min((cw - 12) / ARENA_W, (ch - caption - 12) / ARENA_H);
    const fw = ARENA_W * scale;
    ctx.save();
    ctx.translate(cx + (cw - fw) / 2, cy + caption);
    ctx.scale(scale, scale);
    const m = mirrors.get(p.id);
    if (m) drawSnapshotMirror(ctx, m, p.color, p.result ? (p.result.cleared ? 'ПРОШЁЛ ✓' : 'ВЫБЫЛ') : 'Ждём поле…');
    ctx.restore();
    ctx.save();
    ctx.fillStyle = p.color;
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const status = p.result ? (p.result.cleared ? ' ✓' : ' ✗') : '';
    ctx.fillText(`${p.avatar} ${p.name} · ${p.score}${status}`, cx + cw / 2, cy + 20);
    ctx.restore();
  });
}
```

Check the `drawSnapshotMirror` signature: `(ctx, mirror, color, waitingLabel)` per the deleted code at `teamQuizDevice.ts:1297`. The label only shows until the first snapshot arrives. To show a "finished" state after a result, draw a translucent overlay with the status text instead. Add that after `drawSnapshotMirror` when `p.result` is set:

```ts
    if (p.result) {
      ctx.save();
      ctx.translate(cx + (cw - fw) / 2, cy + caption);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, fw, ARENA_H * scale);
      ctx.fillStyle = p.result.cleared ? '#3ddc84' : '#ff4d6d';
      ctx.font = `bold ${Math.round(40 * scale + 14)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.result.cleared ? `ПРОШЁЛ +${p.lastPoints}` : `+${p.lastPoints}`, fw / 2, (ARENA_H * scale) / 2);
      ctx.restore();
    }
```

Use the plain `'Ждём поле…'` as the waiting label.

- [ ] **Step 3: `src/game/tv/lobby.ts` and `standings.ts`**

```ts
// lobby.ts
import { el } from '../../ui/dom';
import { manualEl } from '../../ui/manual';
import { net } from '../../net/client';
import type { ShowStore } from '../show/store';

export function renderTvLobby(root: HTMLElement, store: ShowStore): void {
  const st = store.state;
  const players = st?.players ?? [];
  const secs = Math.ceil(store.secondsUntil(st?.countdownEnd ?? null));
  root.replaceChildren(el('div', { class: 'tv-lobby' },
    el('h1', {}, 'ARCOQUIZ'),
    el('p', { class: 'tv-url' }, `Заходите: ${net.shareUrl}`),
    el('div', { class: 'tv-roster' }, ...players.map((p) =>
      el('div', { class: `tv-seat${p.ready ? ' ready' : ''}`, style: `--c:${p.color}` },
        el('div', { class: 'tv-avatar' }, p.avatar), el('div', {}, p.name), el('div', { class: 'hint' }, p.ready ? 'готов' : '…')))),
    players.length ? null : el('p', { class: 'hint' }, 'Пока никого — откройте адрес на телефоне'),
    st?.countdownEnd ? el('p', { class: 'countdown' }, `Старт через ${secs}`) : null,
    players.length === 1 ? el('p', { class: 'hint' }, 'Один игрок? Против него выйдет 🤖 Бот.') : null,
    manualEl(),
  ));
}
```

```ts
// standings.ts
import { el } from '../../ui/dom';
import { ACT_TITLES } from '../../net/showProtocol';
import type { ShowStore } from '../show/store';

/** Intro, between-rounds and final table, big enough to read from the sofa. */
export function renderStandings(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const ranked = st.players.filter((p) => p.inMatch).sort((a, b) => b.score - a.score);
  const title = st.phase === 'intro' ? 'Сегодня в студии' : st.phase === 'over' ? '🏆 ФИНАЛ' : `Итоги раунда ${(st.round?.index ?? 0) + 1}`;
  const next = st.phase === 'roundEnd' && st.round && st.round.index + 1 < st.rounds ? `Дальше: раунд ${st.round.index + 2}` : '';
  root.replaceChildren(el('div', { class: 'tv-standings' },
    st.round ? el('p', { class: 'act' }, ACT_TITLES[st.round.act]) : null,
    el('h1', {}, title),
    el('ol', { class: 'standings big' }, ...ranked.map((p) =>
      el('li', { style: `--c:${p.color}` }, `${p.avatar} ${p.name}`, el('span', {}, `${p.score}${p.lastPoints ? `  +${p.lastPoints}` : ''}`)))),
    next ? el('p', { class: 'hint' }, next) : null,
  ));
}
```

- [ ] **Step 4: `src/game/tv/index.ts`**

```ts
import type { App, Scene } from '../../app';
import { el } from '../../ui/dom';
import { SnapshotMirror } from '../../render/snapshotMirror';
import { ACT_TITLES } from '../../net/showProtocol';
import { ShowStore } from '../show/store';
import { startBotRunner } from '../show/botRunner';
import { drawArenaGrid } from './arenaGrid';
import { renderTvLobby } from './lobby';
import { renderStandings } from './standings';
import { tickerLine } from './ticker';

const TICKER_H = 64;
const HEADER_H = 70;

/** The TV: shows everything, controls nothing. Canvas grid of live arenas
 *  during a round; DOM for the lobby and tables; a ticker along the bottom. */
export function tvShowScene(app: App): Scene {
  const store = new ShowStore('tv');
  const stopBots = startBotRunner(store);
  const mirrors = new Map<string, SnapshotMirror>();
  const ticker = el('div', { class: 'tv-ticker' });
  const body = el('div', { class: 'tv-body' });
  app.overlay.classList.add('interactive');
  app.overlay.replaceChildren(body, ticker);

  const offSnap = store.onSnapshot((id, snap) => {
    let m = mirrors.get(id);
    if (!m) { m = new SnapshotMirror(); mirrors.set(id, m); }
    m.push(snap);
  });

  let lastRound = -1;
  function render(): void {
    const st = store.state;
    if (st?.round && st.round.index !== lastRound) { lastRound = st.round.index; for (const m of mirrors.values()) m.reset(); }
    ticker.replaceChildren(...store.events.slice(-4).map((ev) => el('span', { class: `tick ${ev.kind}` }, tickerLine(ev, st?.players ?? []))));
    if (!st || st.phase === 'lobby') renderTvLobby(body, store);
    else if (st.phase === 'arena') body.replaceChildren();
    else renderStandings(body, store);
  }
  const off = store.onChange(render);
  const clockTimer = window.setInterval(() => { if (store.state?.phase === 'lobby') render(); }, 500);
  render();

  return {
    update(dt) { for (const m of mirrors.values()) m.tick(dt); },
    draw(ctx, w, h) {
      ctx.fillStyle = '#071a20';
      ctx.fillRect(0, 0, w, h);
      const st = store.state;
      if (st?.phase !== 'arena' || !st.round) return;
      const racers = st.players.filter((p) => p.inMatch);
      const secs = Math.ceil(store.secondsUntil(st.deadline) - 8); // minus server grace
      ctx.save();
      ctx.fillStyle = '#b06bff';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText(`${ACT_TITLES[st.round.act]} · РАУНД ${st.round.index + 1}/${st.rounds}${st.round.boss ? ' · 👾 БОСС' : ''}`, 24, 44);
      ctx.textAlign = 'right';
      ctx.fillStyle = secs <= 10 ? '#ff4d6d' : '#ffd24d';
      ctx.fillText(`${Math.max(0, secs)} с`, w - 24, 44);
      const waiting = racers.filter((p) => !p.result).map((p) => p.name);
      ctx.textAlign = 'center';
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,242,255,0.7)';
      if (waiting.length && waiting.length < racers.length) ctx.fillText(`Ждём: ${waiting.join(', ')}`, w / 2, 44);
      ctx.restore();
      drawArenaGrid(ctx, 0, HEADER_H, w, h - HEADER_H - TICKER_H, racers, mirrors);
    },
    dispose() { off(); offSnap(); clearInterval(clockTimer); stopBots(); store.dispose(); app.overlay.replaceChildren(); },
  };
}
```

`8` duplicates `DUR.grace`. Export `ARENA_GRACE = 8` from `src/net/showProtocol.ts`, with a comment that it mirrors `server/show/constants.js` `DUR.grace`, and use it here.

The overlay is `interactive` for the whole TV session. Check that the overlay doesn't cover the canvas visually during `arena`: `body` is empty, and the ticker sits at the bottom via CSS.

- [ ] **Step 5: Start screen and routing**

`src/ui/start.ts`:

```ts
import type { Scene, SceneFactory } from '../app';
import { button, el } from './dom';
import { playerShowScene } from '../game/player';
import { tvShowScene } from '../game/tv';

/** «Я играю» or «Это экран-ТВ». `?role=tv` / `?role=player` skip it. */
export const startScene: SceneFactory = (app): Scene => {
  app.overlay.classList.add('interactive');
  app.overlay.replaceChildren(el('div', { class: 'start' },
    el('h1', {}, 'ARCOQUIZ'),
    el('p', { class: 'hint' }, 'Арканоид-викторина. Ведущий — ИИ. До 10 игроков.'),
    button('🎮 Я играю', () => app.setScene(playerShowScene), 'btn primary large'),
    button('📺 Это экран-ТВ', () => app.setScene(tvShowScene), 'btn large'),
  ));
  return {
    update() {},
    draw(ctx, w, h) { ctx.fillStyle = '#071a20'; ctx.fillRect(0, 0, w, h); },
    dispose() { app.overlay.replaceChildren(); },
  };
};
```

In `src/main.ts`, route:

```ts
const role = new URLSearchParams(location.search).get('role');
app.setScene(role === 'tv' ? tvShowScene : role === 'player' ? playerShowScene : startScene);
```

Import both scenes.

Append TV CSS to `src/ui/show.css`:

```css
.tv-body { position: absolute; inset: 0 0 64px 0; overflow: auto; }
.tv-ticker { position: absolute; left: 0; right: 0; bottom: 0; height: 64px; display: flex; gap: 28px; align-items: center; padding: 0 24px; background: rgba(0,0,0,.55); border-top: 2px solid var(--violet); font-size: 20px; white-space: nowrap; overflow: hidden; }
.tick { animation: tick-in .5s ease-out; }
.tick.cleared { color: var(--green); } .tick.died, .tick.timeout { color: var(--red); } .tick.matchOver { color: var(--amber); }
@keyframes tick-in { from { transform: translateY(30px); opacity: 0; } to { transform: none; opacity: 1; } }
.tv-lobby, .tv-standings { max-width: 1200px; margin: 4vh auto; display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; }
.tv-lobby h1, .tv-standings h1 { font-size: clamp(44px, 7vw, 96px); margin: 0; letter-spacing: 6px; }
.tv-url { font-size: 30px; color: var(--amber); margin: 0; }
.tv-roster { display: grid; grid-template-columns: repeat(5, 170px); gap: 14px; }
.tv-seat { padding: 16px; border-radius: 18px; border: 3px solid var(--c); opacity: .55; font-size: 20px; }
.tv-seat.ready { opacity: 1; background: color-mix(in srgb, var(--c) 18%, transparent); }
.tv-avatar { font-size: 52px; }
.standings.big { font-size: 30px; width: min(900px, 90vw); }
```

- [ ] **Step 6: Verify.** Run: `npm run typecheck && npm test`. Expected: both pass.

- [ ] **Step 7: Commit** with the message `Put the show on a TV: lobby, live arena grid, ticker, table`, plus the trailer.

---

### Task 12: Docs and an end-to-end run

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `package.json` (`name` → `arcoquiz`, `description`)

- [ ] **Step 1: Rewrite `README.md`** (Russian). Sections:
  - Запуск (`npm install`, `npm run lan`, PORT);
  - Как играть: the 5 `MANUAL_POINTS` verbatim;
  - Роли (ТВ `?role=tv`, игрок `?role=player`);
  - Учётки (`server/data/players.json`, PIN);
  - Устройство кода (the new directory map);
  - Тесты (`npm test`).
  
  Drop every mention of Своя игра, ведущий-человек, трек и кубик.

- [ ] **Step 2: Rewrite `CLAUDE.md`'s architecture section**:
  - the server now **directs** the show (`server/show/engine.js`: phases, timers, scoring, accounts). Clients simulate arenas and report `ArenaResult`. The TV or first player runs bot arenas (`botRunner.ts`);
  - protocol: `src/net/showProtocol.ts` ↔ `server/show/*.js`. Constants mirrored by hand: `LEVEL_COUNT`/`BOSS_LEVELS` ↔ `campaignLevels.ts`/`bosses.ts`, `DUR.grace` ↔ `ARENA_GRACE`;
  - commands: add `npm test`;
  - the wiring recipe for a new feature: engine handler + test → protocol type → store → scene.
  
  Keep the determinism, TS-config and LAN-testing notes. Remove the team-quiz and "referee, not simulation" sections.

- [ ] **Step 3: End-to-end check**

```bash
npm run typecheck && npm test && PORT=8090 npm run lan
```

In **separate browser windows**:
1. Open `http://localhost:8090/?role=tv`. Expect the lobby: ARCOQUIZ, URL, the manual, and «Пока никого».
2. Open `?role=player`. Create «Тест1» (🦊, PIN 1111). Expect the lobby with you on the roster, and the TV showing the seat.
3. Press «Готов». Expect: the match starts immediately, and the TV shows «Сегодня в студии» with you and 🤖 Бот. After 6 s you get your arena, and the TV shows two live fields, the header with АКТ 1 and the timer.
4. Clear or lose. Expect the TV ticker line, the «Ждём: Бот» hint until the bot reports, then «Итоги раунда 1» on both screens.
5. Let it run to round 6. Expect «👾 БОСС» in the header and a boss level on both fields. Round 10 is a boss too, and a different one.
6. Close the player window and reopen `?role=player`. Expect it resumes into the same account without the PIN (token).
7. A second player window: log in as a new account during the match. Expect it to see the waiting view (`inMatch=false`), with no arena.
8. At «ФИНАЛ», press «Ещё раз». Expect everyone back in the lobby, unready, and the bot removed.
9. Restart the server. Expect accounts to persist, and `server/data/players.json` to hold no raw PIN.

Record any failure. Fix it via superpowers:systematic-debugging before claiming done.

- [ ] **Step 4: Commit** with the message `Tell the show's story in the README and CLAUDE.md`, plus the trailer.

---

## Later stages (separate plans, written when each starts)

- **Stage 3 — full round:**
  - phases `arena → question (20 s) → shop (15 s) → roundEnd`;
  - `server/show/questions.js` (load `server/content/questions/*.json`, which is tracked, not in gitignored `data/`; pick with no repeats per act/difficulty); answer types `choice|number|order`, graded server-side, speed bonus, `note` reveal, the answer key hidden until reveal;
  - the shop UI on phones; items apply at the next arena via `applyCardEffectToArena`;
  - Act 2 wagers, Act 3 discounted debuffs; bot quiz answers (~60%, 3–10 s) and bot shopping on the server.
- **Stage 4 — alliances:**
  - engine handlers `allianceCreate{name}`, `allianceInvite{playerId}`, `allianceAccept{allianceId}`, `allianceJoinRequest`, `allianceRename{name}`, `allianceLeave`;
  - max 3; dissolve at 1; +50 when all members answer right; buff/debuff target rules enforced on the server at purchase.
- **Stage 5 — TV production:**
  - a spotlight tile, phase bumpers («АКТ 2 · СТАВКИ»), an animated table reorder, confetti, a QR code (vendored tiny generator);
  - the host bar with `speechSynthesis`;
  - `server/show/host.js` template lines per `ShowEvent` kind.
- **Stage 6 — content:**
  - ~60 questions about 42 projects (Codexion, CallMeMayBe, Fly-in, PythonTester), ~40 on tarot/runes plus a generator from `/Users/Oleg/Claude_Projects/runes` data, and "about you" templates plus a lobby questionnaire;
  - no Italian content; archive `jeopardy.json`.
- **Stage 7 — show polish:**
  - special inserts (vote «кто из вас», duel, revenge);
  - optional Claude lines (`claude-haiku-4-5`, 2 s timeout, template fallback);
  - the stats page per account.
