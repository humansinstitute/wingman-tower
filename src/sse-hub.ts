/**
 * SSE Hub — in-memory event fan-out and ring buffer for advisory
 * record/group change notifications to connected Flight Deck clients.
 *
 * Events are advisory: they tell clients what to refresh, but do not
 * grant read access. Visibility is enforced on the follow-up pull via
 * GET /api/v4/records, not at SSE emission time.
 *
 * See wingman-fd/docs/design/sse-updates.md for the full design.
 */

const EVENT_BUFFER_MAX = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_CONNECTION_LIFETIME_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_CONNECTIONS_PER_WORKSPACE = 50;
const MAX_CONNECTIONS_PER_USER = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SSEClient = {
  userNpub: string;
  ownerNpub: string;
  controller: ReadableStreamDefaultController;
  connectedAt: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  lifetimeTimer: ReturnType<typeof setTimeout> | null;
};

export type SSEEvent = {
  event: string;
  data: Record<string, unknown>;
};

type BufferedEvent = {
  id: number;
  ownerNpub: string;
  payload: string;
};

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------

class SSEHub {
  private clients = new Map<string, Set<SSEClient>>(); // keyed by ownerNpub
  private userClientCounts = new Map<string, number>(); // keyed by userNpub
  private eventId = 0;
  private eventBuffer: BufferedEvent[] = [];

  // --- client lifecycle ---

  canConnect(userNpub: string, ownerNpub: string): { ok: boolean; reason?: string } {
    const wsCount = this.clients.get(ownerNpub)?.size ?? 0;
    if (wsCount >= MAX_CONNECTIONS_PER_WORKSPACE) {
      return { ok: false, reason: `workspace connection limit (${MAX_CONNECTIONS_PER_WORKSPACE})` };
    }
    const userCount = this.userClientCounts.get(userNpub) ?? 0;
    if (userCount >= MAX_CONNECTIONS_PER_USER) {
      return { ok: false, reason: `per-user connection limit (${MAX_CONNECTIONS_PER_USER})` };
    }
    return { ok: true };
  }

  addClient(client: SSEClient) {
    const key = client.ownerNpub;
    if (!this.clients.has(key)) this.clients.set(key, new Set());
    this.clients.get(key)!.add(client);

    const userCount = this.userClientCounts.get(client.userNpub) ?? 0;
    this.userClientCounts.set(client.userNpub, userCount + 1);

    // Start heartbeat
    client.heartbeatTimer = setInterval(() => {
      this.sendRaw(client, `event: heartbeat\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
    }, HEARTBEAT_INTERVAL_MS);

    // Max lifetime — force reconnect with fresh auth
    client.lifetimeTimer = setTimeout(() => {
      this.removeClient(client);
    }, MAX_CONNECTION_LIFETIME_MS);
  }

  removeClient(client: SSEClient) {
    if (client.heartbeatTimer) {
      clearInterval(client.heartbeatTimer);
      client.heartbeatTimer = null;
    }
    if (client.lifetimeTimer) {
      clearTimeout(client.lifetimeTimer);
      client.lifetimeTimer = null;
    }
    try {
      client.controller.close();
    } catch {
      // already closed
    }
    this.clients.get(client.ownerNpub)?.delete(client);

    const userCount = this.userClientCounts.get(client.userNpub) ?? 0;
    if (userCount <= 1) {
      this.userClientCounts.delete(client.userNpub);
    } else {
      this.userClientCounts.set(client.userNpub, userCount - 1);
    }
  }

  // --- event emission ---

  emit(ownerNpub: string, event: SSEEvent) {
    this.eventId++;
    const payload = `id: ${this.eventId}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;

    // Buffer for replay
    this.eventBuffer.push({ id: this.eventId, ownerNpub, payload });
    while (this.eventBuffer.length > EVENT_BUFFER_MAX) {
      this.eventBuffer.shift();
    }

    // Fan out to connected clients
    const clients = this.clients.get(ownerNpub);
    if (!clients?.size) return;

    for (const client of clients) {
      this.sendRaw(client, payload);
    }
  }

  // --- replay ---

  canReplay(lastEventId: number): boolean {
    if (this.eventBuffer.length === 0) return lastEventId >= this.eventId;
    return this.eventBuffer[0].id <= lastEventId;
  }

  replayFrom(ownerNpub: string, lastEventId: number, controller: ReadableStreamDefaultController) {
    for (const event of this.eventBuffer) {
      if (event.id <= lastEventId) continue;
      if (event.ownerNpub !== ownerNpub) continue;
      try {
        controller.enqueue(new TextEncoder().encode(event.payload));
      } catch {
        break;
      }
    }
  }

  // --- diagnostics ---

  getClientCount(ownerNpub?: string): number {
    if (ownerNpub) return this.clients.get(ownerNpub)?.size ?? 0;
    let total = 0;
    for (const set of this.clients.values()) total += set.size;
    return total;
  }

  getCurrentEventId(): number {
    return this.eventId;
  }

  // --- internal ---

  private sendRaw(client: SSEClient, payload: string) {
    try {
      client.controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      this.removeClient(client);
    }
  }
}

export const sseHub = new SSEHub();
