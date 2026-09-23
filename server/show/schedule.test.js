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
