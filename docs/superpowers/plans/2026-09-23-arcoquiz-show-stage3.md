# Arcoquiz Show — Stage 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each round into the full show loop: a shared 3-2-1 start, the arena, a category pick by the first to clear, a question that is graded automatically, a reveal, then the shop. Add the act rules (act 2 wagers, act 3 double question points and cheaper debuffs), a bot that answers and shops, and the approved black-and-gold look. Close the cleanup items deferred from stages 1–2.

**Architecture:**
- The server engine (`server/show/engine.js`) stays the single director and gains the phases `getReady → arena → pick → question → reveal → shop → roundEnd`.
- Pure helpers carry the rules and are each tested on their own:
  - `server/show/questions.js`: bank loading and validation, picking, grading, bot answers.
  - `server/show/shop.js`: catalog mirror, prices, purchase validation, bot purchases.
- Question answers never leave the server before the reveal.
- Purchased items are stored on the target player. The server exposes them as that player's `effects` for the next arena, and the client applies them to its `ArenaRun` with the existing `applyCardEffectToArena`.

**Tech Stack:**
- TypeScript 5 + Vite 5 client (canvas + DOM overlay via `el`/`button`).
- Node ESM server with `ws`, tested with `node:test`.
- New dev dependencies, fonts only: `@fontsource/bebas-neue`, `@fontsource/manrope`.

**Spec:** `docs/superpowers/specs/2026-09-23-arcoquiz-show-design.md`. Approved look: https://claude.ai/artifact/U5M1wHcSKHZPH6zREey9GR

## Global Constraints

- **Text:** all user-facing text is English, including questions, notes, UI and server messages. Gate: `grep -rnE "[А-Яа-яЁё]" src server index.html README.md CLAUDE.md | grep -v server/data` prints nothing.
- **Colours:**

  | Token | Value |
  |---|---|
  | ground | `#0b0a08` |
  | surface | `#16130e` |
  | raised | `#211c14` |
  | line | `#3a3226` |
  | gold | `#f5c542` |
  | light gold | `#ffe08a` |
  | text | `#fff8e7` |
  | muted | `#bdb39a` |
  | danger | `#ff4d6d` |

  Player colours stay vivid (`COLORS` in `server/show/constants.js`). Arena bricks keep their own colours.
- **Fonts:** display is Bebas Neue, body is Manrope. Both are bundled locally via `@fontsource` (the game must work on a LAN with no internet).
- **Round phases and seconds:**

  | Phase | Seconds |
  |---|---|
  | getReady | 3 |
  | arena | 75 (boss 120) + 8 grace |
  | pick | 6 |
  | question | 20 |
  | reveal | 6 |
  | shop | 15 |
  | roundEnd | 5 |

  The last round (index 9) skips the shop.
- **Category pick:**
  - The first player to clear the arena picks one of 3 categories.
  - If nobody picks within 6 s, or nobody cleared, the server picks at random.
  - The server picks the question inside the category and does not repeat a question within a match.
- **Question points:**
  - Base is `100 × difficulty`, doubled in act 3.
  - `choice` and `order` answers: a correct answer earns base plus a speed bonus of `round(50 × fraction of question time left)`.
  - `number` answers: the closest answer(s) earn base, and an exact answer earns +50 more.
  - A wrong answer or no answer earns 0.
- **Act 2 wager:** a player may stake 0 to `floor(0.5 × score)` on the question. A correct answer gains the stake, a wrong answer loses it. A stake counts only if the player answered.
- **Shop:**
  - Prices mirror `src/core/shop.ts` exactly.
  - Act 3 debuffs cost `ceil(cost × 0.7)`.
  - Self items target the buyer only. Rival items target another in-match player (alliances come in stage 4).
  - Items land at the start of the target's next arena.
- **Bot:** answers correctly with probability 0.6, 3–10 s after the question opens. In act 2 it stakes 20% of its allowed maximum. In the shop it buys one item per shop phase when it can afford it: the cheapest rival debuff aimed at the current leader, otherwise `extraLife`.
- **Loadout:** everyone in the show plays with the same loadout: the default super and no skills. The device's local profile no longer affects strength.
- **Gates after every task:** `npm run typecheck`, `npm test`, `npm run build`. Never push to `main`.

---

### Task 1: Clean up the stage 1–2 leftovers and harden accounts

**Files:**
- Modify: `server/index.js`, `src/net/client.ts`, `src/app.ts`, `src/ui/styles.css`, `src/game/player/arena.ts`, `server/show/engine.js`, `server/show/accounts.js`, `server/show/accounts.test.js`, `server/show/engine.test.js`, `src/net/showProtocol.ts`, `src/game/show/store.ts`, `package.json`
- Delete: `src/core/awards.ts` and `src/render/backdrop.ts`, but only if `grep -rn "awards'\|backdrop'" src` shows no importers.

**Interfaces:**
- Produces:
  - `ShowState.matchId: number`, which rises by one at every match start.
  - The server-to-client message `{k:'kicked'}`.
  - `AccountStore.verify` returns `null` while an account is locked out.

- [ ] **Step 1: Write the failing engine and account tests**

Append to `server/show/engine.test.js`:

```js
test('matchId rises with every match start', async () => {
  const s = setup();
  await login(s.eng, 'p1', 'u1');
  const before = s.eng.state().matchId;
  await s.eng.handle('p1', { k: 'ready', ready: true });
  assert.equal(s.eng.state().matchId, before + 1);
});

test('a second device taking over an account kicks the first', async () => {
  const { eng } = setup();
  await login(eng, 'p1', 'u1');
  eng.drain();
  await login(eng, 'p2', 'u1');
  assert.ok(eng.drain().some((o) => o.to === 'p1' && o.msg.k === 'kicked'));
});

test('logout revokes the resume token', async () => {
  const { eng } = setup();
  await login(eng, 'p1', 'u1');
  const token = eng.drain().find((o) => o.msg.k === 'auth' && o.msg.ok).msg.token;
  await eng.handle('p1', { k: 'logout' });
  eng.connect('p9');
  await eng.handle('p9', { k: 'resume', token });
  assert.ok(eng.drain().some((o) => o.to === 'p9' && o.msg.k === 'auth' && !o.msg.ok));
});
```

Append to `server/show/accounts.test.js`:

```js
test('five wrong PINs lock the account for 30 seconds', async () => {
  let t = 0;
  const s = await createAccountStore(await mkdtemp(join(tmpdir(), 'acc-')), { now: () => t });
  const a = await s.register({ name: 'Lock', avatar: '🦊', pin: '1111' });
  for (let i = 0; i < 5; i++) assert.equal(s.verify(a.id, '0000'), null);
  assert.equal(s.verify(a.id, '1111'), null, 'locked even with the right PIN');
  t += 30_001;
  assert.equal(s.verify(a.id, '1111')?.id, a.id);
});
```

In the existing test `persists across reloads and never stores the PIN`, replace `assert.ok(!raw.includes('4321'));` with:

```js
const stored = JSON.parse(raw).accounts[0];
assert.equal(stored.pin, undefined);
assert.notEqual(stored.hash, '4321');
assert.equal(stored.hash.length, 64);
```

The old assertion could fail by chance whenever the random hex happened to contain `4321`.

- [ ] **Step 2: Run the tests.** Run `npm test`. Expected: the 4 new tests FAIL.

- [ ] **Step 3: Implement the server side**

`server/show/accounts.js`:
- `createAccountStore(dir, { now = Date.now } = {})`.
- Keep a `Map` from id to `{ fails, lockedUntil }`.
- `verify`:
  - If `now() < lockedUntil`, return `null`.
  - On a wrong PIN, `fails += 1`. When `fails >= 5`, set `lockedUntil = now() + 30_000` and `fails = 0`.
  - On success, clear the entry.

`server/show/engine.js`:
- Add `let matchId = 0;`. Increment it in `startMatch()` just before `phase = 'intro'`, and add `matchId` to `state()`.
- In `bind()`, when another peer held the account, call `out(otherPeerId, { k: 'kicked' })` before clearing its `accountId`.
- Token rotation: keep `accountTokens: Map<accountId, token>`. When `bind` issues a new token, delete the account's previous token from `tokens`. `logout` deletes the account's token too.
- Remove the dead comment `// Task 6` in `handle()` and `tick()`.

`server/index.js`: delete the `rooms` map, `broadcast()`, the `join` case and the room cleanup in `close`. Nothing else uses them.

`package.json`: set the test script to `"test": "node --test \"server/**/*.test.js\""`. The quotes let Node expand the glob itself, so tests at any depth are found.

- [ ] **Step 4: Implement the client side**

`src/net/showProtocol.ts`:
- Add `matchId: number` to `ShowState`.
- Add `| { k: 'kicked' }` to `ShowDown`.

`src/game/show/store.ts`: on `kicked`, set `this.me = null`, clear the token with `safeSet(TOKEN_KEY, null)`, set `this.authError = 'Signed in on another device.'`, and emit.

`src/net/client.ts`:
- Remove `supports()`, `features`, the `room` field, and the `join` send.
- `connect(name)` keeps only opening the socket.
- Update `src/game/show/store.ts`'s `net.connect(...)` call to match, and remove the `'lobby'` connect in `src/app.ts` (`initNetwork`). The show store is the only thing that connects now.

`src/game/player/arena.ts`: build the run with `new ArenaRun(round.levelIndex, seconds)`, and delete the `equipSkills` line. That is the fixed loadout.

`src/ui/styles.css`:
- Delete every rule whose selector is no longer used. Check each selector with `grep -rn "<class>" src index.html`. Candidates: `announce`, `answer-chip`, `board-scroll`, `card-back-emoji`, `card-category`, `card-type-badge`, `commentary`, `editor-canvas`, `editor-wrap`, `level-cell`, `level-grid`, `race-*`, `racecell`, `racetrack`, `swatch`, `tokens`, `xpbar`, `card-flip`, `card-stage`, `card-face`, `card-front`.
- Also delete the comment that names `teamQuizDevice.ts`.
- Keep every selector that grep finds used.

- [ ] **Step 5: Verify.** Run `npm test`: all pass, including the 4 new tests. Then run `npm run typecheck` and `npm run build`.

