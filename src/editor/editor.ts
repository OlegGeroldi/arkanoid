import { App, type Scene } from '../app';
import { ARENA_W, BRICK_H, BRICK_W, COLS, ROWS } from '../core/constants';
import { BRICK_KINDS, BRICK_ORDER, EMPTY, isBrickCode, type BrickCode } from '../core/bricks';
import { breakableCount, cloneLevel, emptyRows, getCell, normalizeLevel, setCell, type LevelData } from '../core/level';
import {
  deleteUserLevel,
  loadUserLevels,
  newLevelId,
  setCampaignOverride,
  upsertUserLevel,
} from '../core/storage';
import { Backdrop } from '../render/backdrop';
import { soloScene } from '../game/campaign';
import { mainMenu } from '../ui/menu';
import { button, downloadJson, el, pickJsonFile } from '../ui/dom';

const CANVAS_W = ARENA_W;
const CANVAS_H = ROWS * BRICK_H + 76;

type Tool = 'brush' | 'erase' | 'row' | 'col' | 'fill';

const TOOL_LABELS: Record<Tool, string> = {
  brush: 'Кисть',
  erase: 'Ластик',
  row: 'Ряд',
  col: 'Столбец',
  fill: 'Заливка',
};

/** Grid level editor: paint bricks, play-test instantly, save to the browser or
 *  export the level as JSON. */
