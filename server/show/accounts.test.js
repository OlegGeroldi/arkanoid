import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountStore, AccountError } from './accounts.js';

const fresh = async () => createAccountStore(await mkdtemp(join(tmpdir(), 'acc-')));

test('register then verify with the right PIN only', async () => {
  const s = await fresh();
  const a = await s.register({ name: 'Kate', avatar: '🦊', pin: '1234' });
  assert.equal(a.name, 'Kate');
  assert.deepEqual(a.stats, { matches: 0, wins: 0, best: 0 });
  assert.equal(s.verify(a.id, '1234')?.id, a.id);
  assert.equal(s.verify(a.id, '9999'), null);
  assert.equal(s.verify('nope', '1234'), null);
});

test('rejects bad names, bad pins, duplicate names', async () => {
  const s = await fresh();
  await s.register({ name: 'Oleg', avatar: '🐸', pin: '0000' });
  await assert.rejects(s.register({ name: 'oleg', avatar: '🐸', pin: '1111' }), AccountError);
  await assert.rejects(s.register({ name: '', avatar: '🐸', pin: '1111' }), AccountError);
  await assert.rejects(s.register({ name: 'x'.repeat(17), avatar: '🐸', pin: '1111' }), AccountError);
  await assert.rejects(s.register({ name: 'Anya', avatar: '🐸', pin: '12a4' }), AccountError);
  await assert.rejects(s.register({ name: 'Bot', avatar: '🐸', pin: '1234' }), AccountError);
});

test('persists across reloads and never stores the PIN', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acc-'));
  const s1 = await createAccountStore(dir);
  const a = await s1.register({ name: 'Anya', avatar: '🦉', pin: '4321' });
  await s1.recordMatch(a.id, { won: true, score: 900 });
  const raw = await readFile(join(dir, 'players.json'), 'utf8');
  assert.ok(!raw.includes('4321'));
  const s2 = await createAccountStore(dir);
  assert.deepEqual(s2.list()[0].stats, { matches: 1, wins: 1, best: 900 });
  assert.ok(s2.verify(a.id, '4321'));
});