- [ ] **Step 6: Commit** with the message `Tidy the stage-two leftovers and lock out PIN guessing`, plus the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 2: Black-and-gold theme

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/main.ts`, `src/ui/styles.css` (`:root` block), `src/ui/show.css`, `src/game/tv/index.ts` (header colours), `src/game/tv/arenaGrid.ts` (tile frame), `src/game/tv/lobby.ts`, `src/game/tv/standings.ts`, `src/game/player/lobby.ts`, `src/game/player/wait.ts`, `src/game/player/login.ts`, `src/game/tv/ticker.ts` (no copy changes, only the ticker markup class)

**Interfaces:**
- Produces:
  - CSS custom properties on `:root`: `--bg --surface --raised --line --gold --gold-hi --text --muted --danger --font --font-display`.
  - The class names used by later tasks: `.tv-screen` (full-height TV layout), `.tv-title`, `.gold`, `.big-num`, `.card-option` (a selectable card), `.card-option.hot`, `.btn-gold`.

- [ ] **Step 1: Fonts**

```bash
npm install --save-dev @fontsource/bebas-neue @fontsource/manrope
```

At the top of `src/main.ts`, before `./ui/show.css`:

```ts
import '@fontsource/bebas-neue/400.css';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/800.css';
```

- [ ] **Step 2: Tokens.** Replace the `:root` block in `src/ui/styles.css` with the one below. The old names stay mapped so that existing rules keep working.

```css
:root {
  --bg: #0b0a08;
  --bg-gradient: #0b0a08;
  --surface: #16130e;
  --raised: #211c14;
  --panel: #16130e;
  --line: #3a3226;
  --gold: #f5c542;
  --gold-hi: #ffe08a;
  --cyan: #f5c542;
  --amber: #f5c542;
  --violet: #b06bff;
  --pink: #ff5fa2;
  --red: #ff4d6d;
  --danger: #ff4d6d;
  --green: #3ddc84;
  --text: #fff8e7;
  --muted: #bdb39a;
  --font: Manrope, system-ui, -apple-system, sans-serif;
  --font-display: 'Bebas Neue', Impact, sans-serif;
}
```

- [ ] **Step 3: Rewrite `src/ui/show.css`** to follow the mockup (golden title with glow, dark cards, gold borders). Keep every existing class name, since the scenes use them, and add the new ones:

```css
.show-panel { max-width: 560px; margin: 5vh auto; padding: 26px 22px; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; display: flex; flex-direction: column; gap: 16px; color: var(--text); font-family: var(--font); }
.show-panel h2 { margin: 0; font-family: var(--font-display); font-size: 40px; letter-spacing: 2px; font-weight: 400; color: var(--gold); }
.show-panel .row { display: flex; gap: 10px; justify-content: space-between; align-items: center; flex-wrap: nowrap; }
.gold { color: var(--gold); }
.tv-title { font-family: var(--font-display); letter-spacing: 8px; color: var(--gold); text-shadow: 0 0 36px rgba(245,197,66,.45); font-weight: 400; margin: 0; }
.big-num { font-family: var(--font-display); color: var(--gold); line-height: 1; text-shadow: 0 0 40px rgba(245,197,66,.6); }
.btn-gold { font-family: var(--font-display); font-size: 30px; letter-spacing: 4px; padding: 16px 28px; min-height: 60px; border: 0; border-radius: 18px; background: var(--gold); color: var(--bg); box-shadow: 0 0 30px rgba(245,197,66,.4); cursor: pointer; }
.btn-gold:disabled { opacity: .4; box-shadow: none; cursor: not-allowed; }
.card-option { display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-start; gap: 6px; text-align: left; min-height: 110px; padding: 20px; border-radius: 20px; background: var(--surface); border: 3px solid var(--line); color: var(--text); font: inherit; cursor: pointer; }
.card-option .tag { font-size: 13px; font-weight: 800; letter-spacing: 3px; color: var(--gold); }
.card-option .title { font-family: var(--font-display); font-size: 36px; letter-spacing: 1px; line-height: 1; }
.card-option.hot, .card-option:hover { border-color: var(--gold); box-shadow: 0 0 30px rgba(245,197,66,.35); }
.card-option.right { border-color: var(--green); box-shadow: 0 0 26px rgba(61,220,132,.4); }
.card-option.wrong { border-color: var(--danger); opacity: .7; }
.field { font: inherit; font-size: 20px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--text); }
.field:focus { outline: 2px solid var(--gold); }
.field.pin { font-size: 34px; letter-spacing: 12px; text-align: center; }
.account-grid, .avatar-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.avatar-grid { grid-template-columns: repeat(8, 1fr); }
.account, .avatar { font: inherit; font-size: 18px; padding: 14px; border-radius: 14px; border: 2px solid var(--line); background: var(--raised); color: var(--text); cursor: pointer; }
.avatar { font-size: 24px; padding: 8px; }
.avatar.picked, .account:hover { border-color: var(--gold); background: rgba(245,197,66,.12); }
.account.new { border-style: dashed; }
.error { color: var(--danger); margin: 0; }
.roster { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 7px 14px; border-radius: 999px; border: 2px solid var(--c); opacity: .6; font-weight: 700; }
.chip.ready { opacity: 1; box-shadow: 0 0 14px color-mix(in srgb, var(--c) 45%, transparent); }
.countdown { font-family: var(--font-display); font-size: 48px; color: var(--gold); margin: 0; font-weight: 400; }
.act { font-family: var(--font-display); color: var(--muted); letter-spacing: 4px; font-size: 22px; margin: 0; }
.standings { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; counter-reset: rank; }
.standings li { counter-increment: rank; display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 10px 14px; border-radius: 12px; background: var(--surface); border: 2px solid var(--c); font-weight: 700; }
.standings li::before { content: counter(rank); font-family: var(--font-display); color: var(--gold); font-size: 26px; width: 28px; }
.standings li > span { margin-left: auto; font-family: var(--font-display); font-size: 26px; color: var(--gold); }
.standings li.me { background: rgba(245,197,66,.12); }
.manual { font-size: 14px; color: var(--muted); background: var(--surface); border-radius: 16px; padding: 16px; }
.manual h3 { margin: 0 0 6px; font-family: var(--font-display); font-weight: 400; letter-spacing: 3px; font-size: 24px; color: var(--gold); }
.manual ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; line-height: 1.45; color: #e9dfc6; }
.start { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; background: var(--bg); }
.start h1 { font-family: var(--font-display); font-weight: 400; font-size: clamp(64px, 12vw, 150px); margin: 0; letter-spacing: 10px; color: var(--gold); text-shadow: 0 0 36px rgba(245,197,66,.45); }
.tv-body { position: absolute; inset: 0 0 64px 0; overflow: auto; background: transparent; }
.tv-ticker { position: absolute; left: 0; right: 0; bottom: 0; height: 64px; display: flex; gap: 36px; align-items: center; padding: 0 32px; background: var(--surface); border-top: 2px solid var(--gold); font-size: 20px; font-weight: 600; white-space: nowrap; overflow: hidden; }
.tv-ticker::before { content: 'LIVE'; font-family: var(--font-display); letter-spacing: 3px; font-size: 26px; color: var(--gold); }
.tick { animation: tick-in .5s ease-out; }
.tick.cleared, .tick.matchOver, .tick.revealed { color: var(--gold); }
.tick.died, .tick.timeout { color: var(--danger); }
@keyframes tick-in { from { transform: translateY(30px); opacity: 0; } to { transform: none; opacity: 1; } }
.tv-screen { min-height: 100%; box-sizing: border-box; padding: 48px 80px 24px; display: flex; flex-direction: column; align-items: center; gap: 26px; text-align: center; color: var(--text); font-family: var(--font); }
.tv-lobby, .tv-standings { max-width: 1200px; margin: 4vh auto; display: flex; flex-direction: column; align-items: center; gap: 22px; text-align: center; }
.tv-lobby h1, .tv-standings h1 { font-family: var(--font-display); font-weight: 400; font-size: clamp(64px, 9vw, 132px); margin: 0; letter-spacing: 10px; color: var(--gold); text-shadow: 0 0 36px rgba(245,197,66,.45); }
.tv-url { font-size: 28px; font-weight: 800; margin: 0; padding: 12px 28px; border: 2px solid var(--gold); border-radius: 999px; background: var(--surface); }
.tv-roster { display: grid; grid-template-columns: repeat(5, 190px); gap: 16px; }
.tv-seat { height: 150px; box-sizing: border-box; border-radius: 18px; border: 3px solid var(--c); background: var(--surface); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 20px; font-weight: 800; opacity: .6; }
.tv-seat.ready { opacity: 1; box-shadow: 0 0 22px color-mix(in srgb, var(--c) 35%, transparent); }
.tv-seat .hint { font-size: 14px; letter-spacing: 2px; color: var(--gold); font-weight: 600; }
.tv-avatar { font-size: 48px; }
.tv-lobby .manual { font-size: 22px; text-align: left; max-width: 900px; }
.standings.big { font-size: 30px; width: min(900px, 90vw); }
.standings.big li > span { font-size: 40px; }
```

- [ ] **Step 4: Canvas colours**
  - In `src/game/tv/index.ts` `draw()`: set the background fill to `#0b0a08`, the header title to `'bold 40px "Bebas Neue", Impact, sans-serif'` in `#f5c542`, the boss marker in `#ff8a9e`, the timer in `#f5c542`, switching to `#ff4d6d` at 10 s or less, and "Waiting for" in `#bdb39a`.
  - In `src/game/tv/arenaGrid.ts`: draw a rounded 3 px frame around each tile in the player's colour, or in `#f5c542` once `p.result?.cleared`. Draw captions in `'800 20px Manrope, sans-serif'`: the name in the player's colour and the score in gold. The result overlay text is `CLEARED` in gold (Bebas Neue).
  - Clear the whole canvas to `#0b0a08` in the player router's `draw()` (`src/game/player/index.ts`) when no arena is running.

- [ ] **Step 5: Screen markup touch-ups**
  - TV lobby (`src/game/tv/lobby.ts`): title `h1` "ARCOQUIZ", a subtitle `p.act` "THE ARKANOID QUIZ SHOW", the URL pill, seats, the countdown as `p.countdown` with the number wrapped in `span.big-num`, and the manual.
  - Phone lobby (`src/game/player/lobby.ts`): the Ready button uses class `btn-gold` with the label "I'M READY" / "NOT READY". "Switch player" becomes a plain link-styled `button.btn.ghost.small`.
  - Login and wait screens: switch primary buttons to `btn-gold`.
  - Remove the now-unused `.tv-seat .hint` fallback if nothing uses it.

- [ ] **Step 6: Verify**
  - Run `npm run typecheck`, `npm test` and `npm run build`.
  - Check visually: run `npm run build && PORT=18090 node server/index.js`, then open `/?role=tv` and `/?role=player` side by side. Compare with the mockup artboards "TV · Lobby" and "Phone · Lobby" at https://claude.ai/artifact/U5M1wHcSKHZPH6zREey9GR. If you have no browser, say so in the report.
  - Kill the server afterwards.

- [ ] **Step 7: Commit** with the message `Dress the show in black and gold`, plus the trailer.

---

### Task 3: Engine phase pipeline with the shared 3-2-1 start

**Files:**
- Modify: `server/show/constants.js`, `server/show/engine.js`, `server/show/engine.test.js`

**Interfaces:**
- Produces:
  - `DUR` gains `getReady: 3, pick: 6, question: 20, reveal: 6, shop: 15`, and `roundEnd` changes to `5`.
  - Phases: `'lobby'|'intro'|'getReady'|'arena'|'pick'|'question'|'reveal'|'shop'|'roundEnd'|'over'`.
  - This task implements only `getReady` and the transition order `arena → afterArena() → roundEnd`. Tasks 5 and 7 insert pick/question/reveal and shop into `afterArena()` and `afterReveal()`.
  - Event kind `'getReady'`.

- [ ] **Step 1: Update and add tests.** In `server/show/engine.test.js`:

Replace the `startedDuo` helper so that it lands in the arena:

```js
async function startedDuo() {
  const s = setup();
  await login(s.eng, 'p1', 'u1');
  await login(s.eng, 'p2', 'u2');
  await s.eng.handle('p1', { k: 'ready', ready: true });
  await s.eng.handle('p2', { k: 'ready', ready: true });
  s.advance(DUR.intro + 0.1);
  s.advance(DUR.getReady + 0.1);
  return s;
}
```

Add:

```js
test('intro leads to a 3-2-1 getReady, then the arena', async () => {
  const s = setup();
  await login(s.eng, 'p1', 'u1');
  await login(s.eng, 'p2', 'u2');
  await s.eng.handle('p1', { k: 'ready', ready: true });
  await s.eng.handle('p2', { k: 'ready', ready: true });
  s.advance(DUR.intro + 0.1);
  assert.equal(s.eng.state().phase, 'getReady');
  assert.equal(s.eng.state().round.index, 0);
  s.advance(DUR.getReady + 0.1);
  assert.equal(s.eng.state().phase, 'arena');
  assert.equal(s.eng.state().deadline, s.now() + (DUR.arena + DUR.grace) * 1000 - 100);
});
```

The deadline was set at the moment the phase changed, which is 0.1 s before `s.now()`. That is where the `- 100` comes from.

Update every existing test that calls `s.advance(DUR.intro + 0.1)` and then expects `'arena'`: add `s.advance(DUR.getReady + 0.1)` after it. In `intro leads into the first arena` and `ten rounds then over`, the loop body becomes:

```js
for (let i = 0; i < 10; i++) {
  assert.equal(s.eng.state().round.index, i);
  assert.equal(s.eng.state().phase, 'arena');
  await s.eng.handle('p1', { k: 'result', result: res({ cleared: true, timeLeft: 5 }) });
  await s.eng.handle('tv', { k: 'result', for: 'bot', result: res({ bricks: 3 }) });
  s.advanceUntil((st) => st.phase === 'arena' || st.phase === 'over');
}
```

Add `advanceUntil` to `setup()`. It steps 1 s at a time, at most 600 times, until the predicate holds:

```js
advanceUntil: (pred) => {
  for (let i = 0; i < 600 && !pred(eng.state()); i++) { t += 1000; eng.tick(); }
  assert.ok(pred(eng.state()), 'state never matched');
},
```

