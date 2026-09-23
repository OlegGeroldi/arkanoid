import { el } from '../../ui/dom';
import { ACT_TITLES } from '../../net/showProtocol';
import type { ShowStore } from '../show/store';

/** Intro, between-rounds and final table, big enough to read from the sofa. */
export function renderStandings(root: HTMLElement, store: ShowStore): void {
  const st = store.state!;
  const ranked = st.players.filter((p) => p.inMatch).sort((a, b) => b.score - a.score);
  const title = st.phase === 'intro' ? 'Tonight in the studio' : st.phase === 'over' ? '🏆 FINAL' : `Round ${(st.round?.index ?? 0) + 1} results`;
  const next = st.phase === 'roundEnd' && st.round && st.round.index + 1 < st.rounds ? `Next: round ${st.round.index + 2}` : '';
  root.replaceChildren(el('div', { class: 'tv-standings' },
    st.round ? el('p', { class: 'act' }, ACT_TITLES[st.round.act]) : null,
    el('h1', {}, title),
    el('ol', { class: 'standings big' }, ...ranked.map((p) =>
      el('li', { style: `--c:${p.color}` }, `${p.avatar} ${p.name}`, el('span', {}, `${p.score}${p.lastPoints ? `  +${p.lastPoints}` : ''}`)))),
    next ? el('p', { class: 'hint' }, next) : null,
  ));
}
