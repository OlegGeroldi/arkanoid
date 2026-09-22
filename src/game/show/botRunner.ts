import { Bot } from '../../core/bot';
import { net } from '../../net/client';
import { ArenaRun } from './arenaRunner';
import type { ShowStore } from './store';

const STEP = 1 / 60;

/** Plays the bot's arenas on whichever client the server named bot host.
 *  Runs on setInterval, not rAF, so a backgrounded TV tab keeps playing. */
export function startBotRunner(store: ShowStore): () => void {
  const bot = new Bot();
  let run: ArenaRun | null = null;
  let roundKey = '';
  let reported = false;
  let last = performance.now();

  const timer = window.setInterval(() => {
    const now = performance.now();
    let dt = Math.min(1, (now - last) / 1000);
    last = now;
    const st = store.state;
    const botPlayer = st?.players.find((p) => p.isBot && p.inMatch);
    if (!st || !botPlayer || st.botHost !== net.selfId || st.phase !== 'arena' || !st.round) { run = null; return; }
    const key = `${st.round.index}`;
    if (key !== roundKey) { roundKey = key; run = new ArenaRun(st.round.levelIndex, st.round.seconds); reported = false; }
    if (!run || reported) return;
    while (dt > 0 && !run.done) {
      const d = Math.min(STEP, dt);
      dt -= d;
      run.step(d, bot.think(run.arena, d));
      run.arena.drainEvents();
    }
    const snap = run.snapshot();
    if (snap) store.send({ k: 'snapshot', snap, for: 'bot' });
    if (run.done) { reported = true; store.send({ k: 'result', result: run.done, for: 'bot' }); }
  }, 50);

  return () => clearInterval(timer);
}