`advanceUntil` is also what lets these tests pass unchanged once Tasks 5 and 7 add more phases between arenas. Those phases resolve by timeout, and the only per-phase input they need from humans is optional.

- [ ] **Step 2: Run the tests.** Expected: FAIL (there is no `getReady` phase yet).

- [ ] **Step 3: Implement.** In `constants.js`, update `DUR` as listed under Interfaces. In `engine.js`:

```js
  const arenaSeconds = (r) => (r.boss ? DUR.bossArena : DUR.arena);

  function beginGetReady() {
    roundIdx += 1;
    clearOrder = [];
    for (const p of inMatch()) { p.result = null; p.lastPoints = 0; }
    phase = 'getReady';
    deadline = now() + DUR.getReady * 1000;
    event('getReady');
    pushState();
  }

  function beginArena() {
    const r = schedule[roundIdx];
    phase = 'arena';
    deadline = now() + (arenaSeconds(r) + DUR.grace) * 1000;
    event('roundStart');
    pushState();
  }

  /** Stage-3 hook: pick → question → reveal → shop are inserted here. */
  function afterArena() { endRound(); }
```

Wire the new functions in:
- `intro` goes to `beginGetReady()`.
- `getReady` goes to `beginArena()`.
- In `applyResult`, when all results are in, call `afterArena()` instead of `endRound()`. Do the same after the arena timeout loop in `advancePhase`.
- `roundEnd` goes to `beginGetReady()`, or to `endMatch()` after the last round.

Replace the three copies of the `r.boss ? DUR.bossArena : DUR.arena` ternary with `arenaSeconds(r)`. `state().round.seconds` uses it too.

- [ ] **Step 4: Run the tests.** Run `npm test`. Everything passes.

- [ ] **Step 5: Commit** with the message `Count everyone into the arena together`, plus the trailer.

---

### Task 4: Question bank, grading and seed content

**Files:**
- Create:
  - `server/show/questions.js`
  - `server/show/questions.test.js`
  - `server/content/questions/fortytwo.json`
  - `server/content/questions/runes.json`
  - `server/content/questions/arcade.json`

**Interfaces:**
- Produces, from `server/show/questions.js`:
  - `class QuestionBankError extends Error`
  - `validateBank(bank) → bank`, which throws `QuestionBankError`.
  - `loadBank(dir) → { categories, questions }`. It merges every `*.json` in `dir` and validates the result.
  - `pickCategories(bank, used: Set<string>, rand, n = 3) → Category[]`
  - `drawQuestion(bank, categoryId, used: Set<string>, rand) → Question`, which adds the drawn id to `used`.
  - `publicQuestion(q, bank) → { id, category, categoryLabel, type, prompt, options }`. It never includes `answer` or `note`.
  - `gradeAnswers(q, answers, { openedAt, seconds, base }) → Map<playerId, { correct: boolean, points: number }>`. `answers` is a `Map<playerId, { value, at }>`.
  - `botAnswer(q, rand) → value`
- Types:
  - `Category = { id, label, tag }`.
  - `Question = { id, category, type: 'choice'|'number'|'order', prompt, options?: string[], answer, note, difficulty: 1|2|3 }`.
  - A `choice` question has an `answer` that is an option index. An `order` question has an `answer` that is an array of option indices in the correct order. A `number` question has an `answer` that is a number.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateBank, loadBank, pickCategories, drawQuestion, publicQuestion, gradeAnswers, botAnswer, QuestionBankError } from './questions.js';
import { mulberry32 } from './rng.js';

const CONTENT = fileURLToPath(new URL('../content/questions', import.meta.url));
const mini = () => ({
  categories: [{ id: 'a', label: 'A', tag: 'A' }, { id: 'b', label: 'B', tag: 'B' }],
  questions: [
    { id: 'a1', category: 'a', type: 'choice', prompt: 'P', options: ['x', 'y'], answer: 1, note: 'n', difficulty: 1 },
    { id: 'a2', category: 'a', type: 'number', prompt: 'P', answer: 24, note: 'n', difficulty: 2 },
    { id: 'b1', category: 'b', type: 'order', prompt: 'P', options: ['p', 'q', 'r'], answer: [2, 0, 1], note: 'n', difficulty: 1 },
  ],
});

test('the shipped bank loads, validates and is English-only', () => {
  const bank = loadBank(CONTENT);
  assert.ok(bank.questions.length >= 24);
  assert.equal(bank.categories.length, 3);
  assert.ok(!/[А-Яа-яЁё]/.test(JSON.stringify(bank)));
});

test('validation rejects broken questions', () => {
  const bad = (mut) => { const b = mini(); mut(b); return () => validateBank(b); };
  assert.throws(bad((b) => { b.questions[0].answer = 5; }), QuestionBankError);
  assert.throws(bad((b) => { b.questions[0].category = 'zz'; }), QuestionBankError);
  assert.throws(bad((b) => { b.questions[2].answer = [0, 0, 1]; }), QuestionBankError);
  assert.throws(bad((b) => { b.questions[1].id = 'a1'; }), QuestionBankError);
  assert.throws(bad((b) => { b.questions[1].difficulty = 4; }), QuestionBankError);
});

test('draws never repeat while a category has unused questions', () => {
  const bank = mini();
  const used = new Set();
  const rand = mulberry32(3);
  const ids = [drawQuestion(bank, 'a', used, rand).id, drawQuestion(bank, 'a', used, rand).id];
  assert.deepEqual(ids.sort(), ['a1', 'a2']);
  assert.ok(['a1', 'a2'].includes(drawQuestion(bank, 'a', used, rand).id), 'falls back when exhausted');
});

test('pickCategories prefers categories with unused questions', () => {
  const bank = mini();
  const cats = pickCategories(bank, new Set(['b1']), mulberry32(1), 2);
  assert.equal(cats.length, 2);
  assert.equal(cats[0].id, 'a');
});

test('the public question hides the answer and the note', () => {
  const pq = publicQuestion(mini().questions[0], mini());
  assert.equal(pq.answer, undefined);
  assert.equal(pq.note, undefined);
  assert.equal(pq.categoryLabel, 'A');
});

test('choice grading: correct plus speed bonus, wrong gets 0', () => {
  const q = mini().questions[0];
  const g = gradeAnswers(q, new Map([['p1', { value: 1, at: 5000 }], ['p2', { value: 0, at: 1000 }]]), { openedAt: 0, seconds: 20, base: 100 });
  assert.deepEqual(g.get('p1'), { correct: true, points: 100 + Math.round(50 * 0.75) });
  assert.deepEqual(g.get('p2'), { correct: false, points: 0 });
});

test('number grading: the closest wins, an exact answer earns +50', () => {
  const q = mini().questions[1];
  const g = gradeAnswers(q, new Map([['p1', { value: 20, at: 1 }], ['p2', { value: 27, at: 1 }], ['p3', { value: 28, at: 1 }]]), { openedAt: 0, seconds: 20, base: 200 });
  assert.deepEqual(g.get('p2'), { correct: true, points: 200 });
  assert.deepEqual(g.get('p1'), { correct: false, points: 0 });
  const exact = gradeAnswers(q, new Map([['p1', { value: 24, at: 1 }]]), { openedAt: 0, seconds: 20, base: 200 });
  assert.deepEqual(exact.get('p1'), { correct: true, points: 250 });
});

test('order grading needs the exact sequence', () => {
  const q = mini().questions[2];
  const g = gradeAnswers(q, new Map([['p1', { value: [2, 0, 1], at: 0 }], ['p2', { value: [0, 2, 1], at: 0 }]]), { openedAt: 0, seconds: 20, base: 100 });
  assert.equal(g.get('p1').correct, true);
  assert.equal(g.get('p1').points, 150);
  assert.equal(g.get('p2').points, 0);
});

test('the bot is right about 60% of the time', () => {
  const q = mini().questions[0];
  const rand = mulberry32(9);
  let right = 0;
  for (let i = 0; i < 2000; i++) if (botAnswer(q, rand) === 1) right++;
  assert.ok(right > 1080 && right < 1320, `right=${right}`);
});
```

- [ ] **Step 2: Run the tests.** Expected: FAIL (module not found).

- [ ] **Step 3: Implement `server/show/questions.js`**

```js
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pickInt, shuffle } from './rng.js';

export class QuestionBankError extends Error {}

const isInt = (n) => Number.isInteger(n);

export function validateBank(bank) {
  const fail = (m) => { throw new QuestionBankError(m); };
  if (!bank || !Array.isArray(bank.categories) || !Array.isArray(bank.questions)) fail('Bank needs categories and questions.');
  const cats = new Set();
  for (const c of bank.categories) {
    if (!c?.id || !c.label || !c.tag) fail(`Category ${c?.id} needs id, label and tag.`);
    if (cats.has(c.id)) fail(`Duplicate category ${c.id}.`);
    cats.add(c.id);
  }
  const ids = new Set();
  for (const q of bank.questions) {
    const where = `Question ${q?.id}`;
    if (!q?.id || ids.has(q.id)) fail(`${where}: missing or duplicate id.`);
    ids.add(q.id);
    if (!cats.has(q.category)) fail(`${where}: unknown category ${q.category}.`);
    if (typeof q.prompt !== 'string' || !q.prompt) fail(`${where}: empty prompt.`);
    if (typeof q.note !== 'string') fail(`${where}: note must be a string.`);
    if (![1, 2, 3].includes(q.difficulty)) fail(`${where}: difficulty must be 1-3.`);
    if (q.type === 'choice') {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) fail(`${where}: 2-4 options.`);
      if (!isInt(q.answer) || q.answer < 0 || q.answer >= q.options.length) fail(`${where}: answer must index an option.`);
    } else if (q.type === 'order') {
      if (!Array.isArray(q.options) || q.options.length < 3 || q.options.length > 5) fail(`${where}: 3-5 options.`);
      const a = q.answer;
      if (!Array.isArray(a) || a.length !== q.options.length || new Set(a).size !== a.length || !a.every((i) => isInt(i) && i >= 0 && i < q.options.length)) fail(`${where}: answer must be a permutation of option indices.`);
    } else if (q.type === 'number') {
      if (typeof q.answer !== 'number' || !Number.isFinite(q.answer)) fail(`${where}: numeric answer.`);
    } else fail(`${where}: unknown type ${q.type}.`);
  }
  return bank;
}

export function loadBank(dir) {
  const bank = { categories: [], questions: [] };
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const part = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    bank.categories.push(...(part.categories ?? []));
    bank.questions.push(...(part.questions ?? []));
  }
  return validateBank(bank);
}

const unusedIn = (bank, catId, used) => bank.questions.filter((q) => q.category === catId && !used.has(q.id));

export function pickCategories(bank, used, rand, n = 3) {
  const fresh = shuffle(rand, bank.categories.filter((c) => unusedIn(bank, c.id, used).length > 0));
  const stale = shuffle(rand, bank.categories.filter((c) => !fresh.includes(c)));
  return [...fresh, ...stale].slice(0, n);
}

export function drawQuestion(bank, categoryId, used, rand) {
  let pool = unusedIn(bank, categoryId, used);
  if (!pool.length) pool = bank.questions.filter((q) => q.category === categoryId);
  if (!pool.length) pool = bank.questions;
  const q = pool[pickInt(rand, pool.length)];
  used.add(q.id);
  return q;
}

export function publicQuestion(q, bank) {
  const cat = bank.categories.find((c) => c.id === q.category);
  return { id: q.id, category: q.category, categoryLabel: cat?.label ?? q.category, type: q.type, prompt: q.prompt, options: q.options ?? null };
}

const sameSeq = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

export function gradeAnswers(q, answers, { openedAt, seconds, base }) {
  const out = new Map();
  if (q.type === 'number') {
    let best = Infinity;
    for (const { value } of answers.values()) if (typeof value === 'number') best = Math.min(best, Math.abs(value - q.answer));
    for (const [id, { value }] of answers) {
      const d = typeof value === 'number' ? Math.abs(value - q.answer) : Infinity;
      const correct = d === best && Number.isFinite(d);
      out.set(id, { correct, points: correct ? base + (d === 0 ? 50 : 0) : 0 });
    }
    return out;
  }
  for (const [id, { value, at }] of answers) {
    const correct = q.type === 'choice' ? value === q.answer : sameSeq(value, q.answer);
    const left = Math.max(0, 1 - (at - openedAt) / (seconds * 1000));
    out.set(id, { correct, points: correct ? base + Math.round(50 * left) : 0 });
  }
  return out;
}

