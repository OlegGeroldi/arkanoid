import { net } from '../../net/client';
import type { ArenaSnapshot } from '../../net/protocol';
import type { AccountPublic, PlayerPublic, ShowDown, ShowEvent, ShowState, ShowUp } from '../../net/showProtocol';

export const TOKEN_KEY = 'arcoquiz.token';
export const ROLE_KEY = 'arcoquiz.role';

const safeGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string | null): void => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ }
};

/** One client's mirror of the show: the server's public state plus the event
 *  feed, and a way to talk back. Scenes read it and re-render on change. */
export class ShowStore {
  state: ShowState | null = null;
  me: PlayerPublic | null = null;
  accounts: AccountPublic[] = [];
  authError = '';
  events: ShowEvent[] = [];
  /** Local ms minus server ms, from the last state. */
  skew = 0;

  private changeFns = new Set<() => void>();
  private snapFns = new Set<(playerId: string, snap: ArenaSnapshot) => void>();
  private off: Array<() => void> = [];

  constructor(readonly role: 'tv' | 'player') {
    safeSet(ROLE_KEY, role);
    this.off.push(net.onShow((raw) => this.receive(raw as ShowDown)));
    this.off.push(net.subscribe(() => {
      if (net.status !== 'online') this.greeted = false;
      if (net.status === 'online' && !this.greeted) this.greet();
    }));
    net.connect(role === 'tv' ? 'TV' : 'player', 'show');
    if (net.status === 'online') this.greet();
  }

  private greeted = false;
  private greet(): void {
    this.greeted = true;
    this.send({ k: 'hello', role: this.role });
    if (this.role === 'player') {
      const token = safeGet(TOKEN_KEY);
      if (token) this.send({ k: 'resume', token });
      this.send({ k: 'accounts' });
    }
  }

  get myId(): string | null { return this.me?.id ?? null; }

  /** Seconds until a server-clock deadline, never negative. */
  secondsUntil(serverMs: number | null): number {
    if (serverMs === null) return 0;
    return Math.max(0, (serverMs + this.skew - Date.now()) / 1000);
  }

  send(msg: ShowUp): void { net.sendShow(msg); }

  logout(): void { safeSet(TOKEN_KEY, null); this.me = null; this.emit(); }

  private receive(msg: ShowDown): void {
    switch (msg.k) {
      case 'accounts': this.accounts = msg.list; break;
      case 'auth':
        if (msg.ok) { this.me = msg.player; this.authError = ''; safeSet(TOKEN_KEY, msg.token); }
        else { this.authError = msg.error; if (msg.error.startsWith('Session')) safeSet(TOKEN_KEY, null); }
        break;
      case 'state':
        this.state = msg.show;
        this.skew = Date.now() - msg.show.now;
        if (this.me) this.me = msg.show.players.find((p) => p.id === this.me!.id) ?? this.me;
        break;
      case 'event':
        this.events = [...this.events.slice(-29), msg.ev];
        break;
      case 'snapshot':
        for (const fn of this.snapFns) fn(msg.playerId, msg.snap);
        return;
    }
    this.emit();
  }

  onChange(fn: () => void): () => void { this.changeFns.add(fn); return () => this.changeFns.delete(fn); }
  onSnapshot(fn: (id: string, s: ArenaSnapshot) => void): () => void { this.snapFns.add(fn); return () => this.snapFns.delete(fn); }
  private emit(): void { for (const fn of this.changeFns) fn(); }

  dispose(): void { for (const f of this.off) f(); this.changeFns.clear(); this.snapFns.clear(); }
}
