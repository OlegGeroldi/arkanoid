import { App, fitBox, type Scene } from '../app';
import { ARENA_H, ARENA_W } from '../core/constants';
import type { LevelData } from '../core/level';
import { PinballTable, type PinInput } from '../core/pinball';
import { PROPS } from '../core/props';
import { ArenaFx } from '../render/fx';
import { FONT } from '../render/renderer';
import { drawTable } from '../render/pinballRender';
import { FixedStepper } from './stepper';
import { button, el } from '../ui/dom';
import { mainMenu } from '../ui/menu';
import { sfx } from '../audio/sfx';
import { music } from '../audio/music';

const HUD_W = 236;
const GAP = 16;
const SCENE_W = ARENA_W + GAP + HUD_W;
const SCENE_H = ARENA_H;

export interface PinballOptions {
  levels: LevelData[];
  startIndex?: number;
}

/** The table. Same bricks, same furniture, opposite physics — so it lives in
 *  its own scene with its own simulation and shares only the look. */
export function pinballScene(app: App, opts: PinballOptions): Scene {
  const levels = opts.levels.length ? opts.levels : [];
  let index = Math.min(Math.max(opts.startIndex ?? 0, 0), Math.max(levels.length - 1, 0));
  let table = new PinballTable(levels[index]);
  let fx = new ArenaFx();
  const stepper = new FixedStepper();
  let panelOpen = false;
  let t = 0;
  /** Tables cleared this run, which is the only score worth bragging about. */
  let cleared = 0;
  let best = 0;

  music.setScene('game');

  function read(): PinInput {
    const input = app.input;
    return {
      left: input.isDown(['KeyA', 'ArrowLeft']),
      right: input.isDown(['KeyD', 'ArrowRight']),
      plunger: input.isDown(['Space']),
    };
  }

  function panel(title: string, tone: string, lines: string[], actions: HTMLElement[]): void {
    panelOpen = true;
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen narrow' },
        el('h2', { class: 'race-headline', style: `color:${tone}` }, title),
        ...lines.map((l) => el('p', { class: 'hint' }, l)),
        el('div', { class: 'row', style: 'margin-top:18px' }, ...actions),
      ),
    );
  }

  function nextTable(): void {
    index = (index + 1) % Math.max(1, levels.length);
    const score = table.score;
    table = new PinballTable(levels[index]);
    table.score = score;
    fx = new ArenaFx();
    panelOpen = false;
    app.overlay.replaceChildren();
    app.overlay.classList.remove('interactive');
  }

  function onCleared(): void {
    cleared++;
    best = Math.max(best, table.score);
    app.saveProfile((p) => {
      p.bestScore = Math.max(p.bestScore, table.score);
      p.totalXp += Math.round(table.score / 20);
    });
    panel('СТОЛ ЗАЧИЩЕН', '#3ddc84', [
      `Счёт: ${table.score}. Столов подряд: ${cleared}.`,
      'Шары не сбрасываются — следующий стол играется тем, что осталось.',
    ], [
      button('Следующий стол', nextTable, 'btn primary'),
      button('В меню', () => app.setScene(mainMenu), 'btn ghost'),
    ]);
  }

  function onOver(): void {
    best = Math.max(best, table.score);
    app.saveProfile((p) => {
      p.bestScore = Math.max(p.bestScore, table.score);
      p.totalXp += Math.round(table.score / 20);
      p.runs += 1;
    });
    panel('ШАРЫ КОНЧИЛИСЬ', '#ff4d6d', [
      `Счёт: ${table.score}. Столов зачищено: ${cleared}.`,
      `Кирпичей осталось: ${table.remaining}.`,
    ], [
      button('Ещё раз', () => app.setScene((a) => pinballScene(a, opts)), 'btn primary'),
      button('В меню', () => app.setScene(mainMenu), 'btn ghost'),
    ]);
  }

  /** PinEvents are not ArenaEvents, so they are translated by hand rather than
   *  bent into a shape the arkanoid effects layer would accept. */
  function consume(): void {
    for (const e of table.drainEvents()) {
      switch (e.t) {
        case 'brick':
          fx.burst(e.x + table.brickW / 2, e.y + 9, e.color, e.big ? 10 : 4);
          sfx.play(e.big ? 'brick' : 'brickHard', table.combo);
          break;
        case 'prop':
          fx.ring(e.x, e.y, e.kind === 'bumper' ? 44 : 34, PROPS[e.kind].color);
          if (e.score >= 40) fx.text(e.x, e.y - 18, `+${e.score}`, PROPS[e.kind].color);
          sfx.play(e.kind === 'bumper' ? 'wall' : 'paddle', 4);
          break;
        case 'targetsDown':
          fx.text(ARENA_W / 2, 260, 'МИШЕНИ СБИТЫ +500', '#3ddc84');
          sfx.play('levelup');
          break;
        case 'flip':
          sfx.play('paddle');
          break;
        case 'launch':
          sfx.play('super');
          break;
        case 'wall':
          sfx.play('wall');
          break;
        case 'drain':
          fx.text(ARENA_W / 2, 300, 'ШАР УШЁЛ', '#ff4d6d');
          sfx.play('lifeLost');
          break;
        case 'cleared':
          sfx.play('cleared');
          onCleared();
          break;
        case 'over':
          sfx.play('dead');
          onOver();
          break;
      }
    }
  }

  function drawHud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(10,15,32,0.85)';
    ctx.strokeStyle = 'rgba(176,107,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 12);
    ctx.fill();
    ctx.stroke();

    const pad = 14;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#b06bff';
    ctx.font = `800 16px ${FONT}`;
    ctx.fillText('ПИНБОЛ', pad, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(`${table.level.name} · стол ${index + 1}`, pad, 44);

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(String(table.score).padStart(7, '0'), pad, 82);

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText('ШАРЫ', pad, 112);
    ctx.fillStyle = '#ff5fa2';
    ctx.font = `800 20px ${FONT}`;
    ctx.fillText('●'.repeat(Math.max(0, table.ballsLeft)), pad, 136);

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(`Кирпичей: ${table.remaining}`, pad, 164);
    ctx.fillText(`Столов зачищено: ${cleared}`, pad, 182);
    if (table.combo > 1) {
      ctx.fillStyle = '#ffd24d';
      ctx.font = `800 15px ${FONT}`;
      ctx.fillText(`Серия ×${table.combo}`, pad, 206);
    }
    if (table.locked > 0) {
      ctx.fillStyle = '#b06bff';
      ctx.font = `600 12px ${FONT}`;
      ctx.fillText(`Замков заперто: ${table.locked}`, pad, 228);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText('A / ← — левый флиппер', pad, h - 76);
    ctx.fillText('D / → — правый флиппер', pad, h - 58);
    ctx.fillText('Пробел — плунжер', pad, h - 40);
    ctx.fillText('Esc — в меню', pad, h - 22);
    ctx.restore();
  }

  return {
    update(dt) {
      t += dt;
      fx.update(dt);
      if (app.input.wasPressed(['Escape'])) {
        app.setScene(mainMenu);
        return;
      }
      if (panelOpen) return;

      const input = read();
      // The table takes no edge-triggered input: both flippers and the plunger
      // are held, so every substep gets the same reading.
      stepper.step(dt, (sdt) => table.update(sdt, input));
      consume();
    },

    draw(ctx, w, h) {
      ctx.save();
      fitBox(ctx, w, h, SCENE_W, SCENE_H);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, ARENA_W, ARENA_H);
      ctx.clip();
      drawTable(ctx, table, fx, t);
      ctx.restore();
      drawHud(ctx, ARENA_W + GAP, 0, HUD_W, SCENE_H);
      ctx.restore();
    },

    dispose() {
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };
}
