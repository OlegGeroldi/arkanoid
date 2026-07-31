import { TICK } from '../core/constants';
import type { ArenaInput } from '../core/arena';

/** Edge-triggered fields must only fire on the first sub-step of a frame,
 *  otherwise one key tap would be consumed several times. */
export function edgeOnce(input: ArenaInput, first: boolean): ArenaInput {
  return first ? input : { ...input, actionPressed: false, superPressed: false, pick: 0 };
}

/** Fixed-timestep driver shared by every mode. `first` is true for the leading
 *  sub-step of a frame — that is when edge-triggered input should be applied. */
export class FixedStepper {
  private acc = 0;

  step(dt: number, run: (dt: number, first: boolean) => void): void {
    this.acc = Math.min(this.acc + dt, 0.35);
    let first = true;
    while (this.acc >= TICK) {
      run(TICK, first);
      this.acc -= TICK;
      first = false;
    }
    // A frame shorter than a single tick still has to deliver its edge events.
    if (first) run(0, true);
  }
}
