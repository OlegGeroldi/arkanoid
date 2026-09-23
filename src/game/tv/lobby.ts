import { el } from '../../ui/dom';
import { manualEl } from '../../ui/manual';
import { net } from '../../net/client';
import type { ShowStore } from '../show/store';

export function renderTvLobby(root: HTMLElement, store: ShowStore): void {
  const st = store.state;
  const players = (st?.players ?? []).filter((p) => p.connected);
  const humans = players.filter((p) => !p.isBot).length;
  const secs = Math.ceil(store.secondsUntil(st?.countdownEnd ?? null));
  root.replaceChildren(el('div', { class: 'tv-lobby' },
    el('h1', {}, 'ARCOQUIZ'),
    el('p', { class: 'tv-url' }, `Join at: ${net.shareUrl}`),
    el('div', { class: 'tv-roster' }, ...players.map((p) =>
      el('div', { class: `tv-seat${p.ready ? ' ready' : ''}`, style: `--c:${p.color}` },
        el('div', { class: 'tv-avatar' }, p.avatar), el('div', {}, p.name), el('div', { class: 'hint' }, p.ready ? 'ready' : '…')))),
    players.length ? null : el('p', { class: 'hint' }, 'Nobody yet — open the address on your phone'),
    st?.countdownEnd ? el('p', { class: 'countdown' }, `Starting in ${secs}`) : null,
    humans === 1 ? el('p', { class: 'hint' }, 'Just one player? 🤖 Bot will take them on.') : null,
    manualEl(),
  ));
}
