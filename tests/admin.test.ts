import { describe, expect, test } from 'bun:test';
import { createHash } from 'crypto';
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { createApp } from '../src/server';

describe('Admin table viewer', () => {
  const app = createApp();
  const outsiderSecret = new Uint8Array(32).fill(7);
  const OUTSIDER = nip19.npubEncode(getPublicKey(outsiderSecret));

  function sha256Hex(input: string) {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  function authHeader(path: string, method: string, secret: Uint8Array, body?: unknown) {
    const url = `http://localhost${path}`;
    const tags = [
      ['u', url],
      ['method', method.toUpperCase()],
    ];

    if (body !== undefined) {
      tags.push(['payload', sha256Hex(JSON.stringify(body))]);
    }

    const event = finalizeEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    }, secret);

    return `Nostr ${Buffer.from(JSON.stringify(event), 'utf8').toString('base64')}`;
  }

  test('GET /table-viewer exposes the viewer page', async () => {
    const res = await app.request('/table-viewer');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain('Table Viewer');
    expect(html).toContain('Connection Tokens');
    expect(html).toContain('/api/v4/admin/tables');
    expect(html).toContain('Connect with Nostr');
  });

  test('GET /api/v4/admin/tables requires auth', async () => {
    const res = await app.request('/api/v4/admin/tables');
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('nip98 auth required');
  });

  test('GET /api/v4/admin/tables rejects non-admin npub', async () => {
    const path = '/api/v4/admin/tables';
    const res = await app.request(path, {
      headers: {
        Authorization: authHeader(path, 'GET', outsiderSecret),
      },
    });

    expect(OUTSIDER).not.toBe('npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy');
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBe('admin npub required');
  });
});