export function botAnswer(q, rand) {
  const right = rand() < 0.6;
  if (q.type === 'choice') {
    if (right) return q.answer;
    const wrong = q.options.map((_, i) => i).filter((i) => i !== q.answer);
    return wrong[pickInt(rand, wrong.length)];
  }
  if (q.type === 'order') return right ? [...q.answer] : [...q.answer].reverse();
  if (right) return q.answer;
  const off = Math.max(1, Math.round(Math.abs(q.answer) * (0.1 + rand() * 0.3)));
  return q.answer + (rand() < 0.5 ? -off : off);
}
```

- [ ] **Step 4: Write the seed content.** All facts come from the project READMEs (`/Users/Oleg/Claude_Projects/Codexion/README.md`, `/Users/Oleg/Claude_Projects/CallMeMayBe/README.md`) or are well-established general knowledge. Write the three files exactly as follows.

`server/content/questions/fortytwo.json`:

```json
{
  "categories": [{ "id": "fortytwo", "label": "42 Projects", "tag": "42 PROJECTS" }],
  "questions": [
    { "id": "ft-dongles", "category": "fortytwo", "type": "choice", "difficulty": 1, "prompt": "In Codexion, how many USB dongles does a coder hold while compiling?", "options": ["One", "Two", "Three", "None, it's wireless"], "answer": 1, "note": "The left one and the right one at once: dining philosophers, with USB." },
    { "id": "ft-edf", "category": "fortytwo", "type": "choice", "difficulty": 2, "prompt": "Codexion's edf scheduler hands a free dongle to…", "options": ["Whoever asked first", "Whoever will burn out soonest", "The coder with the most compiles", "A random coder"], "answer": 1, "note": "EDF means Earliest Deadline First. fifo is the other policy." },
    { "id": "ft-heap", "category": "fortytwo", "type": "choice", "difficulty": 2, "prompt": "Where does each Codexion dongle keep its waiting requests?", "options": ["A linked list", "A hand-written binary min-heap", "A hash map", "A sticky note"], "answer": 1, "note": "Swap one comparison function and the whole scheduling policy changes." },
    { "id": "ft-args", "category": "fortytwo", "type": "number", "difficulty": 2, "prompt": "How many command-line arguments does ./codexion require?", "answer": 8, "note": "All eight are mandatory, and durations are in milliseconds." },
    { "id": "ft-classic", "category": "fortytwo", "type": "choice", "difficulty": 1, "prompt": "Codexion is a remix of which classic problem?", "options": ["Travelling salesman", "Dining philosophers", "Tower of Hanoi", "Byzantine generals"], "answer": 1, "note": "Plus a dongle cooldown and an explicit arbitration policy." },
    { "id": "ft-cycle", "category": "fortytwo", "type": "order", "difficulty": 1, "prompt": "Put a Codexion coder's loop in order", "options": ["Refactor", "Compile", "Debug"], "answer": [1, 2, 0], "note": "Compile, debug, refactor, then straight back to the dongles." },
    { "id": "ft-cmm-output", "category": "fortytwo", "type": "choice", "difficulty": 1, "prompt": "Ask call me maybe 'What is the sum of 2 and 3?'. What comes back?", "options": ["5", "A structured function call", "An error", "A haiku"], "answer": 1, "note": "fn_add_numbers with a = 2.0 and b = 3.0. It never answers, it calls." },
    { "id": "ft-cmm-model", "category": "fortytwo", "type": "choice", "difficulty": 2, "prompt": "Which model powers call me maybe?", "options": ["GPT-2", "Qwen3-0.6B", "Llama 3 70B", "BERT"], "answer": 1, "note": "About half a billion parameters, running on a CPU." },
    { "id": "ft-cmm-trick", "category": "fortytwo", "type": "choice", "difficulty": 3, "prompt": "What keeps call me maybe's JSON 100% valid?", "options": ["Prompt engineering", "Constrained decoding", "Fine-tuning", "Retrying until it parses"], "answer": 1, "note": "Every token is restricted before it is emitted, straight on the logits." }
  ]
}
```

`server/content/questions/runes.json`:

```json
{
  "categories": [{ "id": "runes", "label": "Tarot & Runes", "tag": "TAROT & RUNES" }],
  "questions": [
    { "id": "ru-count", "category": "runes", "type": "number", "difficulty": 1, "prompt": "How many runes are in the Elder Futhark?", "answer": 24, "note": "Three families (ættir) of eight." },
    { "id": "ru-name", "category": "runes", "type": "choice", "difficulty": 2, "prompt": "Where does the name 'futhark' come from?", "options": ["Its first six runes", "A Norse god", "A Danish village", "The Old Norse word for secret"], "answer": 0, "note": "F-U-TH-A-R-K, like 'alphabet' comes from alpha and beta." },
    { "id": "ru-fehu", "category": "runes", "type": "choice", "difficulty": 2, "prompt": "Fehu, the very first rune, stands for…", "options": ["Cattle and wealth", "Fire", "Ice", "A journey"], "answer": 0, "note": "Cattle were wealth that could walk." },
    { "id": "ru-isa", "category": "runes", "type": "choice", "difficulty": 2, "prompt": "Isa is the rune of…", "options": ["Ice", "The sun", "A horse", "Hail"], "answer": 0, "note": "A single vertical stroke: still, frozen, waiting." },
    { "id": "ta-major", "category": "runes", "type": "number", "difficulty": 1, "prompt": "How many cards are in the tarot's Major Arcana?", "answer": 22, "note": "From 0, The Fool, to 21, The World." },
    { "id": "ta-zero", "category": "runes", "type": "choice", "difficulty": 1, "prompt": "Which Major Arcana card carries the number 0?", "options": ["The Magician", "The Fool", "The World", "Death"], "answer": 1, "note": "The Fool starts the journey the other 21 cards describe." },
    { "id": "ta-deck", "category": "runes", "type": "number", "difficulty": 2, "prompt": "How many cards are in a standard tarot deck?", "answer": 78, "note": "22 Major Arcana plus 56 Minor Arcana." },
    { "id": "ta-suit", "category": "runes", "type": "choice", "difficulty": 1, "prompt": "Which of these is NOT a tarot suit?", "options": ["Cups", "Wands", "Swords", "Shields"], "answer": 3, "note": "The four suits are Wands, Cups, Swords and Pentacles." }
  ]
}
```

`server/content/questions/arcade.json`:

```json
{
  "categories": [{ "id": "arcade", "label": "Arcade Legends", "tag": "ARCADE" }],
  "questions": [
    { "id": "ar-year", "category": "arcade", "type": "choice", "difficulty": 2, "prompt": "In which year did Taito release Arkanoid?", "options": ["1978", "1986", "1994", "2001"], "answer": 1, "note": "1986, ten years after Atari's Breakout." },
    { "id": "ar-vaus", "category": "arcade", "type": "choice", "difficulty": 3, "prompt": "Arkanoid's paddle is really a spacecraft called…", "options": ["Vaus", "Nostromo", "Normandy", "Arwing"], "answer": 0, "note": "The Vaus escaped the mothership Arkanoid." },
    { "id": "ar-doh", "category": "arcade", "type": "choice", "difficulty": 1, "prompt": "Who is Arkanoid's final boss?", "options": ["DOH", "Bowser", "Ganon", "Dr. Wily"], "answer": 0, "note": "He may be waiting in tonight's finale too." },
    { "id": "ar-breakout", "category": "arcade", "type": "choice", "difficulty": 1, "prompt": "Which game did Arkanoid grow out of?", "options": ["Pong", "Breakout", "Asteroids", "Tetris"], "answer": 1, "note": "Breakout: one paddle, one ball, one wall of bricks." },
    { "id": "ar-breakout-year", "category": "arcade", "type": "number", "difficulty": 2, "prompt": "In what year did Atari release Breakout?", "answer": 1976, "note": "Designed by Nolan Bushnell and Steve Bristow." },
    { "id": "ar-order", "category": "arcade", "type": "order", "difficulty": 2, "prompt": "Put these in release order, oldest first", "options": ["Tetris", "Pong", "Arkanoid"], "answer": [1, 0, 2], "note": "Pong 1972, Tetris 1984, Arkanoid 1986." },
    { "id": "ar-blinky", "category": "arcade", "type": "choice", "difficulty": 1, "prompt": "What colour is Blinky in Pac-Man?", "options": ["Red", "Pink", "Cyan", "Orange"], "answer": 0, "note": "Blinky chases you directly. Pinky tries to ambush you." },
    { "id": "ar-konami", "category": "arcade", "type": "choice", "difficulty": 2, "prompt": "How does the Konami Code end?", "options": ["B, A, Start", "A, B, Select", "Up, Up", "X, Y"], "answer": 0, "note": "Up, Up, Down, Down, Left, Right, Left, Right, B, A, Start." }
  ]
}
```

- [ ] **Step 5: Run the tests.** Run `npm test`. Everything passes.

- [ ] **Step 6: Commit** with the message `Grade questions on the server and seed an English bank`, plus the trailer.

---

### Task 5: Engine pick, question and reveal phases, wagers and the bot's answers

**Files:**
- Modify: `server/show/engine.js`, `server/show/engine.test.js`, `server/index.js`

**Interfaces:**
- Consumes: Task 4's `loadBank`, `pickCategories`, `drawQuestion`, `publicQuestion`, `gradeAnswers`, `botAnswer`, and `DUR` from Task 3.
- Produces:
  - `createShowEngine({ now, accounts, seed, bank })`. `bank` is the loaded bank. `server/index.js` passes `loadBank(join(ROOT, 'server', 'content', 'questions'))`.
  - `ShowUp` gains `{k:'pick', categoryId}` and `{k:'answer', value, wager?}`.
  - New `ShowState` fields:
    - `pick: { pickerId: string|null, options: {id,label,tag}[] } | null`
    - `question: { id, category, categoryLabel, type, prompt, options, points, wagerMax: number } | null`. `wagerMax` is 0 outside act 2 and is the same for everyone, 0.
    - `reveal: { questionId, answer, note, results: { playerId, value, correct, delta }[] } | null`
  - `PlayerPublic` gains `answered: boolean` and `wagerMax: number`, which is this player's own `floor(0.5 × score)` in act 2, otherwise 0.
  - Event kinds `'picked'` (`playerId`, `categoryId`), `'answered'` (`playerId`), `'revealed'`.
  - A bot picker picks immediately and at random.

- [ ] **Step 1: Add a bank fixture and write the failing tests.** In `engine.test.js`, give `setup()` a small in-memory bank. Pass `bank: testBank` to `createShowEngine`:

```js
const testBank = {
  categories: [{ id: 'a', label: 'Alpha', tag: 'A' }, { id: 'b', label: 'Beta', tag: 'B' }, { id: 'c', label: 'Gamma', tag: 'C' }],
  questions: ['a', 'b', 'c'].flatMap((c) => [1, 2, 3, 4].map((n) => ({ id: `${c}${n}`, category: c, type: 'choice', prompt: `Q ${c}${n}`, options: ['no', 'yes'], answer: 1, note: 'because', difficulty: 1 }))),
};
```

Tests to add:

```js
async function duoInQuestion(first = 'p1') {
  const s = await startedDuo();
  await s.eng.handle(first, { k: 'result', result: res({ cleared: true, timeLeft: 10 }) });
  await s.eng.handle(first === 'p1' ? 'p2' : 'p1', { k: 'result', result: res({ bricks: 4 }) });
  return s;
}

test('the first to clear gets to pick from three categories', async () => {
  const s = await duoInQuestion('p2');
  const st = s.eng.state();
  assert.equal(st.phase, 'pick');
  assert.equal(st.pick.pickerId, 'u2');
  assert.equal(st.pick.options.length, 3);
  await s.eng.handle('p1', { k: 'pick', categoryId: st.pick.options[0].id });
  assert.equal(s.eng.state().phase, 'pick', 'only the picker may pick');
  await s.eng.handle('p2', { k: 'pick', categoryId: st.pick.options[1].id });
  assert.equal(s.eng.state().phase, 'question');
  assert.equal(s.eng.state().question.category, st.pick.options[1].id);
});

