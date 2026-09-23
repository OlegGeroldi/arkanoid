import type { App, Scene } from '../../app';
import { ShowStore } from '../show/store';
import { startBotRunner } from '../show/botRunner';
import { playerArenaScene } from './arena';
import type { ArenaResult, ShowState } from '../../net/showProtocol';
import { renderLogin } from './login';
import { renderLobby } from './lobby';
import { renderWait } from './wait';

/** The player's device. One store; the view follows the show's phase. An
 *  inner arena scene takes over the canvas while this player's arena runs. */
export function playerShowScene(app: App): Scene {
  const store = new ShowStore('player');
  const stopBots = startBotRunner(store);
  const loginUi = { picked: null as string | null, creating: false };
  let arena: Scene | null = null;
  let arenaRound = -1;
  let lastKey = '';
  /** This device's finished result for a round, kept so it can be re-sent if
   *  it went out while the socket was down (the server still shows null). */
  let finished: { round: number; result: ArenaResult } | null = null;
  let resentFor: ShowState | null = null;
  const report = (result: ArenaResult): void => {
    finished = { round: arenaRound, result };
    resentFor = store.state;
    store.send({ k: 'result', result });
  };

  function render(): void {
    const st = store.state;
    const me = store.me;
    // Round indices repeat across matches: only keep a result within its arena.
    if (st && st.phase !== 'arena') finished = null;
    if (st && st !== resentFor && st.phase === 'arena' && me?.inMatch && me.result === null
      && finished && st.round?.index === finished.round) {
      resentFor = st;
      store.send({ k: 'result', result: finished.result });
    }
    const myArena = st?.phase === 'arena' && me?.inMatch && !me.result && st.round;
    if (myArena && st.round!.index !== arenaRound) {
      arenaRound = st.round!.index;
      arena?.dispose();
      arena = playerArenaScene(app, store, report);
      return;
    }
    if (arena && !(st?.phase === 'arena' && me && !me.result)) { arena.dispose(); arena = null; }
    if (arena) return;

    // Rebuilding DOM on every change kills focus while typing a PIN: only
    // re-render the login view when what it shows actually changed.
    const key = !me ? `login:${store.accounts.length}:${store.authError}:${loginUi.picked}:${loginUi.creating}` : '';
    if (key && key === lastKey) return;
    lastKey = key;

    app.overlay.classList.add('interactive');
    const root = app.overlay;
    if (!st || !me) renderLogin(root, store, loginUi, () => { lastKey = ''; render(); });
    else if (st.phase === 'lobby') {
      renderLobby(root, store, () => {
        loginUi.picked = null;
        loginUi.creating = false;
        store.authError = '';
        store.logout();
      });
    }
    else renderWait(root, store);
  }

  const off = store.onChange(render);
  const countdownTimer = window.setInterval(() => { if (store.state?.countdownEnd && store.state.phase === 'lobby' && store.me) render(); }, 500);
  render();

  return {
    update(dt) { arena?.update(dt); },
    draw(ctx, w, h) {
      if (arena) arena.draw(ctx, w, h);
      else { ctx.fillStyle = '#071a20'; ctx.fillRect(0, 0, w, h); }
    },
    dispose() { off(); clearInterval(countdownTimer); stopBots(); arena?.dispose(); store.dispose(); app.overlay.replaceChildren(); },
  };
}
