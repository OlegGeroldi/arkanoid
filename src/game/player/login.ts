import { button, el } from '../../ui/dom';
import type { ShowStore } from '../show/store';

const AVATARS = ['🦊', '🐸', '🐙', '🦉', '🐼', '🦄', '🐯', '🐨', '🦖', '🐝', '🐧', '🦁', '🐻', '🐳', '🦩', '🌵'];

/** Pick yourself from the list and type your PIN, or make a new player. */
export function renderLogin(root: HTMLElement, store: ShowStore, ui: { picked: string | null; creating: boolean }, rerender: () => void): void {
  const error = store.authError ? el('p', { class: 'error' }, store.authError) : null;

  if (ui.creating) {
    let avatar = AVATARS[0];
    const name = el('input', { class: 'field', placeholder: 'Name', maxlength: 16 });
    const pin = el('input', { class: 'field', placeholder: 'PIN (4 digits)', inputmode: 'numeric', maxlength: 4, type: 'password' });
    const grid = el('div', { class: 'avatar-grid' });
    const paint = (): void => {
      grid.replaceChildren(...AVATARS.map((a) => button(a, () => { avatar = a; paint(); }, a === avatar ? 'avatar picked' : 'avatar')));
    };
    paint();
    root.replaceChildren(el('div', { class: 'show-panel' },
      el('h2', {}, 'New player'), name, grid, pin, error,
      el('div', { class: 'row' },
        button('Back', () => { ui.creating = false; store.authError = ''; rerender(); }, 'btn ghost'),
        button('Create', () => store.send({ k: 'register', name: name.value, avatar, pin: pin.value }), 'btn primary large')),
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
      el('h2', {}, `${acc?.avatar ?? ''} ${acc?.name ?? ''}`), el('p', { class: 'hint' }, 'Enter your PIN'), pin, error,
      el('div', { class: 'row' },
        button('Back', () => { ui.picked = null; store.authError = ''; rerender(); }, 'btn ghost'),
        button('Sign in', go, 'btn primary large')),
    ));
    pin.focus();
    return;
  }

  root.replaceChildren(el('div', { class: 'show-panel' },
    el('h2', {}, 'Who is playing?'),
    el('div', { class: 'account-grid' },
      ...store.accounts.map((a) => button(`${a.avatar} ${a.name}`, () => { ui.picked = a.id; rerender(); }, 'account')),
      button('＋ New player', () => { ui.creating = true; rerender(); }, 'account new')),
    error,
  ));
}
