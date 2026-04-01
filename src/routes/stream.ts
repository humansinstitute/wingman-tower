/**
 * SSE stream endpoint for real-time record/group change notifications.
 *
 * GET /api/v4/workspaces/:ownerNpub/stream?token=<base64>&last_event_id=<cursor>
 *
 * Auth: NIP-98 token passed as query param (signed by workspace session key).
 * The token is validated once on connect; the stream stays open without re-auth.
 *
 * See wingman-fd/docs/design/sse-updates.md for full design.
 */

import { Hono } from 'hono';
import { verifyNip98AuthHeader } from '../auth';
import { resolveWsKeyNpub } from '../services/user-workspace-keys';
import { sseHub } from '../sse-hub';
import type { SSEClient } from '../sse-hub';

export const streamRouter = new Hono();

streamRouter.get('/:ownerNpub/stream', async (c) => {
  const ownerNpub = c.req.param('ownerNpub');
  const token = c.req.query('token');
  const lastEventIdParam = c.req.query('last_event_id');

  if (!token) {
    return c.text('Missing token', 401);
  }

  // Validate NIP-98 token from query param.
  // Build a synthetic Authorization header for the existing verifier.
  const authHeader = `Nostr ${token}`;
  const signerNpub = await verifyNip98AuthHeader(authHeader, c.req.raw);
  if (!signerNpub) {
    return c.text('Invalid or expired token', 401);
  }

  // Resolve workspace session key to real user npub
  const resolvedUserNpub = await resolveWsKeyNpub(signerNpub);
  const userNpub = resolvedUserNpub ?? signerNpub;

  // Check connection limits
  const check = sseHub.canConnect(userNpub, ownerNpub);
  if (!check.ok) {
    return c.text(check.reason || 'Connection limit reached', 429);
  }

  // Parse last_event_id for replay
  const lastEventId = lastEventIdParam ? parseInt(lastEventIdParam, 10) : null;

  // Hoist the client reference so cancel() can clean up on disconnect.
  let client: SSEClient | null = null;

  const stream = new ReadableStream({
    start(controller) {
      client = {
        userNpub,
        ownerNpub,
        controller,
        connectedAt: Date.now(),
        heartbeatTimer: null,
        lifetimeTimer: null,
      };

      sseHub.addClient(client);

      // Handle replay or catch-up-required
      if (lastEventId != null && !isNaN(lastEventId)) {
        if (sseHub.canReplay(lastEventId)) {
          sseHub.replayFrom(ownerNpub, lastEventId, controller);
        } else {
          // Cursor has been evicted from ring buffer
          const catchUpPayload = `event: catch-up-required\ndata: ${JSON.stringify({ reason: 'cursor_evicted' })}\n\n`;
          try {
            controller.enqueue(new TextEncoder().encode(catchUpPayload));
          } catch {
            // client already gone
          }
        }
      }

      // Send initial connected event
      const connectedPayload = `event: connected\ndata: ${JSON.stringify({ event_id: sseHub.getCurrentEventId() })}\n\n`;
      try {
        controller.enqueue(new TextEncoder().encode(connectedPayload));
      } catch {
        // client already gone
      }
    },
    cancel() {
      // Stream closed by client — explicitly remove from hub to clear
      // timers and connection counts immediately rather than waiting
      // for the next failed sendRaw.
      if (client) sseHub.removeClient(client);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
});
