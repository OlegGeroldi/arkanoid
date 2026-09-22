type Child = Node | string | null | undefined | false;

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** Tiny element helper — enough DOM sugar for the menus and the editor without
 *  pulling in a framework. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      node.className = String(v);
    } else if (k === 'html') {
      node.innerHTML = String(v);
    } else if (k === 'value' && node instanceof HTMLInputElement) {
      node.value = String(v);
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export const button = (label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement =>
  el('button', { class: cls, onclick: onClick }, label);

/** Flip-reveal card, ported from the standalone party quiz's rotateY card
 *  interface (`quizz/public/css/styles.css` `.card-flip`): mounted face-down
 *  and turned a frame later so the CSS transition actually plays. `settled`
 *  skips that flip-in when this exact card was already showing — every scene
 *  here rebuilds its whole tree on each unrelated event, so without this the
 *  animation would replay on every notify(), not just a genuinely new card. */
export function cardFlip(shown: boolean, settled: boolean, back: Child, front: Child): HTMLElement {
  const flip = el(
    'div',
    { class: `card-flip${shown && settled ? ' is-flipped' : ''}` },
    el('div', { class: 'card-face card-back' }, back),
    el('div', { class: 'card-face card-front' }, front),
  );
  if (shown && !settled) {
    requestAnimationFrame(() => requestAnimationFrame(() => flip.classList.add('is-flipped')));
  }
  return el('div', { class: 'card-stage' }, flip);
}

const DIE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/** Spins a die element through a few random faces before settling on the
 *  real result — purely cosmetic, the roll itself already happened; this
 *  just gives the number a beat to land on screen instead of appearing
 *  instantly. `onTick` fires on every spin frame (including the final,
 *  settled one) so a caller can layer a tick sound on top without this
 *  generic DOM helper knowing anything about audio itself. */
export function animateDieRoll(
  target: HTMLElement,
  finalFace: number,
  opts: { onDone?: () => void; onTick?: () => void; spins?: number; stepMs?: number } = {},
): void {
  const { onDone, onTick, spins = 8, stepMs = 140 } = opts;
  let i = 0;
  const tick = () => {
    target.textContent = i >= spins ? DIE_FACES[Math.min(5, Math.max(0, finalFace - 1))] : DIE_FACES[Math.floor(Math.random() * 6)];
    onTick?.();
    i++;
    if (i <= spins) setTimeout(tick, stepMs);
    else onDone?.();
  };
  tick();
}

/** Downloads a JSON blob (level export). */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens a file picker and resolves with parsed JSON, or null if cancelled. */
export function pickJsonFile(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept: 'application/json,.json' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(JSON.parse(await file.text()));
      } catch {
        resolve(null);
      }
    });
    input.click();
  });
}