test('nobody picking in time means the host picks', async () => {
  const s = await duoInQuestion();
  s.advance(DUR.pick + 0.1);
  assert.equal(s.eng.state().phase, 'question');
});

test('nobody clearing skips the pick', async () => {
  const s = await startedDuo();
  await s.eng.handle('p1', { k: 'result', result: res({ bricks: 1 }) });
  await s.eng.handle('p2', { k: 'result', result: res({ bricks: 1 }) });
  assert.equal(s.eng.state().phase, 'question');
});

test('the question is sent without its answer', async () => {
  const s = await duoInQuestion();
  await s.eng.handle('p1', { k: 'pick', categoryId: s.eng.state().pick.options[0].id });
  const q = s.eng.state().question;
  assert.equal(q.answer, undefined);
  assert.equal(q.note, undefined);
  assert.equal(q.points, 100);
});

test('answers are graded at the reveal, and all answering ends the question early', async () => {
  const s = await duoInQuestion();
  await s.eng.handle('p1', { k: 'pick', categoryId: s.eng.state().pick.options[0].id });
  const before = Object.fromEntries(s.eng.state().players.map((p) => [p.id, p.score]));
  s.advance(4);
  await s.eng.handle('p1', { k: 'answer', value: 1 });
  await s.eng.handle('p1', { k: 'answer', value: 0 });
  assert.equal(s.eng.state().players.find((p) => p.id === 'u1').answered, true);
  await s.eng.handle('p2', { k: 'answer', value: 0 });
  const st = s.eng.state();
  assert.equal(st.phase, 'reveal');
  assert.equal(st.reveal.answer, 1);
  assert.equal(st.reveal.note, 'because');
  const r1 = st.reveal.results.find((r) => r.playerId === 'u1');
  assert.equal(r1.correct, true);
  assert.equal(r1.delta, 100 + Math.round(50 * (1 - 4 / DUR.question)));
  assert.equal(st.players.find((p) => p.id === 'u1').score, before.u1 + r1.delta);
  assert.equal(st.reveal.results.find((r) => r.playerId === 'u2').delta, 0);
});

test('act 3 doubles question points', async () => {
  const s = await startedDuo();
  s.jumpToRound(6);
  await s.eng.handle('p1', { k: 'result', result: res({ bricks: 1 }) });
  await s.eng.handle('p2', { k: 'result', result: res({ bricks: 1 }) });
  assert.equal(s.eng.state().question.points, 200);
});

test('act 2 wagers: win the stake when right, lose it when wrong, capped at half the score', async () => {
  const s = await startedDuo();
  s.jumpToRound(3);
  s.setScore('u1', 400); s.setScore('u2', 400);
  await s.eng.handle('p1', { k: 'result', result: res({ bricks: 0 }) });
  await s.eng.handle('p2', { k: 'result', result: res({ bricks: 0 }) });
  assert.equal(s.eng.state().players.find((p) => p.id === 'u1').wagerMax, 200);
  await s.eng.handle('p1', { k: 'answer', value: 1, wager: 999 });
  await s.eng.handle('p2', { k: 'answer', value: 0, wager: 150 });
  const res1 = s.eng.state().reveal.results;
  const d1 = res1.find((r) => r.playerId === 'u1').delta;
  const d2 = res1.find((r) => r.playerId === 'u2').delta;
  assert.ok(d1 >= 100 + 200 && d1 <= 150 + 200, `d1=${d1}`);
  assert.equal(d2, -150);
});

test('the bot answers between 3 and 10 seconds after the question opens', async () => {
  const s = setup();
  await login(s.eng, 'p1', 'u1');
  s.eng.connect('tv');
  await s.eng.handle('tv', { k: 'hello', role: 'tv' });
  await s.eng.handle('p1', { k: 'ready', ready: true });
  s.advance(DUR.intro + 0.1); s.advance(DUR.getReady + 0.1);
  await s.eng.handle('p1', { k: 'result', result: res({ bricks: 1 }) });
  await s.eng.handle('tv', { k: 'result', for: 'bot', result: res({ bricks: 1 }) });
  assert.equal(s.eng.state().phase, 'question');
  s.advance(2.9);
  assert.equal(s.eng.state().players.find((p) => p.isBot).answered, false);
  s.advance(7.2);
  assert.equal(s.eng.state().players.find((p) => p.isBot).answered, true);
});
```

Add these helpers to `setup()`. They use test-only engine hooks exposed through `createShowEngine`'s return value as `__test`:

```js
jumpToRound: (i) => eng.__test.jumpToRound(i),
setScore: (id, v) => eng.__test.setScore(id, v),
```

In `engine.js`, return `__test: { jumpToRound(i) { roundIdx = i - 1; beginGetReady(); advancePhase(); }, setScore(id, v) { players.get(id).score = v; } }`. `jumpToRound` starts round `i` and moves through `getReady` into the arena.

The bot test needs the bot's answer delay to be deterministic. Use the engine's seeded `rand`: add `const rand = mulberry32(seed())` at match start.

- [ ] **Step 2: Run the tests.** Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** In `engine.js`:

```js
import { mulberry32, pickInt } from './rng.js';
import { pickCategories, drawQuestion, publicQuestion, gradeAnswers, botAnswer } from './questions.js';

  // match-scoped
  let rand = Math.random;
  let usedQuestions = new Set();
  let pick = null;          // { pickerId, options }
  let question = null;      // the full question, server-only
  let questionOpenedAt = 0;
  let answers = new Map();  // playerId -> { value, at, wager }
  let botAnswerAt = null;
  let reveal = null;

  const act = () => schedule[roundIdx]?.act ?? 1;
  const questionBase = (q) => 100 * q.difficulty * (act() === 3 ? 2 : 1);
  const wagerMaxOf = (p) => (act() === 2 ? Math.floor(0.5 * Math.max(0, p.score)) : 0);
```

- In `startMatch`, add `rand = mulberry32(seed())` and `usedQuestions = new Set()`. Keep `buildSchedule(seed())` as a separate draw.
- In `beginGetReady`, set `pick = null`, `question = null`, `reveal = null`, `answers = new Map()` and `botAnswerAt = null`.

```js
  function afterArena() {
    const first = clearOrder[0];
    const options = pickCategories(bank, usedQuestions, rand, 3);
    const picker = first ? players.get(first) : null;
    if (!picker || picker.isBot) {
      beginQuestion(options[pickInt(rand, options.length)].id);
      return;
    }
    phase = 'pick';
    pick = { pickerId: picker.id, options: options.map(({ id, label, tag }) => ({ id, label, tag })) };
    deadline = now() + DUR.pick * 1000;
    pushState();
  }

  function beginQuestion(categoryId) {
    if (pick) event('picked', { playerId: pick.pickerId ?? undefined, categoryId });
    question = drawQuestion(bank, categoryId, usedQuestions, rand);
    phase = 'question';
    questionOpenedAt = now();
    answers = new Map();
    const bot = players.get(BOT.id);
    botAnswerAt = bot?.inMatch ? now() + (3 + rand() * 7) * 1000 : null;
    deadline = now() + DUR.question * 1000;
    pushState();
  }

  function submitAnswer(p, value, wager) {
    if (phase !== 'question' || !p?.inMatch || answers.has(p.id)) return;
    const w = Math.max(0, Math.min(wagerMaxOf(p), Math.floor(Number(wager) || 0)));
    answers.set(p.id, { value, at: now(), wager: w });
    event('answered', { playerId: p.id });
    if (inMatch().every((q) => answers.has(q.id))) beginReveal();
    else pushState();
  }

  function beginReveal() {
    const graded = gradeAnswers(question, new Map([...answers].map(([id, a]) => [id, { value: a.value, at: a.at }])), { openedAt: questionOpenedAt, seconds: DUR.question, base: questionBase(question) });
    const results = inMatch().map((p) => {
      const a = answers.get(p.id);
      const g = graded.get(p.id) ?? { correct: false, points: 0 };
      const stake = a ? a.wager : 0;
      const delta = g.points + (a ? (g.correct ? stake : -stake) : 0);
      p.score += delta;
      return { playerId: p.id, value: a ? a.value : null, correct: g.correct, delta };
    });
    reveal = { questionId: question.id, answer: question.answer, note: question.note, results };
    phase = 'reveal';
    deadline = now() + DUR.reveal * 1000;
    event('revealed');
    pushState();
  }

  /** Stage-3 hook: the shop goes here (Task 7). */
  function afterReveal() { endRound(); }
```

Also:

- **`advancePhase`:**
  - `pick` goes to `beginQuestion(pick.options[pickInt(rand, pick.options.length)].id)`.
  - `question` goes to `beginReveal()`.
  - `reveal` goes to `afterReveal()`.
- **`tick`:** before the phase loop, if `phase === 'question' && botAnswerAt !== null && now() >= botAnswerAt`, then set `botAnswerAt = null` and call `submitAnswer(players.get(BOT.id), botAnswer(question, rand), Math.floor(0.2 * wagerMaxOf(players.get(BOT.id))))`.
- **`handleMatch`:**
  - `'pick'`: accept only if `phase === 'pick'`, `who?.id === pick.pickerId`, `msg.for === undefined`, and the category id is one of `pick.options`. Then call `beginQuestion(msg.categoryId)`.
  - `'answer'`: accept `msg.for === undefined` only. Validate the value's shape against `question.type`:
    - `choice`: an integer.
    - `order`: an integer array.
    - `number`: a finite number.

    Then call `submitAnswer(who, msg.value, msg.wager)`.
- **`state()`:** add `pick` and `reveal`, and `question: question && phase !== 'reveal' ? { ...publicQuestion(question, bank), points: questionBase(question), wagerMax: 0 } : (question ? { ...publicQuestion(question, bank), points: questionBase(question), wagerMax: 0 } : null)`. The question stays visible during the reveal. The answer is only in `reveal`.
- **`publicPlayer(p)`:** add `answered: answers.has(p.id)` and `wagerMax: wagerMaxOf(p)`.
- **`server/index.js`:** `import { loadBank } from './show/questions.js'`, then `const bank = loadBank(join(ROOT, 'server', 'content', 'questions'));` and pass `bank` to `createShowEngine`.
- **The existing `setup()`** passes `bank: testBank`.

- [ ] **Step 4: Run the tests.** Run `npm test`. Everything passes, including the 10-round test through `advanceUntil`.

- [ ] **Step 5: Commit** with the message `Let the first to clear pick a category, then quiz everyone`, plus the trailer.

---

### Task 6: Pick, question and reveal screens (phone and TV) and the 3-2-1

**Files:**
- Modify: `src/net/showProtocol.ts`, `src/game/player/index.ts`, `src/game/tv/index.ts`, `src/game/tv/ticker.ts`
- Create:
  - `src/game/player/getReady.ts`
  - `src/game/player/pick.ts`
  - `src/game/player/question.ts`
  - `src/game/player/reveal.ts`
  - `src/game/tv/getReady.ts`
  - `src/game/tv/pick.ts`
  - `src/game/tv/question.ts`
  - `src/game/tv/reveal.ts`

**Interfaces:**
- Consumes: Task 5's state fields, the Task 2 classes (`.tv-screen`, `.tv-title`, `.big-num`, `.card-option`, `.btn-gold`, `.gold`), and `ShowStore.secondsUntil`.
- Produces:
  - `renderPlayerGetReady`, `renderPick`, `renderQuestion`, `renderReveal`, each `(root: HTMLElement, store: ShowStore) => void`.
  - The TV versions: `renderTvGetReady`, `renderTvPick`, `renderTvQuestion`, `renderTvReveal`, with the same signature.

- [ ] **Step 1: Protocol.** In `src/net/showProtocol.ts`:

```ts
export type ShowPhase = 'lobby' | 'intro' | 'getReady' | 'arena' | 'pick' | 'question' | 'reveal' | 'shop' | 'roundEnd' | 'over';
export type QuestionType = 'choice' | 'number' | 'order';
export interface CategoryPublic { id: string; label: string; tag: string }
export interface QuestionPublic { id: string; category: string; categoryLabel: string; type: QuestionType; prompt: string; options: string[] | null; points: number; wagerMax: number }
export type AnswerValue = number | number[];
export interface RevealPublic { questionId: string; answer: AnswerValue; note: string; results: { playerId: string; value: AnswerValue | null; correct: boolean; delta: number }[] }
```

- Add to `ShowState`: `pick: { pickerId: string | null; options: CategoryPublic[] } | null; question: QuestionPublic | null; reveal: RevealPublic | null;`.
- Add to `PlayerPublic`: `answered: boolean; wagerMax: number;`.
- Add to `ShowUp`: `| { k: 'pick'; categoryId: string } | { k: 'answer'; value: AnswerValue; wager?: number }`.
- Add to `ShowEventKind`: `'getReady' | 'picked' | 'answered' | 'revealed' | 'bought'`. `bought` is used in Task 8.
- Add `categoryId?: string; targetId?: string; itemId?: string;` to `ShowEvent`.
- Add a `DUR_QUESTION = 20` export next to `ARENA_GRACE`, with a mirror comment.

- [ ] **Step 2: Player getReady.** Create `src/game/player/getReady.ts`:

```ts
import { el } from '../../ui/dom';
import { ACT_TITLES } from '../../net/showProtocol';
import type { ShowStore } from '../show/store';

