export type NetStatus = 'offline' | 'connecting' | 'online';

type Listener = () => void;

/** Talks to the LAN server when the game is served from one.
 *
 *  Everything here is optional by design: opened from a file or GitHub Pages the
 *  game simply stays offline, and every feature that uses the network keeps its
 *  local behaviour. */
export class NetClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private retry = 0;
  private retryTimer: number | null = null;

  status: NetStatus = 'offline';
  selfId = '';
  room = '';
  name = '';
  /** Set when the page was not served by the room server. */
  unavailable = false;
  /** What the server admits it can do. An older server simply omits things, so
   *  a client newer than the server can say that out loud instead of failing
   *  silently. */
  features: string[] = [];

  supports(feature: string): boolean {
    return this.features.includes(feature);
  }

  /** ws:// address derived from where the page came from. */
  get url(): string {
    const loc = window.location;
    if (loc.protocol === 'file:') return '';
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${loc.host}`;
  }

  get shareUrl(): string {
    return window.location.origin;
  }

  connect(name: string, room = 'lobby'): void {
    this.name = name;
    this.room = room;
    if (!this.url) {
      this.unavailable = true;
      this.emit();
      return;
    }
    if (this.ws && (this.status === 'online' || this.status === 'connecting')) {
      this.send({ type: 'join', name, room });
      return;
    }
    this.open();
  }

  private open(): void {
    this.status = 'connecting';
    this.emit();

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.fail();
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.status = 'online';
      this.unavailable = false;
      this.retry = 0;
      this.send({ type: 'join', name: this.name, room: this.room });
      this.emit();
    });

    ws.addEventListener('message', (e) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }

      switch (msg.type) {
        case 'welcome':
          this.selfId = String(msg.id ?? '');
          this.features = Array.isArray(msg.features) ? (msg.features as string[]) : [];
          break;
        case 'teamquiz':
          for (const fn of this.teamQuizListeners) fn(msg.msg);
          break;
        default:
          break;
      }
      this.emit();
    });

    ws.addEventListener('close', () => this.fail());
    ws.addEventListener('error', () => ws.close());
  }

  /** Backs off and retries: a laptop that sleeps mid-game should reconnect on
   *  its own rather than needing a restart. */
  private fail(): void {
    this.ws = null;
    this.status = 'offline';
    this.emit();

    if (this.retryTimer !== null) return;
    const delay = Math.min(15000, 1000 * 2 ** this.retry++);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.name) this.open();
    }, delay);
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** The team quiz talks to its referee on its own channel rather than
   *  through a generic relay: the server has to read these, not just forward
   *  them. */
  sendTeamQuiz(msg: unknown): void {
    this.send({ type: 'teamquiz', msg });
  }

  onTeamQuiz(fn: (msg: unknown) => void): () => void {
    this.teamQuizListeners.add(fn);
    return () => this.teamQuizListeners.delete(fn);
  }

  private teamQuizListeners = new Set<(msg: unknown) => void>();

  disconnect(): void {
    this.name = '';
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.status = 'offline';
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export const net = new NetClient();
