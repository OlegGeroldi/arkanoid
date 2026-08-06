import { net } from '../net/client';
import type { CardId, TurnReport } from '../core/race';
import type { RaceSeat, RaceSnapshot, RaceUp } from '../net/raceProtocol';

/** The race's half of the wire. Everything the referee can say, as callbacks,
 *  and everything a client can say, as methods — so the scene never touches
 *  message shapes and the protocol never leaks into the rules. */

export interface RaceLogEntry {
  index: number;
  seat: number;
  /** Zero when the turn was burnt by a timeout: no die was thrown. */
  die: number;
  result: TurnReport | null;
  reversed: boolean;
}

export interface RaceHandlers {
  lobby?(seats: RaceSeat[], hostId: string): void;
  started?(seed: number, distance: number, seats: RaceSeat[]): void;
  turn?(seat: number, index: number): void;
  roll?(seat: number, index: number, die: number, result: TurnReport | null): void;
  card?(from: number, card: CardId): void;
  snapshot?(seat: number, snap: RaceSnapshot): void;
  timeout?(seat: number): void;
  resume?(data: { seed: number; distance: number; seats: RaceSeat[]; log: RaceLogEntry[]; turn: number; index: number }): void;
  over?(seat: number): void;
}

export class RaceNet {
  private off: (() => void) | null = null;

  constructor(private handlers: RaceHandlers) {
    this.off = net.onRace((raw) => this.dispatch(raw));
  }

  private dispatch(raw: unknown): void {
    const m = raw as Record<string, unknown> | null;
    if (!m || typeof m.k !== 'string') return;
    const h = this.handlers;
    switch (m.k) {
      case 'lobby':
        h.lobby?.(m.seats as RaceSeat[], String(m.hostId ?? ''));
        break;
      case 'started':
        h.started?.(Number(m.seed), Number(m.distance), m.seats as RaceSeat[]);
        break;
      case 'turn':
        h.turn?.(Number(m.seat), Number(m.index));
        break;
      case 'roll':
        h.roll?.(Number(m.seat), Number(m.index), Number(m.die), (m.result ?? null) as TurnReport | null);
        break;
      case 'card':
        h.card?.(Number(m.from), m.card as CardId);
        break;
      case 'snapshot':
        h.snapshot?.(Number(m.seat), m.snap as RaceSnapshot);
        break;
      case 'timeout':
        h.timeout?.(Number(m.seat));
        break;
      case 'resume':
        h.resume?.(m as unknown as Parameters<NonNullable<RaceHandlers['resume']>>[0]);
        break;
      case 'over':
        h.over?.(Number(m.seat));
        break;
      default:
        break;
    }
  }

  private send(msg: RaceUp | { k: 'resume' }): void {
    net.sendRace(msg);
  }

  claim(seats: { name: string; team: number | null }[]): void {
    this.send({ k: 'claim', seats });
  }

  leave(): void {
    this.send({ k: 'leave' });
  }

  start(distance: number): void {
    this.send({ k: 'start', distance });
  }

  /** Asks the referee for the whole race so far — how a reloaded tab catches up. */
  resume(): void {
    this.send({ k: 'resume' });
  }

  reportResult(result: TurnReport): void {
    this.send({ k: 'result', result });
  }

  endTurn(reversed: boolean): void {
    this.send({ k: 'turnEnd', reversed });
  }

  throwCard(from: number, card: CardId): void {
    this.send({ k: 'card', from, card });
  }

  sendSnapshot(snap: RaceSnapshot): void {
    this.send({ k: 'snapshot', snap });
  }

  dispose(): void {
    this.off?.();
    this.off = null;
  }
}
