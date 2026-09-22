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
