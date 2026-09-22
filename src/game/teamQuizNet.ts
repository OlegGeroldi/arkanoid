import { net } from '../net/client';
import type { CardEffect, CardId } from '../core/race';
import type { ShopItemId } from '../core/shop';
import type { TurnResult } from '../core/teamRace';
import type { RaceSnapshot } from '../net/raceProtocol';
import type {
  BroadcastState,
  BroadcastView,
  CurrentQuestion,
  SubmittedQuestion,
  TeamQuizRole,
  TeamQuizRosterTeam,
  TeamQuizRoundView,
  TeamQuizUp,
} from '../net/teamQuizProtocol';

/** The team quiz's half of the wire — same shape as `raceNet.ts`: everything
 *  the referee can say, as callbacks, and everything a client can say, as
 *  methods, so the scenes never touch message shapes directly. */

export interface TeamQuizHandlers {
  roster?(teams: TeamQuizRosterTeam[]): void;
  started?(seed: number, distance: number): void;
  round?(view: TeamQuizRoundView): void;
  cardRevealed?(cardId: string): void;
  jeopardyAwarded?(cardId: string, teamId: string, points: number): void;
  boostApplied?(cardId: string, teamId: string, effect: CardEffect): void;
  cardBanked?(cardId: string, teamId: string, boostCardId: CardId): void;
  roll?(teamId: string, round: number, order: number, die: number, result: TurnResult | null): void;
  snapshot?(teamId: string, snap: RaceSnapshot): void;
  purchase?(teamId: string, itemId: ShopItemId, targetTeamId: string | null): void;
  alliance?(racerId: string, allianceId: number | null): void;
  error?(message: string): void;
  over?(teamId: string): void;
  reset?(): void;
  jeopardyState?(revealed: string[], used: string[]): void;
  broadcastView?(state: BroadcastState): void;
  currentQuestion?(question: CurrentQuestion | null): void;
  answerSubmitted?(teamId: string): void;
  answersRevealed?(answers: Record<string, string>): void;
  questionSubmitted?(question: SubmittedQuestion): void;
  customQuestionShown?(question: SubmittedQuestion): void;
}

export class TeamQuizNet {
  private off: (() => void) | null = null;

  constructor(private handlers: TeamQuizHandlers) {
    this.off = net.onTeamQuiz((raw) => this.dispatch(raw));
  }

  private dispatch(raw: unknown): void {
    const m = raw as Record<string, unknown> | null;
    if (!m || typeof m.k !== 'string') return;
    const h = this.handlers;
    switch (m.k) {
      case 'roster':
        h.roster?.(m.teams as TeamQuizRosterTeam[]);
        break;
      case 'started':
        h.started?.(Number(m.seed), Number(m.distance));
        break;
      case 'round':
        h.round?.(m.view as TeamQuizRoundView);
        break;
      case 'cardRevealed':
        h.cardRevealed?.(String(m.cardId));
        break;
      case 'jeopardyAwarded':
        h.jeopardyAwarded?.(String(m.cardId), String(m.teamId), Number(m.points));
        break;
      case 'boostApplied':
        h.boostApplied?.(String(m.cardId), String(m.teamId), m.effect as CardEffect);
        break;
      case 'cardBanked':
        h.cardBanked?.(String(m.cardId), String(m.teamId), m.boostCardId as CardId);
        break;
      case 'roll':
        h.roll?.(String(m.teamId), Number(m.round), Number(m.order), Number(m.die), (m.result ?? null) as TurnResult | null);
        break;
      case 'snapshot':
        h.snapshot?.(String(m.teamId), m.snap as RaceSnapshot);
        break;
      case 'purchase':
        h.purchase?.(String(m.teamId), m.itemId as ShopItemId, (m.targetTeamId as string | undefined) ?? null);
        break;
      case 'alliance':
        h.alliance?.(String(m.racerId), (m.allianceId as number | null | undefined) ?? null);
        break;
      case 'error':
        h.error?.(String(m.message ?? ''));
        break;
      case 'over':
        h.over?.(String(m.teamId));
        break;
      case 'reset':
        h.reset?.();
        break;
      case 'jeopardyState':
        h.jeopardyState?.(m.revealed as string[], m.used as string[]);
        break;
      case 'broadcastView':
        h.broadcastView?.(m.state as BroadcastState);
        break;
      case 'currentQuestion':
        h.currentQuestion?.((m.question ?? null) as CurrentQuestion | null);
        break;
      case 'answerSubmitted':
        h.answerSubmitted?.(String(m.teamId));
        break;
      case 'answersRevealed':
        h.answersRevealed?.(m.answers as Record<string, string>);
        break;
      case 'questionSubmitted':
        h.questionSubmitted?.(m.question as SubmittedQuestion);
        break;
      case 'customQuestionShown':
        h.customQuestionShown?.(m.question as SubmittedQuestion);
        break;
      default:
        break;
    }
  }

