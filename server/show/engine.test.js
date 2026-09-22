import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShowEngine } from './engine.js';
import { DUR } from './constants.js';

function fakeAccounts() {
  const list = [
    { id: 'u1', name: 'Anya', avatar: '🦊', stats: { matches: 0, wins: 0, best: 0 } },
    { id: 'u2', name: 'Oleg', avatar: '🐸', stats: { matches: 0, wins: 0, best: 0 } },
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

test('un-readying the only ready player cancels the countdown', async () => {
  const { eng, advance } = setup();
  await login(eng, 'p1', 'u1');
  await login(eng, 'p2', 'u2');
  await eng.handle('p1', { k: 'ready', ready: true });
  assert.ok(eng.state().countdownEnd);
  assert.equal(eng.state().phase, 'lobby');
  await eng.handle('p1', { k: 'ready', ready: false });
  assert.equal(eng.state().countdownEnd, null);
  advance(DUR.countdown + 0.1);
  assert.equal(eng.state().phase, 'lobby');
});

test('the only ready player disconnecting cancels the countdown', async () => {
  const { eng, advance } = setup();
  await login(eng, 'p1', 'u1');
  await login(eng, 'p2', 'u2');
  await eng.handle('p1', { k: 'ready', ready: true });
  assert.ok(eng.state().countdownEnd);
  eng.disconnect('p1');
  assert.equal(eng.state().countdownEnd, null);
  advance(DUR.countdown + 0.1);
  assert.equal(eng.state().phase, 'lobby');
});

test('the solo bot gets a color no in-match player is using', async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, name: `N${i}`, avatar: '🦊', stats: {} }));
  let t = 1_000_000;
  const accounts = { ...fakeAccounts(), list: () => many, verify: (id) => many.find((a) => a.id === id) };
  const eng = createShowEngine({ now: () => t, accounts, seed: () => 7 });
  const advance = (s) => { t += s * 1000; eng.tick(); };
  for (let i = 0; i < 10; i++) await login(eng, `p${i}`, `x${i}`);
  await eng.handle('p0', { k: 'ready', ready: true });
  advance(DUR.countdown + 0.1);
  const st = eng.state();
  assert.equal(st.phase, 'intro');
  const bot = st.players.find((p) => p.isBot);
  const human = st.players.find((p) => p.id === 'x0');
  assert.ok(bot && bot.inMatch);
  assert.notEqual(bot.color, human.color);
});

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
