import type { App, Scene } from '../../app';
import { el } from '../../ui/dom';
import { SnapshotMirror } from '../../render/snapshotMirror';
import { ACT_TITLES, ARENA_GRACE } from '../../net/showProtocol';
import { ShowStore } from '../show/store';
import { startBotRunner } from '../show/botRunner';
import { drawArenaGrid } from './arenaGrid';
import { renderTvLobby } from './lobby';
import { renderStandings } from './standings';
import { tickerLine } from './ticker';

const TICKER_H = 64;
const HEADER_H = 70;

/** The TV: shows everything, controls nothing. Canvas grid of live arenas
 *  during a round; DOM for the lobby and tables; a ticker along the bottom. */
export function tvShowScene(app: App): Scene {
  const store = new ShowStore('tv');
  const stopBots = startBotRunner(store);
  const mirrors = new Map<string, SnapshotMirror>();
  const ticker = el('div', { class: 'tv-ticker' });
  const body = el('div', { class: 'tv-body' });
  app.overlay.classList.add('interactive');
  app.overlay.replaceChildren(body, ticker);

  const offSnap = store.onSnapshot((id, snap) => {
    let m = mirrors.get(id);
    if (!m) { m = new SnapshotMirror(); mirrors.set(id, m); }
    m.push(snap);
  });

  let lastRound = -1;
  function render(): void {
    const st = store.state;
    if (st?.round && st.round.index !== lastRound) { lastRound = st.round.index; for (const m of mirrors.values()) m.reset(); }
    ticker.replaceChildren(...store.events.slice(-4).map((ev) => el('span', { class: `tick ${ev.kind}` }, tickerLine(ev, st?.players ?? []))));
    if (!st || st.phase === 'lobby') renderTvLobby(body, store);
    else if (st.phase === 'arena') body.replaceChildren();
    else renderStandings(body, store);
  }
  const off = store.onChange(render);
  const clockTimer = window.setInterval(() => { if (store.state?.phase === 'lobby') render(); }, 500);
  render();

  return {
    update(dt) { for (const m of mirrors.values()) m.tick(dt); },
    draw(ctx, w, h) {
      ctx.fillStyle = '#071a20';
      ctx.fillRect(0, 0, w, h);
      const st = store.state;
      if (st?.phase !== 'arena' || !st.round) return;
      const racers = st.players.filter((p) => p.inMatch);
      const secs = Math.ceil(store.secondsUntil(st.deadline) - ARENA_GRACE);
      ctx.save();
      ctx.fillStyle = '#b06bff';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText(`${ACT_TITLES[st.round.act]} · ROUND ${st.round.index + 1}/${st.rounds}${st.round.boss ? ' · 👾 BOSS' : ''}`, 24, 44);
      ctx.textAlign = 'right';
      ctx.fillStyle = secs <= 10 ? '#ff4d6d' : '#ffd24d';
      ctx.fillText(`${Math.max(0, secs)} s`, w - 24, 44);
      const waiting = racers.filter((p) => !p.result).map((p) => p.name);
      ctx.textAlign = 'center';
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,242,255,0.7)';
      if (waiting.length && waiting.length < racers.length) ctx.fillText(`Waiting for: ${waiting.join(', ')}`, w / 2, 44);
      ctx.restore();
      drawArenaGrid(ctx, 0, HEADER_H, w, h - HEADER_H - TICKER_H, racers, mirrors);
    },
    dispose() { off(); offSnap(); clearInterval(clockTimer); stopBots(); store.dispose(); app.overlay.replaceChildren(); },
  };
}
