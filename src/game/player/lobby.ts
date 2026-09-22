import { button, el } from '../../ui/dom';
import { manualEl } from '../../ui/manual';
import type { ShowStore } from '../show/store';

export function renderLobby(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const me = store.me!;
  const secs = Math.ceil(store.secondsUntil(st.countdownEnd));
  root.replaceChildren(el('div', { class: 'show-panel' },
    el('h2', {}, `${me.avatar} ${me.name}`),
    el('div', { class: 'roster' }, ...st.players.map((p) =>
      el('div', { class: `chip${p.ready ? ' ready' : ''}`, style: `--c:${p.color}` }, `${p.avatar} ${p.name}${p.ready ? ' ✓' : ''}`))),
    st.countdownEnd ? el('p', { class: 'countdown' }, `Starting in ${secs}`) : el('p', { class: 'hint' }, 'Waiting for everyone to press «Ready»'),
    button(me.ready ? 'Not ready' : 'Ready!', () => store.send({ k: 'ready', ready: !me.ready }), me.ready ? 'btn ghost large' : 'btn primary large'),
    manualEl(),
    button('Switch player', () => store.logout(), 'btn ghost small'),
  ));
}
