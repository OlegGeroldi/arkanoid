import type { JeopardyData } from '../core/jeopardy';

/** Thin fetch wrappers around `/api/jeopardy` (`server/jeopardyStore.js`) —
 *  same shape as the party quiz's own `fetch('/api/cards')` + `PUT`. Used by
 *  every screen that needs to read the board (admin, team) and by the
 *  standalone content editor that can write it. */

export async function fetchJeopardy(): Promise<JeopardyData> {
  const res = await fetch('/api/jeopardy');
  if (!res.ok) throw new Error('Не удалось загрузить квиз.');
  return (await res.json()) as JeopardyData;
}

export async function saveJeopardy(data: JeopardyData): Promise<void> {
  const res = await fetch('/api/jeopardy', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Не удалось сохранить квиз.');
  }
}
