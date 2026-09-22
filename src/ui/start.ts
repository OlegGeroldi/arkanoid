import type { Scene, SceneFactory } from '../app';
import { button, el } from './dom';
import { playerShowScene } from '../game/player';
import { tvShowScene } from '../game/tv';

/** «I'm playing» or «This is the TV». `?role=tv` / `?role=player` skip it. */
export const startScene: SceneFactory = (app): Scene => {
  app.overlay.classList.add('interactive');
  app.overlay.replaceChildren(el('div', { class: 'start' },
    el('h1', {}, 'ARCOQUIZ'),
    el('p', { class: 'hint' }, 'An arkanoid quiz show. Hosted by AI. Up to 10 players.'),
    button('🎮 I\'m playing', () => app.setScene(playerShowScene), 'btn primary large'),
    button('📺 This is the TV', () => app.setScene(tvShowScene), 'btn large'),
  ));
  return {
    update() {},
    draw(ctx, w, h) { ctx.fillStyle = '#071a20'; ctx.fillRect(0, 0, w, h); },
    dispose() { app.overlay.replaceChildren(); },
  };
};