export function renderPlayerGetReady(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const n = Math.max(1, Math.ceil(store.secondsUntil(st.deadline)));
  root.replaceChildren(el('div', { class: 'show-panel', style: 'align-items:center;text-align:center' },
    st.round ? el('p', { class: 'act' }, `${ACT_TITLES[st.round.act]} · ROUND ${st.round.index + 1}`) : null,
    el('div', { class: 'big-num', style: 'font-size:180px' }, String(n)),
    st.round?.boss ? el('p', { class: 'countdown', style: 'color:var(--danger)' }, 'BOSS ROUND') : null,
    el('p', { class: 'hint' }, 'Hands on the paddle — everyone starts together'),
  ));
}
```

- [ ] **Step 3: Player pick.** Create `src/game/player/pick.ts`:

```ts
import { el } from '../../ui/dom';
import type { ShowStore } from '../show/store';

export function renderPick(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const pick = st.pick!;
  const picker = st.players.find((p) => p.id === pick.pickerId);
  const mine = pick.pickerId === store.myId;
  const secs = Math.ceil(store.secondsUntil(st.deadline));
  root.replaceChildren(el('div', { class: 'show-panel' },
    el('div', { class: 'row' }, el('span', { class: 'act' }, mine ? 'YOU CLEARED FIRST!' : `${picker?.avatar ?? ''} ${picker?.name ?? ''} is picking`), el('span', { class: 'countdown', style: 'font-size:30px' }, `${secs} s`)),
    el('h2', {}, 'PICK A CATEGORY'),
    ...pick.options.map((c) => {
      const b = el('button', { class: 'card-option', type: 'button', disabled: !mine }, el('span', { class: 'tag' }, c.tag), el('span', { class: 'title' }, c.label));
      if (mine) b.addEventListener('click', () => store.send({ k: 'pick', categoryId: c.id }));
      return b;
    }),
    el('p', { class: 'hint' }, 'Everyone answers the question from the picked category.'),
  ));
}
```

- [ ] **Step 4: Player question.** Create `src/game/player/question.ts`. Local UI state (the order being built, the typed number, the wager) lives in a closure object passed in by the router, so re-renders keep it:

```ts
import { button, el } from '../../ui/dom';
import type { ShowStore } from '../show/store';

export interface QuestionUi { questionId: string; order: number[]; num: string; wager: number }

