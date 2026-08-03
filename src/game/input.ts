import type { ArenaInput } from '../core/arena';

export interface Bindings {
  left: string[];
  right: string[];
  action: string[];
  super: string[];
  /** Active skill slots 1 and 2. */
  skills: [string[], string[]];
  picks: [string[], string[], string[]];
  /** Solo/campaign only: the mouse steers the paddle. */
  mouse?: boolean;
}

export const SOLO_KEYS: Bindings = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  action: ['Space', 'KeyW', 'ArrowUp'],
  super: ['ShiftLeft', 'ShiftRight'],
  skills: [['KeyQ'], ['KeyE']],
  picks: [['Digit1', 'Numpad1'], ['Digit2', 'Numpad2'], ['Digit3', 'Numpad3']],
  mouse: true,
};

export const P1_KEYS: Bindings = {
  left: ['KeyA'],
  right: ['KeyD'],
  action: ['KeyW'],
  super: ['KeyS'],
  skills: [['KeyQ'], ['KeyE']],
  picks: [['Digit1'], ['Digit2'], ['Digit3']],
};

export const P2_KEYS: Bindings = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  action: ['ArrowUp'],
  super: ['ArrowDown', 'Slash'],
  skills: [['Comma'], ['Period']],
  picks: [
    ['Digit8', 'Numpad1'],
    ['Digit9', 'Numpad2'],
    ['Digit0', 'Numpad3'],
  ],
};

/** Keys that steer a paddle — pressing one takes control away from the mouse. */
const MOVEMENT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD']);

/** Physical-key code for an event. Some environments (remote input, a few
 *  virtual keyboards) send an empty `code`, so fall back to deriving one from
 *  `key` — layout-independent bindings still work everywhere else. */
function codeOf(e: KeyboardEvent): string {
  if (e.code) return e.code;
  const k = e.key;
  if (k === ' ' || k === 'Spacebar') return 'Space';
  if (k.length === 1) {
    if (/[a-zA-Z]/.test(k)) return `Key${k.toUpperCase()}`;
    if (/[0-9]/.test(k)) return `Digit${k}`;
    if (k === '/') return 'Slash';
  }
  if (k === 'Shift') return 'ShiftLeft';
  return k; // Escape, ArrowLeft, ... already match their code
}

/** Central keyboard/mouse state. Edge-triggered presses are consumed once per
 *  simulation frame so a tap can never be read twice. */
export class InputHub {
  private down = new Set<string>();
  private pressedNow = new Set<string>();
  /** Pointer position in canvas CSS pixels; null until the mouse moves. */
  pointer: { x: number; y: number } | null = null;
  pointerDown = false;
  clicked = false;
  /** Whichever device was used last owns the paddle: pressing a movement key
   *  hands control to the keyboard, moving the mouse takes it back. */
  private pointerOwns = false;
  /** True while the pointer is captured by the canvas. Captured, the mouse
   *  cannot wander into the browser chrome or off-screen mid-rally. */
  locked = false;

  constructor(private target: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('touchstart', this.onTouch, { passive: false });
    target.addEventListener('touchmove', this.onTouch, { passive: false });
    target.addEventListener('touchend', this.onTouchEnd);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  /** Asks the browser to hand the mouse over to the game. Silently ignored when
   *  the gesture requirement is not met — play continues with a free cursor. */
  lockPointer(): void {
    if (this.locked) return;
    void this.target.requestPointerLock?.();
  }

  releasePointer(): void {
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  private onLockChange = (): void => {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.target;
    // Escape is swallowed by the browser to release the pointer, so the game
    // would never see it. Treat losing the capture as the pause key instead.
    if (was && !this.locked) this.injectKey('Escape');
  };

  /** Feeds a synthetic press into this frame's edge-triggered input. */
  injectKey(code: string): void {
    this.pressedNow.add(code);
  }

  dispose(): void {
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.releasePointer();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.target.removeEventListener('touchstart', this.onTouch);
    this.target.removeEventListener('touchmove', this.onTouch);
    this.target.removeEventListener('touchend', this.onTouchEnd);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const code = codeOf(e);
    // Arrows/space scroll the page otherwise.
    if (code.startsWith('Arrow') || code === 'Space') e.preventDefault();
    this.down.add(code);
    this.pressedNow.add(code);
    if (MOVEMENT_KEYS.has(code)) this.pointerOwns = false;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(codeOf(e));
  };

  private onBlur = (): void => {
    this.down.clear();
  };

  private setPointer(clientX: number, clientY: number): void {
    const r = this.target.getBoundingClientRect();
    const next = { x: clientX - r.left, y: clientY - r.top };
    // Only a real move hands control back to the mouse — a stale hover must not
    // keep overriding the keyboard.
    if (!this.pointer || Math.abs(next.x - this.pointer.x) > 0.5 || Math.abs(next.y - this.pointer.y) > 0.5) {
      this.pointerOwns = true;
    }
    this.pointer = next;
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (this.locked) {
      // Captured: the OS pointer stands still, so movement is relative.
      const r = this.target.getBoundingClientRect();
      const x = (this.pointer?.x ?? r.width / 2) + e.movementX;
      this.pointer = { x: Math.min(Math.max(x, 0), r.width), y: this.pointer?.y ?? r.height / 2 };
      if (e.movementX !== 0) this.pointerOwns = true;
      return;
    }
    this.setPointer(e.clientX, e.clientY);
  };

  private onMouseDown = (e: MouseEvent): void => {
    this.setPointer(e.clientX, e.clientY);
    this.pointerDown = true;
    this.clicked = true;
  };

  private onMouseUp = (): void => {
    this.pointerDown = false;
  };

  private onTouch = (e: TouchEvent): void => {
    e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    this.setPointer(t.clientX, t.clientY);
    if (e.type === 'touchstart') {
      this.pointerDown = true;
      this.clicked = true;
    }
  };

  private onTouchEnd = (): void => {
    this.pointerDown = false;
  };

  isDown(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  wasPressed(codes: string[]): boolean {
    return codes.some((c) => this.pressedNow.has(c));
  }

  anyPressed(): boolean {
    return this.pressedNow.size > 0;
  }

  /** Call once per rendered frame, after the simulation has read its input. */
  endFrame(): void {
    this.pressedNow.clear();
    this.clicked = false;
  }

  /** Builds arena input. `pointerArenaX` is the mouse mapped into arena units by
   *  the caller (it knows the viewport layout), or null to ignore the mouse. */
  read(b: Bindings, pointerArenaX: number | null): ArenaInput {
    let pick: 0 | 1 | 2 | 3 = 0;
    if (this.wasPressed(b.picks[0])) pick = 1;
    else if (this.wasPressed(b.picks[1])) pick = 2;
    else if (this.wasPressed(b.picks[2])) pick = 3;

    const left = this.isDown(b.left);
    const right = this.isDown(b.right);
    const useMouse = b.mouse === true && this.pointerOwns && !left && !right;

    let skill: 0 | 1 | 2 = 0;
    if (this.wasPressed(b.skills[0])) skill = 1;
    else if (this.wasPressed(b.skills[1])) skill = 2;

    return {
      left,
      right,
      skill,
      pointer: useMouse ? pointerArenaX : null,
      actionPressed: this.wasPressed(b.action) || (b.mouse === true && this.clicked),
      superPressed: this.wasPressed(b.super),
      pick,
    };
  }
}
