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
