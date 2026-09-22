import type { Scene, SceneFactory } from '../app';
import { el } from './dom';

/** Landing screen. Real choices arrive in Task 11. */
export const startScene: SceneFactory = (app): Scene => {
  app.overlay.classList.add('interactive');
  app.overlay.replaceChildren(el('div', { class: 'start' }, el('h1', {}, 'ARCOQUIZ'), el('p', {}, 'The show is getting ready…')));
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