export function editorScene(app: App, initial?: LevelData): Scene {
  const backdrop = new Backdrop();

  let level: LevelData =
    initial ??
    ({
      id: newLevelId(),
      name: 'Новый уровень',
      author: app.profile.name,
      rows: emptyRows(),
      ballSpeed: 1,
      bg: 0,
    } satisfies LevelData);

  let campaignIndex = 0;
  let tool: Tool = 'brush';
  let paint: BrickCode = 'n';
  let painting = false;
  let undoStack: string[][] = [];
  let redoStack: string[][] = [];

  const canvas = el('canvas', { class: 'editor-canvas', width: String(CANVAS_W), height: String(CANVAS_H) });
  const ctx = canvas.getContext('2d')!;

  function snapshot(): void {
    undoStack.push(level.rows.slice());
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
  }

  function toast(text: string): void {
    const node = el('div', { class: 'toast' }, text);
    document.body.append(node);
    setTimeout(() => node.remove(), 2400);
  }

  // --------------------------------------------------------------- drawing --

  function cellFromEvent(e: PointerEvent): { col: number; row: number } | null {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * CANVAS_W;
    const y = ((e.clientY - r.top) / r.height) * CANVAS_H;
    const col = Math.floor(x / BRICK_W);
    const row = Math.floor(y / BRICK_H);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return { col, row };
  }

  function applyTool(col: number, row: number, erase: boolean): void {
    const ch = erase || tool === 'erase' ? EMPTY : paint;
    switch (tool) {
      case 'row':
        for (let c = 0; c < COLS; c++) setCell(level, c, row, ch);
        break;
      case 'col':
        for (let r = 0; r < ROWS; r++) setCell(level, col, r, ch);
        break;
      case 'fill':
        floodFill(col, row, ch);
        break;
      default:
        setCell(level, col, row, ch);
    }
    render();
  }

  function floodFill(col: number, row: number, ch: string): void {
    const target = getCell(level, col, row);
    if (target === ch) return;
    const queue: [number, number][] = [[col, row]];
    const seen = new Set<string>();
    while (queue.length) {
      const [c, r] = queue.pop()!;
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
      const key = `${c},${r}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (getCell(level, c, r) !== target) continue;
      setCell(level, c, r, ch);
      queue.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety; painting works without it */
    }
    snapshot();
    painting = true;
    applyTool(cell.col, cell.row, e.button === 2);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!painting || tool === 'fill') return;
    const cell = cellFromEvent(e);
    if (cell) applyTool(cell.col, cell.row, e.buttons === 2);
  });

  const stopPaint = (): void => {
    painting = false;
  };
  canvas.addEventListener('pointerup', stopPaint);
  canvas.addEventListener('pointercancel', stopPaint);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function drawGrid(): void {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#0b1024');
    g.addColorStop(1, '#070a16');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = 'rgba(120,160,220,0.14)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * BRICK_W, 0);
      ctx.lineTo(c * BRICK_W, ROWS * BRICK_H);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * BRICK_H);
      ctx.lineTo(CANVAS_W, r * BRICK_H);
      ctx.stroke();
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = getCell(level, c, r);
        if (!isBrickCode(ch)) continue;
        const kind = BRICK_KINDS[ch];
        const x = c * BRICK_W + 1.5;
        const y = r * BRICK_H + 1.5;
        ctx.save();
        ctx.shadowColor = kind.color;
        ctx.shadowBlur = 8;
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = kind.color;
        ctx.beginPath();
        ctx.roundRect(x, y, BRICK_W - 3, BRICK_H - 3, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.strokeStyle = kind.color;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Paddle preview so the author can judge the free space below the grid.
    ctx.fillStyle = 'rgba(77,226,255,0.55)';
    ctx.fillRect(CANVAS_W / 2 - 42, CANVAS_H - 22, 84, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('зона ракетки', CANVAS_W / 2, CANVAS_H - 30);
  }

  // ------------------------------------------------------------- overlay UI --

  function render(): void {
    drawGrid();
    const breakable = breakableCount(level);
    const userLevels = loadUserLevels();

    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen' },
        el(
          'div',
          { class: 'row between', style: 'margin-bottom:14px' },
          el('h2', { style: 'margin:0' }, 'Редактор уровней'),
          el(
            'div',
            { class: 'row' },
            el('span', { class: `pill ${breakable ? '' : 'pink'}` }, `Кирпичей: ${breakable}`),
            button('В меню', () => app.setScene(mainMenu), 'btn small ghost'),
          ),
        ),

        el(
          'div',
          { class: 'editor-wrap' },
          el('div', {}, canvas, el(
            'p',
            { class: 'hint' },
            'Левая кнопка — рисовать, правая — стирать. Уровень должен содержать хотя бы один разрушаемый кирпич.',
          )),

          el(
            'div',
            { class: 'col' },
            el('h3', {}, 'Кирпичи'),
            el(
              'div',
              { class: 'palette' },
              ...BRICK_ORDER.map((code) => {
                const kind = BRICK_KINDS[code];
                return el(
                  'div',
                  {
                    class: `swatch${paint === code && tool !== 'erase' ? ' selected' : ''}`,
                    title: kind.desc,
                    onclick: () => {
                      paint = code;
                      if (tool === 'erase') tool = 'brush';
                      render();
                    },
                  },
                  el('span', { class: 'chip', style: `background:${kind.color}` }),
                  kind.name,
                );
              }),
            ),

            el('h3', { style: 'margin-top:10px' }, 'Инструмент'),
            el(
              'div',
              { class: 'row', style: 'gap:6px' },
              ...(Object.keys(TOOL_LABELS) as Tool[]).map((id) =>
                button(
                  TOOL_LABELS[id],
                  () => {
                    tool = id;
                    render();
                  },
                  `btn small${tool === id ? ' primary' : ''}`,
                ),
              ),
            ),

            el('h3', { style: 'margin-top:10px' }, 'Уровень'),
            el(
              'label',
              { class: 'field' },
              'Название',
              el('input', {
                type: 'text',
                value: level.name,
                oninput: (e: Event) => {
                  level.name = (e.target as HTMLInputElement).value;
                },
              }),
            ),
            el(
              'label',
              { class: 'field' },
              `Скорость мяча: ${(level.ballSpeed ?? 1).toFixed(2)}×`,
              el('input', {
                type: 'number',
                step: '0.05',
                min: '0.5',
                max: '2.5',
                value: String(level.ballSpeed ?? 1),
                onchange: (e: Event) => {
                  level.ballSpeed = Number((e.target as HTMLInputElement).value) || 1;
                  render();
                },
              }),
            ),

            el(
              'div',
              { class: 'row', style: 'gap:6px;margin-top:6px' },
              button('Отменить', undo, 'btn small'),
              button('Вернуть', redo, 'btn small'),
              button('Зеркало', mirror, 'btn small'),
              button('Очистить', clearAll, 'btn small danger'),
            ),

            el(
              'div',
              { class: 'row', style: 'gap:6px;margin-top:10px' },
              button('▶ Тест', playtest, 'btn primary small'),
              button('Сохранить', save, 'btn small'),
              button('Новый', createNew, 'btn small'),
            ),
            el(
              'div',
              { class: 'row', style: 'gap:6px' },
              button('Экспорт JSON', exportLevel, 'btn small'),
              button('Импорт JSON', importLevel, 'btn small'),
            ),

            app.profile.admin ? adminCampaignSection() : null,

            el('h3', { style: 'margin-top:12px' }, `Мои уровни (${userLevels.length})`),
            el(
              'div',
              { class: 'col', style: 'gap:6px;max-height:190px;overflow:auto' },
              ...(userLevels.length
                ? userLevels.map((l) =>
                    el(
                      'div',
                      { class: 'row', style: 'gap:6px' },
                      button(
                        l.name,
                        () => {
                          level = cloneLevel(l);
                          undoStack = [];
                          redoStack = [];
                          render();
                        },
                        `btn small${l.id === level.id ? ' primary' : ''}`,
                      ),
                      button(
                        '✕',
                        () => {
                          deleteUserLevel(l.id);
                          toast('Уровень удалён');
                          render();
                        },
                        'btn small danger',
                      ),
                    ),
                  )
                : [el('p', { class: 'hint' }, 'Сохранённых уровней пока нет.')]),
            ),
          ),
        ),
      ),
    );
  }

  /** Admin-only: pull any campaign level in, edit it and store the result as an
   *  override. Generated levels come from a seed, so an edit cannot live in the
   *  generator — it has to sit on top of it. */
  function adminCampaignSection(): HTMLElement {
    const levels = app.campaignLevels();
    const edited = Object.keys(app.store.campaignOverrides).length;

    return el(
      'div',
      { class: 'col', style: 'gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,95,162,0.3)' },
      el(
        'div',
        { class: 'row between' },
        el('h3', { style: 'margin:0;color:var(--pink)' }, 'Уровни кампании'),
        el('span', { class: 'pill pink' }, `правок: ${edited}`),
      ),
      el(
        'label',
        { class: 'field' },
        'Номер уровня',
        el('input', {
          type: 'number',
          min: '1',
          max: String(levels.length),
          value: String(campaignIndex + 1),
          onchange: (e: Event) => {
            const n = Number((e.target as HTMLInputElement).value) || 1;
            campaignIndex = Math.min(Math.max(n - 1, 0), levels.length - 1);
            render();
          },
        }),
      ),
      el('p', { class: 'hint', style: 'margin:0' }, `${levels[campaignIndex].name}${app.store.campaignOverrides[String(campaignIndex)] ? ' · изменён' : ''}`),
      el(
        'div',
        { class: 'row', style: 'gap:6px' },
        button(
          'Загрузить',
          () => {
            level = cloneLevel(levels[campaignIndex]);
            undoStack = [];
            redoStack = [];
            toast(`Загружен уровень ${campaignIndex + 1}`);
            render();
          },
          'btn small',
        ),
        button(
          'Записать в кампанию',
          () => {
            if (breakableCount(level) === 0) {
              toast('Нужен хотя бы один разрушаемый кирпич');
              return;
            }
            const saved = { ...cloneLevel(level), id: `campaign-${campaignIndex + 1}` };
            setCampaignOverride(app.store, campaignIndex, saved);
            app.commitStore();
            toast(`Уровень ${campaignIndex + 1} заменён`);
            render();
          },
          'btn small primary',
        ),
        app.store.campaignOverrides[String(campaignIndex)]
          ? button(
              'Сброс',
              () => {
                setCampaignOverride(app.store, campaignIndex, null);
                app.commitStore();
                toast('Возвращён исходный уровень');
                render();
              },
              'btn small danger',
            )
          : null,
      ),
    );
  }

  // -------------------------------------------------------------- commands --

  function undo(): void {
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(level.rows.slice());
    level.rows = prev;
    render();
  }

  function redo(): void {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(level.rows.slice());
    level.rows = next;
    render();
  }

  function mirror(): void {
    snapshot();
    // Mirror the left half onto the right half.
    level.rows = level.rows.map((row) => {
      let out = '';
      for (let c = 0; c < COLS; c++) {
        const src = c < COLS / 2 ? c : COLS - 1 - c;
        out += row[src] ?? EMPTY;
      }
      return out;
    });
    render();
  }

  function clearAll(): void {
    snapshot();
    level.rows = emptyRows();
    render();
  }

  function createNew(): void {
    level = {
      id: newLevelId(),
      name: 'Новый уровень',
      author: app.profile.name,
      rows: emptyRows(),
      ballSpeed: 1,
      bg: 0,
    };
    undoStack = [];
    redoStack = [];
    render();
  }

  function save(): void {
    if (breakableCount(level) === 0) {
      toast('Нужен хотя бы один разрушаемый кирпич');
      return;
    }
    upsertUserLevel(cloneLevel(level));
    toast(`Сохранено: ${level.name}`);
    render();
  }

  function playtest(): void {
    if (breakableCount(level) === 0) {
      toast('Сначала нарисуйте кирпичи');
      return;
    }
    const testLevel = cloneLevel(level);
    app.setScene((a) =>
      soloScene(a, {
        levels: [testLevel],
        superId: app.profile.favouriteSuper,
        title: 'Тест уровня',
        onExit: (a2) => editorScene(a2, testLevel),
      }),
    );
  }

  function exportLevel(): void {
    downloadJson(`${level.name.replace(/[^\wа-яА-Я -]+/g, '_')}.json`, level);
  }

  async function importLevel(): Promise<void> {
    const raw = await pickJsonFile();
    const parsed = normalizeLevel(raw, newLevelId());
    if (!parsed) {
      toast('Не удалось прочитать файл уровня');
      return;
    }
    snapshot();
    level = { ...parsed, id: newLevelId() };
    toast(`Загружено: ${level.name}`);
    render();
  }

  render();

  return {
    update(dt) {
      backdrop.update(dt);
      if (app.input.wasPressed(['Escape'])) app.setScene(mainMenu);
    },
    draw(ctx2, w, h) {
      backdrop.draw(ctx2, w, h);
    },
    dispose() {
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };
}
