import type { App, Scene } from '../../app';
import { ShowStore } from '../show/store';
import { startBotRunner } from '../show/botRunner';
import { playerArenaScene } from './arena';
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

  function render(): void {
    const st = store.state;
    const me = store.me;
    const myArena = st?.phase === 'arena' && me?.inMatch && !me.result && st.round;
    if (myArena && st.round!.index !== arenaRound) {
      arenaRound = st.round!.index;
      arena?.dispose();
      arena = playerArenaScene(app, store);
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
    else if (st.phase === 'lobby') renderLobby(root, store);
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
