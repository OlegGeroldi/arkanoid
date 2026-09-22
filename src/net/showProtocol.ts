import type { ArenaSnapshot } from './protocol';
import type { BossId } from '../core/bosses';

export type ShowPhase = 'lobby' | 'intro' | 'arena' | 'roundEnd' | 'over';

export interface ArenaResult {
  cleared: boolean;
  died: boolean;
  timeLeft: number;
  bricks: number;
  livesLost: number;
}

export interface AccountPublic {
  id: string;
  name: string;
  avatar: string;
  stats: { matches: number; wins: number; best: number };
}

export interface PlayerPublic {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
  inMatch: boolean;
  score: number;
  coins: number;
  result: ArenaResult | null;
  lastPoints: number;
}

export interface RoundPublic {
  index: number;
  act: 1 | 2 | 3 | 4;
  actRound: number;
  levelIndex: number;
  boss: BossId | null;
  seconds: number;
}

export interface ShowState {
  phase: ShowPhase;
  /** Server clock when this state was sent, for skew correction. */
  now: number;
  players: PlayerPublic[];
  round: RoundPublic | null;
  rounds: number;
  /** Epoch ms, server clock. */
  deadline: number | null;
  countdownEnd: number | null;
  botHost: string | null;
  tvCount: number;
}

export type ShowEventKind =
  | 'joined' | 'left' | 'ready' | 'matchStart' | 'roundStart'
  | 'cleared' | 'died' | 'timeout' | 'roundEnd' | 'matchOver';

export interface ShowEvent {
  kind: ShowEventKind;
  at: number;
  playerId?: string;
  place?: number;
  points?: number;
}

export type ShowUp =
  | { k: 'hello'; role: 'tv' | 'player' }
  | { k: 'accounts' }
  | { k: 'register'; name: string; avatar: string; pin: string }
  | { k: 'login'; id: string; pin: string }
  | { k: 'resume'; token: string }
  | { k: 'ready'; ready: boolean }
  | { k: 'result'; result: ArenaResult; for?: string }
  | { k: 'snapshot'; snap: ArenaSnapshot; for?: string }
  | { k: 'restart' };

export type ShowDown =
  | { k: 'accounts'; list: AccountPublic[] }
  | { k: 'auth'; ok: true; player: PlayerPublic; token: string }
  | { k: 'auth'; ok: false; error: string }
  | { k: 'state'; show: ShowState }
  | { k: 'event'; ev: ShowEvent }
  | { k: 'snapshot'; playerId: string; snap: ArenaSnapshot };

export const ACT_TITLES: Record<number, string> = { 1: 'ACT 1 · WARM-UP', 2: 'ACT 2 · HIGH STAKES', 3: 'ACT 3 · NO MERCY', 4: 'FINALE · BOSS' };
