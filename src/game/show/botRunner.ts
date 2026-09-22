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
    const elapsed = (now - last) / 1000;
    last = now;
    const st = store.state;
    const botPlayer = st?.players.find((p) => p.isBot && p.inMatch);
    if (!st || !botPlayer || st.botHost !== net.selfId || st.phase !== 'arena' || !st.round) {
      run = null;
      roundKey = '';
      reported = false;
      return;
    }
    const key = `${st.round.index}`;
    if (key !== roundKey) { roundKey = key; run = new ArenaRun(st.round.levelIndex, st.round.seconds); reported = false; }
    if (!run || reported) return;
    // A backgrounded tab can starve this interval for a long stretch. Catch up
    // through the full gap in fixed chunks rather than dropping it on the
    // floor — ArenaRun.done naturally bounds this to the round's own clock,
    // and the safety cap below guards against a pathologically long gap.
    let dt = Math.min(elapsed, st.round.seconds + 1);
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
