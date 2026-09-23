import { Bot } from '../../core/bot';
import { net } from '../../net/client';
import { ArenaRun } from './arenaRunner';
import type { ShowStore } from './store';
import { ARENA_GRACE, type ArenaResult, type ShowState } from '../../net/showProtocol';

const STEP = 1 / 60;

/** Plays the bot's arenas on whichever client the server named bot host.
 *  Runs on setInterval, not rAF, so a backgrounded TV tab keeps playing. */
export function startBotRunner(store: ShowStore): () => void {
  const bot = new Bot();
  let run: ArenaRun | null = null;
  let roundKey = '';
  let reported = false;
  /** The bot's finished result per round, re-sent while the server still
   *  shows it as null (it may have gone out while the socket was down). */
  let finished: { round: number; result: ArenaResult } | null = null;
  let resentFor: ShowState | null = null;
  let last = performance.now();

  const timer = window.setInterval(() => {
    const now = performance.now();
    const elapsed = (now - last) / 1000;
    last = now;
    const st = store.state;
    const botPlayer = st?.players.find((p) => p.isBot && p.inMatch);
    if (!st || !botPlayer || st.botHost !== net.selfId || st.phase !== 'arena' || !st.round) {
      // Round indices repeat across matches: only keep a result within its arena.
      if (st && st.phase !== 'arena') finished = null;
      run = null;
      roundKey = '';
      reported = false;
      return;
    }
    if (finished?.round === st.round.index && botPlayer.result === null && st !== resentFor) {
      resentFor = st;
      store.send({ k: 'result', result: finished.result, for: 'bot' });
    }
    const key = `${st.round.index}`;
    if (key !== roundKey) {
      roundKey = key;
      // A host that joins mid-round follows the server clock.
      const seconds = Math.max(1, Math.min(st.round.seconds, store.secondsUntil(st.deadline) - ARENA_GRACE));
      run = new ArenaRun(st.round.levelIndex, seconds);
      reported = false;
    }
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
    if (run.done) {
      reported = true;
      finished = { round: st.round.index, result: run.done };
      resentFor = st;
      store.send({ k: 'result', result: run.done, for: 'bot' });
    }
  }, 50);

  return () => clearInterval(timer);
}
