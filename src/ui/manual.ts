import { el } from './dom';

export const MANUAL_POINTS = [
  'Sign in as yourself (or create a player: name, avatar, 4-digit PIN) and press «Ready».',
  'Every round is a short arkanoid level: mouse or ←/→, Space to launch. Clear it first for a bonus.',
  'Points decide your place. Coins (from bricks) are spent in the shop between rounds.',
  'Alliances: team up to three, give it a name — buffs go to allies only, debuffs to everyone else.',
  '10 rounds in three acts, two bosses: at the end of act 2 and in the finale. Most points wins.',
];

export const manualEl = (): HTMLElement =>
  el('div', { class: 'manual' }, el('h3', {}, 'How to play'), el('ol', {}, ...MANUAL_POINTS.map((p) => el('li', {}, p))));