  private send(msg: TeamQuizUp): void {
    net.sendTeamQuiz(msg);
  }

  hello(role: TeamQuizRole, teamId?: string): void {
    this.send({ k: 'hello', role, teamId });
  }

  addPlayer(name: string): void {
    this.send({ k: 'admin:addPlayer', name });
  }

  addTeam(name: string): void {
    this.send({ k: 'admin:addTeam', name });
  }

  removeTeam(teamId: string): void {
    this.send({ k: 'admin:removeTeam', teamId });
  }

  addMember(teamId: string, name: string, ai?: boolean): void {
    this.send({ k: 'admin:addMember', teamId, name, ai });
  }

  removeMember(teamId: string, memberId: string): void {
    this.send({ k: 'admin:removeMember', teamId, memberId });
  }

  setPilotOrder(teamId: string, order: string[]): void {
    this.send({ k: 'admin:setPilotOrder', teamId, order });
  }

  startMatch(distance: number): void {
    this.send({ k: 'admin:startMatch', distance });
  }

  nextRound(): void {
    this.send({ k: 'admin:nextRound' });
  }

  resetMatch(): void {
    this.send({ k: 'admin:resetMatch' });
  }

  revealCard(cardId: string): void {
    this.send({ k: 'admin:revealCard', cardId });
  }

  awardCard(cardId: string, teamId: string, points: number): void {
    this.send({ k: 'admin:awardCard', cardId, teamId, points });
  }

  applyBoost(cardId: string, teamId: string, effect: CardEffect): void {
    this.send({ k: 'admin:applyBoost', cardId, teamId, effect });
  }

  bankCard(cardId: string, boostCardId: CardId): void {
    this.send({ k: 'team:bankCard', cardId, boostCardId });
  }

  setBroadcastView(view: BroadcastView, focusTeamId?: string): void {
    this.send({ k: 'admin:setBroadcastView', view, focusTeamId });
  }

  revealAnswers(): void {
    this.send({ k: 'admin:revealAnswers' });
  }

  pickCustomQuestion(id: string): void {
    this.send({ k: 'admin:pickCustomQuestion', id });
  }

  submitAnswer(text: string): void {
    this.send({ k: 'team:submitAnswer', text });
  }

  submitQuestion(text: string): void {
    this.send({ k: 'team:submitQuestion', text });
  }

  reportResult(result: TurnResult): void {
    this.send({ k: 'pilot:result', result });
  }

  sendSnapshot(snap: RaceSnapshot): void {
    this.send({ k: 'pilot:snapshot', snap });
  }

  reportOver(): void {
    this.send({ k: 'pilot:over' });
  }

  purchase(itemId: ShopItemId, targetTeamId?: string): void {
    this.send({ k: 'team:purchase', itemId, targetTeamId });
  }

  joinAlliance(targetId: string): void {
    this.send({ k: 'player:joinAlliance', targetId });
  }

  leaveAlliance(): void {
    this.send({ k: 'player:leaveAlliance' });
  }

  dispose(): void {
    this.off?.();
    this.off = null;
  }
}
