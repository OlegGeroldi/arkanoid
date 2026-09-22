import { button, el } from '../../ui/dom';
import { ACT_TITLES } from '../../net/showProtocol';
import type { ShowStore } from '../show/store';

/** Everything that is not your own arena: intro, round results, waiting for
 *  others, and the final table. */
export function renderWait(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const me = store.me;
  const ranked = [...st.players].filter((p) => p.inMatch).sort((a, b) => b.score - a.score);
  const title =
    st.phase === 'intro' ? 'The show begins!'
    : st.phase === 'over' ? `Winner: ${ranked[0]?.avatar ?? ''} ${ranked[0]?.name ?? ''}`
    : st.phase === 'arena' ? 'Waiting for the others…'
    : `Round ${(st.round?.index ?? 0) + 1} results`;
  const waitingFor = st.phase === 'arena' ? ranked.filter((p) => !p.result).map((p) => p.name).join(', ') : '';
  root.replaceChildren(el('div', { class: 'show-panel' },
    st.round ? el('p', { class: 'act' }, ACT_TITLES[st.round.act]) : null,
    el('h2', {}, title),
    waitingFor ? el('p', { class: 'hint' }, `Waiting for: ${waitingFor}`) : null,
    el('ol', { class: 'standings' }, ...ranked.map((p) =>
      el('li', { class: p.id === me?.id ? 'me' : '', style: `--c:${p.color}` },
        `${p.avatar} ${p.name}`, el('span', {}, `${p.score}${p.lastPoints ? ` (+${p.lastPoints})` : ''}`)))),
    st.phase === 'over' ? button('Play again', () => store.send({ k: 'restart' }), 'btn primary large') : null,
  ));
}