export function renderQuestion(root: HTMLElement, store: ShowStore, ui: QuestionUi): void {
  const st = store.state!;
  const q = st.question!;
  const me = store.me!;
  if (ui.questionId !== q.id) { ui.questionId = q.id; ui.order = []; ui.num = ''; ui.wager = 0; }
  const secs = Math.ceil(store.secondsUntil(st.deadline));
  const head = el('div', { class: 'row' }, el('span', { class: 'act' }, `${q.categoryLabel} · ${q.points} PTS`), el('span', { class: 'countdown', style: 'font-size:30px' }, `${secs} s`));
  if (!me.inMatch) { root.replaceChildren(el('div', { class: 'show-panel' }, head, el('h2', {}, q.prompt), el('p', { class: 'hint' }, 'You are watching this round.'))); return; }
  if (me.answered) { root.replaceChildren(el('div', { class: 'show-panel' }, head, el('h2', {}, q.prompt), el('p', { class: 'countdown' }, 'ANSWER LOCKED'), el('p', { class: 'hint' }, 'Waiting for the others…'))); return; }

  const send = (value: number | number[]): void => store.send({ k: 'answer', value, wager: ui.wager });
  const parts: (HTMLElement | null)[] = [head, el('h2', { style: 'font-family:var(--font);font-size:24px;color:var(--text);letter-spacing:0' }, q.prompt)];

  if (me.wagerMax > 0) {
    const out = el('span', { class: 'gold' }, String(ui.wager));
    const range = el('input', { type: 'range', min: 0, max: me.wagerMax, step: 10, value: ui.wager, 'aria-label': 'Wager' });
    range.addEventListener('input', () => { ui.wager = Number(range.value); out.textContent = String(ui.wager); });
    parts.push(el('label', { class: 'hint', style: 'display:flex;gap:10px;align-items:center' }, 'Stake:', range, out, ` / ${me.wagerMax}`));
  }

  if (q.type === 'choice') {
    q.options!.forEach((o, i) => { const b = el('button', { class: 'card-option', type: 'button', style: 'min-height:64px' }, el('span', { class: 'title', style: 'font-size:26px' }, o)); b.addEventListener('click', () => send(i)); parts.push(b); });
  } else if (q.type === 'order') {
    const picked = el('p', { class: 'hint' }, ui.order.length ? ui.order.map((i) => q.options![i]).join(' → ') : 'Tap the options in order');
    parts.push(picked);
    q.options!.forEach((o, i) => {
      if (ui.order.includes(i)) return;
      const b = el('button', { class: 'card-option', type: 'button', style: 'min-height:56px' }, el('span', { class: 'title', style: 'font-size:24px' }, o));
      b.addEventListener('click', () => { ui.order.push(i); if (ui.order.length === q.options!.length) send([...ui.order]); else renderQuestion(root, store, ui); });
      parts.push(b);
    });
    if (ui.order.length) parts.push(button('Start over', () => { ui.order = []; renderQuestion(root, store, ui); }, 'btn ghost small'));
  } else {
    const input = el('input', { class: 'field pin', inputmode: 'decimal', value: ui.num, 'aria-label': 'Your answer' });
    input.addEventListener('input', () => { ui.num = input.value.replace(/[^\d.-]/g, ''); input.value = ui.num; });
    const go = (): void => { const v = Number(ui.num); if (ui.num !== '' && Number.isFinite(v)) send(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    parts.push(input, button('LOCK IT IN', go, 'btn-gold'));
  }
  root.replaceChildren(el('div', { class: 'show-panel' }, ...parts));
}
```

- [ ] **Step 5: Player reveal.** Create `src/game/player/reveal.ts`:

```ts
import { el } from '../../ui/dom';
import type { AnswerValue, QuestionPublic } from '../../net/showProtocol';
import type { ShowStore } from '../show/store';

export const answerText = (q: QuestionPublic, v: AnswerValue | null): string =>
  v === null ? '—' : Array.isArray(v) ? v.map((i) => q.options?.[i] ?? '?').join(' → ') : q.type === 'choice' ? (q.options?.[v] ?? '?') : String(v);

export function renderReveal(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const q = st.question!;
  const rv = st.reveal!;
  const mine = rv.results.find((r) => r.playerId === store.myId);
  root.replaceChildren(el('div', { class: 'show-panel' },
    el('p', { class: 'act' }, q.categoryLabel),
    el('h2', { style: 'font-family:var(--font);font-size:22px;color:var(--text);letter-spacing:0' }, q.prompt),
    el('div', { class: 'card-option right' }, el('span', { class: 'tag' }, 'ANSWER'), el('span', { class: 'title' }, answerText(q, rv.answer))),
    mine ? el('p', { class: 'countdown', style: `color:${mine.delta >= 0 ? 'var(--gold)' : 'var(--danger)'}` }, `${mine.correct ? 'RIGHT' : 'WRONG'} · ${mine.delta >= 0 ? '+' : ''}${mine.delta}`) : null,
    el('p', { class: 'hint' }, rv.note),
  ));
}
```

- [ ] **Step 6: Router.** In `src/game/player/index.ts`:
  - Keep `const questionUi: QuestionUi = { questionId: '', order: [], num: '', wager: 0 };`.
  - Branch on `st.phase`:
    - `'getReady'`: `renderPlayerGetReady`.
    - `'pick'`: `renderPick`.
    - `'question'`: `renderQuestion(root, store, questionUi)`.
    - `'reveal'`: `renderReveal`.
    - Everything else stays as it is.
  - The existing 500 ms refresh interval should re-render during `getReady`, `pick` and `question` too, so the timers tick. Expand its condition to `['lobby', 'getReady', 'pick', 'question'].includes(phase)`.
  - The question view must not rebuild while the player is typing a number. Skip the interval re-render in `question` when `document.activeElement` is the number input, and update only the countdown text. Give the countdown span a `data-countdown` attribute and set its `textContent` directly.

- [ ] **Step 7: TV views.** Create:

```ts
// src/game/tv/getReady.ts
import { el } from '../../ui/dom';
import { ACT_TITLES } from '../../net/showProtocol';
import type { ShowStore } from '../show/store';
export function renderTvGetReady(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const n = Math.max(1, Math.ceil(store.secondsUntil(st.deadline)));
  root.replaceChildren(el('div', { class: 'tv-screen', style: 'justify-content:center' },
    st.round ? el('p', { class: 'act', style: 'font-size:44px' }, `${ACT_TITLES[st.round.act]} · ROUND ${st.round.index + 1} / ${st.rounds}`) : null,
    el('div', { style: 'width:360px;height:360px;border-radius:50%;border:10px solid var(--gold);display:flex;align-items:center;justify-content:center;background:var(--surface);box-shadow:0 0 80px rgba(245,197,66,.35)' }, el('span', { class: 'big-num', style: 'font-size:260px' }, String(n))),
    st.round?.boss ? el('p', { class: 'tv-url', style: 'border-color:var(--danger);color:#ff8a9e;font-family:var(--font-display);letter-spacing:4px;font-weight:400' }, 'BOSS ROUND') : null,
    el('p', { class: 'hint', style: 'font-size:22px' }, 'Hands on the paddle — everyone starts together'),
  ));
}
```

```ts
// src/game/tv/pick.ts
import { el } from '../../ui/dom';
import type { ShowStore } from '../show/store';
export function renderTvPick(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const pick = st.pick!;
  const p = st.players.find((x) => x.id === pick.pickerId);
  const secs = Math.ceil(store.secondsUntil(st.deadline));
  root.replaceChildren(el('div', { class: 'tv-screen', style: 'justify-content:center' },
    el('p', { class: 'hint', style: 'font-size:24px' }, `${p?.avatar ?? ''} ${p?.name ?? ''} cleared first`),
    el('h1', { class: 'tv-title', style: 'font-size:84px' }, 'PICK A CATEGORY'),
    el('div', { style: 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px;width:min(1180px,92vw)' },
      ...pick.options.map((c) => el('div', { class: 'card-option', style: 'min-height:220px' }, el('span', { class: 'tag' }, c.tag), el('span', { class: 'title', style: 'font-size:54px' }, c.label)))),
    el('p', { class: 'countdown' }, `${secs} s`),
  ));
}
```

```ts
// src/game/tv/question.ts
import { el } from '../../ui/dom';
import type { ShowStore } from '../show/store';
export function renderTvQuestion(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const q = st.question!;
  const secs = Math.ceil(store.secondsUntil(st.deadline));
  const waiting = st.players.filter((p) => p.inMatch && !p.answered).map((p) => p.name);
  root.replaceChildren(el('div', { class: 'tv-screen' },
    el('div', { style: 'display:flex;justify-content:space-between;width:100%' }, el('span', { class: 'act', style: 'font-size:36px' }, `${q.categoryLabel} · ${q.points} PTS`), el('span', { class: 'big-num', style: `font-size:72px;${secs <= 5 ? 'color:var(--danger)' : ''}` }, String(secs))),
    el('h1', { style: 'font-size:52px;max-width:1200px;margin:24px 0;font-weight:800' }, q.prompt),
    q.options ? el('div', { style: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;width:min(1200px,92vw)' }, ...q.options.map((o, i) => el('div', { class: 'card-option', style: 'min-height:90px' }, el('span', { class: 'tag' }, q.type === 'order' ? 'PUT IN ORDER' : String.fromCharCode(65 + i)), el('span', { class: 'title' }, o)))) : el('p', { class: 'countdown' }, 'TYPE A NUMBER — CLOSEST WINS'),
    el('p', { class: 'hint', style: 'font-size:22px' }, waiting.length ? `Waiting for answers: ${waiting.join(', ')}` : 'Everyone has answered'),
  ));
}
```

```ts
// src/game/tv/reveal.ts
import { el } from '../../ui/dom';
import { answerText } from '../player/reveal';
import type { ShowStore } from '../show/store';
export function renderTvReveal(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const q = st.question!;
  const rv = st.reveal!;
  root.replaceChildren(el('div', { class: 'tv-screen' },
    el('p', { class: 'act', style: 'font-size:32px' }, q.categoryLabel),
    el('h1', { style: 'font-size:40px;max-width:1200px;margin:0;font-weight:800' }, q.prompt),
    el('div', { class: 'card-option right', style: 'min-height:0;align-items:center' }, el('span', { class: 'tag' }, 'THE ANSWER'), el('span', { class: 'title', style: 'font-size:64px' }, answerText(q, rv.answer))),
    el('p', { class: 'hint', style: 'font-size:24px;max-width:1100px' }, rv.note),
    el('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;justify-content:center' }, ...rv.results.map((r) => {
      const p = st.players.find((x) => x.id === r.playerId);
      return el('div', { class: 'chip ready', style: `--c:${p?.color ?? '#fff'};font-size:22px;${r.correct ? '' : 'opacity:.6'}` }, `${p?.avatar ?? ''} ${p?.name ?? ''} · ${answerText(q, r.value)} · ${r.delta >= 0 ? '+' : ''}${r.delta}`);
    })),
  ));
}
```

In `src/game/tv/index.ts` `render()`, branch as follows:
- `'getReady'`: `renderTvGetReady`
- `'pick'`: `renderTvPick`
- `'question'`: `renderTvQuestion`
- `'reveal'`: `renderTvReveal`
- `'arena'`: an empty body, as today
- `intro`, `roundEnd` and `over`: standings

The lobby refresh interval must also re-render during `getReady`, `pick` and `question`.

In `src/game/tv/ticker.ts`, add these lines:
- `getReady`: `'3… 2… 1…'`
- `picked`: ``${who} picked ${ev.categoryId}``. The TV finds the category label from `state.pick?.options`. Pass the options in as an optional third argument `cats?: CategoryPublic[]` and fall back to the id.
- `answered`: ``${who} locked in an answer``
- `revealed`: `'The answer is out!'`
- `bought`: ``${who} bought ${ev.itemId} → ${target}``. Task 8 passes a name map for items. For now use the id.

The switch must stay exhaustive.

- [ ] **Step 8: Verify.** Run `npm run typecheck`, `npm test` and `npm run build`, and check that no Cyrillic slipped in. If a browser is available, run one round with a TV window and a player window (`PORT=18090`): 3-2-1 → arena → pick → question → reveal → round end.

- [ ] **Step 9: Commit** with the message `Put the pick, the question and the reveal on every screen`, plus the trailer.

---

### Task 7: Engine shop phase, act-3 discount, effects and bot shopping

**Files:**
- Create: `server/show/shop.js`, `server/show/shop.test.js`
- Modify: `server/show/engine.js`, `server/show/engine.test.js`

**Interfaces:**
- Produces:
  - `server/show/shop.js` exports:
    - `SHOP`: `{ [itemId]: { cost: number, target: 'self'|'rival' } }`, mirroring `src/core/shop.ts`.
    - `priceOf(itemId, act) → number`
    - `checkPurchase({ itemId, buyer, target, act, inMatchIds }) → string | null`. The string is an English error.
    - `botPurchase({ bot, players, act }) → { itemId, targetId } | null`
  - `ShowUp` gains `{k:'buy', itemId, targetId}`.
  - `ShowState.shop: { act: number, prices: Record<itemId, number> } | null`. It is non-null during the `shop` phase.
  - `PlayerPublic` gains:
    - `pending: string[]`: item ids bought *for* this player, which land next arena.
    - `effects: string[]`: items active in the current arena. Set at `beginGetReady` from `pending`, which is then cleared.
  - Server-to-client message: `{k:'purchaseError', error}` to the buyer.
  - Event: `'bought'` (`playerId`, `targetId`, `itemId`).

- [ ] **Step 1: Write the failing tests** (`server/show/shop.test.js`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHOP, priceOf, checkPurchase, botPurchase } from './shop.js';

test('the catalog mirrors src/core/shop.ts exactly', () => {
  const src = readFileSync(new URL('../../src/core/shop.ts', import.meta.url), 'utf8');
  const ts = {};
  for (const m of src.matchAll(/id: '(\w+)',[\s\S]*?cost: (\d+),[\s\S]*?target: '(self|rival)'/g)) ts[m[1]] = { cost: Number(m[2]), target: m[3] };
  assert.deepEqual(SHOP, ts);
});

test('act 3 makes rival debuffs 30% cheaper, never self items', () => {
  assert.equal(priceOf('sabotage', 2), 110);
  assert.equal(priceOf('sabotage', 3), 77);
  assert.equal(priceOf('extraLife', 3), 20);
});

test('purchase rules', () => {
  const buyer = { id: 'u1', coins: 100 };
  const ids = ['u1', 'u2'];
  assert.equal(checkPurchase({ itemId: 'extraLife', buyer, target: 'u1', act: 1, inMatchIds: ids }), null);
  assert.match(checkPurchase({ itemId: 'extraLife', buyer, target: 'u2', act: 1, inMatchIds: ids }), /yourself/);
  assert.match(checkPurchase({ itemId: 'repel', buyer, target: 'u1', act: 1, inMatchIds: ids }), /rival/);
  assert.match(checkPurchase({ itemId: 'sabotage', buyer, target: 'u2', act: 1, inMatchIds: ids }), /coins/);
  assert.match(checkPurchase({ itemId: 'nope', buyer, target: 'u1', act: 1, inMatchIds: ids }), /Unknown/);
  assert.match(checkPurchase({ itemId: 'repel', buyer: { id: 'u1', coins: 999 }, target: 'zz', act: 1, inMatchIds: ids }), /rival/);
});

test('the bot debuffs the leader with the cheapest item it can afford, else buys a life', () => {
  const players = [{ id: 'bot', coins: 130, score: 10, inMatch: true }, { id: 'u1', score: 500, inMatch: true }, { id: 'u2', score: 300, inMatch: true }];
  assert.deepEqual(botPurchase({ bot: players[0], players, act: 1 }), { itemId: 'repel', targetId: 'u1' });
  assert.deepEqual(botPurchase({ bot: { ...players[0], coins: 25 }, players, act: 1 }), { itemId: 'extraLife', targetId: 'bot' });
  assert.equal(botPurchase({ bot: { ...players[0], coins: 5 }, players, act: 1 }), null);
});
```

Add to `engine.test.js`:

```js
async function duoInShop() {
  const s = await startedDuo();
  s.setCoins('u1', 300); s.setCoins('u2', 300);
  await s.eng.handle('p1', { k: 'result', result: res({ bricks: 0 }) });
  await s.eng.handle('p2', { k: 'result', result: res({ bricks: 0 }) });
  await s.eng.handle('p1', { k: 'answer', value: 0 });
  await s.eng.handle('p2', { k: 'answer', value: 0 });
  s.advance(DUR.reveal + 0.1);
  return s;
}

test('after the reveal comes the shop; purchases cost coins and land next arena', async () => {
  const s = await duoInShop();
  assert.equal(s.eng.state().phase, 'shop');
  assert.equal(s.eng.state().shop.prices.sabotage, 110);
  await s.eng.handle('p1', { k: 'buy', itemId: 'sabotage', targetId: 'u2' });
  await s.eng.handle('p1', { k: 'buy', itemId: 'extraLife', targetId: 'u1' });
  let st = s.eng.state();
  assert.equal(st.players.find((p) => p.id === 'u1').coins, 300 - 110 - 20);
  assert.deepEqual(st.players.find((p) => p.id === 'u2').pending, ['sabotage']);
  s.advanceUntil((x) => x.phase === 'getReady');
  st = s.eng.state();
  assert.deepEqual(st.players.find((p) => p.id === 'u2').effects, ['sabotage']);
  assert.deepEqual(st.players.find((p) => p.id === 'u2').pending, []);
  assert.deepEqual(st.players.find((p) => p.id === 'u1').effects, ['extraLife']);
});

test('a bad purchase is refused with a reason, and coins stay', async () => {
  const s = await duoInShop();
  s.eng.drain();
  await s.eng.handle('p1', { k: 'buy', itemId: 'extraLife', targetId: 'u2' });
  assert.ok(s.eng.drain().some((o) => o.to === 'p1' && o.msg.k === 'purchaseError'));
  assert.equal(s.eng.state().players.find((p) => p.id === 'u1').coins, 300);
});

test('the last round skips the shop', async () => {
  const s = await startedDuo();
  s.jumpToRound(9);
  await s.eng.handle('p1', { k: 'result', result: res({ bricks: 0 }) });
  await s.eng.handle('p2', { k: 'result', result: res({ bricks: 0 }) });
  s.advanceUntil((x) => x.phase !== 'question');
  s.advanceUntil((x) => x.phase !== 'reveal');
  assert.equal(s.eng.state().phase, 'roundEnd');
});
```

Add a `setCoins(id, v)` test hook alongside `setScore`.

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Implement `server/show/shop.js`**

```js
/** Mirrors src/core/shop.ts (id, cost, target). The server runs plain Node,
 *  so the catalog is copied; shop.test.js fails if the two drift. */
export const SHOP = {
  extraLife: { cost: 20, target: 'self' },
  shield: { cost: 20, target: 'self' },
  superCharge: { cost: 20, target: 'self' },
  sabotage: { cost: 110, target: 'rival' },
  mirror: { cost: 190, target: 'rival' },
  brittle: { cost: 190, target: 'rival' },
  repel: { cost: 100, target: 'rival' },
  steel: { cost: 200, target: 'rival' },
  blind: { cost: 115, target: 'rival' },
  haste: { cost: 120, target: 'rival' },
  jam: { cost: 200, target: 'rival' },
  drain: { cost: 125, target: 'rival' },
  quake: { cost: 210, target: 'rival' },
};
export const ACT3_DEBUFF_DISCOUNT = 0.7;

export function priceOf(itemId, act) {
  const it = SHOP[itemId];
  if (!it) return Infinity;
  return act === 3 && it.target === 'rival' ? Math.ceil(it.cost * ACT3_DEBUFF_DISCOUNT) : it.cost;
}

export function checkPurchase({ itemId, buyer, target, act, inMatchIds }) {
  const it = SHOP[itemId];
  if (!it) return 'Unknown item.';
  if (it.target === 'self' && target !== buyer.id) return 'That one is for yourself only.';
  if (it.target === 'rival' && (target === buyer.id || !inMatchIds.includes(target))) return 'Pick a rival who is in the match.';
  if (buyer.coins < priceOf(itemId, act)) return 'Not enough coins.';
  return null;
}

export function botPurchase({ bot, players, act }) {
  const rivals = players.filter((p) => p.inMatch && p.id !== bot.id).sort((a, b) => b.score - a.score);
  const leader = rivals[0];
  if (leader) {
    const debuffs = Object.keys(SHOP).filter((id) => SHOP[id].target === 'rival').sort((a, b) => priceOf(a, act) - priceOf(b, act));
    const cheapest = debuffs.find((id) => priceOf(id, act) <= bot.coins);
    if (cheapest) return { itemId: cheapest, targetId: leader.id };
  }
  return bot.coins >= priceOf('extraLife', act) ? { itemId: 'extraLife', targetId: bot.id } : null;
}
```

Check the `SHOP` values against `src/core/shop.ts` before writing them. The mirror test is the authority.

- [ ] **Step 4: Engine.** In `engine.js`:
  - Add `pending: []` and `effects: []` to new player records, and expose both in `publicPlayer`.
  - In `startMatch`, reset `pending` and `effects` for every player.
  - `beginGetReady`: for each player in the match, set `p.effects = p.pending` and then `p.pending = []`.
  - `afterReveal()`: if this is the last round (`roundIdx === schedule.length - 1`), call `endRound()`. Otherwise:
    - set `phase = 'shop'` and `deadline = now() + DUR.shop * 1000`;
    - if the bot is in the match, run `botPurchase` once and apply it;
    - call `pushState()`.
  - `advancePhase`: `shop` goes to `endRound()`.
  - `state()`: add `shop: phase === 'shop' ? { act: act(), prices: Object.fromEntries(Object.keys(SHOP).map((id) => [id, priceOf(id, act())])) } : null`.
  - `handleMatch` case `'buy'`: accept only if `phase === 'shop'`, `who?.inMatch`, and `msg.for === undefined`. Call `checkPurchase`.
    - On an error, `out(peerId, { k: 'purchaseError', error })`.
    - Otherwise:
      - `who.coins -= priceOf(...)`
      - `players.get(msg.targetId).pending.push(msg.itemId)`
      - `event('bought', { playerId: who.id, targetId: msg.targetId, itemId: msg.itemId })`
      - `pushState()`
  - Add the `setCoins` test hook.

- [ ] **Step 5: Run the tests.** Run `npm test`. Everything passes.

- [ ] **Step 6: Commit** with the message `Open the shop after every reveal`, plus the trailer.

---

### Task 8: Shop screens and applying effects in the arena

**Files:**
- Create: `src/game/player/shop.ts`, `src/game/tv/shop.ts`
- Modify: `src/net/showProtocol.ts`, `src/game/show/store.ts`, `src/game/show/arenaRunner.ts`, `src/game/player/arena.ts`, `src/game/show/botRunner.ts`, `src/game/player/index.ts`, `src/game/tv/index.ts`, `src/game/tv/ticker.ts`

**Interfaces:**
- Consumes:
  - `SHOP_ITEMS` and `SHOP_LIST` from `src/core/shop.ts`: `name`, `icon`, `desc`, `target`, `effect`.
  - `applyCardEffectToArena` from `src/core/cardEffects.ts`.
  - Task 7's state fields.
- Produces:
  - `new ArenaRun(levelIndex, seconds, effects: ShopItemId[] = [])`. The run applies each item's `effect` right after it builds the arena.
  - `ShowStore.purchaseError: string`.

- [ ] **Step 1: Protocol and store.**
  - In `showProtocol.ts`, add `pending: string[]; effects: string[];` to `PlayerPublic`, `shop: { act: number; prices: Record<string, number> } | null` to `ShowState`, `| { k: 'buy'; itemId: string; targetId: string }` to `ShowUp`, and `| { k: 'purchaseError'; error: string }` to `ShowDown`.
  - In `store.ts`, add `purchaseError = ''`. On `purchaseError`, set it and emit. On any `state` whose phase is not `shop`, clear it.

- [ ] **Step 2: ArenaRun effects.** In `src/game/show/arenaRunner.ts`:

```ts
import { SHOP_ITEMS, type ShopItemId } from '../../core/shop';
import { applyCardEffectToArena } from '../../core/cardEffects';
// constructor(levelIndex: number, seconds: number, effects: string[] = [])
// after this.arena = new Arena(...):
for (const id of effects) {
  const item = SHOP_ITEMS[id as ShopItemId];
  if (item) applyCardEffectToArena(item.effect, this.arena);
}
this.livesAtStart = this.arena.lives;
```

`livesAtStart` is taken after the effects are applied, so an extra life is not counted as a loss.

In `src/game/player/arena.ts`, pass `store.me?.effects ?? []`. In `src/game/show/botRunner.ts`, pass the bot player's `effects`.

- [ ] **Step 3: Phone shop.** Create `src/game/player/shop.ts`. It keeps the chosen rival in a closure `ui` object, `ShopUi = { targetId: string | null }`:

```ts
import { button, el } from '../../ui/dom';
import { SHOP_LIST } from '../../core/shop';
import type { ShowStore } from '../show/store';

export interface ShopUi { targetId: string | null }

export function renderShop(root: HTMLElement, store: ShowStore, ui: ShopUi): void {
  const st = store.state!;
  const me = store.me!;
  const shop = st.shop!;
  const secs = Math.ceil(store.secondsUntil(st.deadline));
  const rivals = st.players.filter((p) => p.inMatch && p.id !== me.id);
  if (!ui.targetId || !rivals.some((r) => r.id === ui.targetId)) ui.targetId = rivals[0]?.id ?? null;
  const itemRow = (it: (typeof SHOP_LIST)[number]): HTMLElement => {
    const price = shop.prices[it.id] ?? it.cost;
    const target = it.target === 'self' ? me.id : ui.targetId;
    const b = button(`${it.icon} ${it.name} · ${price}`, () => { if (target) store.send({ k: 'buy', itemId: it.id, targetId: target }); }, 'card-option');
    b.disabled = !target || me.coins < price;
    b.title = it.desc;
    return b;
  };
  root.replaceChildren(el('div', { class: 'show-panel' },
    el('div', { class: 'row' }, el('span', { class: 'act' }, 'SHOP'), el('span', { class: 'countdown', style: 'font-size:30px' }, `${secs} s`)),
    el('h2', {}, `${me.coins} COINS`),
    store.purchaseError ? el('p', { class: 'error' }, store.purchaseError) : null,
    el('p', { class: 'act' }, 'FOR YOU'),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, ...SHOP_LIST.filter((i) => i.target === 'self').map(itemRow)),
    el('p', { class: 'act' }, 'FOR A RIVAL'),
    el('div', { class: 'roster' }, ...rivals.map((r) => {
      const c = button(`${r.avatar} ${r.name}`, () => { ui.targetId = r.id; renderShop(root, store, ui); }, `chip${ui.targetId === r.id ? ' ready' : ''}`);
      c.style.setProperty('--c', r.color);
      return c;
    })),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, ...SHOP_LIST.filter((i) => i.target === 'rival').map(itemRow)),
    me.pending.length ? el('p', { class: 'hint' }, `Coming at you next arena: ${me.pending.length} item(s)`) : null,
  ));
}
```

`.card-option` is sized for categories. Here add inline `style="min-height:64px;justify-content:center"` via `b.style.cssText`. Also check that `button()` in `src/ui/dom.ts` sets `class`: it takes `cls` as its third argument.

- [ ] **Step 4: TV shop.** Create `src/game/tv/shop.ts`: a coins table plus the last 6 purchases.

```ts
import { el } from '../../ui/dom';
import { SHOP_ITEMS, type ShopItemId } from '../../core/shop';
import type { ShowStore } from '../show/store';

export function renderTvShop(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const secs = Math.ceil(store.secondsUntil(st.deadline));
  const name = (id?: string): string => { const p = st.players.find((x) => x.id === id); return p ? `${p.avatar} ${p.name}` : '?'; };
  const buys = store.events.filter((e) => e.kind === 'bought').slice(-6).reverse();
  const ranked = st.players.filter((p) => p.inMatch).sort((a, b) => b.coins - a.coins);
  root.replaceChildren(el('div', { class: 'tv-screen' },
    el('div', { style: 'display:flex;justify-content:space-between;width:100%' }, el('h1', { class: 'tv-title', style: 'font-size:84px' }, 'SHOP IS OPEN'), el('span', { class: 'big-num', style: 'font-size:72px' }, String(secs))),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:40px;width:min(1200px,92vw);text-align:left' },
      el('ol', { class: 'standings big' }, ...ranked.map((p) => el('li', { style: `--c:${p.color}` }, `${p.avatar} ${p.name}`, el('span', {}, `${p.coins}`)))),
      el('div', { style: 'display:flex;flex-direction:column;gap:12px;font-size:24px' }, ...(buys.length ? buys.map((e) => el('div', {}, `${name(e.playerId)} → ${SHOP_ITEMS[e.itemId as ShopItemId]?.name ?? e.itemId} → ${name(e.targetId)}`)) : [el('p', { class: 'hint' }, 'Nobody has bought anything yet…')]))),
  ));
}
```

- [ ] **Step 5: Wire the router, TV and ticker.**
  - In the player router, `'shop'` goes to `renderShop(root, store, shopUi)`, and the refresh interval ticks during `shop`.
  - In the TV, `'shop'` goes to `renderTvShop`.
  - In `ticker.ts`, the `bought` case uses item names: ``${who} bought ${SHOP_ITEMS[ev.itemId as ShopItemId]?.name ?? ev.itemId} → ${targetName}``.

- [ ] **Step 6: Verify.** Run `npm run typecheck`, `npm test` and `npm run build`, and check for Cyrillic. If a browser is available, play two rounds with one player (bot opponent). Buy Sabotage for the bot and check that the bot's field shows the frost debuff in its next arena on the TV.

- [ ] **Step 7: Commit** with the message `Let players shop, and deliver what they bought`, plus the trailer.

---

### Task 9: Docs and end-to-end run

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `src/ui/manual.ts`

- [ ] **Step 1: Manual.** Replace `MANUAL_POINTS` with:

```ts
export const MANUAL_POINTS = [
  'Sign in as yourself (or create a player: name, avatar, 4-digit PIN) and press «I\'m ready».',
  'Every round starts on 3-2-1: a short arkanoid level for everyone at once. Clear it first to pick the quiz category.',
  'Then everyone answers the same question: quick right answers score more. In act 2 you can stake points; act 3 doubles them.',
  'Bricks earn coins. In the shop, buy a boost for yourself or a debuff for a rival — it lands in their next arena.',
  '10 rounds, three acts, two bosses: at the end of act 2 and in the finale. Most points wins.',
];
```

The alliance line comes back in stage 4.

- [ ] **Step 2: README and CLAUDE.md.**
  - README: update "How to play" (the new manual, verbatim) and the Status line, which becomes stages 1–3 of 7 done, with alliances, the AI host and more content still to come. Add a short "Question bank" section: files in `server/content/questions/*.json`, the schema from Task 4, validation on server start.
  - CLAUDE.md: document the phase pipeline, the helper modules `questions.js`/`shop.js`, the `SHOP` mirror test, the `DUR_QUESTION`/`ARENA_GRACE` mirrors, and that the answer never leaves the server before the reveal.

- [ ] **Step 3: Scripted e2e.** Put a throwaway script in the scratchpad and run it against `PORT=18092 node server/index.js`, using the `ws` client. It plays a full solo match against the bot: TV + player, register, ready. In every round:
  - wait for `arena` → send a cleared result;
  - on `pick` → pick the first option;
  - on `question` → answer 0 (or `[0,1,2]`, or `1` for number);
  - on `shop` → buy `extraLife` for yourself.

  Assert:
  1. the phases seen per round are exactly `getReady, arena, pick, question, reveal, shop, roundEnd`, and round 10 has no shop;
  2. no `state` message ever contains the key `answer` outside `reveal`: `JSON.stringify(state.question)` never matches `"answer"`;
  3. `effects` contains `extraLife` in the next round's `getReady`;
  4. the match reaches `over`.

  Delete `server/data` afterwards if the script created it. Print PASS/FAIL per check.

- [ ] **Step 4: Gates.** `npm run typecheck`, `npm test`, `npm run build`, and the Cyrillic grep all pass.

- [ ] **Step 5: Commit** with the message `Tell players about questions and the shop`, plus the trailer.

---

## Later stages (separate plans)

- **Stage 4:** alliances. Create, name, invite or join, rename, leave; at most 3 per alliance. Buffs go to allies, debuffs to non-allies, checked in `checkPurchase`. +50 to every member when all of them answer right.
- **Stage 5:** TV production. Spotlight tile, table reorder animation, confetti, QR code, host bar with `speechSynthesis`, `server/show/host.js` template lines.
- **Stage 6:** content. Grow the bank to ~60 questions about 42 projects and ~40 about tarot and runes, plus a generator. Add "about you" questions from a lobby questionnaire, and archive `jeopardy.json`.
- **Stage 7:** special inserts (vote, duel, revenge), optional Claude lines, and a stats page.
